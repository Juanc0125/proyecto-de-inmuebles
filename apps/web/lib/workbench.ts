import type { CharacterType, Scene, SceneAction, ScenePropType, Workbench, WorkbenchRole, WorkbenchStep } from '@shared-types/video';
import { POST as planScenesRoute } from '../app/api/videos/[id]/scenes/route';
import type { VideoRecord } from '../app/api/videos/store';
import { generateWithProvider, generateWithVision, type GenerationResult } from './ai-provider';
import { IMAGE_TIMEOUT_MS, generateSceneImage, uploadSceneImage, type GeneratedImage } from './scene-images';
import { VideoError, VIDEO_NOT_FOUND, claimWorkbench, generateScript, getVideo, saveWorkbench, updateScene, updateScript } from './video-persistence';

// The AI workbench ("mesa de trabajo"): free providers taking turns on one
// video, each in the role it does best, every turn written to videos.workbench
// so the panel can show the table at work. Nothing here approves, publishes or
// renders (RF-012): the run ends with a draft a person still has to review.

// Who sits where. A preference only: when that provider has no key, no credit
// or is saturated, the rest of the chain takes the seat and the step records
// who actually answered.
export const ROLE_PROVIDER: Partial<Record<WorkbenchRole, string>> = {
    guionista: 'gemini',
    director: 'groq',
    cumplimiento: 'mistral',
    critico: 'openrouter',
    director_arte: 'groq',
    revisor_visual: 'gemini',
};

const MAX_COMPLIANCE_ROUNDS = 2;
const CRITIQUE_THRESHOLD = 7;
const IMAGE_CONCURRENCY = 2;

// The route's maxDuration is 300 s; the run stops a little before so it can
// still write down why it stopped.
export const RUN_BUDGET_MS = 280_000;

const LIMITES = 'Nada de aprobaciones prometidas, tasas, cuotas o montos inventados, garantias, ni asesoria financiera personalizada, ni nombres de entidades.';
const BUDGET_EXCEEDED = 'La mesa de trabajo se quedó sin tiempo antes de terminar. Lo hecho quedó guardado; las escenas sin imagen se pueden generar una por una.';

class BudgetExceeded extends Error {}

// ---- JSON from models -----------------------------------------------------

// Models wrap JSON in fences or prose; the first {...} block is taken.
export function extractJsonObject(text: string): Record<string, unknown> | null {
    const clean = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const candidates = [clean];
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) candidates.push(clean.slice(start, end + 1));
    for (const candidate of candidates) {
        try {
            const parsed: unknown = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
        } catch {
            // next candidate
        }
    }
    return null;
}

function text(value: unknown, max: number): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export interface ComplianceReview {
    ok: boolean;
    issues: string[];
    fixed_script: string | null;
    fixed_scenes: { order: number; description: string }[];
}

/** Null when the text holds no usable review; `ok` is never trusted over a non-empty issue list. */
export function parseComplianceReview(raw: string): ComplianceReview | null {
    const json = extractJsonObject(raw);
    if (!json) return null;
    const issues = Array.isArray(json.issues)
        ? json.issues.map((issue) => (typeof issue === 'string' ? issue.trim() : text((issue as Record<string, unknown> | null)?.descripcion ?? (issue as Record<string, unknown> | null)?.description, 300))).filter(Boolean).slice(0, 10)
        : [];
    if (typeof json.ok !== 'boolean' && !Array.isArray(json.issues)) return null;
    const ok = json.ok === true && issues.length === 0;
    const fixedScript = text(json.fixed_script, 4000) || null;
    const fixedScenes = Array.isArray(json.fixed_scenes)
        ? json.fixed_scenes.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return [];
            const record = entry as Record<string, unknown>;
            const order = Number(record.order);
            const description = text(record.description, 300);
            return Number.isInteger(order) && order > 0 && description ? [{ order, description }] : [];
        })
        : [];
    return { ok, issues, fixed_script: ok ? null : fixedScript, fixed_scenes: ok ? [] : fixedScenes };
}

export interface Critique {
    hook: number;
    clarity: number;
    pacing: number;
    cta: number;
    average: number;
    comments: string;
}

