// Thin fetch wrappers around the video-studio backend API. Every function throws a plain
// Error with a Spanish message (taken from the API's own `{ error }` body when available) so
// callers can show it directly to the user.

import type { SoundAsset, SoundKind } from '@shared-types/sounds';
import type { BrandTemplate, VideoTemplate } from '@shared-types/templates';
import type {
    CharacterType,
    LogoPosition,
    Platform,
    Scene,
    SceneAction,
    ScenePropType,
    Video,
} from '@shared-types/video';

export type VideoRecord = Video & { scenes: Scene[] };

export async function parseJsonSafe(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

// Fired on `window` whenever the server answers 401. The studio listens for it
// and offers an "Entrar" link in the header: a guarded action failing is the
// one moment the operator needs to know there is a way in.
export const SIGN_IN_REQUIRED_EVENT = 'stickman:sign-in-required';

// The studio is open to anyone; only the guarded actions (render, approve,
// delete, upload - see proxy.ts) answer 401 without a session. That 401 is
// not "you were thrown out", it is "this one needs you to sign in", so it is
// shown like any other error instead of bouncing the browser to /login and
// losing whatever was on screen. The header then shows an "Entrar" link,
// announced through SIGN_IN_REQUIRED_EVENT.
async function request<T>(input: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
        response = await fetch(input, init);
    } catch {
        // Offline, DNS, a dropped connection: fetch rejects with a browser
        // message in English ("Failed to fetch") that must not reach the screen.
        throw new Error('No se pudo conectar con el servidor.');
    }
    const data = await parseJsonSafe(response);
    if (!response.ok) {
        if (response.status === 401 && typeof window !== 'undefined') {
            window.dispatchEvent(new Event(SIGN_IN_REQUIRED_EVENT));
        }
        const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
        const message = record && typeof record.error === 'string' ? record.error : 'Ocurrió un error inesperado.';
        throw new Error(message);
    }
    return data as T;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// The three auth endpoints, kept here so every call to the server - including
// these - goes through the one `request()` chokepoint above.
export async function login(email: string, password: string): Promise<void> {
    await request<unknown>('/api/auth/login', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ email, password }),
    });
}

export async function logout(): Promise<void> {
    await request<unknown>('/api/auth/logout', { method: 'POST' });
}

export async function fetchSession(): Promise<{ email: string | null }> {
    return request<{ email: string | null }>('/api/auth/session');
}

export async function fetchVideos(): Promise<VideoRecord[]> {
    const data = await request<{ videos: VideoRecord[] }>('/api/videos');
    return data.videos;
}

export async function createVideo(
    topic: string,
    platform: Platform,
    targetDurationSeconds: number,
    template: VideoTemplate = 'libre',
): Promise<VideoRecord> {
    const data = await request<{ video: VideoRecord }>('/api/videos', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ topic, platform, targetDurationSeconds, template }),
    });
    return data.video;
}

export interface BatchCreateFailure {
    tema: string;
    error: string;
}

// A warning names a video that IS in `creados` but came out degraded - a
// hardcoded generic script because no model answered, or no scenes. This is
// distinct from `fallidos`: the video exists and is in the list, it just
// isn't what the operator asked for yet.
// `causa` is the machine-readable half and `motivo` the sentence a person
// reads. Both come from the server: deducing the cause by matching words in
// the prose breaks silently the day that prose is reworded.
export type BatchWarningCause = 'guion_generico' | 'sin_escenas' | 'guion_generico_y_sin_escenas';

export interface BatchCreateWarning {
    tema: string;
    causa: BatchWarningCause;
    motivo: string;
}

export interface BatchCreateResult {
    creados: VideoRecord[];
    fallidos: BatchCreateFailure[];
    advertencias: BatchCreateWarning[];
}

// RF-024: several videos from several topics in one call. The server runs
// them sequentially - each is at least one model call - and a partial
// failure is a 200 with both arrays populated, not a thrown error.
export async function createVideosBatch(
    temas: string[],
    platform: Platform,
    targetDurationSeconds: number,
    template: VideoTemplate,
    conEscenas: boolean,
): Promise<BatchCreateResult> {
    return request<BatchCreateResult>('/api/videos/batch', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
            temas,
            platform,
            target_duration_seconds: targetDurationSeconds,
            template,
            con_escenas: conEscenas,
        }),
    });
}

export async function saveScript(id: string, script: string): Promise<VideoRecord> {
    const data = await request<{ video: VideoRecord }>(`/api/videos/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ script }),
    });
    return data.video;
}

export type StatusAction = 'submit' | 'approve' | 'reject' | 'publish' | 'render';

export async function transitionStatus(id: string, action: StatusAction): Promise<VideoRecord> {
    const data = await request<{ video: VideoRecord }>(`/api/videos/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ action }),
    });
    return data.video;
}

export async function generateScenes(id: string): Promise<VideoRecord> {
    const data = await request<{ video: VideoRecord }>(`/api/videos/${id}/scenes`, { method: 'POST' });
    return data.video;
}

