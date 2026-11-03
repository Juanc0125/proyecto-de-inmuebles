import { NextResponse } from 'next/server';
import { getTemplate } from '@shared-types/templates';
import type { Platform } from '@shared-types/video';
import { MAX_TARGET_DURATION_SECONDS } from '@shared-types/video';
import { POST as planScenesRoute } from '../[id]/scenes/route';
import { coerceVisualStyle, createVideo, generateScript } from '../../../../lib/video-persistence';
import type { VideoRecord } from '../store';

const PLATFORMS: Platform[] = ['reels', 'tiktok', 'shorts'];

// RF-024, priority "baja": bulk creation of drafts, nothing more. Each topic
// is at least one model call (the script) and two when con_escenas is asked
// for (script + scene plan), so the cap keeps one request from queueing more
// work than the free model tier can take.
const MAX_TOPICS = 8;

const INTERNAL_URL = 'http://batch.local/api';

interface BatchFailure {
    tema: string;
    error: string;
}

// Created, but not the way the operator would expect if they only read
// "creado": the script is the hardcoded fallback, the scenes did not come out,
// or both at once. `motivo` is one spoken sentence for a person; `causa` is
// the same fact in a code the UI can switch on, so it offers "regenera el
// guion" or "pulsa Generar escenas" without pattern-matching Spanish prose -
// a rewritten sentence would silently break that the way a second copy of a
// business rule always does here.
type BatchWarningCause = 'guion_generico' | 'sin_escenas' | 'guion_generico_y_sin_escenas';

interface BatchWarning {
    tema: string;
    causa: BatchWarningCause;
    motivo: string;
}

// The scene planner - its JSON coercion and its sentence fallback - lives only
// in [id]/scenes/route.ts. This calls that handler in process, the same way
// copilot.ts does, instead of keeping a second copy of any of it.
async function planScenes(id: string): Promise<VideoRecord> {
    const response = await planScenesRoute(new Request(INTERNAL_URL, { method: 'POST' }), { params: Promise.resolve({ id }) });
    const payload = await response.json().catch(() => null) as { video?: VideoRecord; error?: string } | null;
    if (!response.ok || !payload?.video) {
        throw new Error(payload?.error ?? 'No se pudieron generar las escenas.');
    }
    return payload.video;
}

// One entry per combination of what quietly went wrong, null when nothing
// did. `scriptIsFallback` comes straight from generateScript; `sceneOutcome`
// is 'ok' when con_escenas was never asked for or came back with at least one
// scene, 'empty' when the planner returned zero scenes without throwing, and
// 'failed' when it threw. 'guion_generico_y_sin_escenas' is a third causa, not
// 'sin_escenas' with a longer sentence: the two underlying problems have two
// different fixes, and squashing them into one code would send the operator
// to only one of the two panels that actually needs attention.
function buildWarning(scriptIsFallback: boolean, sceneOutcome: 'ok' | 'failed' | 'empty'): { causa: BatchWarningCause; motivo: string } | null {
    const scenesMissing = sceneOutcome !== 'ok';
    if (!scriptIsFallback && !scenesMissing) return null;

    if (scriptIsFallback && scenesMissing) {
        return {
            causa: 'guion_generico_y_sin_escenas',
            motivo: sceneOutcome === 'failed'
                ? 'El modelo de lenguaje no respondio (el guion es una plantilla generica) y tampoco se pudieron generar las escenas.'
                : 'El modelo de lenguaje no respondio (el guion es una plantilla generica) y el video no quedo con ninguna escena.',
        };
    }
    if (scriptIsFallback) {
        return { causa: 'guion_generico', motivo: 'El modelo de lenguaje no respondio, asi que el guion es una plantilla generica.' };
    }
    return {
        causa: 'sin_escenas',
        motivo: sceneOutcome === 'failed'
            ? 'El guion quedo bien pero no se pudieron generar las escenas.'
            : 'El guion quedo bien pero el video no quedo con ninguna escena.',
    };
}