function score(value: unknown): number | null {
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? Math.min(10, Math.max(1, num)) : null;
}

export function parseCritique(raw: string): Critique | null {
    const json = extractJsonObject(raw);
    if (!json) return null;
    const hook = score(json.hook ?? json.gancho);
    const clarity = score(json.clarity ?? json.claridad);
    const pacing = score(json.pacing ?? json.ritmo);
    const cta = score(json.cta ?? json.llamado);
    if (hook === null || clarity === null || pacing === null || cta === null) return null;
    const average = Math.round(((hook + clarity + pacing + cta) / 4) * 10) / 10;
    const comments = text(json.critique ?? json.comentarios ?? json.comments, 1500);
    return { hook, clarity, pacing, cta, average, comments };
}

export interface VisualReview { ok: boolean; reason: string; fixHint: string }

export function parseVisualReview(raw: string): VisualReview | null {
    const json = extractJsonObject(raw);
    if (!json || typeof json.ok !== 'boolean') return null;
    return { ok: json.ok, reason: text(json.reason, 300), fixHint: text(json.fix_hint, 300) };
}

// ---- Art direction ---------------------------------------------------------

// Appended in code, not left to the model: these are the constraints the
// render depends on (subtitles in the lower third, no text in the picture).
// The fallback model (FLUX.1 schnell) makes squares, so the subject is kept centred
// for a 9:16 cover crop.
export const PHOTO_STYLE = 'Photorealistic vertical 9:16 photograph, shot on 35mm film camera, natural soft daylight, Latin American setting, realistic skin texture, main subject centered horizontally and placed in the upper two thirds of the frame, lower third of the frame calm and uncluttered, no text, no letters, no captions, no logos, no brand names, no watermark.';

export const DEFAULT_CHARACTER_BIBLE: Record<CharacterType, string> = {
    broker: 'a Latin American mortgage advisor in his late 30s, short dark hair, light blue shirt and navy blazer, warm confident expression',
    cliente: 'a Latin American woman in her early 30s, shoulder-length wavy brown hair, mustard knit sweater',
    pareja: 'a young Latin American couple in their early 30s, she with long dark hair and a white blouse, he with a short beard and a denim shirt',
    hombre: 'a Latin American man in his 40s, salt-and-pepper hair, grey polo shirt',
    mujer: 'a Latin American woman in her 50s, short curly hair, green cardigan',
    generico: 'a Latin American adult in casual everyday clothes',
};

const ACTION_EN: Record<SceneAction, string> = {
    hablar: 'talking expressively to someone off camera',
    caminar: 'walking along a residential street',
    senalar: 'pointing at something while explaining',
    sentarse: 'sitting at a table, relaxed',
    pensar: 'looking thoughtful and a little worried',
    telefono: 'talking on a mobile phone',
    mostrar_objeto: 'showing something in their hands',
};

const PROP_EN: Record<ScenePropType, string> = {
    ninguno: 'in a bright modern apartment living room',
    casa: 'in front of a modest two-storey family house',
    carro: 'next to a family car parked on the street',
    banco: 'in a generic office lobby without any signage',
    telefono: 'holding a smartphone',
    documento: 'holding printed paperwork',
    dinero: 'with a household budget notebook on the table',
    grafico: 'looking at a laptop screen with an abstract chart',
    oficina: 'in a small advisor office with a desk and plants',
};

export function composeImagePrompt(scenePrompt: string, characterDescription: string | null): string {
    const base = scenePrompt.trim().replace(/[.\s]+$/, '');
    return [base, characterDescription ? `Character: ${characterDescription}` : '', PHOTO_STYLE].filter(Boolean).join('. ');
}

export function fallbackScenePrompt(scene: Pick<Scene, 'character' | 'action' | 'prop'>): string {
    return `Medium shot of ${DEFAULT_CHARACTER_BIBLE[scene.character]}, ${ACTION_EN[scene.action]}, ${PROP_EN[scene.prop]}`;
}

interface ArtDirection {
    bible: Partial<Record<CharacterType, string>>;
    prompts: Map<number, string>; // final prompt by scene order
    result: GenerationResult | null;
}

