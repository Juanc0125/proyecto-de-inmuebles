import { createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import bz2 from 'unbzip2-stream';
import { extract } from 'tar-stream';
import { elevenlabsSpeak } from './elevenlabs';

// RF-003: the narration voice. Runs locally through sherpa-onnx, which ships
// as WebAssembly rather than a native binary - so unlike every other native
// piece in this worker, it behaves identically on Windows and on Railway's
// Linux container. No API key and no per-video cost.
//
// The voice model is ~67MB and is not in the repo, so it is fetched once per
// container into VOICE_CACHE_DIR. Rendering waits on that download the first
// time; every later render reuses it.
const MODEL_NAME = process.env.VOICE_MODEL ?? 'vits-piper-es_MX-claude-high';
// Every piper archive holds one .onnx named after the model without the
// vendor prefix, so changing voice is one variable. VOICE_MODEL_FILE stays as
// an escape hatch for a model that breaks the convention.
const MODEL_FILE = process.env.VOICE_MODEL_FILE ?? `${MODEL_NAME.replace(/^vits-piper-/, '')}.onnx`;
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${MODEL_NAME}.tar.bz2`;
const CACHE_DIR = process.env.VOICE_CACHE_DIR ?? join(process.cwd(), '.voice-cache');
const SPEAKING_RATE = Number(process.env.VOICE_SPEED ?? 1);

export interface Speech {
	samples: Float32Array;
	sampleRate: number;
	durationSeconds: number;
	/** Exact per-word timings, when the voice reports them (ElevenLabs does). */
	words?: WordTiming[];
}

let modelPromise: Promise<string | null> | null = null;
let ttsInstance: { generate: (options: { text: string; sid: number; speed: number }) => { samples: Float32Array; sampleRate: number } } | null = null;

async function exists(path: string) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function downloadModel(): Promise<string | null> {
	const modelDirectory = join(CACHE_DIR, MODEL_NAME);
	// The model file alone is not proof of a usable cache: a copied project once
	// arrived with the .onnx intact but espeak-ng-data almost empty, sherpa-onnx
	// refused the config, and every scene came out silent while the render
	// itself reported success. phontab is what sherpa-onnx checks first.
	if (await exists(join(modelDirectory, MODEL_FILE)) && await exists(join(modelDirectory, 'espeak-ng-data', 'phontab'))) {
		return modelDirectory;
	}

	// Extract into a staging directory and rename on success, so an interrupted
	// download can never leave a half-written model that looks complete.
	const staging = `${modelDirectory}.partial`;
	await rm(staging, { recursive: true, force: true });
	await mkdir(staging, { recursive: true });

	console.log(`Descargando el modelo de voz ${MODEL_NAME} (unica vez por contenedor)...`);
	const response = await fetch(MODEL_URL);
	if (!response.ok || !response.body) throw new Error(`No se pudo descargar el modelo de voz: HTTP ${response.status}`);

	const archive = extract();
	archive.on('entry', (header, stream, next) => {
		// Archive paths are prefixed with the model folder; strip it so the
		// layout under the staging directory matches what sherpa-onnx expects.
		const relative = header.name.replace(/^[^/]+\/?/, '');
		if (!relative || header.type === 'directory') {
			stream.resume();
			stream.on('end', next);
			return;
		}
		const target = join(staging, relative);
		mkdir(join(target, '..'), { recursive: true })
			.then(() => pipeline(stream, createWriteStream(target)))
			.then(() => next())
			.catch((error) => archive.destroy(error));
	});

	await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), bz2(), archive);
	await rm(modelDirectory, { recursive: true, force: true });
	await rename(staging, modelDirectory);
	console.log('Modelo de voz listo.');
	return modelDirectory;
}

/** Downloads the voice model if needed. Safe to call repeatedly; only runs once. */
export function ensureVoiceModel(): Promise<string | null> {
	if (!modelPromise) {
		modelPromise = downloadModel().catch((error) => {
			console.warn('No se pudo preparar el modelo de voz; los videos saldran sin narracion.', error);
			// Cleared so a later render can retry rather than being stuck with
			// a failure cached for the life of the container.
			modelPromise = null;
			return null;
		});
	}
	return modelPromise;
}

async function getTts() {
	if (ttsInstance) return ttsInstance;
	const modelDirectory = await ensureVoiceModel();
	if (!modelDirectory) return null;

	// Required lazily: loading the WASM runtime costs ~1.5s, which is wasted on
	// a worker that only ever serves /health.
	//
	// Budget note, found while chasing the render-worker OOM: require('sherpa-onnx')
	// instantiates ONE WebAssembly module at import time (see sherpa-onnx's own
	// index.js), shared by every createOfflineTts() call for the rest of the
	// process's life - there is no dispose/free exposed, and WASM linear memory
	// can only grow, never shrink. Measured directly: Node's RSS jumps from
	// ~42MB to ~215-260MB on the very FIRST speak() call in a container's
	// lifetime (most of it is almost certainly the ~63MB "high" quality Piper
	// model's weights plus onnxruntime's own arena allocations, not the
	// inference itself - a second, different sentence only added another
	// ~18MB). That 215-260MB is a PERMANENT floor for the rest of the
	// container's life once any scene has been narrated, not something a
	// render can free when it finishes - roughly a quarter of a 1GB container
	// on its own. It is the cost of keeping narration free and offline (see
	// the module comment above), and is unrelated to - and additive with -
	// whatever a given render's own canvases/ffmpeg encodes are using at the
	// same time.
	const sherpa = require('sherpa-onnx');
	ttsInstance = sherpa.createOfflineTts({
		model: {
			vits: {
				model: join(modelDirectory, MODEL_FILE),
				tokens: join(modelDirectory, 'tokens.txt'),
				dataDir: join(modelDirectory, 'espeak-ng-data'),
				noiseScale: 0.667,
				noiseScaleW: 0.8,
				lengthScale: 1,
			},
			numThreads: 1,
			debug: 0,
			provider: 'cpu',
		},
		maxNumSentences: 1,
	});
	return ttsInstance;
}

/** Narrates one line. Returns null when the voice is unavailable - never throws. */
export async function speak(text: string): Promise<Speech | null> {
	const trimmed = text.trim();
	if (!trimmed) return null;

	// The professional voice first, when configured. Piper below is the
	// fallback, so a scene ElevenLabs cannot voice is still narrated.
	const professional = await elevenlabsSpeak(trimmed);
	if (professional) return professional;

	try {
		const tts = await getTts();
		if (!tts) return null;
		const audio = tts.generate({ text: trimmed, sid: 0, speed: SPEAKING_RATE });
		return {
			samples: audio.samples,
			sampleRate: audio.sampleRate,
			durationSeconds: audio.samples.length / audio.sampleRate,
		};
	} catch (error) {
		console.warn('Fallo la sintesis de voz para una escena; esa escena quedara en silencio.', error);
		return null;
	}
}

/**
 * Per-frame mouth opening (0..1) taken from the loudness of the narration, so
 * the mouth actually follows the words rather than flapping on a timer.
 * Uses RMS over each frame's slice of audio, normalised against the loudest
 * frame so quiet voices still animate, with a little smoothing so the jaw
 * doesn't chatter between frames.
 */
export function mouthEnvelope(speech: Speech, frameRate: number, frameCount: number): number[] {
	const samplesPerFrame = speech.sampleRate / frameRate;
	const raw: number[] = [];

	for (let frame = 0; frame < frameCount; frame += 1) {
		const start = Math.floor(frame * samplesPerFrame);
		const end = Math.min(speech.samples.length, Math.floor((frame + 1) * samplesPerFrame));
		let sum = 0;
		for (let i = start; i < end; i += 1) sum += speech.samples[i] * speech.samples[i];
		raw.push(end > start ? Math.sqrt(sum / (end - start)) : 0);
	}

	const loudest = Math.max(...raw, 1e-6);
	let previous = 0;
	return raw.map((value) => {
		// sqrt pulls quiet syllables up so the mouth reads on soft speech too.
		const target = Math.min(1, Math.sqrt(value / loudest));
		previous = previous * 0.45 + target * 0.55;
		return previous;
	});
}

export function voiceModelName() {
	return MODEL_NAME;
}

export interface WordTiming {
	word: string;
	start: number;
	end: number;
}

/**
 * Approximates when each word of a subtitle line is spoken, for the
 * karaoke-style highlight in drawSceneFrame. There is no offline word-level
 * ASR alignment available, so timing starts from each word's character
 * length (a longer word is assumed to take proportionally longer to say,
 * with every word given a fixed minimum share so short ones like "de" or "y"
 * don't collapse to nothing) and, when the narration was actually
 * synthesised locally, is refined against its loudness envelope: a boundary
 * is snapped to the quietest nearby frame, which is usually the small gap
 * between two words. Without an envelope (silent scenes, or narration that
 * came in as scene.audio_url rather than through speak()) it falls back to
 * the length-only estimate across the known scene duration.
 */
export function estimateWordTimings(text: string, totalDuration: number, envelope: number[] | null, frameRate: number): WordTiming[] {
	const words = text.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0 || totalDuration <= 0) return [];

	const weights = words.map((word) => word.length + 3);
	const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

	const boundaries: number[] = [0];
	let cumulative = 0;
	for (const weight of weights) {
		cumulative += weight;
		boundaries.push((cumulative / totalWeight) * totalDuration);
	}

	if (envelope && envelope.length > 1) {
		const frameDuration = 1 / frameRate;
		const searchSeconds = 0.12;
		for (let i = 1; i < boundaries.length - 1; i += 1) {
			const center = Math.round(boundaries[i] / frameDuration);
			const span = Math.max(1, Math.round(searchSeconds / frameDuration));
			const lo = Math.max(0, center - span);
			const hi = Math.min(envelope.length - 1, center + span);
			let quietestIndex = clampIndex(center, envelope.length);
			let quietestValue = envelope[quietestIndex] ?? 1;
			for (let frame = lo; frame <= hi; frame += 1) {
				if (envelope[frame] < quietestValue) {
					quietestValue = envelope[frame];
					quietestIndex = frame;
				}
			}
			boundaries[i] = quietestIndex * frameDuration;
		}
		// Snapping to envelope minima can pull a boundary earlier than the one
		// before it on very short words; keep the sequence monotonic so no
		// word ends up with a zero or negative duration.
		for (let i = 1; i < boundaries.length; i += 1) {
			boundaries[i] = Math.max(boundaries[i], boundaries[i - 1] + frameDuration);
		}
	}

	return words.map((word, i) => ({ word, start: boundaries[i], end: boundaries[i + 1] }));
}

function clampIndex(index: number, length: number) {
	return Math.max(0, Math.min(length - 1, index));
}
