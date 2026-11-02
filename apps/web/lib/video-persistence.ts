import type { User } from '@supabase/supabase-js';
import type { Branding, Platform, Scene, Video, VideoStatus } from '@shared-types/video';
import { DEFAULT_BRANDING, RENDER_STALLED_ERROR, RENDER_STALL_TIMEOUT_MS, isRenderStalled } from '@shared-types/video';
import { getTemplate, type VideoTemplate } from '@shared-types/templates';
import { EDIT_REVERTS_TO_DRAFT_FROM, canTransition, revertsToDraftOnEdit, transitions, videos as mockVideos } from '../app/api/videos/store';
import { getSupabaseClient } from './supabaseClient';
import { generateWithFallback } from './ai-provider';
import { SOUNDS_MIGRATION_MISSING_ERROR, isMissingSchemaError, resolveSoundUrls } from './sounds';
import { MAX_JOB_PAYLOAD_CHARS, encodeJobPayload, readCloudRunJobConfig, runCloudRunJob, type CloudRunJobConfig } from './cloud-run-job';

type VideoRecord = Video & { scenes: Scene[] };
type SceneInput = Omit<Scene, 'id' | 'video_id'>;
type DatabaseRow = Record<string, unknown>;
// Derived instead of imported from supabase-js: the factory already pins the
// generics, and naming them here again would need an `any`.
type SupabaseClient = NonNullable<ReturnType<typeof getSupabaseClient>>;

export const VIDEO_NOT_FOUND = 'Video no encontrado.';

// An error the routes can answer with as it is: the message is for a person,
// the status for the HTTP response. Plain Errors keep meaning "something
// broke" and the routes keep mapping them as before.
export class VideoError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = 'VideoError';
    }
}

export function errorStatus(error: unknown, fallback: number): number {
    if (error instanceof VideoError) return error.status;
    if (error instanceof Error && error.message === VIDEO_NOT_FOUND) return 404;
    return fallback;
}

// supabase-js does not throw when the fetch itself fails: it resolves with an
// error whose code is empty and whose message is the TypeError's. Anything
// carrying a PostgREST or Postgres code is a real answer from the database.
function isNetworkError(error: unknown): boolean {
    if (error instanceof TypeError) return true;
    if (!error || typeof error !== 'object' || error instanceof VideoError) return false;
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (typeof code === 'string' && code !== '') return false;
    return typeof message === 'string' && /fetch failed|TypeError|network|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|aborted/i.test(message);
}

// The in-memory map is a development convenience. In production every
// serverless instance has its own empty copy, so "falling back" there answers
// success for a write nobody will ever see again - which is how real database
// failures used to stay hidden.
function canFallBackToMemory(error: unknown): boolean {
    return process.env.NODE_ENV !== 'production' && isNetworkError(error);
}

// PostgrestError is a plain object, not an Error: without this the routes
// would only ever see "Error desconocido".
function toVideoError(error: unknown): Error {
    if (error instanceof Error) return error;
    console.error('Supabase rechazó la operación.', error);
    return new VideoError('No se pudo guardar el cambio en la base de datos. Intenta de nuevo.', 500);
}

// Returns only when the caller may continue with the in-memory copy.
function fallBackOrThrow(error: unknown, what: string): void {
    if (!canFallBackToMemory(error)) throw toVideoError(error);
    console.warn(`${what}, usando fallback en memoria.`, error);
}

function nullableString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function toBranding(value: unknown): Branding {
    if (!value || typeof value !== 'object') return { ...DEFAULT_BRANDING };
    const source = value as Record<string, unknown>;
    return {
        logo_url: nullableString(source.logo_url),
        logo_position: (typeof source.logo_position === 'string' ? source.logo_position : DEFAULT_BRANDING.logo_position) as Branding['logo_position'],
        primary_color: typeof source.primary_color === 'string' ? source.primary_color : DEFAULT_BRANDING.primary_color,
        secondary_color: typeof source.secondary_color === 'string' ? source.secondary_color : DEFAULT_BRANDING.secondary_color,
        font_family: typeof source.font_family === 'string' ? source.font_family : DEFAULT_BRANDING.font_family,
    };
}

function toScene(scene: DatabaseRow): Scene {
    return {
        id: String(scene.id),
        video_id: String(scene.video_id),
        order: Number(scene.order ?? 1),
        character: (scene.character ?? 'generico') as Scene['character'],
        action: (scene.action ?? 'hablar') as Scene['action'],
        prop: (scene.prop ?? 'ninguno') as Scene['prop'],
        description: String(scene.description ?? ''),
        duration_seconds: Number(scene.duration_seconds ?? 0),
        audio_url: nullableString(scene.audio_url),
        // Absent until the RF-010 migration is applied; null reads as "no effect".
        sound_effect_id: nullableString(scene.sound_effect_id),
    };
}

// The worker that dies to the container memory limit never writes again, so
// its row keeps claiming 'procesando' with its last percentage forever. Every
// record the app hands out passes through here, so this is the one place the
// give-up has to be decided; markStalledRenders() then writes it back.
function withStalledRender(video: VideoRecord): VideoRecord {
    if (!isRenderStalled(video.render_status, video.render_started_at)) return video;
    // render_progress is left where it stopped: it says how far the job got.
    return { ...video, render_status: 'error', render_error: RENDER_STALLED_ERROR };
}

