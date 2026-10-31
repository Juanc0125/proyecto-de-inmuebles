'use client';

import { useState } from 'react';
import { deleteVideo, type VideoRecord } from './api';
import { PLATFORM_LABELS } from './constants';
import StatusBadge from './status-badge';
import SectionIcon, { Icon } from './section-icon';
import VideoPoster from './video-poster';
import { effectiveSeconds } from './studio-utils';

interface VideoListProps {
    videos: VideoRecord[];
    loading: boolean;
    loadError: string;
    onRetry: () => void;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onDeleted: (id: string) => void;
    // How many to show; the Biblioteca has the full, filterable list.
    limit?: number;
    onShowAll?: () => void;
}

// The compact list in the Estudio: pick a video to edit, or delete one. The
// create form used to live in this file; it is create-video-form.tsx now.
export default function VideoList({ videos, loading, loadError, onRetry, selectedId, onSelect, onDeleted, limit, onShowAll }: VideoListProps) {
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState('');
    const shown = limit ? videos.slice(0, limit) : videos;

    async function handleDelete(video: VideoRecord) {
        const confirmed = window.confirm(
            `Se eliminará "${video.topic}" y todas sus escenas. Esta acción no se puede deshacer. ¿Continuar?`,
        );
        if (!confirmed) return;

        setDeletingId(video.id);
        setDeleteError('');
        try {
            await deleteVideo(video.id);
            onDeleted(video.id);
        } catch (err) {
            setDeleteError(err instanceof Error ? err.message : 'No se pudo eliminar el video.');
        } finally {
            setDeletingId(null);
        }
    }

    return (
        <section className="panel panel-pad" aria-labelledby="video-list-title">
            <div className="panel-head mb-4">
                <div className="panel-head-main items-center">
                    <SectionIcon name="film" />
                    <h2 id="video-list-title" className="panel-title">Tus videos</h2>
                </div>
                {!loading && videos.length > 0 && (
                    <span className="chip font-mono tabular-nums">{videos.length}</span>
                )}
            </div>
            {loading && (
                <ul className="space-y-2" aria-label="Cargando videos">
                    {[0, 1, 2].map((key) => (
                        <li key={key} className="tile flex gap-3 p-3">
                            <div className="skeleton h-14 w-8 shrink-0 rounded-md" />
                            <div className="flex-1 space-y-2 py-1">
                                <div className="skeleton h-4 w-3/4" />
                                <div className="skeleton h-3 w-1/3" />
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            {loadError && !loading && (
                <div role="alert" className="alert alert-error flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">{loadError}</span>
                    <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm">
                        Reintentar
                    </button>
                </div>
            )}
            {!loading && !loadError && videos.length === 0 && (
                <div className="flex flex-col items-center rounded-xl border border-dashed border-white/[0.1] bg-white/[0.012] px-4 py-10 text-center">
                    <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10 text-brand-200 ring-1 ring-inset ring-brand-400/25" aria-hidden="true">
                        <Icon name="film" size={20} />
                    </span>
                    <p className="text-sm font-medium text-slate-200">Aún no hay videos</p>
                    <p className="hint mt-1">Crea el primero con el formulario o díselo al copiloto.</p>
                </div>
            )}
            {deleteError && <p role="alert" className="alert alert-error mb-3">{deleteError}</p>}
            <ul className="space-y-2">
                {shown.map((video) => {
                    const isSelected = video.id === selectedId;
                    return (
                        <li
                            key={video.id}
                            className={`group relative rounded-xl border transition-[border-color,background-color,box-shadow] duration-200 ${
                                isSelected
                                    ? 'border-brand-400/40 bg-brand-500/[0.08] shadow-[0_0_0_1px_rgba(34,211,238,0.12)]'
                                    : 'border-white/[0.07] bg-white/[0.018] hover:border-white/[0.14] hover:bg-white/[0.04]'
                            }`}
                        >
                            <button
                                type="button"
                                onClick={() => onSelect(video.id)}
                                aria-current={isSelected ? 'true' : undefined}
                                className="flex w-full items-start gap-3 rounded-xl p-2.5 pr-11 text-left text-sm"
                            >
                                <VideoPoster video={video} showSubtitle={false} className="w-9 shrink-0 rounded-md" />
                                <span className="min-w-0 flex-1 py-0.5">
                                    <span className="line-clamp-2 font-medium leading-snug text-slate-50">{video.topic}</span>
                                    <span className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                                        <span className="flex items-center gap-1.5 text-xs text-slate-400">
                                            {PLATFORM_LABELS[video.platform]}
                                            <span aria-hidden="true">·</span>
                                            <span className="font-mono tabular-nums">{Math.round(effectiveSeconds(video))}s</span>
                                            {video.render_status === 'procesando' && (
                                                <span className="ml-1 inline-flex items-center gap-1 text-brand-200">
                                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-300" aria-hidden="true" />
                                                    <span className="font-mono tabular-nums">{video.render_progress}%</span>
                                                </span>
                                            )}
                                        </span>
                                        <StatusBadge status={video.status} />
                                    </span>
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => handleDelete(video)}
                                disabled={deletingId === video.id}
                                aria-label={`Eliminar ${video.topic}`}
                                title="Eliminar video"
                                className="btn-icon btn-icon-danger absolute right-2 top-2 md:opacity-0 md:focus-visible:opacity-100 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                            >
                                {deletingId === video.id ? (
                                    <span className="spinner text-red-300" aria-hidden="true" />
                                ) : (
                                    <Icon name="trash" />
                                )}
                            </button>
                        </li>
                    );
                })}
            </ul>
            {onShowAll && limit && videos.length > limit && (
                <button type="button" onClick={onShowAll} className="btn btn-ghost btn-sm mt-3 w-full">
                    Ver los {videos.length} videos en la Biblioteca
                    <Icon name="arrow-right" size={14} />
                </button>
            )}
        </section>
    );
}