const CHARACTER_KEYS = Object.keys(DEFAULT_CHARACTER_BIBLE) as CharacterType[];

async function directArt(video: VideoRecord, scenes: Scene[]): Promise<ArtDirection> {
    const used = [...new Set(scenes.map((scene) => scene.character))];
    const result = await generateWithProvider(
        ROLE_PROVIDER.director_arte ?? '',
        [
            'You are the art director of a short vertical mortgage-marketing video set in Latin America. Every scene becomes ONE photorealistic still made by FLUX.',
            'First write a character bible: one consistent physical description (age, hair, clothing, build) for each character type used, so the same person looks the same in every scene. Natural light, Latin American homes and streets.',
            'Then write one English photographic prompt per scene describing subject, action, setting, framing and mood. Do NOT include any text, signs, logos, brands or bank names in the picture. Keep the main subject centred, leaving the lower third of the frame free.',
            'Reply ONLY with JSON: {"character_bible": {"<character type>": "<description>"}, "scenes": [{"order": <number>, "prompt": "<english prompt>"}]}',
        ].join('\n'),
        [{
            role: 'user',
            content: [
                `Topic (Spanish): ${video.topic}`,
                `Character types used: ${used.join(', ')}`,
                'Scenes (Spanish narration):',
                ...scenes.map((scene) => `${scene.order}. character=${scene.character}, action=${scene.action}, prop=${scene.prop}: "${scene.description}"`),
            ].join('\n'),
        }],
        { maxTokens: 1800, temperature: 0.5 },
    );

    const json = result ? extractJsonObject(result.text) : null;
    const bible: Partial<Record<CharacterType, string>> = {};
    const rawBible = json?.character_bible;
    if (rawBible && typeof rawBible === 'object' && !Array.isArray(rawBible)) {
        for (const key of CHARACTER_KEYS) {
            const value = text((rawBible as Record<string, unknown>)[key], 300);
            if (value) bible[key] = value;
        }
    }
    const modelPrompts = new Map<number, string>();
    if (Array.isArray(json?.scenes)) {
        for (const entry of json.scenes as unknown[]) {
            if (!entry || typeof entry !== 'object') continue;
            const record = entry as Record<string, unknown>;
            const prompt = text(record.prompt, 900);
            if (prompt && Number.isInteger(Number(record.order))) modelPrompts.set(Number(record.order), prompt);
        }
    }

    const prompts = new Map<number, string>();
    for (const scene of scenes) {
        const characterDescription = bible[scene.character] ?? DEFAULT_CHARACTER_BIBLE[scene.character];
        prompts.set(scene.order, composeImagePrompt(modelPrompts.get(scene.order) ?? fallbackScenePrompt(scene), characterDescription));
    }
    return { bible, prompts, result: modelPrompts.size ? result : null };
}

// ---- Step recording --------------------------------------------------------

type SaveFn = (id: string, workbench: Workbench) => Promise<void>;

/**
 * Keeps the run's log and writes a snapshot after every change. Writes go
 * through one promise chain, so with two images in flight the database still
 * receives the snapshots in the order they happened.
 */
export class StepRecorder {
    readonly workbench: Workbench;
    private queue: Promise<void> = Promise.resolve();

    constructor(private readonly videoId: string, initial: Workbench, private readonly save: SaveFn = saveWorkbench) {
        this.workbench = { ...initial, steps: [...initial.steps] };
    }

    start(role: WorkbenchRole, input: { round?: number; sceneOrder?: number | null; summary: string; provider?: string }): WorkbenchStep {
        const step: WorkbenchStep = {
            id: crypto.randomUUID(),
            role,
            provider: input.provider ?? ROLE_PROVIDER[role] ?? 'sistema',
            model: null,
            status: 'running',
            round: input.round ?? 1,
            summary: input.summary,
            detail: null,
            scene_order: input.sceneOrder ?? null,
            started_at: new Date().toISOString(),
            finished_at: null,
        };
        this.workbench.steps.push(step);
        this.persist();
        return step;
    }

    finish(step: WorkbenchStep, patch: Partial<Pick<WorkbenchStep, 'status' | 'summary' | 'detail' | 'provider' | 'model'>>): void {
        Object.assign(step, { status: 'done', ...patch, finished_at: new Date().toISOString() });
        this.persist();
    }