// Reads are the only moment anyone looks at an abandoned row, so they are also
// the only chance to repair it. The update is skipped entirely when nothing is
// stalled, which is the normal case.
async function markStalledRenders(client: SupabaseClient, rows: DatabaseRow[]): Promise<void> {
    const stalledIds = rows
        .filter((row) => isRenderStalled(row.render_status, row.render_started_at))
        .map((row) => String(row.id));
    if (!stalledIds.length) return;

    try {
        // The 'procesando' guard protects a worker that reported back between
        // our select and this update from being buried under an error it never
        // hit. Failures are not fatal: the caller already holds the corrected
        // record, and the next read derives it again from render_started_at.
        const { error } = await client
            .from('videos')
            .update({ render_status: 'error', render_error: RENDER_STALLED_ERROR })
            .in('id', stalledIds)
            .eq('render_status', 'procesando');
        if (error) throw error;
    } catch (error) {
        console.warn('No fue posible marcar como error los renders colgados.', error);
    }
}

// RF-010 columns are written only when they carry a value, so inserts keep
// working against a database the sounds migration has not reached yet (null
// is the column default anyway). Background music was removed from the
// product: `videos.music_id` stays in the schema (no destructive migration)
// but is neither read nor written any more.
function soundEffectColumn(soundEffectId: string | null | undefined): { sound_effect_id?: string } {
    return soundEffectId ? { sound_effect_id: soundEffectId } : {};
}

function toVideoRecord(video: DatabaseRow, scenes: DatabaseRow[] = []): VideoRecord {
    return withStalledRender({
        id: String(video.id),
        user_id: String(video.user_id ?? 'demo-user'),
        topic: String(video.topic ?? ''),
        platform: (video.platform ?? 'reels') as Video['platform'],
        target_duration_seconds: Number(video.target_duration_seconds ?? 30),
        script: String(video.script ?? ''),
        status: (video.status ?? 'borrador') as Video['status'],
        branding: toBranding(video.branding),
        video_url: nullableString(video.video_url),
        source_video_id: nullableString(video.source_video_id),
        created_at: typeof video.created_at === 'string' ? video.created_at : new Date().toISOString(),
        render_status: (video.render_status ?? 'inactivo') as Video['render_status'],
        render_progress: Number(video.render_progress ?? 0),
        render_error: nullableString(video.render_error),
        render_started_at: nullableString(video.render_started_at),
        template: getTemplate(video.template).id,
        scenes: (scenes ?? []).map(toScene).sort((a, b) => a.order - b.order),
    });
}

export async function ensureDemoUser(): Promise<string | null> {
    const client = getSupabaseClient({ serviceRole: true });
    if (!client) return null;

    const demoEmail = 'demo@stickman.local';
    // listUsers pages (50 by default): once the project has more accounts than
    // one page holds, the demo user stops being found and a duplicate create
    // fails. Walk the pages until a short one says there are no more.
    const perPage = 1000;
    let user: User | undefined;
    for (let page = 1; !user; page += 1) {
        const { data: users, error: listError } = await client.auth.admin.listUsers({ page, perPage });
        if (listError) {
            console.warn('No fue posible listar usuarios demo', listError.message);
            return null;
        }
        user = users.users.find((entry) => entry.email === demoEmail);
        if (users.users.length < perPage) break;
    }

    if (!user) {
        const demoPassword = process.env.DEMO_USER_PASSWORD;
        if (!demoPassword) {
            console.warn('DEMO_USER_PASSWORD no esta configurada; no se puede crear el usuario demo.');
            return null;
        }

        const { data: created, error: createError } = await client.auth.admin.createUser({
            email: demoEmail,
            password: demoPassword,
            email_confirm: true,
            user_metadata: { name: 'Demo user' },
        });

        if (createError || !created?.user) {
            console.warn('No fue posible crear usuario demo', createError?.message ?? 'unknown');
            return null;
        }
        user = created.user;
    }

    return user.id;
}

async function readFromSupabase(): Promise<VideoRecord[]> {
    // Reads use the service-role client too: this is an internal tool with a
    // single shared demo user and no per-request Supabase auth session, so the
    // "auth.uid() = user_id" RLS select policy would otherwise block every
    // read (0 rows, not an error) even though the rows genuinely exist -
    // access control for this app happens at the Next.js API route layer, not
    // via Supabase RLS.
    const client = getSupabaseClient({ serviceRole: true }) ?? getSupabaseClient();
    if (!client) return Array.from(mockVideos.values()).map(withStalledRender);

    try {
        const { data: videosData, error: videosError } = await client.from('videos').select('*').order('created_at', { ascending: false });
        if (videosError) throw videosError;
        if (!videosData?.length) return [];

        const { data: scenesData, error: scenesError } = await client.from('scenes').select('*');
        if (scenesError) throw scenesError;

        await markStalledRenders(client, videosData);

        return (videosData ?? []).map((video) => toVideoRecord(video, (scenesData ?? []).filter((scene) => scene.video_id === video.id)));
    } catch (error) {
        console.warn('Fallo al leer desde Supabase, usando fallback en memoria.', error);
        return Array.from(mockVideos.values()).map(withStalledRender);
    }
}

