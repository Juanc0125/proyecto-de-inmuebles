import { NextResponse } from 'next/server';
import { getBrandTemplate, safeLogoUrl } from '../../../../../lib/brand-templates';
import { requireSession } from '../../../../../lib/sign-in-required';
import { errorStatus, getVideo, updateBranding } from '../../../../../lib/video-persistence';

type RouteContext = { params: Promise<{ id: string }> };

// Applying a brand template writes the whole identity at once, logo included.
// That is why this is not a PATCH on /branding, which deliberately refuses
// logo_url: there the URL would come from the client, here it comes from a
// template the studio itself stored - and is checked again on the way out,
// since a template saved before that check existed may hold any URL.
export async function POST(request: Request, context: RouteContext) {
    // Guarded in proxy.ts too; repeated here because the copilot calls this
    // handler in process, where the proxy never runs.
    const signInRequired = await requireSession();
    if (signInRequired) return signInRequired;

    const { id } = await context.params;
    const body = await request.json().catch(() => null) as { template_id?: unknown } | null;

    const templateId = body && typeof body.template_id === 'string' ? body.template_id : '';
    if (!templateId) {
        return NextResponse.json({ error: 'template_id es obligatorio.' }, { status: 400 });
    }

    const video = await getVideo(id);
    if (!video) {
        return NextResponse.json({ error: 'Video no encontrado.' }, { status: 404 });
    }

    const template = await getBrandTemplate(templateId);
    if (!template) {
        return NextResponse.json({ error: 'Plantilla de marca no encontrada.' }, { status: 404 });
    }

    try {
        const updated = await updateBranding(id, { ...template.branding, logo_url: safeLogoUrl(template.branding.logo_url) });
        return NextResponse.json({ video: updated });
    } catch (error) {
        console.error('Error al aplicar la plantilla de marca', error);
        const message = error instanceof Error ? error.message : 'Error desconocido';
        return NextResponse.json({ error: message }, { status: errorStatus(error, 500) });
    }
}