    end(status: 'done' | 'error', error: string | null): void {
        for (const step of this.workbench.steps) {
            if (step.status === 'running') Object.assign(step, { status: 'error', finished_at: new Date().toISOString() });
        }
        Object.assign(this.workbench, { status, error, finished_at: new Date().toISOString() });
        this.persist();
    }

    persist(): void {
        const snapshot: Workbench = JSON.parse(JSON.stringify(this.workbench)) as Workbench;
        this.queue = this.queue
            .then(() => this.save(this.videoId, snapshot))
            .catch((error: unknown) => console.warn('No se pudo guardar el progreso de la mesa de trabajo.', error));
    }

    flush(): Promise<void> {
        return this.queue;
    }
}

function providerOf(result: GenerationResult | null): Pick<WorkbenchStep, 'provider' | 'model'> {
    return result ? { provider: result.provider, model: result.model ?? null } : { provider: 'ninguno', model: null };
}

// ---- The run ---------------------------------------------------------------

export function newWorkbench(): Workbench {
    return { status: 'running', started_at: new Date().toISOString(), finished_at: null, error: null, steps: [] };
}

/** Takes the slot (409 if a live run holds it) and applies the RF-012 revert once. */
export async function startWorkbench(videoId: string): Promise<VideoRecord> {
    return claimWorkbench(videoId, newWorkbench());
}

async function mustGetVideo(id: string): Promise<VideoRecord> {
    const video = await getVideo(id);
    if (!video) throw new VideoError(VIDEO_NOT_FOUND, 404);
    return video;
}

function ordered(video: VideoRecord): Scene[] {
    return [...video.scenes].sort((a, b) => a.order - b.order);
}

function describeScenesForReview(video: VideoRecord): string {
    return ordered(video).map((scene) => `${scene.order}. (${scene.character}) ${scene.description}`).join('\n');
}

interface RunContext {
    videoId: string;
    recorder: StepRecorder;
    deadline: number;
    notes: string[]; // facts for the producer's summary
}

function ensureTime(ctx: RunContext, reserveMs = 0): void {
    if (Date.now() + reserveMs > ctx.deadline) throw new BudgetExceeded(BUDGET_EXCEEDED);
}

async function writeScript(ctx: RunContext, round: number, revision?: { script: string; critique: string }): Promise<void> {
    ensureTime(ctx);
    const video = await mustGetVideo(ctx.videoId);
    const step = ctx.recorder.start('guionista', { round, summary: revision ? 'Reescribiendo el guion con la crítica…' : 'Escribiendo el guion…' });
    const draft = await generateScript(video.topic, video.template, { preferredProvider: ROLE_PROVIDER.guionista, revision });
    if (!draft.fromModel) {
        if (!revision) await updateScript(ctx.videoId, draft.text);
        ctx.recorder.finish(step, {
            status: 'error',
            provider: 'respaldo',
            summary: revision ? 'Ningún modelo respondió; se conservó el guion anterior.' : 'Ningún modelo respondió; se usó el guion genérico de respaldo.',
        });
        return;
    }
    await updateScript(ctx.videoId, draft.text);
    const words = draft.text.split(/\s+/).filter(Boolean).length;
    ctx.recorder.finish(step, {
        provider: draft.provider ?? 'desconocido',
        model: draft.model,
        summary: revision ? `Reescribió el guion atendiendo la crítica (${words} palabras).` : `Escribió el guion (${words} palabras).`,
    });
}

