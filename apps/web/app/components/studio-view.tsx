'use client';

import { useEffect, useRef } from 'react';
import type { VideoRecord } from './api';
import CreateVideoForm, { type CreateRequest } from './create-video-form';
import VideoList from './video-list';
import VideoWorkspace, { type SharedLibraries } from './video-workspace';
import type { WorkbenchStartRequest } from './workbench-panel';
import { Icon } from './section-icon';

export interface RevealRequest {
    // Bumped on every request so picking the same video twice still scrolls.
    seq: number;
    // Focus follows the scroll only for actions taken in the panels. When the
    // copilot opens a video the operator is mid-conversation, and pulling
    // focus out of the chat would cut what they are typing or dictating.
    focus: boolean;
    // A workspace section to land on instead of its top (e.g. 'mesa').
    target?: string;
}

interface StudioViewProps {
    videos: VideoRecord[];
    loading: boolean;
    loadError: string;
    onRetry: () => void;
    // The video in the URL (#/estudio/<id>): the workspace shows only then.
    routeVideoId: string | null;
    selectedId: string | null;
    libraries: SharedLibraries;
    createRequest: CreateRequest;
    reveal: RevealRequest;
    workbenchRequest: WorkbenchStartRequest;
    onWorkbenchRequestHandled: () => void;
    onSelect: (id: string) => void;
    onCreated: (video: VideoRecord) => void;
    onBatchCreated: (videos: VideoRecord[]) => void;
    onUpdated: (video: VideoRecord) => void;
    onDuplicated: (video: VideoRecord) => void;
    onDeleted: (id: string) => void;
    onBackToList: () => void;
    onNewVideo: () => void;
    onShowAll: () => void;
}

const STEPS = [
    { n: '01', t: 'Dices el tema', d: 'Hablas o escribes. Se genera un guion con forma de historia, no un folleto.' },
    { n: '02', t: 'Se arma en escenas', d: 'Cada escena con su personaje, su acción y su objeto. Puedes editarlas o borrarlas.' },
    { n: '03', t: 'Tú lo apruebas', d: 'Nada se publica sin que una persona lo revise. El copiloto no puede saltarse este paso.' },
    { n: '04', t: 'Sale el video', d: 'MP4 vertical con voz y subtítulos, listo para descargar o publicar.' },
];

export default function StudioView({
    videos, loading, loadError, onRetry, routeVideoId, selectedId, libraries, createRequest, reveal,
    workbenchRequest, onWorkbenchRequestHandled, onSelect, onCreated, onBatchCreated, onUpdated, onDuplicated, onDeleted, onBackToList, onNewVideo, onShowAll,
}: StudioViewProps) {
    const workspaceRef = useRef<HTMLDivElement>(null);
    const video = routeVideoId ? videos.find((entry) => entry.id === routeVideoId) ?? null : null;

    // Picking a video swaps the whole view, so the page is brought to the top
    // of the workspace - on a phone the click happened far down the list.
    useEffect(() => {
        if (reveal.seq === 0) return;
        const section = reveal.target ? document.getElementById(`ws-${reveal.target}`) : null;
        const target = section ?? workspaceRef.current;
        if (!target) return;
        // After paint, so the workspace already shows the new video.
        const frame = requestAnimationFrame(() => {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            if (reveal.focus) target.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [reveal]);

    if (routeVideoId) {
        return (
            <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={onBackToList} className="btn btn-ghost btn-sm -ml-2">
                        <Icon name="chevron-left" size={14} />
                        Estudio
                    </button>
                    <div className="min-w-0 flex-1 sm:max-w-sm">
                        <label htmlFor="studio-switcher" className="sr-only">Cambiar de video</label>
                        <select
                            id="studio-switcher"
                            value={routeVideoId}
                            onChange={(event) => onSelect(event.target.value)}
                            className="field field-sm"
                        >
                            {!video && <option value={routeVideoId}>{loading ? 'Cargando…' : 'Video no encontrado'}</option>}
                            {videos.map((entry) => (
                                <option key={entry.id} value={entry.id}>{entry.topic}</option>
                            ))}
                        </select>
                    </div>
                    <button type="button" onClick={onNewVideo} className="btn btn-secondary btn-sm ml-auto">
                        <Icon name="plus" size={14} />
                        Nuevo
                    </button>
                </div>
                {/* Focusable so the keyboard and screen reader can move here
                    along with the scroll; scroll-mt clears the top bar. */}
                <div ref={workspaceRef} tabIndex={-1} aria-label="Área de trabajo del video" className="min-w-0 scroll-mt-20 rounded-2xl outline-none">
                    {video ? (
                        <VideoWorkspace
                            video={video}
                            libraries={libraries}
                            onUpdated={onUpdated}
                            onDuplicated={onDuplicated}
                            workbenchRequest={workbenchRequest}
                            onWorkbenchRequestHandled={onWorkbenchRequestHandled}
                        />
                    ) : loading ? (
                        <div className="space-y-4" aria-label="Cargando el video">
                            <div className="skeleton h-40 w-full rounded-2xl" />
                            <div className="skeleton h-64 w-full rounded-2xl" />
                        </div>
                    ) : loadError ? (
                        <div role="alert" className="alert alert-error flex flex-wrap items-center justify-between gap-2">
                            <span className="min-w-0">{loadError}</span>
                            <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm">Reintentar</button>
                        </div>
                    ) : (
                        <div className="panel px-5 py-12 text-center">
                            <p className="text-sm font-medium text-slate-200">Este video ya no existe o el enlace está mal.</p>
                            <button type="button" onClick={onBackToList} className="btn btn-secondary btn-sm mt-4">Volver al Estudio</button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="enter space-y-5">
            <header className="min-w-0">
                <p className="eyebrow mb-1.5">Estudio</p>
                <h1 className="text-2xl font-semibold tracking-[-0.025em] text-white sm:text-[1.75rem]">
                    Convierte un tema en un video <span className="text-gradient-brand">listo para publicar</span>
                </h1>
                <p className="mt-1 max-w-2xl text-sm text-slate-400">
                    Stickman escribe la historia, la reparte en escenas, la narra en español y arma el MP4 vertical para Reels, TikTok o Shorts.
                </p>
            </header>

            <div className="grid grid-cols-1 items-start gap-5 2xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                <CreateVideoForm onCreated={onCreated} onBatchCreated={onBatchCreated} request={createRequest} />
                <div className="space-y-5">
                    <VideoList
                        videos={videos}
                        loading={loading}
                        loadError={loadError}
                        onRetry={onRetry}
                        selectedId={selectedId}
                        onSelect={onSelect}
                        onDeleted={onDeleted}
                        limit={6}
                        onShowAll={onShowAll}
                    />
                    <section className="panel panel-pad" aria-labelledby="how-title">
                        <h2 id="how-title" className="eyebrow mb-4">Cómo funciona</h2>
                        <ol className="grid gap-3 sm:grid-cols-2">
                            {STEPS.map((step) => (
                                <li key={step.n} className="tile p-3.5">
                                    <span className="mb-2 block font-mono text-xs font-medium tracking-wider text-brand-300">{step.n}</span>
                                    <h3 className="mb-1 text-sm font-semibold text-white">{step.t}</h3>
                                    <p className="text-xs leading-relaxed text-slate-400">{step.d}</p>
                                </li>
                            ))}
                        </ol>
                    </section>
                </div>
            </div>
        </div>
    );
}
