// The assistant's voice from ElevenLabs, its first choice. Lives here rather
// than in the route because a Next route file may only export handlers, and
// this is what the tests drive with a mocked fetch. The render worker has its
// own client (apps/render-worker/elevenlabs.ts) with the same request shape;
// the two apps deploy separately and share no code.
//
// Billing: per character, on the same account as the video narration. The
// route caps a reply at 600 characters.

const API_BASE = 'https://api.elevenlabs.io';
// "Jessica - Playful, Bright, Warm", chosen for the assistant.
export const DEFAULT_ASSISTANT_VOICE_ID = 'cgSgspJ2msm6clMCkdW9';
// Flash v2.5 answers fastest and speaks Spanish; a conversation notices
// latency more than the last bit of quality.
export const DEFAULT_ASSISTANT_MODEL = 'eleven_flash_v2_5';
const OUTPUT_FORMAT = 'mp3_44100_128';

export type ElevenlabsTtsConfig = {
    apiKey: string;
    voiceId: string;
    model: string;
    // Undefined for the multilingual_v2 models, which reject language_code.
    languageCode?: string;
};

export type ElevenlabsSpeech = {
    // MP3 as base64.
    audio: string;
    // Start second of each word, in order.
    wordStarts: number[];
};

type Alignment = {
    characters?: unknown;
    character_start_times_seconds?: unknown;
};

// Null without a key: the caller moves on to the next voice. The voice has a
// default so that setting the key alone is enough.
export function readElevenlabsConfig(env: NodeJS.ProcessEnv = process.env): ElevenlabsTtsConfig | null {
    const apiKey = env.ELEVENLABS_API_KEY?.trim() ?? '';
    if (!apiKey) return null;
    const voiceId = env.ELEVENLABS_ASSISTANT_VOICE_ID?.trim() || DEFAULT_ASSISTANT_VOICE_ID;
    const model = env.ELEVENLABS_ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL;
    const languageCode = model.startsWith('eleven_multilingual') ? undefined : 'es';
    return { apiKey, voiceId, model, languageCode };
}

// A word starts at its first non-space character. Splitting on whitespace
// matches how the client splits the reply for its per-word pulses.
export function wordStartsFromAlignment(alignment: Alignment | null | undefined): number[] {
    const characters = alignment?.characters;
    const starts = alignment?.character_start_times_seconds;
    if (!Array.isArray(characters) || !Array.isArray(starts)) return [];
    const result: number[] = [];
    let inWord = false;
    characters.forEach((character, i) => {
        if (typeof character !== 'string' || /^\s*$/.test(character)) {
            inWord = false;
            return;
        }
        if (inWord) return;
        inWord = true;
        const start = Number(starts[i]);
        if (Number.isFinite(start) && start >= 0) result.push(start);
    });
    return result;
}

// Returns the speech, or null on any failure (no balance, rate limit, timeout,
// network) after logging the status and a short detail - never the key.
export async function synthesizeWithElevenlabs(
    text: string,
    config: ElevenlabsTtsConfig,
    timeoutMs: number,
    fetchImpl: typeof fetch = fetch,
): Promise<ElevenlabsSpeech | null> {
    const url = `${API_BASE}/v1/text-to-speech/${encodeURIComponent(config.voiceId)}/with-timestamps?output_format=${OUTPUT_FORMAT}`;
    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'xi-api-key': config.apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
                text,
                model_id: config.model,
                ...(config.languageCode ? { language_code: config.languageCode } : {}),
            }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
            const detail = (await response.text().catch(() => '')).slice(0, 200);
            console.warn(`ElevenLabs TTS respondio ${response.status}; se prueba la siguiente voz. ${detail}`);
            return null;
        }
        const data = await response.json() as { audio_base64?: unknown; alignment?: Alignment | null };
        if (typeof data.audio_base64 !== 'string' || !data.audio_base64) {
            console.warn('ElevenLabs TTS no devolvio audio; se prueba la siguiente voz.');
            return null;
        }
        return { audio: data.audio_base64, wordStarts: wordStartsFromAlignment(data.alignment) };
    } catch (error) {
        // An abort or network error carries no request data, so no key leaks.
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        console.warn(`Fallo ElevenLabs TTS; se prueba la siguiente voz. ${message.slice(0, 200)}`);
        return null;
    }
}