async function planScenes(ctx: RunContext, round: number, guidance?: string): Promise<void> {
    ensureTime(ctx);
    const step = ctx.recorder.start('director', { round, summary: 'Dividiendo el guion en escenas…' });
    // The planner lives only in its route handler; it is invoked in process, the
    // way copilot.ts and the batch route do.
    const response = await planScenesRoute(
        new Request('http://workbench.local/api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: ROLE_PROVIDER.director, ...(guidance ? { guidance } : {}) }),
        }),
        { params: Promise.resolve({ id: ctx.videoId }) },
    );
    const payload = await response.json().catch(() => null) as { video?: VideoRecord; provider?: string | null; model?: string | null; error?: string } | null;
    if (!response.ok || !payload?.video) throw new Error(payload?.error ?? 'No se pudieron generar las escenas.');
    const scenes = payload.video.scenes;
    const total = Math.round(scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0));
    ctx.recorder.finish(step, {
        provider: payload.provider ?? 'respaldo',
        model: payload.model ?? null,
        status: payload.provider ? 'done' : 'error',
        summary: payload.provider
            ? `Armó ${scenes.length} escenas (${total} s en total).`
            : `Ningún modelo respondió; se dividió el guion por oraciones en ${scenes.length} escenas.`,
    });
}

async function reviewCompliance(ctx: RunContext, firstRound: number): Promise<number> {
    let round = firstRound;
    for (let attempt = 0; attempt < MAX_COMPLIANCE_ROUNDS; attempt += 1, round += 1) {
        ensureTime(ctx);
        const video = await mustGetVideo(ctx.videoId);
        const step = ctx.recorder.start('cumplimiento', { round, summary: 'Revisando riesgos de cumplimiento…' });
        const result = await generateWithProvider(
            ROLE_PROVIDER.cumplimiento ?? '',
            [
                'Eres revisor de cumplimiento de marketing de credito hipotecario en Latinoamerica.',
                'Revisa el guion y las lineas de cada escena buscando: aprobaciones prometidas o insinuadas, tasas, cuotas o montos inventados, garantias o resultados asegurados, asesoria financiera personalizada, nombres de bancos o entidades.',
                'Si algo falla, corrige solo lo necesario, manteniendo el tono y la longitud.',
                'Responde UNICAMENTE con JSON: {"ok": boolean, "issues": ["problema en español"], "fixed_script": "guion corregido o null", "fixed_scenes": [{"order": numero, "description": "linea corregida"}]}',
                'Incluye en fixed_scenes solo las escenas que cambian.',
            ].join('\n'),
            [{ role: 'user', content: `Guion:\n${video.script}\n\nEscenas:\n${describeScenesForReview(video)}` }],
            { maxTokens: 1500, temperature: 0.2 },
        );
        const review = result ? parseComplianceReview(result.text) : null;
        if (!review) {
            ctx.recorder.finish(step, {
                ...providerOf(result),
                status: 'error',
                summary: 'No se pudo completar la revisión de cumplimiento; revísalo a mano antes de aprobar.',
            });
            ctx.notes.push('cumplimiento sin revisar');
            return round + 1;
        }
        if (review.ok) {
            ctx.recorder.finish(step, { ...providerOf(result), summary: 'Sin observaciones de cumplimiento.' });
            ctx.notes.push('cumplimiento sin observaciones');
            return round + 1;
        }

        let fixes = 0;
        if (review.fixed_script) {
            await updateScript(ctx.videoId, review.fixed_script);
            fixes += 1;
        }
        const byOrder = new Map(ordered(video).map((scene) => [scene.order, scene]));
        for (const fix of review.fixed_scenes) {
            const scene = byOrder.get(fix.order);
            if (!scene || scene.description === fix.description) continue;
            await updateScene(ctx.videoId, scene.id, { description: fix.description });
            fixes += 1;
        }
        const last = attempt === MAX_COMPLIANCE_ROUNDS - 1;
        ctx.recorder.finish(step, {
            ...providerOf(result),
            summary: fixes
                ? `Encontró ${review.issues.length} riesgo(s) y aplicó ${fixes} corrección(es).${last ? ' Revisa el resultado antes de aprobar.' : ''}`
                : `Encontró ${review.issues.length} riesgo(s) sin proponer corrección; revísalos a mano.`,
            detail: review.issues.map((issue) => `• ${issue}`).join('\n') || null,
        });
        if (!fixes) {
            ctx.notes.push('cumplimiento con observaciones pendientes');
            return round + 1;
        }
        if (last) ctx.notes.push('cumplimiento corregido (verificar)');
    }
    return round;
}

