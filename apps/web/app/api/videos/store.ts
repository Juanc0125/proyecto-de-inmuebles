import type { Scene, Video, VideoStatus } from '@shared-types/video';

export type VideoRecord = Video & { scenes: Scene[] };

const globalStore = globalThis as typeof globalThis & {
    __stickmanVideos?: Map<string, VideoRecord>;
};

export const videos = globalStore.__stickmanVideos ??= new Map<string, VideoRecord>();

export const transitions: Record<string, VideoStatus> = {
    submit: 'pendiente_aprobacion',
    approve: 'aprobado',
    publish: 'publicado',
    reject: 'borrador',
};

export function canTransition(current: VideoStatus, next: VideoStatus): boolean {
    if (current === 'borrador' && next === 'pendiente_aprobacion') return true;
    if (current === 'pendiente_aprobacion' && next === 'aprobado') return true;
    if (current === 'pendiente_aprobacion' && next === 'borrador') return true;
    return current === 'aprobado' && next === 'publicado';
}

// RF-012: an approval is for the content as it was when a person looked at it.
// A content edit made in any of these statuses sends the video back to
// 'borrador'. This is deliberately not a `transitions` entry and does not go
// through canTransition: the status PATCH must never be able to reach
// 'borrador' from 'aprobado' or 'publicado' on request. Only the persistence
// layer applies it, and only as the side effect of a real edit.
export const EDIT_REVERTS_TO_DRAFT_FROM: readonly VideoStatus[] = ['pendiente_aprobacion', 'aprobado', 'publicado'];

export function revertsToDraftOnEdit(status: unknown): boolean {
    return (EDIT_REVERTS_TO_DRAFT_FROM as readonly unknown[]).includes(status);
}
