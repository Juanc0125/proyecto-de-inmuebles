import { NextResponse } from 'next/server';
import type { Branding, LogoPosition } from '@shared-types/video';
import { DEFAULT_BRANDING } from '@shared-types/video';
import { createBrandTemplate, listBrandTemplates, safeLogoUrl } from '../../../lib/brand-templates';
import { getVideo } from '../../../lib/video-persistence';

const LOGO_POSITIONS: LogoPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const MAX_NAME_LENGTH = 80;

type CreateBody = {
    name?: unknown;
    video_id?: unknown;
    branding?: unknown;
};

// A template saved from a video is the common case, so the body may name the
// video instead of repeating its branding. An explicit branding object is
// validated the same way the branding endpoint validates a patch.
function coerceBranding(value: unknown): Branding | string {
    if (!value || typeof value !== 'object') return 'branding debe ser un objeto.';
    const source = value as Record<string, unknown>;

    const logoPosition = source.logo_position ?? DEFAULT_BRANDING.logo_position;
    if (typeof logoPosition !== 'string' || !LOGO_POSITIONS.includes(logoPosition as LogoPosition)) {
        return 'logo_position debe ser uno de: top-left, top-right, bottom-left, bottom-right.';
    }

    const primary = source.primary_color ?? DEFAULT_BRANDING.primary_color;
    if (typeof primary !== 'string' || !HEX_COLOR_PATTERN.test(primary)) {
        return 'primary_color debe ser un color hexadecimal valido, por ejemplo #17202a.';
    }

    const secondary = source.secondary_color ?? DEFAULT_BRANDING.secondary_color;
    if (typeof secondary !== 'string' || !HEX_COLOR_PATTERN.test(secondary)) {
        return 'secondary_color debe ser un color hexadecimal valido, por ejemplo #ffffff.';
    }

    const font = source.font_family ?? DEFAULT_BRANDING.font_family;
    if (typeof font !== 'string' || font.trim().length === 0) {
        return 'font_family debe ser un texto no vacio.';
    }

    return {
        // Only a logo already uploaded to this project's bucket; any other URL
        // is dropped rather than handed to the render worker to fetch.
        logo_url: safeLogoUrl(source.logo_url),
        logo_position: logoPosition as LogoPosition,
        primary_color: primary,
        secondary_color: secondary,
        font_family: font,
    };
}

export async function GET() {
    try {
        const templates = await listBrandTemplates();
        return NextResponse.json({ templates });
    } catch (error) {
        console.error('Error al listar las plantillas de marca', error);
        return NextResponse.json({ error: 'No se pudieron cargar las plantillas de marca.' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as CreateBody | null;
    if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'El cuerpo de la solicitud es invalido.' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
        return NextResponse.json({ error: 'El nombre de la plantilla es obligatorio.' }, { status: 400 });
    }
    if (name.length > MAX_NAME_LENGTH) {
        return NextResponse.json({ error: `El nombre no puede superar los ${MAX_NAME_LENGTH} caracteres.` }, { status: 400 });
    }

    let branding: Branding;
    if (body.video_id !== undefined) {
        if (typeof body.video_id !== 'string') {
            return NextResponse.json({ error: 'video_id debe ser un texto.' }, { status: 400 });
        }
        const video = await getVideo(body.video_id);
        if (!video) {
            return NextResponse.json({ error: 'Video no encontrado.' }, { status: 404 });
        }
        branding = { ...video.branding, logo_url: safeLogoUrl(video.branding.logo_url) };
    } else {
        const coerced = coerceBranding(body.branding);
        if (typeof coerced === 'string') {
            return NextResponse.json({ error: coerced }, { status: 400 });
        }
        branding = coerced;
    }

    try {
        const template = await createBrandTemplate(name, branding);
        return NextResponse.json({ template }, { status: 201 });
    } catch (error) {
        console.error('Error al guardar la plantilla de marca', error);
        return NextResponse.json({ error: 'No se pudo guardar la plantilla de marca.' }, { status: 500 });
    }
}