async function critique(ctx: RunContext): Promise<Critique | null> {
    ensureTime(ctx);
    const video = await mustGetVideo(ctx.videoId);
    const step = ctx.recorder.start('critico', { summary: 'Evaluando gancho, claridad, ritmo y llamado a la acción…' });
    const result = await generateWithProvider(
        ROLE_PROVIDER.critico ?? '',
        [
            'Eres critico de contenido vertical corto (Reels, TikTok, Shorts) de marketing hipotecario.',
            'Califica de 1 a 10: hook (gancho de los primeros segundos), clarity (claridad del mensaje), pacing (ritmo de las escenas) y cta (llamado a la accion prudente).',
            'Da una critica concreta y accionable en español, maximo 5 frases.',
            `La critica nunca debe pedir cifras, tasas ni promesas. ${LIMITES}`,
            'Responde UNICAMENTE con JSON: {"hook": n, "clarity": n, "pacing": n, "cta": n, "critique": "texto"}',
        ].join('\n'),
        [{ role: 'user', content: `Tema: ${video.topic}\n\nGuion:\n${video.script}\n\nEscenas:\n${describeScenesForReview(video)}` }],
        { maxTokens: 800, temperature: 0.4 },
    );
    const parsed = result ? parseCritique(result.text) : null;
    if (!parsed) {
        ctx.recorder.finish(step, { ...providerOf(result), status: 'error', summary: 'No se pudo obtener la crítica; se continúa sin ella.' });
        return null;
    }
    ctx.recorder.finish(step, {
        ...providerOf(result),
        summary: `Nota ${parsed.average}/10 (gancho ${parsed.hook}, claridad ${parsed.clarity}, ritmo ${parsed.pacing}, cierre ${parsed.cta}).`,
        detail: parsed.comments || null,
    });
    ctx.notes.push(`crítica ${parsed.average}/10`);
    return parsed;
}

async function artDirection(ctx: RunContext): Promise<void> {
    ensureTime(ctx);
    const video = await mustGetVideo(ctx.videoId);
    const scenes = ordered(video);
    const step = ctx.recorder.start('director_arte', { summary: 'Definiendo personajes y encuadres de cada escena…' });
    const art = await directArt(video, scenes);
    for (const scene of scenes) {
        const prompt = art.prompts.get(scene.order);
        if (prompt && prompt !== scene.image_prompt) await updateScene(ctx.videoId, scene.id, { image_prompt: prompt });
    }
    const bibleLines = Object.entries(art.bible).map(([key, value]) => `${key}: ${value}`);
    ctx.recorder.finish(step, {
        ...(art.result ? providerOf(art.result) : { provider: 'respaldo', model: null }),
        status: art.result ? 'done' : 'error',
        summary: art.result
            ? `Preparó ${scenes.length} encuadres fotográficos con personajes consistentes.`
            : `Ningún modelo respondió; se usaron encuadres básicos para ${scenes.length} escenas.`,
        detail: bibleLines.length ? `Biblia de personajes:\n${bibleLines.join('\n')}` : null,
    });
}

function seedFor(sceneOrder: number, attempt: number): number {
    // Varies per run so "otra vez" gives a different picture.
    return (Date.now() % 1_000_000) + sceneOrder * 101 + attempt * 7919;
}

async function makeImage(ctx: RunContext, scene: Scene, prompt: string, round: number, seed: number): Promise<GeneratedImage | null> {
    ensureTime(ctx, 15_000);
    const step = ctx.recorder.start('fotografo', { round, sceneOrder: scene.order, provider: 'cloudflare', summary: `Fotografiando la escena ${scene.order}…` });
    const timeout = Math.min(IMAGE_TIMEOUT_MS, Math.max(10_000, ctx.deadline - Date.now() - 5_000));
    try {
        const image = await generateSceneImage(prompt, seed, timeout);
        const url = await uploadSceneImage(ctx.videoId, scene.id, image);
        await updateScene(ctx.videoId, scene.id, { image_url: url, image_prompt: prompt });
        ctx.recorder.finish(step, {
            provider: image.provider,
            model: image.model,
            summary: round > 1 ? `Repitió la foto de la escena ${scene.order}.` : `Foto de la escena ${scene.order} lista.`,
        });
        return image;
    } catch (error) {
        ctx.recorder.finish(step, {
            provider: 'ninguno',
            status: 'error',
            summary: `No se pudo generar la foto de la escena ${scene.order}; puedes regenerarla desde la escena.`,
            detail: error instanceof Error ? error.message : null,
        });
        return null;
    }
}