async function findVideoRecord(id: string): Promise<VideoRecord | null> {
    const client = getSupabaseClient({ serviceRole: true }) ?? getSupabaseClient();
    if (client) {
        try {
            const { data: videoData, error: videoError } = await client.from('videos').select('*').eq('id', id).single();
            if (videoError || !videoData) throw videoError ?? new Error('Video no encontrado.');
            const { data: scenesData, error: scenesError } = await client.from('scenes').select('*').eq('video_id', id);
            if (scenesError) throw scenesError;

            await markStalledRenders(client, [videoData]);

            return toVideoRecord(videoData, scenesData ?? []);
        } catch (error) {
            console.warn('Fallo al leer el video desde Supabase, usando fallback en memoria.', error);
        }
    }
    const local = mockVideos.get(id);
    return local ? withStalledRender(local) : null;
}

// Used whenever the model is unavailable - which, with the API quota
// exhausted, is most of the time. It follows the same telenovela beats the
// prompt asks the model for, so the format is visible even without the LLM.
// Each sentence becomes one scene, so the line breaks here matter.
function buildFallbackScript(topic: string): string {
    const general = [
        `Llevo semanas dandole vueltas a ${topic} y no me decido.`,
        'Mi cuñado dice una cosa, el vecino dice otra, y yo cada dia entiendo menos.',
        'Entonces aparecio el asesor y me hizo una sola pregunta: ¿comparaste el costo total, o solo la cuota?',
        'Me quede helada. Solo habia mirado la cuota.',
        'Compara el costo total, revisa el plazo y pide siempre una oferta formal antes de firmar.',
        'Esta historia es educativa: confirma cada condicion con una entidad autorizada.',
    ];

    const mortgage = [
        'Encontramos la casa perfecta. Y entonces llego la carta del banco.',
        'La cuota parecia baja, pero nadie nos hablo de los seguros ni del plazo real.',
        'Llame al asesor casi llorando. Me dijo: tranquila, todavia no has firmado nada.',
        'Me explico que la cuota mensual no es el precio: el precio es el costo total.',
        'Comparamos tasa, plazo y seguros en un simulador, y salieron numeros muy distintos.',
        'Pedimos la oferta formal, la leimos entera, y esta vez firmamos sabiendo que firmabamos.',
        'Esta historia es educativa y no reemplaza la asesoria financiera.',
    ];

    return (/hipotec|credito|cr[eé]dito|cuota|vivienda|casa|banco/i.test(topic) ? mortgage : general).join(' ');
}

// The caller needs to know whether the model actually wrote this, not just
// receive text: `buildFallbackScript` produces the same handful of sentences
// for every topic, and a batch that hides that behind "creado" is the bug
// RF-024's third array exists to fix.
export async function generateScript(topic: string, template: VideoTemplate): Promise<{ text: string; fromModel: boolean }> {
    // Telenovela structure on purpose: the client wants the "frutinovela" format
    // that works on TikTok - conflict, characters with a stake, a hook - rather
    // than the explainer tone this used to produce. The compliance limits are
    // unchanged; drama applies to the situation, never to the numbers.
    const result = await generateWithFallback(
        [
            'Eres guionista de mini-telenovelas verticales para redes, al estilo de las "frutinovelas" virales, aplicadas a marketing de credito hipotecario y vivienda.',
            'Escribe una historia corta con conflicto real entre personas: alguien quiere comprar o refinanciar, algo se interpone, y aparece quien lo aclara.',
            'Estructura: gancho en la primera linea, conflicto, giro, y cierre con una accion prudente. Tono de telenovela: emocional, con dialogo, un punto exagerado, nunca aburrido.',
            'Frases cortas, habladas, sin tecnicismos. Todo en español neutro.',
            'LIMITES QUE NO PUEDES CRUZAR: no prometas aprobaciones ni tasas concretas, no des recomendaciones financieras personalizadas, no inventes cifras ni nombres de entidades. El drama esta en la situacion de los personajes, jamas en los numeros.',
            'Devuelve solo el guion en texto plano, sin JSON, sin comillas envolventes y sin encabezados.',
            // Last line so the chosen template overrides the generic structure
            // advice above. Empty for 'libre', which leaves the shape to the model.
            ...(getTemplate(template).guidance ? [`ESTRUCTURA OBLIGATORIA: ${getTemplate(template).guidance}`] : []),
        ].join('\n'),
        [{ role: 'user', content: `Tema: ${topic}\nEscribe la mini-telenovela.` }],
        { maxTokens: 500 },
    );
    if (!result || !result.text.trim()) return { text: buildFallbackScript(topic), fromModel: false };
    return { text: result.text.trim(), fromModel: true };
}

async function createInSupabase(client: SupabaseClient, topic: string, platform: Platform, targetDurationSeconds: number, script: string, template: VideoTemplate): Promise<VideoRecord> {
    const userId = await ensureDemoUser();
    if (!userId) {
        throw new Error('No fue posible preparar el usuario demo para Supabase.');
    }

    const { data: videoData, error: videoError } = await client.from('videos').insert({
        user_id: userId,
        topic,
        platform,
        target_duration_seconds: targetDurationSeconds,
        script,
        template,
        status: 'borrador',
        branding: DEFAULT_BRANDING,
    }).select().single();

    if (videoError || !videoData) {
        throw videoError ?? new Error('No se pudo crear el video.');
    }

    return toVideoRecord(videoData, []);
}

