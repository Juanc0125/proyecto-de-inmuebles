import { NextResponse } from 'next/server';
import { runCopilot, type CopilotTurn } from '../../../lib/copilot';
import { requireSession } from '../../../lib/sign-in-required';

// usar_mesa_de_trabajo schedules the workbench with after(), which lives only
// as long as this route may; the workbench route itself has the same limit.
export const maxDuration = 300;

// The browser sends the whole visible conversation and the id of the video on
// screen; everything else the copilot needs it reads from the database itself,
// so the client cannot lie about the state of a video.
export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { videoId?: unknown; messages?: unknown } | null;

    const videoId = typeof body?.videoId === 'string' && body.videoId.trim() ? body.videoId.trim() : null;
    const turns: CopilotTurn[] = (Array.isArray(body?.messages) ? body.messages : [])
        .map((entry) => (entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}))
        .filter((entry): entry is { role: 'user' | 'assistant'; content: string } => (
            (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string' && entry.content.trim().length > 0
        ))
        .map((entry) => ({ role: entry.role, content: entry.content.trim() }));

    if (!turns.some((turn) => turn.role === 'user')) {
        return NextResponse.json({ error: 'Falta el mensaje del usuario.' }, { status: 400 });
    }

    try {
        // Open to anyone; only the delete it can perform needs a session.
        const signedIn = (await requireSession()) === null;
        return NextResponse.json(await runCopilot(videoId, turns, signedIn));
    } catch (error) {
        console.error('Fallo el copiloto.', error);
        return NextResponse.json({ error: 'El copiloto no pudo completar la peticion.' }, { status: 500 });
    }
}
