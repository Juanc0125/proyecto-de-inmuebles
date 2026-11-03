import { NextResponse } from 'next/server';
import { errorStatus } from '../../../../../../../lib/video-persistence';
import { regenerateSceneImage } from '../../../../../../../lib/workbench';

type RouteContext = { params: Promise<{ id: string; sceneId: string }> };

// One image takes up to ~45 s on the free sources, plus the upload.
export const maxDuration = 60;

// Regenerates the photorealistic still of one scene, synchronously. Body is
// optional: { refresh_prompt: true } asks the art director for a new prompt
// instead of reusing the stored one. A new picture is a content edit, so the
// usual RF-012 revert applies.
export async function POST(request: Request, context: RouteContext) {
    const { id, sceneId } = await context.params;
    const body = await request.json().catch(() => null) as { refresh_prompt?: unknown } | null;
    try {
        const video = await regenerateSceneImage(id, sceneId, { refreshPrompt: body?.refresh_prompt === true });
        return NextResponse.json({ video });
    } catch (error) {
        console.error('No se pudo regenerar la imagen de la escena.', error);
        const message = error instanceof Error ? error.message : 'No se pudo regenerar la imagen.';
        return NextResponse.json({ error: message }, { status: errorStatus(error, 500) });
    }
}