function buildLocalVideoRecord(topic: string, platform: Platform, targetDurationSeconds: number, script: string, template: VideoTemplate): VideoRecord {
    const id = crypto.randomUUID();
    const video: Video = {
        id,
        user_id: 'demo-user',
        topic,
        platform,
        target_duration_seconds: targetDurationSeconds,
        script,
        template,
        status: 'borrador',
        branding: { ...DEFAULT_BRANDING },
        video_url: null,
        source_video_id: null,
        render_status: 'inactivo',
        render_progress: 0,
        render_error: null,
        render_started_at: null,
        created_at: new Date().toISOString(),
    };
    return { ...video, scenes: [] };
}

function sceneRows(videoId: string, scenes: SceneInput[]): DatabaseRow[] {
    return scenes.map((scene) => ({
        video_id: videoId,
        order: scene.order,
        character: scene.character,
        action: scene.action,
        prop: scene.prop,
        description: scene.description,
        duration_seconds: scene.duration_seconds,
        audio_url: scene.audio_url,
        ...soundEffectColumn(scene.sound_effect_id),
    }));
}

// The record as it is now, after a write. maybeSingle so a missing row is a
// clean 404 instead of a PostgREST error that reads like a database failure.
async function readVideoFromSupabase(client: SupabaseClient, id: string): Promise<VideoRecord> {
    const { data: videoData, error: videoError } = await client.from('videos').select('*').eq('id', id).maybeSingle();
    if (videoError) throw videoError;
    if (!videoData) throw new VideoError(VIDEO_NOT_FOUND, 404);
    const { data: scenesData, error: scenesError } = await client.from('scenes').select('*').eq('video_id', id);
    if (scenesError) throw scenesError;
    return toVideoRecord(videoData, scenesData ?? []);
}

// RF-012: the approval was for the content as it was. Run BEFORE the content
// write on purpose: if the edit then fails, the video has only lost its
// approval (the safe side); the reverse order could leave edited content still
// marked as approved. The status filter makes it a no-op on drafts and keeps it
// from ever moving a video anywhere but back to 'borrador'.
async function revertApprovalInSupabase(client: SupabaseClient, id: string): Promise<void> {
    const { error } = await client
        .from('videos')
        .update({ status: 'borrador' })
        .eq('id', id)
        .in('status', [...EDIT_REVERTS_TO_DRAFT_FROM]);
    if (error) throw error;
}

function revertApprovalInMemory(video: VideoRecord): VideoRecord {
    return revertsToDraftOnEdit(video.status) ? { ...video, status: 'borrador' } : video;
}

export async function listVideos(): Promise<VideoRecord[]> {
    return readFromSupabase();
}

export async function getVideo(id: string): Promise<VideoRecord | null> {
    return findVideoRecord(id);
}

// `preparedScript` lets a caller that already ran generateScript (the batch
// route, so it can inspect `fromModel` before handing the text over) skip a
// second model call. Every existing caller omits it and keeps generating the
// script here, unchanged.
export async function createVideo(topic: string, platform: Platform, targetDurationSeconds: number, template: VideoTemplate = 'libre', preparedScript?: string): Promise<VideoRecord> {
    const script = preparedScript ?? (await generateScript(topic, template)).text;

    const client = getSupabaseClient({ serviceRole: true });
    if (client) {
        try {
            return await createInSupabase(client, topic, platform, targetDurationSeconds, script, template);
        } catch (error) {
            fallBackOrThrow(error, 'Fallo al crear el video en Supabase');
        }
    }

    const record = buildLocalVideoRecord(topic, platform, targetDurationSeconds, script, template);
    mockVideos.set(record.id, record);
    return record;
}

export async function updateScript(id: string, script: string): Promise<VideoRecord> {
    const client = getSupabaseClient({ serviceRole: true }) ?? getSupabaseClient();
    if (client) {
        try {
            await revertApprovalInSupabase(client, id);
            const { data: updated, error } = await client.from('videos').update({ script }).eq('id', id).select('*').maybeSingle();
            if (error) throw error;
            if (!updated) throw new VideoError(VIDEO_NOT_FOUND, 404);
            const { data: scenesData } = await client.from('scenes').select('*').eq('video_id', id);
            return toVideoRecord(updated, scenesData ?? []);
        } catch (error) {
            fallBackOrThrow(error, 'Fallo al actualizar el guion en Supabase');
        }
    }

    const video = mockVideos.get(id);
    if (!video) throw new VideoError(VIDEO_NOT_FOUND, 404);
    const updated = revertApprovalInMemory({ ...video, script });
    mockVideos.set(id, updated);
    return updated;
}

