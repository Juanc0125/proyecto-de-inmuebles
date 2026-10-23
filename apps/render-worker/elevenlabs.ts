import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reportError } from './error-reporting';

// The professional narration voice when it is configured; Piper (voice.ts)
// stays as the fallback, so a scene ElevenLabs cannot voice is still narrated.
//
// Plan: the API's text-to-speech needs a paid plan. On the free plan
// /v1/voices answers 200 while text-to-speech answers 402
// paid_plan_required (measured with a real key, Sept 2026), and the free plan
// has no commercial licence either - this is advertising. Starter is the
// smallest plan that works. `npm run set:ai-key -- elevenlabs` checks the plan
// before installing a key.
//
// Billing: per character of narration. Every render of a NEW line charges;
// re-rendering the same line with the same voice and model is served from the
// disk cache below and charges nothing.
//
// Memory: this is one HTTP call per scene and never loads Piper's WASM runtime,
// which otherwise takes 215-260 MB of the worker's 1 GB for good.
const API_KEY = process.env.ELEVENLABS_API_KEY?.trim();
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID?.trim();
// multilingual_v2 is the endpoint's own default and speaks Spanish;
// eleven_v4 is newer and listed as the highest quality - ELEVENLABS_MODEL
// switches without code.
const MODEL = process.env.ELEVENLABS_MODEL?.trim() || 'eleven_multilingual_v2';
// language_code is rejected by the multilingual_v2 models, accepted by the rest.
const LANGUAGE = MODEL.startsWith('eleven_multilingual') ? undefined : (process.env.ELEVENLABS_LANGUAGE?.trim() || 'es');
// 24 kHz PCM is available below the Pro plan (44.1 kHz PCM is not) and is
// plenty for a voice; ffmpeg resamples it with the rest of the mix.
const SAMPLE_RATE = 24000;
const CACHE_DIR = join(process.env.VOICE_CACHE_DIR ?? join(process.cwd(), '.voice-cache'), 'elevenlabs');
const API_BASE = 'https://api.elevenlabs.io';

// Set once ElevenLabs answers in a way that will not fix itself mid-render (bad
// key, no characters left, plan without API access). Every later scene goes
// straight to Piper instead of paying a round trip to hear the same refusal.
let disabledReason: string | null = null;

export interface ElevenlabsSpeech {
	samples: Float32Array;
	sampleRate: number;
	durationSeconds: number;
	words: { word: string; start: number; end: number }[];
}

type Alignment = {
	characters: string[];
	character_start_times_seconds: number[];
	character_end_times_seconds: number[];
};

type CachedSpeech = { audio_base64: string; alignment: Alignment | null };

export function isElevenlabsEnabled(): boolean {
	return Boolean(API_KEY && VOICE_ID) && !disabledReason;
}

/** Why the voice is not ElevenLabs, for /health; null when it is. */
export function elevenlabsMissingConfig(): string | null {
	if (!API_KEY) return 'falta ELEVENLABS_API_KEY';
	if (!VOICE_ID) return 'falta ELEVENLABS_VOICE_ID';
	return disabledReason;
}

export function elevenlabsVoiceLabel(): string {
	return `${VOICE_ID} (${MODEL})`;
}

// Character timings into word timings, splitting on whitespace exactly as the
// subtitle code splits the same text, so word i here is word i on screen.
function wordsFromAlignment(alignment: Alignment | null) {
	const words: { word: string; start: number; end: number }[] = [];
	if (!alignment) return words;
	let current = '';
	let start = 0;
	let end = 0;
	alignment.characters.forEach((character, i) => {
		if (/\s/.test(character)) {
			if (current) words.push({ word: current, start, end });
			current = '';
			return;
		}
		if (!current) start = alignment.character_start_times_seconds[i] ?? end;
		current += character;
		end = alignment.character_end_times_seconds[i] ?? start;
	});
	if (current) words.push({ word: current, start, end });
	return words;
}

function decodePcm(base64: string): Float32Array {
	const bytes = Buffer.from(base64, 'base64');
	const samples = new Float32Array(Math.floor(bytes.length / 2));
	for (let i = 0; i < samples.length; i += 1) samples[i] = bytes.readInt16LE(i * 2) / 32768;
	return samples;
}

function cachePath(text: string) {
	const key = createHash('sha256').update(JSON.stringify([VOICE_ID, MODEL, LANGUAGE, SAMPLE_RATE, text])).digest('hex');
	return join(CACHE_DIR, `${key}.json`);
}

async function readCache(path: string): Promise<CachedSpeech | null> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as CachedSpeech;
	} catch {
		return null;
	}
}

async function requestSpeech(text: string): Promise<CachedSpeech | null> {
	const url = `${API_BASE}/v1/text-to-speech/${encodeURIComponent(VOICE_ID ?? '')}/with-timestamps?output_format=pcm_${SAMPLE_RATE}`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'xi-api-key': API_KEY ?? '', 'Content-Type': 'application/json', accept: 'application/json' },
		body: JSON.stringify({ text, model_id: MODEL, ...(LANGUAGE ? { language_code: LANGUAGE } : {}) }),
		signal: AbortSignal.timeout(60000),
	});
	if (!response.ok) {
		const detail = (await response.text().catch(() => '')).slice(0, 300);
		// 401: bad key or no characters left (quota_exceeded comes as 401);
		// 402: plan without API text-to-speech. Neither recovers within a render.
		if (response.status === 401 || response.status === 402) {
			disabledReason = `ElevenLabs respondio ${response.status}; se narra con la voz local hasta reiniciar el worker`;
			const error = new Error(`ElevenLabs ${response.status}: ${detail}`);
			console.error(`${disabledReason}.`, detail);
			void reportError(error, { voice_id: VOICE_ID, model: MODEL });
			return null;
		}
		throw new Error(`ElevenLabs respondio ${response.status}: ${detail}`);
	}
	const data = await response.json() as { audio_base64?: string; alignment?: Alignment | null };
	if (!data.audio_base64) throw new Error('ElevenLabs no devolvio audio.');
	return { audio_base64: data.audio_base64, alignment: data.alignment ?? null };
}

/**
 * One scene's narration from ElevenLabs. Returns null when it is not
 * configured or cannot answer - the caller then narrates with Piper. Never
 * throws.
 */
export async function elevenlabsSpeak(text: string): Promise<ElevenlabsSpeech | null> {
	if (!isElevenlabsEnabled()) return null;
	try {
		const path = cachePath(text);
		let speech = await readCache(path);
		if (!speech) {
			speech = await requestSpeech(text);
			if (!speech) return null;
			await mkdir(CACHE_DIR, { recursive: true });
			await writeFile(path, JSON.stringify(speech)).catch(() => undefined);
		}
		const samples = decodePcm(speech.audio_base64);
		if (samples.length === 0) return null;
		return {
			samples,
			sampleRate: SAMPLE_RATE,
			durationSeconds: samples.length / SAMPLE_RATE,
			words: wordsFromAlignment(speech.alignment),
		};
	} catch (error) {
		console.warn('ElevenLabs no pudo narrar esta escena; se usa la voz local.', error);
		return null;
	}
}
