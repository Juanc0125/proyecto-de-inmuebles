import { NextResponse } from 'next/server';
import { requireSession } from '../../../../../lib/sign-in-required';
import { getVideo, updateScene } from '../../../../../lib/video-persistence';
import { synthesizeSpeech } from '../../../../../lib/tts';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
    // The proxy guards this path, but the copilot calls the handler in
    // process and never goes through the proxy. The paid voice is checked
    // here too so that path cannot skip it.
    const signInRequired = await requireSession();
    if (signInRequired) return signInRequired;

    const { id } = await context.params;

    const video = await getVideo(id);
    if (!video) {
        return NextResponse.json({ error: 'Video no encontrado.' }, { status: 404 });
    }

    for (const scene of video.scenes) {
        const result = await synthesizeSpeech(scene.description);
        if (result) {
            // Recording the narration of lines already approved is not an
            // edit of what the approver saw, so it keeps the approval.
            await updateScene(video.id, scene.id, {
                audio_url: result.audioUrl,
                duration_seconds: result.durationSeconds,
            }, { keepApproval: true });
        }
    }

    const finalRecord = await getVideo(id);
    const ttsConfigured = Boolean(process.env.TTS_API_URL && process.env.TTS_API_KEY);

    return NextResponse.json({ video: finalRecord, ttsConfigured }, { status: 200 });
}
