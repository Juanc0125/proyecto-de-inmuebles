import { NextResponse } from 'next/server';
import { readElevenlabsConfig, synthesizeWithElevenlabs } from '../../../lib/elevenlabs-tts';
import { readGoogleTtsConfig, synthesizeWithGoogle } from '../../../lib/google-tts';

// The assistant's voice, first choice to last:
// 1. ElevenLabs when ELEVENLABS_API_KEY is set (voice ELEVENLABS_ASSISTANT_VOICE_ID,
//    model ELEVENLABS_ASSISTANT_MODEL, both with defaults): the voice chosen
//    for the assistant, with per-character timings for the word pulses.
// 2. Google Cloud Text-to-Speech when GOOGLE_TTS_VOICE is set and the service
//    account (GCP_SA_KEY_B64) is readable: a studio-quality voice on the GCP
//    account the render job already uses.
// 3. HeyGen when HEYGEN_API_KEY + HEYGEN_VOICE_ID are set: the same voice the
//    videos use, billed per request against HeyGen's API wallet.
// 4. 204, and the browser speaks the reply with its own built-in voice.
// The paid voices are why proxy.ts keeps this route behind a session.
//
// It never fails the conversation: anything short of playable audio - no key,
// no balance, a rate limit, a timeout - falls through to the next option and
// finally 204.
//
// Response: { audio_url, word_starts }. Google returns no word timings, so its
// word_starts is [] and the client animates without per-word pulses.

// A spoken reply is a sentence or three; the cap keeps one request from
// costing like a script read-out.
const MAX_CHARS = 600;
const TIMEOUT_MS = 8000;

function silent() {
    return new NextResponse(null, { status: 204 });
}

export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { text?: unknown } | null;
    const text = typeof body?.text === 'string' ? body.text.trim().slice(0, MAX_CHARS) : '';
    if (!text) return silent();

    const eleven = readElevenlabsConfig();
    if (eleven) {
        const speech = await synthesizeWithElevenlabs(text, eleven, TIMEOUT_MS);
        if (speech) return NextResponse.json({ audio_url: `data:audio/mpeg;base64,${speech.audio}`, word_starts: speech.wordStarts });
    }

    const google = readGoogleTtsConfig();
    if (google) {
        const audio = await synthesizeWithGoogle(text, google, TIMEOUT_MS);
        if (audio) return NextResponse.json({ audio_url: `data:audio/mpeg;base64,${audio}`, word_starts: [] });
    }

    return speakWithHeyGen(text);
}

async function speakWithHeyGen(text: string): Promise<NextResponse> {
    const apiKey = process.env.HEYGEN_API_KEY?.trim();
    const voiceId = process.env.HEYGEN_VOICE_ID?.trim();
    if (!apiKey || !voiceId) return silent();

    try {
        const response = await fetch('https://api.heygen.com/v3/voices/speech', {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ text, voice_id: voiceId, speed: 1.05 }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            console.warn(`HeyGen TTS respondio ${response.status}; el navegador hablara con su voz. ${detail.slice(0, 200)}`);
            return silent();
        }
        const data = (await response.json() as { data?: { audio_url?: unknown; word_timestamps?: unknown } }).data;
        if (typeof data?.audio_url !== 'string') return silent();

        // Word starts in seconds, so the assistant's figure can pulse on each
        // word the way it does with the browser voice's boundary events.
        const words = Array.isArray(data.word_timestamps)
            ? data.word_timestamps
                .map((entry) => Number((entry as { start?: unknown }).start))
                .filter((start) => Number.isFinite(start) && start >= 0)
            : [];
        return NextResponse.json({ audio_url: data.audio_url, word_starts: words });
    } catch (error) {
        console.warn('Fallo HeyGen TTS; el navegador hablara con su voz.', error);
        return silent();
    }
}
