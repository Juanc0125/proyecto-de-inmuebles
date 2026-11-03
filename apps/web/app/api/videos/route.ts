import { NextResponse } from 'next/server';
import { getTemplate } from '@shared-types/templates';
import type { Platform } from '@shared-types/video';
import { MAX_TARGET_DURATION_SECONDS } from '@shared-types/video';
import { coerceVisualStyle, createVideo, listVideos } from '../../../lib/video-persistence';

const PLATFORMS: Platform[] = ['reels', 'tiktok', 'shorts'];

export async function GET() {
    const videos = await listVideos();
    return NextResponse.json({ videos });
}

export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { topic?: unknown; platform?: unknown; targetDurationSeconds?: unknown; template?: unknown; visual_style?: unknown } | null;
    const topic = typeof body?.topic === 'string' ? body.topic.trim() : '';
    const rawPlatform = typeof body?.platform === 'string' ? body.platform : 'reels';
    const platform = (PLATFORMS as string[]).includes(rawPlatform) ? rawPlatform as Platform : null;
    const rawDuration = body?.targetDurationSeconds;
    const targetDurationSeconds = rawDuration === undefined || rawDuration === null
        ? 30
        : (typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0 && rawDuration <= MAX_TARGET_DURATION_SECONDS ? rawDuration : null);

    // Unknown names fall back to 'libre' rather than being rejected: a template
    // is a hint about shape, not something worth failing a creation over.
    const template = getTemplate(body?.template).id;
    // Same leniency: an unknown style is the default, not a failed creation.
    const visualStyle = coerceVisualStyle(body?.visual_style);

    if (!topic) return NextResponse.json({ error: 'El tema es obligatorio.' }, { status: 400 });
    if (!platform) return NextResponse.json({ error: 'La plataforma debe ser reels, tiktok o shorts.' }, { status: 400 });
    if (targetDurationSeconds === null) return NextResponse.json({ error: `La duración objetivo debe ser un número positivo de hasta ${MAX_TARGET_DURATION_SECONDS} segundos.` }, { status: 400 });

    try {
        const record = await createVideo(topic, platform, targetDurationSeconds, template, undefined, visualStyle);
        return NextResponse.json({ video: record }, { status: 201 });
    } catch (error) {
        console.error('Error al crear video', error);
        return NextResponse.json({ error: 'No se pudo crear el video.' }, { status: 500 });
    }
}