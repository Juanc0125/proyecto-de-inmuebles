import { describeGoogleError, getAccessToken, readServiceAccountKey, resetTokenCache, type ServiceAccountKey } from './google-auth';

// The assistant's voice from Google Cloud Text-to-Speech. Lives here rather
// than in the route because a Next route file may only export handlers, and
// this is what the tests drive with a mocked fetch.

const SYNTHESIZE_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
// The API's own bounds for speakingRate.
const MIN_RATE = 0.25;
const MAX_RATE = 2;

export type GoogleTtsConfig = {
    voice: string;
    languageCode: string;
    speakingRate: number;
    key: ServiceAccountKey;
};

// Voice names start with their locale ('es-US-Chirp3-HD-Achernar' is es-US),
// and the API wants that locale repeated as languageCode.
export function languageCodeFromVoice(voice: string): string | null {
    return voice.match(/^([a-z]{2,3}-[A-Z]{2})-/)?.[1] ?? null;
}

function readRate(raw: string | undefined): number {
    const rate = Number(raw?.trim());
    if (!raw?.trim() || !Number.isFinite(rate)) return 1;
    return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

// Null when the voice is not configured, its name carries no locale, or there
// are no usable credentials: the caller then moves on to the next voice.
export function readGoogleTtsConfig(env: NodeJS.ProcessEnv = process.env): GoogleTtsConfig | null {
    const voice = env.GOOGLE_TTS_VOICE?.trim() ?? '';
    if (!voice) return null;
    const languageCode = languageCodeFromVoice(voice);
    if (!languageCode) {
        console.warn(`GOOGLE_TTS_VOICE "${voice}" no empieza por un idioma (ej. es-US-...); se omite la voz de Google.`);
        return null;
    }
    const key = readServiceAccountKey(env);
    if (!key) return null;
    return { voice, languageCode, speakingRate: readRate(env.GOOGLE_TTS_RATE), key };
}

// Returns the MP3 as base64, or null on any failure (logged without secrets).
// The timeout covers the token exchange too, so a slow first call (no cached
// token yet) cannot keep the person waiting past it.
export async function synthesizeWithGoogle(
    text: string,
    config: GoogleTtsConfig,
    timeoutMs: number,
    fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
            controller.abort();
            console.warn(`Google TTS no respondio en ${timeoutMs} ms.`);
            resolve(null);
        }, timeoutMs);
    });
    try {
        return await Promise.race([requestSpeech(text, config, controller.signal, fetchImpl), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

// Chirp3-HD voices reject SSML and pitch, so neither is sent.
async function requestSpeech(text: string, config: GoogleTtsConfig, signal: AbortSignal, fetchImpl: typeof fetch): Promise<string | null> {
    try {
        const token = await getAccessToken(config.key, fetchImpl);
        const response = await fetchImpl(SYNTHESIZE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                input: { text },
                voice: { languageCode: config.languageCode, name: config.voice },
                audioConfig: { audioEncoding: 'MP3', speakingRate: config.speakingRate },
            }),
            signal,
        });
        const body = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (!response.ok) {
            if (response.status === 401) resetTokenCache();
            console.warn(`Google TTS respondio ${response.status}: ${describeGoogleError(body)}`);
            return null;
        }
        const audio = body.audioContent;
        return typeof audio === 'string' && audio.length > 0 ? audio : null;
    } catch (error) {
        // GoogleAuthError carries only Google's error code/description; an
        // abort or network error carries no request data either.
        console.warn('Fallo Google TTS.', error instanceof Error ? error.message : String(error));
        return null;
    }
}