// New scenes go in before the old ones come out, so a failure at any step
// leaves the video with a full set of scenes - the old ones or the new ones,
// never zero. The old rows are deleted by id, not by video_id, because by then
// the new rows share that video_id.
export async function replaceScenes(id: string, scenes: SceneInput[]): Promise<VideoRecord> {
    const client = getSupabaseClient({ serviceRole: true }) ?? getSupabaseClient();
    if (client) {
        try {
            const { data: videoData, error: videoError } = await client.from('videos').select('id').eq('id', id).maybeSingle();
            if (videoError) throw videoError;
            if (!videoData) throw new VideoError(VIDEO_NOT_FOUND, 404);

            const { data: oldRows, error: oldError } = await client.from('scenes').select('id').eq('video_id', id);
            if (oldError) throw oldError;
            const oldIds = (oldRows ?? []).map((row) => String(row.id));

            await revertApprovalInSupabase(client, id);

            let newIds: string[] = [];
            if (scenes.length) {
                const { data: inserted, error: insertError } = await client.from('scenes').insert(sceneRows(id, scenes)).select('id');
                if (insertError) throw insertError;
                newIds = (inserted ?? []).map((row) => String(row.id));
            }

            if (oldIds.length) {
                const { error: deleteError } = await client.from('scenes').delete().in('id', oldIds);
                if (deleteError) {
                    // Old and new would now be shown together, doubled. Take the
                    // new ones back out so the video stays as it was.
                    if (newIds.length) {
                        const { error: rollbackError } = await client.from('scenes').delete().in('id', newIds);
                        if (rollbackError) console.error('No fue posible deshacer las escenas nuevas tras un fallo.', rollbackError);
                    }
                    throw deleteError;
                }
            }

            return await readVideoFromSupabase(client, id);
        } catch (error) {
            fallBackOrThrow(error, 'Fallo al reemplazar escenas en Supabase');
        }
    }

    const video = mockVideos.get(id);
    if (!video) throw new VideoError(VIDEO_NOT_FOUND, 404);
    const newScenes: Scene[] = scenes.map((scene) => ({ ...scene, id: crypto.randomUUID(), video_id: id }));
    const updated = revertApprovalInMemory({ ...video, scenes: newScenes });
    mockVideos.set(id, updated);
    return updated;
}

const SCENE_FIELDS: readonly (keyof SceneInput)[] = ['order', 'character', 'action', 'prop', 'description', 'duration_seconds', 'audio_url', 'sound_effect_id'];

// Only what actually differs from the stored scene. A regeneration that fell
// back to the original content therefore writes nothing and costs nobody an
// approval. A new description also drops the narration recorded for the old
// one: the render would otherwise play a voice saying the previous line.
function effectiveScenePatch(scene: Scene, patch: Partial<SceneInput>): Partial<SceneInput> {
    const changed: Partial<SceneInput> = {};
    for (const field of SCENE_FIELDS) {
        if (field in patch && patch[field] !== undefined && patch[field] !== scene[field]) {
            Object.assign(changed, { [field]: patch[field] });
        }
    }
    if ('description' in changed && !('audio_url' in changed) && scene.audio_url !== null) {
        changed.audio_url = null;
    }
    return changed;
}

// `keepApproval` is for writes that are not an edit of what the approver saw:
// the TTS route recording the narration of the approved lines.
export async function updateScene(id: string, sceneId: string, patch: Partial<SceneInput>, options: { keepApproval?: boolean } = {}): Promise<VideoRecord> {
    const client = getSupabaseClient({ serviceRole: true }) ?? getSupabaseClient();
    if (client) {
        try {
            const { data: current, error: currentError } = await client.from('scenes').select('*').eq('id', sceneId).eq('video_id', id).maybeSingle();
            if (currentError) throw currentError;
            const effective = current ? effectiveScenePatch(toScene(current), patch) : {};

            if (Object.keys(effective).length) {
                if (!options.keepApproval) await revertApprovalInSupabase(client, id);
                const { error: updateError } = await client.from('scenes').update(effective).eq('id', sceneId).eq('video_id', id);
                if (updateError && 'sound_effect_id' in effective && isMissingSchemaError(updateError)) {
                    throw new Error(SOUNDS_MIGRATION_MISSING_ERROR);
                }
                if (updateError) throw updateError;
            }

            return await readVideoFromSupabase(client, id);
        } catch (error) {
            if (error instanceof Error && error.message === SOUNDS_MIGRATION_MISSING_ERROR) throw error;
            fallBackOrThrow(error, 'Fallo al actualizar la escena en Supabase');
        }
    }

    const video = mockVideos.get(id);
    if (!video) throw new VideoError(VIDEO_NOT_FOUND, 404);
    const currentScene = video.scenes.find((scene) => scene.id === sceneId);
    const effective = currentScene ? effectiveScenePatch(currentScene, patch) : {};
    if (!Object.keys(effective).length) return video;
    const scenes = video.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...effective } : scene));
    const edited = { ...video, scenes };
    const updated = options.keepApproval ? edited : revertApprovalInMemory(edited);
    mockVideos.set(id, updated);
    return updated;
}

export async function deleteScene(id: string, sceneId: string): Promise<VideoRecord> {
    const client = getSupabaseClient({ serviceRole: true }) ?? getSupabaseClient();
    if (client) {
        try {
            await revertApprovalInSupabase(client, id);
            const { error: deleteError } = await client.from('scenes').delete().eq('id', sceneId).eq('video_id', id);
            if (deleteError) throw deleteError;

            // Close the gap the deletion leaves: order drives both the render
            // sequence and the numbering the user sees, so leaving a hole would
            // show "Escena 1, 2, 4".
            const { data: remaining } = await client.from('scenes').select('*').eq('video_id', id);
            const ordered = [...(remaining ?? [])].sort((a, b) => Number(a.order) - Number(b.order));
            for (let index = 0; index < ordered.length; index += 1) {
                if (Number(ordered[index].order) !== index + 1) {
                    await client.from('scenes').update({ order: index + 1 }).eq('id', ordered[index].id);
                }
            }

            return await readVideoFromSupabase(client, id);
        } catch (error) {
            fallBackOrThrow(error, 'Fallo al eliminar la escena en Supabase');
        }
    }

    const video = mockVideos.get(id);
    if (!video) throw new VideoError(VIDEO_NOT_FOUND, 404);
    const scenes = video.scenes
        .filter((scene) => scene.id !== sceneId)
        .sort((a, b) => a.order - b.order)
        .map((scene, index) => ({ ...scene, order: index + 1 }));
    const updated = revertApprovalInMemory({ ...video, scenes });
    mockVideos.set(id, updated);
    return updated;
}

