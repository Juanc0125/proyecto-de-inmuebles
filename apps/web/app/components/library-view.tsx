'use client';

import { useEffect, useState } from 'react';
import type { Platform, VideoStatus } from '@shared-types/video';
import type { VideoRecord } from './api';
import { PLATFORM_OPTIONS, STATUS_LABELS } from './constants';
import StatusBadge from './status-badge';
import { Icon } from './section-icon';
import VideoPoster from './video-poster';
import { PLATFORM_SHORT, effectiveSeconds, formatClock, normalizeText, relativeTime } from './studio-utils';

interface LibraryViewProps {
    videos: VideoRecord[];
    loading: boolean;
    loadError: string;
    onRetry: () => void;
    now: number;
    onOpen: (id: string) => void;
    onNewVideo: () => void;
}

type Layout = 'grid' | 'list';
type SortKey = 'recent' | 'title' | 'duration';

const LAYOUT_KEY = 'stickman:biblioteca-vista';

export default function LibraryView({ videos, loading, loadError, onRetry, now, onOpen, onNewVideo }: LibraryViewProps) {
    const [layout, setLayout] = useState<Layout>('grid');
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<VideoStatus | 'todos'>('todos');
    const [platform, setPlatform] = useState<Platform | 'todas'>('todas');
    const [sort, setSort] = useState<SortKey>('recent');

    // A per-viewer convenience: read after mount (the server cannot know it)
    // and wrapped, because storage can throw or come back empty.
    useEffect(() => {
        const timer = setTimeout(() => {
            try {
                const stored = window.localStorage.getItem(LAYOUT_KEY);
                if (stored === 'grid' || stored === 'list') setLayout(stored);
            } catch {
                // no stored preference; the default stands
            }
        }, 0);
        return () => clearTimeout(timer);
    }, []);

    function changeLayout(next: Layout) {
        setLayout(next);
        try {
            window.localStorage.setItem(LAYOUT_KEY, next);
        } catch {
            // works for this visit anyway
        }
    }

    // The topic is the title; the script is searched too, so a phrase from
    // inside a video finds it.
    const needle = normalizeText(query.trim());
    const filtered = videos
        .filter((video) => status === 'todos' || video.status === status)
        .filter((video) => platform === 'todas' || video.platform === platform)
        .filter((video) => !needle || normalizeText(`${video.topic} ${video.script}`).includes(needle))
        .sort((a, b) => {
            if (sort === 'title') return a.topic.localeCompare(b.topic, 'es', { sensitivity: 'base' });
            if (sort === 'duration') return effectiveSeconds(b) - effectiveSeconds(a);
            return Date.parse(b.created_at) - Date.parse(a.created_at);
        });
    const filtering = needle !== '' || status !== 'todos' || platform !== 'todas';

    function clearFilters() {
        setQuery('');
        setStatus('todos');
        setPlatform('todas');
    }

    return (
        <div className="enter space-y-5">
            <header className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                    <p className="eyebrow mb-1.5">Biblioteca</p>
                    <h1 className="text-2xl font-semibold tracking-[-0.025em] text-white sm:text-[1.75rem]">Todos los videos</h1>
                    <p className="mt-1 text-sm text-slate-400">Busca, filtra y abre cualquier video. Pasa el cursor sobre uno con MP4 para verlo.</p>
                </div>
                <button type="button" onClick={onNewVideo} className="btn btn-primary">
                    <Icon name="plus" />
                    Nuevo video
                </button>
            </header>

            <div className="panel flex flex-col gap-3 p-3 sm:p-4 2xl:flex-row 2xl:items-end">
                <div className="min-w-0 flex-1">
                    <label htmlFor="library-search" className="label">Buscar</label>
                    <div className="relative">
                        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                            id="library-search"
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Título, tema o una frase del guion"
                            className="field pl-9"
                        />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:flex 2xl:flex-none">
                    <div>
                        <label htmlFor="library-status" className="label">Estado</label>
                        <select id="library-status" value={status} onChange={(event) => setStatus(event.target.value as VideoStatus | 'todos')} className="field 2xl:w-48">
                            <option value="todos">Todos</option>
                            {(Object.keys(STATUS_LABELS) as VideoStatus[]).map((value) => (
                                <option key={value} value={value}>{STATUS_LABELS[value]}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="library-platform" className="label">Plataforma</label>
                        <select id="library-platform" value={platform} onChange={(event) => setPlatform(event.target.value as Platform | 'todas')} className="field 2xl:w-40">
                            <option value="todas">Todas</option>
                            {PLATFORM_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                        <label htmlFor="library-sort" className="label">Ordenar por</label>
                        <select id="library-sort" value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className="field 2xl:w-40">
                            <option value="recent">Más recientes</option>
                            <option value="title">Título (A–Z)</option>
                            <option value="duration">Duración</option>
                        </select>
                    </div>
                </div>
                <div role="group" aria-label="Vista" className="segmented self-start 2xl:self-end">
                    <button type="button" aria-pressed={layout === 'grid'} onClick={() => changeLayout('grid')} aria-label="Vista en cuadrícula">
                        <Icon name="grid" size={15} />
                    </button>
                    <button type="button" aria-pressed={layout === 'list'} onClick={() => changeLayout('list')} aria-label="Vista en lista">
                        <Icon name="list" size={15} />
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-xs tabular-nums text-slate-400" aria-live="polite">
                    {loading ? 'Cargando…' : `${filtered.length} de ${videos.length} videos`}
                </p>
                {filtering && (
                    <button type="button" onClick={clearFilters} className="btn btn-ghost btn-sm">
                        <Icon name="close" size={13} />
                        Limpiar filtros
                    </button>
                )}
            </div>

            {loadError && !loading && (
                <div role="alert" className="alert alert-error flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">{loadError}</span>
                    <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm">Reintentar</button>
                </div>
            )}

            {loading ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6" aria-hidden="true">
                    {[0, 1, 2, 3].map((key) => <div key={key} className="skeleton aspect-[9/16] w-full rounded-xl" />)}
                </div>
            ) : filtered.length === 0 ? (
                <div className="panel flex flex-col items-center px-4 py-14 text-center">
                    <Icon name="search" size={22} className="mb-3 text-slate-500" />
                    <p className="text-sm font-medium text-slate-200">{videos.length === 0 ? 'Aún no hay videos' : 'Ningún video coincide'}</p>
                    <p className="hint mt-1">{videos.length === 0 ? 'Crea el primero desde el Estudio o con el copiloto.' : 'Prueba con otra búsqueda o quita algún filtro.'}</p>
                </div>
            ) : layout === 'grid' ? (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-6">
                    {filtered.map((video) => (
                        <li key={video.id}>
                            <button
                                type="button"
                                onClick={() => onOpen(video.id)}
                                className="group block w-full rounded-xl text-left"
                                aria-label={`Abrir ${video.topic}`}
                            >
                                <div className="relative">
                                    <VideoPoster video={video} hoverPreview className="w-full rounded-xl transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:shadow-glow" />
                                    <span className="absolute left-2 top-2 rounded-full bg-ink-950/60 backdrop-blur"><StatusBadge status={video.status} short /></span>
                                    {video.video_url && (
                                        <span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-ink-950/70 text-white ring-1 ring-white/20 backdrop-blur" aria-hidden="true">
                                            <Icon name="play" size={12} />
                                        </span>
                                    )}
                                </div>
                                <p className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-slate-100 group-hover:text-white">{video.topic}</p>
                                <p className="mt-1 font-mono text-[0.6875rem] tabular-nums text-slate-500">
                                    {PLATFORM_SHORT[video.platform]} · {formatClock(effectiveSeconds(video))} · {relativeTime(video.created_at, now)}
                                </p>
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="panel overflow-hidden">
                    <ul className="divide-y divide-white/[0.05]">
                        {filtered.map((video) => (
                            <li key={video.id}>
                                <button
                                    type="button"
                                    onClick={() => onOpen(video.id)}
                                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.03] sm:gap-4 sm:px-4"
                                >
                                    <VideoPoster video={video} hoverPreview showSubtitle={false} className="w-9 shrink-0 rounded-md" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium text-slate-100">{video.topic}</span>
                                        <span className="block font-mono text-[0.6875rem] tabular-nums text-slate-500">
                                            {PLATFORM_SHORT[video.platform]} · {video.scenes.length} esc. · {relativeTime(video.created_at, now)}
                                        </span>
                                    </span>
                                    <span className="hidden font-mono text-xs tabular-nums text-slate-400 sm:block">{formatClock(effectiveSeconds(video))}</span>
                                    <StatusBadge status={video.status} />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
