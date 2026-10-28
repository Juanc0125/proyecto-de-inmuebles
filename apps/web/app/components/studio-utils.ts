// Small pure helpers shared by the shell's sections. Nothing here talks to the
// server or holds state; it only derives display values from a VideoRecord.

import type { Platform } from '@shared-types/video';
import type { VideoRecord } from './api';

export type Section = 'panel' | 'estudio' | 'biblioteca' | 'flujo' | 'marca' | 'sonidos';

export const SECTIONS: { id: Section; label: string; description: string }[] = [
    { id: 'panel', label: 'Panel', description: 'Resumen, pendientes y actividad' },
    { id: 'estudio', label: 'Estudio', description: 'Crear y editar videos' },
    { id: 'biblioteca', label: 'Biblioteca', description: 'Todos los videos, con filtros' },
    { id: 'flujo', label: 'Flujo de aprobación', description: 'Tablero por estado' },
    { id: 'marca', label: 'Marca', description: 'Logo, colores y plantillas' },
    { id: 'sonidos', label: 'Sonidos', description: 'Música y efectos' },
];

export function sortedScenes(video: VideoRecord) {
    return [...video.scenes].sort((a, b) => a.order - b.order);
}

export function scenesSeconds(video: VideoRecord): number {
    return video.scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0);
}

// What the video will actually last once rendered: the scenes decide it, and
// before there are any the target is the best estimate there is.
export function effectiveSeconds(video: VideoRecord): number {
    const fromScenes = scenesSeconds(video);
    return fromScenes > 0 ? fromScenes : video.target_duration_seconds;
}

export function formatClock(totalSeconds: number): string {
    const rounded = Math.max(0, Math.round(totalSeconds));
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// `now` is passed in rather than read here: reading the clock during render
// is impure, so callers hold it in state and tick it.
export function relativeTime(iso: string, now: number): string {
    const then = Date.parse(iso);
    if (Number.isNaN(then) || now === 0) return '';
    const minutes = Math.round((now - then) / 60000);
    if (minutes < 1) return 'hace un momento';
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.round(hours / 24);
    if (days < 30) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
    return new Date(then).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function normalizeText(value: string): string {
    return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export const PLATFORM_SHORT: Record<Platform, string> = {
    reels: 'Reels',
    tiktok: 'TikTok',
    shorts: 'Shorts',
};