function sameBranding(a: Branding, b: Branding): boolean {
    return a.logo_url === b.logo_url
        && a.logo_position === b.logo_position
        && a.primary_color === b.primary_color
        && a.secondary_color === b.secondary_color
        && a.font_family === b.font_family;
}

// Branding is part of what the approver signed off on - the logo and colours
// are on every frame of a regulated ad - so a real change reverts approval
// like any other edit. Re-applying the identity the video already has does not.
export async function updateBranding(id: string, branding: Partial<Branding>): Promise<VideoRecord> {
    const current = await findVideoRecord(id);
    if (!current) throw new VideoError(VIDEO_NOT_FOUND, 404);
    const mergedBranding: Branding = { ...current.branding, ...branding };
    if (sameBranding(current.branding, mergedBranding)) return current;

    const client = getSupabaseClient({ serviceRole: true }) ?? getSupabaseClient();
    if (client) {
        try {
            await revertApprovalInSupabase(client, id);
            const { data: updated, error } = await client.from('videos').update({ branding: mergedBranding }).eq('id', id).select('*').maybeSingle();
            if (error) throw error;
            if (!updated) throw new VideoError(VIDEO_NOT_FOUND, 404);
            const { data: scenesData } = await client.from('scenes').select('*').eq('video_id', id);
            return toVideoRecord(updated, scenesData ?? []);
        } catch (error) {
            fallBackOrThrow(error, 'Fallo al actualizar branding en Supabase');
        }
    }

    const video = mockVideos.get(id);
    if (!video) throw new VideoError(VIDEO_NOT_FOUND, 404);
    const updated = revertApprovalInMemory({ ...video, branding: mergedBranding });
    mockVideos.set(id, updated);
    return updated;
}

export async function duplicateForPlatform(id: string, platform: Platform): Promise<VideoRecord> {
    const original = await findVideoRecord(id);
    if (!original) throw new VideoError(VIDEO_NOT_FOUND, 404);

    const sceneInputs: SceneInput[] = original.scenes.map((scene) => ({
        order: scene.order,
        character: scene.character,
        action: scene.action,
        prop: scene.prop,
        description: scene.description,
        duration_seconds: scene.duration_seconds,
        audio_url: scene.audio_url,
        sound_effect_id: scene.sound_effect_id,
    }));

    const client = getSupabaseClient({ serviceRole: true }) ?? getSupabaseClient();
    if (client) {
        try {
            const { data: videoData, error: videoError } = await client.from('videos').insert({
                user_id: original.user_id,
                topic: original.topic,
                platform,
                target_duration_seconds: original.target_duration_seconds,
                script: original.script,
                template: original.template,
                status: 'borrador',
                branding: original.branding,
                source_video_id: original.id,
            }).select().single();
            if (videoError || !videoData) throw videoError ?? new Error('No se pudo duplicar el video.');

            const newId = String(videoData.id);
            if (sceneInputs.length) {
                const { error: insertError } = await client.from('scenes').insert(sceneRows(newId, sceneInputs));
                if (insertError) {
                    // A copy without its scenes looks like a finished duplicate
                    // and is not one; take it back out rather than leave it.
                    const { error: cleanupError } = await client.from('videos').delete().eq('id', newId);
                    if (cleanupError) console.error('No fue posible borrar la copia incompleta del video.', cleanupError);
                    throw insertError;
                }
            }

            return await readVideoFromSupabase(client, newId);
        } catch (error) {
            fallBackOrThrow(error, 'Fallo al duplicar el video en Supabase');
        }
    }

    const newId = crypto.randomUUID();
    const video: Video = {
        id: newId,
        user_id: original.user_id,
        topic: original.topic,
        platform,
        target_duration_seconds: original.target_duration_seconds,
        script: original.script,
        status: 'borrador',
        branding: { ...original.branding },
        video_url: null,
        source_video_id: original.id,
        render_status: 'inactivo',
        render_progress: 0,
        render_error: null,
        render_started_at: null,
        template: original.template,
        created_at: new Date().toISOString(),
    };
    const record: VideoRecord = {
        ...video,
        scenes: sceneInputs.map((scene) => ({ ...scene, id: crypto.randomUUID(), video_id: newId })),
    };
    mockVideos.set(newId, record);
    return record;
}

// The business rules of a status change, shared by the database and memory
// paths. Thrown as VideoError(409) so they reach the client as what they are
// instead of being mistaken for a storage failure.
function nextStatusFor(video: { status: unknown; video_url: unknown }, action: string): VideoStatus {
    if (action === 'publish' && !video.video_url) throw new VideoError('Genera el video antes de publicarlo.', 409);
    const nextStatus = transitions[action];
    if (!nextStatus || !canTransition(video.status as VideoStatus, nextStatus)) {
        throw new VideoError(`Transición no permitida desde ${String(video.status)}.`, 409);
    }
    return nextStatus;
}