async function reviewImage(ctx: RunContext, scene: Scene, image: GeneratedImage): Promise<VisualReview | null> {
    ensureTime(ctx, 10_000);
    const step = ctx.recorder.start('revisor_visual', { sceneOrder: scene.order, summary: `Revisando la foto de la escena ${scene.order}…` });
    const result = await generateWithVision(
        [
            'Eres revisor visual de anuncios verticales de credito hipotecario.',
            'Aprueba la imagen solo si: es fotorrealista, corresponde a la escena, no tiene texto, letras, logos, marcas ni marcas de agua, no tiene manos o rostros deformes, y el tercio inferior queda libre para subtitulos.',
            'Responde UNICAMENTE con JSON: {"ok": boolean, "reason": "motivo breve en español", "fix_hint": "short English instruction to fix the prompt, or empty"}',
        ].join('\n'),
        `Escena ${scene.order} (${scene.character}): "${scene.description}"`,
        [{ base64: Buffer.from(image.bytes).toString('base64'), mimeType: image.mimeType }],
        { maxTokens: 400, temperature: 0.1 },
    );
    const review = result ? parseVisualReview(result.text) : null;
    if (!review) {
        ctx.recorder.finish(step, {
            ...providerOf(result),
            status: 'skipped',
            summary: result ? 'La revisión visual no fue legible; revisa la foto a mano.' : 'Sin modelo de visión disponible; revisa la foto a mano.',
        });
        return null;
    }
    ctx.recorder.finish(step, {
        ...providerOf(result),
        summary: review.ok ? `Foto de la escena ${scene.order} aprobada.` : `Foto de la escena ${scene.order} rechazada: ${review.reason || 'sin motivo'}.`,
        detail: review.reason || null,
    });
    return review;
}

async function photographScene(ctx: RunContext, scene: Scene): Promise<boolean> {
    const prompt = scene.image_prompt || composeImagePrompt(fallbackScenePrompt(scene), DEFAULT_CHARACTER_BIBLE[scene.character]);
    const image = await makeImage(ctx, scene, prompt, 1, seedFor(scene.order, 0));
    if (!image) return false;
    const review = await reviewImage(ctx, scene, image);
    if (review && !review.ok) {
        // One retry only: a new seed and the reviewer's hint. The result is not
        // reviewed again, to keep the run inside the time budget.
        const hint = review.fixHint ? `. Make sure: ${review.fixHint}` : '';
        const retried = await makeImage(ctx, scene, `${prompt}${hint}`, 2, seedFor(scene.order, 1));
        return retried !== null;
    }
    return true;
}

async function photograph(ctx: RunContext): Promise<void> {
    const scenes = ordered(await mustGetVideo(ctx.videoId));
    let next = 0;
    let made = 0;
    let budgetError: unknown = null;
    // A small pool: two images in flight is what the free tiers tolerate.
    const worker = async () => {
        while (next < scenes.length && !budgetError) {
            const scene = scenes[next];
            next += 1;
            try {
                if (await photographScene(ctx, scene)) made += 1;
            } catch (error) {
                if (error instanceof BudgetExceeded) budgetError = error;
                else throw error;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, scenes.length) }, worker));
    ctx.notes.push(`${made}/${scenes.length} fotos`);
    if (budgetError) throw budgetError;
}

function produce(ctx: RunContext, scenes: number, realistic: boolean): void {
    const step = ctx.recorder.start('productor', { provider: 'sistema', summary: 'Cerrando la mesa de trabajo…' });
    const used = [...new Set(ctx.recorder.workbench.steps
        .map((entry) => entry.provider)
        .filter((provider) => !['sistema', 'ninguno', 'respaldo', 'desconocido'].includes(provider)))];
    ctx.recorder.finish(step, {
        summary: `Borrador listo: ${scenes} escenas${ctx.notes.length ? `, ${ctx.notes.join(', ')}` : ''}. Una persona debe revisarlo y aprobarlo.`,
        detail: [
            `Proveedores que participaron: ${used.join(', ') || 'ninguno'}.`,
            realistic ? 'Estilo realista: cada escena lleva su foto.' : 'Estilo ilustración: no se generan fotos.',
            'Nada se aprobó ni se publicó automáticamente.',
        ].join('\n'),
    });
}

