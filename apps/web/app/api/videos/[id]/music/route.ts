import { NextResponse } from 'next/server';
import { SOUNDS_MIGRATION_MISSING_ERROR, getSound } from '../../../../../lib/sounds';
import { getVideo, setVideoMusic } from '../../../../../lib/video-persistence';

type RouteContext = { params: Promise<{ id: string }> };

// RF-010: one background track per video. Changing it sends an approved
// video back to draft (RF-012), the same as branding: see setVideoMusic.
export async function PATCH(request: Request, context: RouteContext) {
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as { music_id?: unknown } | null;

    if (!body || typeof body !== 'object' || !('music_id' in body)) {
        return NextResponse.json({ error: 'Envia music_id: el identificador de la musica, o null para quitarla.' }, { status: 400 });
    }

    const musicId = body.music_id;
    if (musicId !== null) {
        if (typeof musicId !== 'string') {
            return NextResponse.json({ error: 'music_id debe ser un texto o null.' }, { status: 400 });
        }
        const sound = await getSound(musicId);
        if (!sound) {
            return NextResponse.json({ error: 'La musica elegida no existe.' }, { status: 400 });
        }
        if (sound.kind !== 'musica') {
            return NextResponse.json({ error: 'El sonido elegido es un efecto, no una musica de fondo.' }, { status: 400 });
        }
    }

    const video = await getVideo(id);
    if (!video) {
        return NextResponse.json({ error: 'Video no encontrado.' }, { status: 404 });
    }

    try {
        const updated = await setVideoMusic(id, musicId);
        return NextResponse.json({ video: updated });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido';
        if (message === 'Video no encontrado.') return NextResponse.json({ error: message }, { status: 404 });
        if (message === SOUNDS_MIGRATION_MISSING_ERROR) return NextResponse.json({ error: message }, { status: 500 });
        console.error('Error al guardar la musica del video', error);
        return NextResponse.json({ error: 'No se pudo guardar la musica del video.' }, { status: 500 });
    }
}