function patchInMemory(id: string, action: string): VideoRecord {
    const video = mockVideos.get(id);
    if (!video) throw new VideoError(VIDEO_NOT_FOUND, 404);
    const updated = { ...video, status: nextStatusFor(video, action) };
    mockVideos.set(id, updated);
    return updated;
}

async function patchInSupabase(client: SupabaseClient, id: string, action: string): Promise<VideoRecord> {
    const { data: videoData, error: fetchError } = await client.from('videos').select('*').eq('id', id).maybeSingle();
    if (fetchError) throw fetchError;
    if (!videoData) throw new VideoError(VIDEO_NOT_FOUND, 404);

    const nextStatus = nextStatusFor(videoData, action);

    // Conditional on the status just read: an edit that reverted the video to
    // 'borrador' a moment ago must not be overwritten by an approval clicked
    // on the version the person saw before it.
    const { data: updated, error: updateError } = await client
        .from('videos')
        .update({ status: nextStatus })
        .eq('id', id)
        .eq('status', String(videoData.status))
        .select('*')
        .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) throw new VideoError('El video cambió mientras tanto. Recarga la página y vuelve a intentarlo.', 409);

    const { data: scenesData } = await client.from('scenes').select('*').eq('video_id', id);
    return toVideoRecord(updated, scenesData ?? []);
}

export async function updateVideoStatus(id: string, action: string): Promise<VideoRecord> {
    const client = getSupabaseClient({ serviceRole: true }) ?? getSupabaseClient();
    if (!client) return patchInMemory(id, action);
    try {
        return await patchInSupabase(client, id, action);
    } catch (error) {
        fallBackOrThrow(error, 'Fallo al actualizar estado en Supabase');
        return patchInMemory(id, action);
    }
}

export async function deleteVideo(id: string): Promise<void> {
    const video = await findVideoRecord(id);
    if (!video) throw new VideoError(VIDEO_NOT_FOUND, 404);

    const client = getSupabaseClient({ serviceRole: true }) ?? getSupabaseClient();
    if (client) {
        try {
            // Scenes first: they reference the video, and deleting the parent
            // while children exist fails unless the foreign key cascades.
            const { error: scenesError } = await client.from('scenes').delete().eq('video_id', id);
            if (scenesError) throw scenesError;
            const { error } = await client.from('videos').delete().eq('id', id);
            if (error) throw error;
        } catch (error) {
            fallBackOrThrow(error, 'Fallo al eliminar el video en Supabase');
        }
    }

    mockVideos.delete(id);
}

type RenderState = Pick<Video, 'render_status' | 'render_progress' | 'render_error' | 'render_started_at'>;

const RENDER_ALREADY_RUNNING = 'Este video ya se está generando.';
const RENDER_WORKER_BUSY = 'El generador está ocupado con otro video; intenta en unos minutos.';

// Takes the render slot for this video in one conditional write, so two
// clicks (or two tabs) cannot both reach the worker. A row still marked
// 'procesando' is only taken over once it is past the same stall threshold
// the reads use to give a job up for dead.
async function claimRender(client: SupabaseClient | null, video: VideoRecord, claim: RenderState): Promise<VideoRecord> {
    if (!client) {
        const local = mockVideos.get(video.id) ?? video;
        if (local.render_status === 'procesando' && !isRenderStalled(local.render_status, local.render_started_at)) {
            throw new VideoError(RENDER_ALREADY_RUNNING, 409);
        }
        const claimed = { ...local, ...claim };
        mockVideos.set(video.id, claimed);
        return claimed;
    }

    const stallCutoff = new Date(Date.now() - RENDER_STALL_TIMEOUT_MS).toISOString();
    const { data: claimed, error } = await client
        .from('videos')
        .update(claim)
        .eq('id', video.id)
        .or(`render_status.is.null,render_status.neq.procesando,render_started_at.lt."${stallCutoff}"`)
        .select('*')
        .maybeSingle();
    if (error) throw toVideoError(error);
    if (!claimed) throw new VideoError(RENDER_ALREADY_RUNNING, 409);
    return toVideoRecord(claimed, video.scenes as unknown as DatabaseRow[]);
}

// Gives the slot back when the worker never took the job. Guarded by our own
// start time so it cannot undo a claim someone else made after ours.
async function releaseRender(client: SupabaseClient | null, id: string, claim: RenderState, previous: RenderState): Promise<void> {
    if (!client) {
        const local = mockVideos.get(id);
        if (local && local.render_started_at === claim.render_started_at) mockVideos.set(id, { ...local, ...previous });
        return;
    }
    const { error } = await client
        .from('videos')
        .update(previous)
        .eq('id', id)
        .eq('render_status', 'procesando')
        .eq('render_started_at', claim.render_started_at ?? '');
    if (error) console.error('No fue posible liberar el render tras el rechazo del generador.', error);
}