export interface RunOptions {
    rewriteScript?: boolean;
    workbench: Workbench;
    save?: SaveFn;
    budgetMs?: number;
}

/**
 * The whole table, start to end. Never throws: whatever goes wrong ends as
 * workbench.status 'error' with a Spanish message, and whatever was done
 * before stays saved.
 */
export async function runWorkbench(videoId: string, options: RunOptions): Promise<Workbench> {
    const recorder = new StepRecorder(videoId, options.workbench, options.save);
    const ctx: RunContext = { videoId, recorder, deadline: Date.now() + (options.budgetMs ?? RUN_BUDGET_MS), notes: [] };
    try {
        const video = await mustGetVideo(videoId);

        if (!video.script.trim() || options.rewriteScript) {
            await writeScript(ctx, 1);
        } else {
            const step = recorder.start('guionista', { provider: 'sistema', summary: 'Se conserva el guion actual.' });
            recorder.finish(step, { status: 'skipped', summary: 'Se conservó el guion existente.' });
        }

        await planScenes(ctx, 1);
        const complianceRound = await reviewCompliance(ctx, 1);

        const review = await critique(ctx);
        if (review && review.average < CRITIQUE_THRESHOLD) {
            const feedback = review.comments || `Mejorar gancho (${review.hook}), claridad (${review.clarity}), ritmo (${review.pacing}) y cierre (${review.cta}).`;
            const current = await mustGetVideo(videoId);
            await writeScript(ctx, 2, { script: current.script, critique: feedback });
            await planScenes(ctx, 2, `Critica a resolver: ${feedback}`);
            // A rewrite can bring back what compliance removed, so it looks again.
            await reviewCompliance(ctx, complianceRound);
        }

        const current = await mustGetVideo(videoId);
        const realistic = current.visual_style === 'realista';
        if (realistic && current.scenes.length) {
            await artDirection(ctx);
            await photograph(ctx);
        }

        produce(ctx, current.scenes.length, realistic);
        recorder.end('done', null);
    } catch (error) {
        const message = error instanceof BudgetExceeded || error instanceof VideoError
            ? error.message
            : 'La mesa de trabajo falló antes de terminar. Lo hecho quedó guardado; puedes volver a intentarlo.';
        if (!(error instanceof BudgetExceeded)) console.error('Fallo la mesa de trabajo.', error);
        recorder.end('error', message);
    }
    await recorder.flush();
    return recorder.workbench;
}

/**
 * One scene's picture again, outside a run (the "regenerar foto" button). The
 * stored prompt is reused unless asked to refresh it or there is none yet.
 */
export async function regenerateSceneImage(videoId: string, sceneId: string, options: { refreshPrompt?: boolean } = {}): Promise<VideoRecord> {
    const video = await mustGetVideo(videoId);
    const scene = video.scenes.find((entry) => entry.id === sceneId);
    if (!scene) throw new VideoError('Escena no encontrada.', 404);

    let prompt = scene.image_prompt;
    if (!prompt || options.refreshPrompt) {
        const art = await directArt(video, [scene]);
        prompt = art.prompts.get(scene.order) ?? composeImagePrompt(fallbackScenePrompt(scene), DEFAULT_CHARACTER_BIBLE[scene.character]);
    }
    let image: GeneratedImage;
    try {
        // Leaves room inside the route's 60 s for the upload and the write.
        image = await generateSceneImage(prompt, Math.floor(Math.random() * 1_000_000), 45_000);
    } catch (error) {
        throw new VideoError(error instanceof Error ? error.message : 'No se pudo generar la imagen.', 502);
    }
    const url = await uploadSceneImage(videoId, scene.id, image);
    return updateScene(videoId, scene.id, { image_url: url, image_prompt: prompt });
}
