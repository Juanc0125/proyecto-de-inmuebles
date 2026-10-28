export type { VideoTemplate } from './templates';
import type { VideoTemplate } from './templates';

export type VideoStatus = 'borrador' | 'pendiente_aprobacion' | 'aprobado' | 'publicado';
export type Platform = 'reels' | 'tiktok' | 'shorts';
export type CharacterType = 'broker' | 'cliente' | 'pareja' | 'hombre' | 'mujer' | 'generico';
export type SceneAction = 'hablar' | 'caminar' | 'senalar' | 'sentarse' | 'pensar' | 'telefono' | 'mostrar_objeto';
export type ScenePropType = 'ninguno' | 'casa' | 'carro' | 'banco' | 'telefono' | 'documento' | 'dinero' | 'grafico' | 'oficina';
export type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface Branding {
    logo_url: string | null;
    logo_position: LogoPosition;
    primary_color: string;   // hex, e.g. "#17202a"
    secondary_color: string; // hex, e.g. "#ffffff"
    font_family: string;     // e.g. "Arial"
}

export const DEFAULT_BRANDING: Branding = {
    logo_url: null,
    logo_position: 'top-right',
    primary_color: '#17202a',
    secondary_color: '#ffffff',
    font_family: 'Arial',
};

// One scene is one spoken line: under 2 s it cannot be read, over 10 s the
// stick figure stands still long enough to lose the viewer. The scene planner,
// the manual edit and the copilot all clamp or reject against these.
export const MIN_SCENE_SECONDS = 2;
export const MAX_SCENE_SECONDS = 10;

// Upper bound for a whole video's target length. These are short vertical
// clips; a bigger target only makes the planner ask for more scenes than the
// format can hold.
export const MAX_TARGET_DURATION_SECONDS = 180;

// Rendering is asynchronous: generating a scene with an AI model takes
// minutes, so the request returns immediately and the worker reports progress
// on the video row.
export type RenderStatus = 'inactivo' | 'procesando' | 'listo' | 'error';

// A render that has not reported in this long is not slow, it is gone: the
// worker container hits its memory limit and gets killed mid-job, and nothing
// ever touches that row again. Generous enough to cover an AI-generated video,
// which legitimately takes minutes per scene. Lives here because the server
// that gives the row up for dead and the panel that warns about it have to
// agree on one number.
export const RENDER_STALL_TIMEOUT_MS = 20 * 60 * 1000;

// What the person reads on a render nobody will ever finish. Says what
// happened and what to do, without naming the machinery that broke.
export const RENDER_STALLED_ERROR = 'La generación se interrumpió antes de terminar y no va a continuar sola. Puedes volver a intentarla cuando quieras.';

// Takes raw values so it works both on a database row and on a Video already
// mapped. No start time means the job never really began: with no clock to
// measure against, the honest answer is "not stalled".
export function isRenderStalled(renderStatus: unknown, renderStartedAt: unknown, now: number = Date.now()): boolean {
    if (renderStatus !== 'procesando') return false;
    if (typeof renderStartedAt !== 'string') return false;
    const startedAt = Date.parse(renderStartedAt);
    if (Number.isNaN(startedAt)) return false;
    return now - startedAt > RENDER_STALL_TIMEOUT_MS;
}

export interface Video {
    id: string;
    user_id: string;
    topic: string;
    platform: Platform;
    target_duration_seconds: number;
    script: string;
    status: VideoStatus;
    branding: Branding;
    video_url: string | null;
    source_video_id: string | null; // set when duplicated from another video for a different platform (content reuse)
    created_at: string;
    render_status: RenderStatus;
    render_progress: number; // 0-100
    render_error: string | null;
    render_started_at: string | null; // lets the UI spot a job whose worker died
    template: VideoTemplate; // RF-019: narrative shape the scenes follow
    music_id: string | null; // RF-010: 'biblioteca:<slug>' | 'subido:<uuid>', one background track per video
}

export interface Scene {
    id: string;
    video_id: string;
    order: number;
    character: CharacterType;
    action: SceneAction;
    prop: ScenePropType;
    description: string; // the narration line for this scene; also doubles as the subtitle text
    duration_seconds: number;
    audio_url: string | null;
    sound_effect_id: string | null; // RF-010: optional effect played at the start of the scene
}