export async function renderVideo(id: string): Promise<VideoRecord> {
    const video = await findVideoRecord(id);
    if (!video) throw new VideoError(VIDEO_NOT_FOUND, 404);
    if (video.status !== 'aprobado') throw new VideoError('Solo se pueden generar videos aprobados.', 409);

    // Where the render runs. 'http' is the always-on worker reached at
    // RENDER_WORKER_URL; 'cloud-run-job' starts one Cloud Run Jobs execution
    // per video. Anything unrecognised falls back to the HTTP worker, the
    // behaviour every deployment had before this switch existed.
    const backend = process.env.RENDER_BACKEND?.trim().toLowerCase() === 'cloud-run-job' ? 'cloud-run-job' : 'http';

    let workerUrl = '';
    let workerToken: string | undefined;
    let jobConfig: CloudRunJobConfig | null = null;
    if (backend === 'cloud-run-job') {
        const config = readCloudRunJobConfig();
        if ('missing' in config) {
            // Same reasoning as RENDER_WORKER_URL below: fail with the name of
            // what is missing, before claiming anything. Outside production
            // there is no local stand-in for a Cloud Run job, so it fails too.
            throw new VideoError(`Faltan variables para generar en Cloud Run: ${config.missing.join(', ')}.`, 500);
        }
        jobConfig = config;
    } else {
        const configuredWorkerUrl = process.env.RENDER_WORKER_URL?.trim();
        if (!configuredWorkerUrl && process.env.NODE_ENV === 'production') {
            throw new VideoError('RENDER_WORKER_URL es obligatoria en producción.', 500);
        }
        workerUrl = (configuredWorkerUrl || 'http://localhost:8080').replace(/\/+$/, '');

        // The worker now sits open to the internet at RENDER_WORKER_URL, so a
        // shared secret is the only thing stopping anyone who finds that URL from
        // queuing renders directly. Required in production for the same reason
        // RENDER_WORKER_URL is: a render silently sent unauthenticated would just
        // be rejected by the worker's own check, so fail here with a clear reason
        // instead of a confusing 401 from that fetch.
        workerToken = process.env.RENDER_WORKER_TOKEN?.trim();
        if (!workerToken && process.env.NODE_ENV === 'production') {
            throw new VideoError('RENDER_WORKER_TOKEN es obligatoria en producción.', 500);
        }
    }
    const sortedScenes = [...video.scenes].sort((a, b) => a.order - b.order);

    // The worker gets playable URLs, never ids: it has no access to the sound
    // catalog. A sound deleted since it was chosen resolves to null and the
    // video renders without it.
    const soundUrls = await resolveSoundUrls(sortedScenes.map((scene) => scene.sound_effect_id));
    const urlFor = (soundId: string | null) => (soundId ? soundUrls.get(soundId) ?? null : null);

    // One job description for both backends, so the HTTP worker and the Cloud
    // Run job cannot drift apart on what a render needs.
    const job = {
        id,
        platform: video.platform,
        branding: video.branding,
        scenes: sortedScenes.map((scene) => ({
            order: scene.order,
            character: scene.character,
            action: scene.action,
            prop: scene.prop,
            description: scene.description,
            duration_seconds: scene.duration_seconds,
            audio_url: scene.audio_url,
            sound_effect_url: urlFor(scene.sound_effect_id),
        })),
    };

    // Checked before the claim: a job too big for an env override would be
    // refused by Google anyway, and there is nothing to give back yet.
    const encodedJob = jobConfig ? encodeJobPayload(job) : '';
    if (jobConfig && encodedJob.length > MAX_JOB_PAYLOAD_CHARS) {
        throw new VideoError('El video tiene demasiado contenido para enviarlo al generador. Acorta las escenas o reduce su número.', 413);
    }

    const client = getSupabaseClient({ serviceRole: true }) ?? getSupabaseClient();
    const previous: RenderState = {
        render_status: video.render_status,
        render_progress: video.render_progress,
        render_error: video.render_error,
        render_started_at: video.render_started_at,
    };
    const claim: RenderState = {
        render_status: 'procesando',
        render_progress: 0,
        render_error: null,
        render_started_at: new Date().toISOString(),
    };
    // Claimed before the worker is called, and never written again here once
    // it answers: from the 202 on, the worker owns the row and reports its own
    // progress, and a late write from this side would overwrite that.
    const claimed = await claimRender(client, video, claim);

    if (jobConfig) {
        // A 2xx only means Google created the execution; the job itself writes
        // progress, 'listo' or 'error' to the row, exactly like the HTTP
        // worker does after its 202. If the container never starts, the stall
        // threshold gives the row up as it would for a dead worker.
        const result = await runCloudRunJob(jobConfig, encodedJob);
        if (!result.ok) {
            console.error('Cloud Run rechazó la ejecución del render.', { status: result.status, detail: result.detail });
            await releaseRender(client, id, claim, previous);
            throw new VideoError('No se pudo iniciar el generador de video.', 502);
        }
        return claimed;
    }

    // The worker answers 202 as soon as it has accepted the job and then
    // reports progress on the video row, so this only has to confirm the job
    // was queued. A render can run for minutes once scenes come from an AI
    // model - far longer than this request may stay open.
    let response: Response;
    try {
        response = await fetch(`${workerUrl}/render`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
            },
            body: JSON.stringify(job),
        });
    } catch (error) {
        console.error('No fue posible contactar al generador de video.', error);
        await releaseRender(client, id, claim, previous);
        throw new VideoError('No fue posible contactar al generador de video. Intenta de nuevo en unos minutos.', 502);
    }

    if (!response.ok) {
        await releaseRender(client, id, claim, previous);
        if (response.status === 409) throw new VideoError(RENDER_ALREADY_RUNNING, 409);
        if (response.status === 503) throw new VideoError(RENDER_WORKER_BUSY, 503);
        const result = await response.json().catch(() => ({})) as { error?: unknown };
        throw new VideoError(typeof result.error === 'string' ? result.error : 'No se pudo encolar la generación del video.', 502);
    }

    return claimed;
}
