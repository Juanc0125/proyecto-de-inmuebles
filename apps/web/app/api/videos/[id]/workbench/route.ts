import { NextResponse, after } from 'next/server';
import { errorStatus } from '../../../../../lib/video-persistence';
import { runWorkbench, startWorkbench } from '../../../../../lib/workbench';

type RouteContext = { params: Promise<{ id: string }> };

// The run continues after the 202 inside after(), and after() lives as long as
// this route may: five minutes. lib/workbench.ts stops itself a little before.
export const maxDuration = 300;

// Starts the AI workbench on a video. Answers 202 with the claimed workbench
// ('running') and keeps working in the background, writing each step to
// videos.workbench; the panel polls GET /api/videos. Never approves anything.
export async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as { rewrite_script?: unknown } | null;
    const rewriteScript = body?.rewrite_script === true;

    let video;
    try {
        video = await startWorkbench(id);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido';
        return NextResponse.json({ error: message }, { status: errorStatus(error, 500) });
    }

    const workbench = video.workbench;
    if (workbench) {
        after(async () => {
            await runWorkbench(id, { rewriteScript, workbench });
        });
    }

    return NextResponse.json({ video }, { status: 202 });
}