export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as {
        temas?: unknown;
        platform?: unknown;
        target_duration_seconds?: unknown;
        template?: unknown;
        con_escenas?: unknown;
        visual_style?: unknown;
    } | null;

    const rawTopics = Array.isArray(body?.temas) ? body.temas : null;
    if (!rawTopics || rawTopics.length === 0) {
        return NextResponse.json({ error: 'Debes indicar al menos un tema.' }, { status: 400 });
    }
    if (rawTopics.length > MAX_TOPICS) {
        return NextResponse.json({ error: `No se pueden pedir mas de ${MAX_TOPICS} temas por lote.` }, { status: 400 });
    }

    // Same defaults and the same rejection as POST /api/videos: a platform the
    // client did not send becomes 'reels', one it sent but misspelled is a 4xx.
    const rawPlatform = typeof body?.platform === 'string' ? body.platform : 'reels';
    const platform = (PLATFORMS as string[]).includes(rawPlatform) ? rawPlatform as Platform : null;
    if (!platform) {
        return NextResponse.json({ error: 'La plataforma debe ser reels, tiktok o shorts.' }, { status: 400 });
    }

    const rawDuration = body?.target_duration_seconds;
    const targetDurationSeconds = rawDuration === undefined || rawDuration === null
        ? 30
        : (typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0 && rawDuration <= MAX_TARGET_DURATION_SECONDS ? rawDuration : null);
    if (targetDurationSeconds === null) {
        return NextResponse.json({ error: `La duración objetivo debe ser un número positivo de hasta ${MAX_TARGET_DURATION_SECONDS} segundos.` }, { status: 400 });
    }

    // Unknown template names fall back to 'libre' rather than failing the whole
    // batch over one field, same as POST /api/videos.
    const template = getTemplate(body?.template).id;
    const conEscenas = body?.con_escenas === true;
    const visualStyle = coerceVisualStyle(body?.visual_style);

    // Blank and repeated topics are not a mistake worth reporting back, so they
    // are dropped quietly instead of becoming an entry in `fallidos`.
    const seen = new Set<string>();
    const temas: string[] = [];
    for (const raw of rawTopics) {
        const tema = typeof raw === 'string' ? raw.trim() : '';
        if (!tema || seen.has(tema.toLowerCase())) continue;
        seen.add(tema.toLowerCase());
        temas.push(tema);
    }
    if (temas.length === 0) {
        return NextResponse.json({ error: 'Debes indicar al menos un tema.' }, { status: 400 });
    }

    const creados: VideoRecord[] = [];
    const fallidos: BatchFailure[] = [];
    const advertencias: BatchWarning[] = [];

    // Sequential, not Promise.all: Groq's free tier is roughly 7000 tokens a
    // minute, and firing every script (plus every scene plan) at once trades a
    // useful partial result for a wall of rate-limit failures. Sequential also
    // means a failure partway through never costs the videos already created.
    for (const tema of temas) {
        try {
            // Generated here, not inside createVideo, so this route can see
            // whether the model actually answered before deciding if the topic
            // needs a warning - createVideo just takes the text and saves it.
            const { text: script, fromModel } = await generateScript(tema, template);
            const video = await createVideo(tema, platform, targetDurationSeconds, template, script, visualStyle);

            if (!conEscenas) {
                creados.push(video);
                const warning = buildWarning(!fromModel, 'ok');
                if (warning) advertencias.push({ tema, ...warning });
                continue;
            }

            try {
                const withScenes = await planScenes(video.id);
                creados.push(withScenes);
                const warning = buildWarning(!fromModel, withScenes.scenes.length === 0 ? 'empty' : 'ok');
                if (warning) advertencias.push({ tema, ...warning });
            } catch (sceneError) {
                // The draft itself already saved with a real script; discarding it
                // because the optional scene step failed would throw away working
                // output over something the operator can retry from the panel.
                console.warn(`Fallo al generar escenas para "${tema}" dentro del lote.`, sceneError);
                creados.push(video);
                // 'failed' always counts as scenes missing, so this is never null.
                const warning = buildWarning(!fromModel, 'failed');
                if (warning) advertencias.push({ tema, ...warning });
            }
        } catch (error) {
            fallidos.push({ tema, error: error instanceof Error ? error.message : 'Error desconocido.' });
        }
    }

    return NextResponse.json({ creados, fallidos, advertencias });
}
