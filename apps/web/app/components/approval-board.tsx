'use client';

import { isRenderStalled, type VideoStatus } from '@shared-types/video';
import type { VideoRecord } from './api';
import { STATUS_DOT_CLASSES, STATUS_LABELS } from './constants';
import { Icon } from './section-icon';
import VideoPoster from './video-poster';
import { PLATFORM_SHORT, effectiveSeconds, formatClock } from './studio-utils';

interface ApprovalBoardProps {
    videos: VideoRecord[];
    loading: boolean;
    now: number;
    onOpen: (id: string) => void;
}

const COLUMNS: { status: VideoStatus; hint: string }[] = [
    { status: 'borrador', hint: 'En preparación' },
    { status: 'pendiente_aprobacion', hint: 'Esperan a una persona' },
    { status: 'aprobado', hint: 'Listos para generar el MP4' },
    { status: 'publicado', hint: 'Ya en la plataforma' },
];

function renderState(video: VideoRecord, now: number): { label: string; tone: string } | null {
    if (now > 0 && isRenderStalled(video.render_status, video.render_started_at, now)) return { label: 'Colgado', tone: 'text-red-300' };
    switch (video.render_status) {
        case 'procesando':
            return { label: `Generando ${video.render_progress}%`, tone: 'text-brand-200' };
        case 'error':
            return { label: 'Error al generar', tone: 'text-red-300' };
        case 'listo':
            return { label: 'MP4 listo', tone: 'text-emerald-300' };
        default:
            return video.status === 'aprobado' ? { label: 'Sin MP4', tone: 'text-slate-400' } : null;
    }
}

// A read-only board: cards open the video in the Estudio, and that is all
// they do. There is deliberately no drag and drop - moving a card into
// "Aprobado" or "Publicado" would be an approval by gesture, and RF-012 keeps
// those as explicit human buttons in the status panel.
export default function ApprovalBoard({ videos, loading, now, onOpen }: ApprovalBoardProps) {
    return (
        <div className="enter space-y-5">
            <header className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                    <p className="eyebrow mb-1.5">Flujo de aprobación</p>
                    <h1 className="text-2xl font-semibold tracking-[-0.025em] text-white sm:text-[1.75rem]">Tablero</h1>
                    <p className="mt-1 max-w-2xl text-sm text-slate-400">
                        Cada video en su etapa. Abre uno para revisarlo: aprobar y publicar se hacen solo con los botones del panel de estado, nunca arrastrando.
                    </p>
                </div>
                <p className="chip border-amber-400/25 bg-amber-400/[0.06] text-amber-100">
                    <Icon name="shield" size={13} className="text-amber-300" />
                    Aprobación humana obligatoria
                </p>
            </header>

            {/* Columns scroll sideways on narrow screens instead of squeezing. */}
            <div className="thin-scroll -mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
                <div className="grid min-w-[60rem] grid-cols-4 gap-4 lg:min-w-0">
                    {COLUMNS.map((column) => {
                        const items = videos.filter((video) => video.status === column.status);
                        return (
                            <section
                                key={column.status}
                                aria-labelledby={`col-${column.status}`}
                                className="flex min-h-[20rem] flex-col rounded-[var(--radius-panel)] border border-white/[0.06] bg-ink-900/50"
                            >
                                <header className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3.5 py-3">
                                    <span className="min-w-0">
                                        <span className="flex items-center gap-2">
                                            <span className={`h-2 w-2 rounded-full ${STATUS_DOT_CLASSES[column.status]}`} aria-hidden="true" />
                                            <h2 id={`col-${column.status}`} className="truncate text-sm font-semibold text-white">{STATUS_LABELS[column.status]}</h2>
                                        </span>
                                        <span className="mt-0.5 block truncate text-[0.6875rem] text-slate-500">{column.hint}</span>
                                    </span>
                                    <span className="chip font-mono tabular-nums">{loading ? '–' : items.length}</span>
                                </header>
                                <ul className="flex-1 space-y-2.5 p-2.5">
                                    {loading && <li className="skeleton h-24 w-full" aria-hidden="true" />}
                                    {!loading && items.length === 0 && (
                                        <li className="rounded-lg border border-dashed border-white/[0.08] px-3 py-6 text-center text-xs text-slate-500">
                                            Sin videos en esta etapa.
                                        </li>
                                    )}
                                    {items.map((video) => {
                                        const render = renderState(video, now);
                                        return (
                                            <li key={video.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => onOpen(video.id)}
                                                    aria-label={`Abrir ${video.topic} en el Estudio`}
                                                    className="tile tile-hover group flex w-full gap-3 p-2.5 text-left"
                                                >
                                                    <VideoPoster video={video} showSubtitle={false} className="w-11 shrink-0 rounded-md" />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="line-clamp-2 text-[0.8125rem] font-medium leading-snug text-slate-100 group-hover:text-white">{video.topic}</span>
                                                        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[0.6875rem] tabular-nums text-slate-400">
                                                            <span>{PLATFORM_SHORT[video.platform]}</span>
                                                            <span aria-hidden="true">·</span>
                                                            <span>{formatClock(effectiveSeconds(video))}</span>
                                                            <span aria-hidden="true">·</span>
                                                            <span>{video.scenes.length} esc.</span>
                                                        </span>
                                                        {render && (
                                                            <span className={`mt-1 flex items-center gap-1.5 text-[0.6875rem] font-medium ${render.tone}`}>
                                                                {video.render_status === 'procesando' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-300" aria-hidden="true" />}
                                                                {render.label}
                                                            </span>
                                                        )}
                                                    </span>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
