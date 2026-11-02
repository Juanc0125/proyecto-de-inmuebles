import { NextResponse } from 'next/server';
import type { SoundKind } from '@shared-types/sounds';
import { SOUND_KINDS, listSounds, registerSound } from '../../../lib/sounds';
import { ensureDemoUser } from '../../../lib/video-persistence';

const MAX_NAME_LENGTH = 80;
const MAX_LICENSE_LENGTH = 300;

type RegisterBody = {
    name?: unknown;
    kind?: unknown;
    path?: unknown;
    licencia?: unknown;
};

export async function GET() {
    try {
        const sonidos = await listSounds();
        return NextResponse.json({ sonidos });
    } catch (error) {
        console.error('Error al listar los sonidos', error);
        return NextResponse.json({ error: 'No se pudieron cargar los sonidos.' }, { status: 500 });
    }
}

// Second half of an upload: the browser already PUT the file to the signed URL
// from /api/sounds/upload-url, and this records it with the license the
// business declares. Without a stated license a sound is never registered -
// RF-010 asks for audio cleared for commercial use.
export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as RegisterBody | null;
    if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'El cuerpo de la solicitud es invalido.' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
        return NextResponse.json({ error: 'El nombre del sonido es obligatorio.' }, { status: 400 });
    }
    if (name.length > MAX_NAME_LENGTH) {
        return NextResponse.json({ error: `El nombre no puede superar los ${MAX_NAME_LENGTH} caracteres.` }, { status: 400 });
    }

    // Only effects exist now; a missing kind means one, so the upload form
    // does not need a selector with a single option.
    const kind = body.kind === undefined ? 'efecto' : body.kind;
    if (kind === 'musica') {
        return NextResponse.json({ error: 'La música de fondo ya no está disponible; solo se pueden subir efectos de sonido.' }, { status: 400 });
    }
    if (typeof kind !== 'string' || !SOUND_KINDS.includes(kind as SoundKind)) {
        return NextResponse.json({ error: 'El tipo debe ser "efecto".' }, { status: 400 });
    }

    const licencia = typeof body.licencia === 'string' ? body.licencia.trim() : '';
    if (!licencia) {
        return NextResponse.json({ error: 'Indica la licencia: quién tiene los derechos de uso comercial de este audio.' }, { status: 400 });
    }
    if (licencia.length > MAX_LICENSE_LENGTH) {
        return NextResponse.json({ error: `La licencia no puede superar los ${MAX_LICENSE_LENGTH} caracteres.` }, { status: 400 });
    }

    const path = typeof body.path === 'string' ? body.path.trim() : '';
    if (!path.startsWith('subidos/')) {
        return NextResponse.json({ error: 'La ruta del archivo debe empezar por "subidos/".' }, { status: 400 });
    }

    try {
        const userId = await ensureDemoUser();
        const result = await registerSound({ name, kind: kind as SoundKind, path, license: licencia }, userId);
        if (!result.ok) {
            return NextResponse.json({ error: result.error }, { status: result.status });
        }
        return NextResponse.json({ sonido: result.sonido }, { status: 201 });
    } catch (error) {
        console.error('Error al registrar el sonido', error);
        return NextResponse.json({ error: 'No se pudo registrar el sonido.' }, { status: 500 });
    }
}