export async function regenerateScene(id: string, sceneId: string): Promise<VideoRecord> {
    const data = await request<{ video: VideoRecord }>(`/api/videos/${id}/scenes/${sceneId}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ regenerate: true }),
    });
    return data.video;
}

export interface ScenePatch {
    character?: CharacterType;
    action?: SceneAction;
    prop?: ScenePropType;
    description?: string;
    duration_seconds?: number;
    // RF-010: null clears the effect. Only ids of kind 'efecto' are accepted.
    sound_effect_id?: string | null;
}

export async function updateScene(id: string, sceneId: string, patch: ScenePatch): Promise<VideoRecord> {
    const data = await request<{ video: VideoRecord }>(`/api/videos/${id}/scenes/${sceneId}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify(patch),
    });
    return data.video;
}

export async function generateVoice(id: string): Promise<{ video: VideoRecord; ttsConfigured: boolean }> {
    return request<{ video: VideoRecord; ttsConfigured: boolean }>(`/api/videos/${id}/tts`, { method: 'POST' });
}

export interface BrandingPatch {
    logo_position?: LogoPosition;
    primary_color?: string;
    secondary_color?: string;
    font_family?: string;
}

export async function updateBranding(id: string, patch: BrandingPatch): Promise<VideoRecord> {
    const data = await request<{ video: VideoRecord }>(`/api/videos/${id}/branding`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify(patch),
    });
    return data.video;
}

export async function uploadLogo(id: string, dataUrl: string): Promise<{ video: VideoRecord; logoUrl: string }> {
    return request<{ video: VideoRecord; logoUrl: string }>(`/api/videos/${id}/logo`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ dataUrl }),
    });
}

export async function fetchBrandTemplates(): Promise<BrandTemplate[]> {
    const data = await request<{ templates: BrandTemplate[] }>('/api/brand-templates');
    return data.templates;
}

export async function saveBrandTemplate(name: string, videoId: string): Promise<BrandTemplate> {
    const data = await request<{ template: BrandTemplate }>('/api/brand-templates', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name, video_id: videoId }),
    });
    return data.template;
}

export async function applyBrandTemplate(id: string, templateId: string): Promise<VideoRecord> {
    const data = await request<{ video: VideoRecord }>(`/api/videos/${id}/brand-template`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ template_id: templateId }),
    });
    return data.video;
}

export async function deleteBrandTemplate(templateId: string): Promise<void> {
    await request<unknown>(`/api/brand-templates/${templateId}`, { method: 'DELETE' });
}

export async function duplicateVideo(id: string, platform: Platform): Promise<VideoRecord> {
    const data = await request<{ video: VideoRecord }>(`/api/videos/${id}/duplicate`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ platform }),
    });
    return data.video;
}

export async function deleteVideo(id: string): Promise<void> {
    await request<unknown>(`/api/videos/${id}`, { method: 'DELETE' });
}

export async function deleteScene(id: string, sceneId: string): Promise<VideoRecord> {
    const data = await request<{ video: VideoRecord }>(`/api/videos/${id}/scenes/${sceneId}`, { method: 'DELETE' });
    return data.video;
}

// RF-010: background music and sound effects. The library sounds and the ones
// the business uploaded come back in one list; `origin` tells them apart.
export async function fetchSounds(): Promise<SoundAsset[]> {
    const data = await request<{ sonidos: SoundAsset[] }>('/api/sounds');
    return data.sonidos;
}

export interface SoundUploadTicket {
    path: string;
    token: string;
    signed_url: string;
}

export async function requestSoundUpload(file: File): Promise<SoundUploadTicket> {
    return request<SoundUploadTicket>('/api/sounds/upload-url', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ filename: file.name, content_type: file.type, size: file.size }),
    });
}

// The file goes straight from the browser to Supabase Storage: Vercel cuts
// request bodies above 4.5 MB, so it can never travel through our API. The
// token in the signed URL is the only credential the storage endpoint needs.
// Same multipart shape supabase-js' uploadToSignedUrl sends, so the stored
// object keeps the file's own content type.
export async function uploadSoundFile(ticket: SoundUploadTicket, file: File): Promise<void> {
    const body = new FormData();
    body.append('cacheControl', '3600');
    body.append('', file);
    let response: Response;
    try {
        response = await fetch(ticket.signed_url, { method: 'PUT', headers: { 'x-upsert': 'false' }, body });
    } catch {
        throw new Error('No se pudo conectar con el almacenamiento para subir el audio.');
    }
    if (!response.ok) {
        throw new Error('El almacenamiento rechazó el archivo de audio. Intenta de nuevo o prueba con otro archivo.');
    }
}

export async function registerSound(name: string, kind: SoundKind, path: string, licencia: string): Promise<SoundAsset> {
    const data = await request<{ sonido: SoundAsset }>('/api/sounds', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name, kind, path, licencia }),
    });
    return data.sonido;
}

export async function deleteSound(id: string): Promise<void> {
    await request<unknown>(`/api/sounds/${id}`, { method: 'DELETE' });
}

export async function setVideoMusic(id: string, musicId: string | null): Promise<VideoRecord> {
    const data = await request<{ video: VideoRecord }>(`/api/videos/${id}/music`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ music_id: musicId }),
    });
    return data.video;
}
