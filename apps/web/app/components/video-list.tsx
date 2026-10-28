'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { VIDEO_TEMPLATES, getTemplate, type VideoTemplate } from '@shared-types/templates';
import type { Platform } from '@shared-types/video';
import {
    createVideo,
    createVideosBatch,
    deleteVideo,
    type BatchCreateFailure,
    type BatchCreateWarning,
    type BatchWarningCause,
    type VideoRecord,
} from './api';
import { PLATFORM_LABELS, PLATFORM_OPTIONS } from './constants';
import StatusBadge from './status-badge';
import SectionIcon from './section-icon';

interface VideoListProps {
    videos: VideoRecord[];
    loading: boolean;
    loadError: string;
    onRetry: () => void;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onCreated: (video: VideoRecord) => void;
    onDeleted: (id: string) => void;
}

// RF-024: the same form makes one video or several. A person making one must
// not pay for the batch machinery, so the two paths only share the fields
// that genuinely apply to both (platform, template, duration).
type CreateMode = 'single' | 'batch';

const MAX_BATCH_TOPICS = 8;

// Fill of the small poster beside each video, tinted by status so the list
// can be scanned by colour as well as by the badge text.
const POSTER_CLASSES: Record<VideoRecord['status'], string> = {
    borrador: 'bg-gradient-to-b from-slate-500/40 to-slate-700/40 ring-white/10',
    pendiente_aprobacion: 'bg-gradient-to-b from-amber-400/45 to-amber-700/35 ring-amber-300/25',
    aprobado: 'bg-gradient-to-b from-brand-500/70 to-accent-600/60 ring-brand-300/30',
    publicado: 'bg-gradient-to-b from-emerald-400/55 to-emerald-700/45 ring-emerald-300/30',
};

interface BatchSummary {
    createdCount: number;
    failed: BatchCreateFailure[];
    warnings: BatchCreateWarning[];
}

function formatElapsed(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// `motivo` says what happened; this says what to do about it, which differs
// per cause. Keyed off the server's `causa` rather than its prose: the two
// were coupled through the word "escena" for a while, and that would have
// started showing the wrong advice the first time a sentence was reworded.
const NEXT_STEP: Record<BatchWarningCause, string> = {
    guion_generico: 'Vuelve a generar el guion desde el panel de este video cuando el modelo responda.',
    sin_escenas: 'Pulsa "Generar escenas" en el panel de este video.',
    guion_generico_y_sin_escenas: 'Regenera el guion cuando el modelo responda y después genera las escenas.',
};

function warningNextStep(warning: BatchCreateWarning): string {
    return NEXT_STEP[warning.causa] ?? NEXT_STEP.guion_generico;
}

export default function VideoList({ videos, loading, loadError, onRetry, selectedId, onSelect, onCreated, onDeleted }: VideoListProps) {
    const [mode, setMode] = useState<CreateMode>('single');
    const [topic, setTopic] = useState('');
    const [batchTopics, setBatchTopics] = useState('');
    const [conEscenas, setConEscenas] = useState(true);
    const [platform, setPlatform] = useState<Platform>('reels');
    const [duration, setDuration] = useState(30);
    const [template, setTemplate] = useState<VideoTemplate>('libre');
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const [batchElapsed, setBatchElapsed] = useState(0);
    const [batchResult, setBatchResult] = useState<BatchSummary | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState('');

    const batchTopicsList = batchTopics.split('\n').map((line) => line.trim()).filter(Boolean);
    const batchTopicsCount = batchTopicsList.length;

    // A ticking counter, not a percentage: the server only replies once every
    // topic is done, so this is honest about what we actually know (elapsed
    // time) rather than faking a step-by-step progress bar.
    useEffect(() => {
        if (!submitting || mode !== 'batch') return;
        const timer = setInterval(() => {
            setBatchElapsed((seconds) => seconds + 1);
        }, 1000);
        return () => clearInterval(timer);
    }, [submitting, mode]);

    function handleModeChange(next: CreateMode) {
        if (submitting) return;
        setMode(next);
        setFormError('');
        setBatchResult(null);
    }

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

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!topic.trim()) {
            setFormError('El tema es obligatorio.');
            return;
        }
        if (!Number.isFinite(duration) || duration <= 0) {
            setFormError('La duración objetivo debe ser un número positivo.');
            return;
        }

        setSubmitting(true);
        setFormError('');
        try {
            const video = await createVideo(topic.trim(), platform, duration, template);
            setTopic('');
            onCreated(video);
        } catch (error) {
            setFormError(error instanceof Error ? error.message : 'No se pudo crear el video.');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleBatchSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (batchTopicsCount === 0) {
            setFormError('Ingresa al menos un tema, uno por línea.');
            return;
        }
        if (batchTopicsCount > MAX_BATCH_TOPICS) {
            setFormError(`Máximo ${MAX_BATCH_TOPICS} temas por lote.`);
            return;
        }
        if (!Number.isFinite(duration) || duration <= 0) {
            setFormError('La duración objetivo debe ser un número positivo.');
            return;
        }

        setSubmitting(true);
        setFormError('');
        setBatchResult(null);
        setBatchElapsed(0);
        try {
            const result = await createVideosBatch(batchTopicsList, platform, duration, template, conEscenas);
            // onCreated both prepends and selects; calling it last-to-first
            // leaves the videos in the order the operator typed them and ends
            // with the first topic selected, per RF-024.
            for (let index = result.creados.length - 1; index >= 0; index -= 1) {
                onCreated(result.creados[index]);
            }
            setBatchResult({
                createdCount: result.creados.length,
                failed: result.fallidos,
                // Defensive default: the backend is adding this field, so an
                // older response without it must still render cleanly.
                warnings: result.advertencias ?? [],
            });
            // Leaving only the failed topics in the box makes retrying a single click.
            setBatchTopics(result.fallidos.length > 0 ? result.fallidos.map((f) => f.tema).join('\n') : '');
        } catch (error) {
            setFormError(error instanceof Error ? error.message : 'No se pudo crear el lote de videos.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="space-y-5">
            <section className="panel panel-pad" aria-labelledby="create-video-title">
                <div className="panel-head">
                    <div className="panel-head-main">
                        <SectionIcon name="sparkles" />
                        <div className="min-w-0">
                            <h2 id="create-video-title" className="panel-title">Crear nuevo video</h2>
                            <p className="hint">También puedes pedírselo al asistente.</p>
                        </div>
                    </div>
                </div>

                {/* Segmented control: one track, the active option raised. */}
                <div role="group" aria-label="Modo de creación" className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-white/[0.07] bg-ink-950/60 p-1 text-sm">
                    <button
                        type="button"
                        aria-pressed={mode === 'single'}
                        onClick={() => handleModeChange('single')}
                        disabled={submitting}
                        className={`h-8 rounded-lg px-3 font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                            mode === 'single' ? 'bg-ink-700 text-white shadow-[0_1px_2px_rgba(0,0,0,0.4)] ring-1 ring-inset ring-white/10' : 'text-slate-400 hover:text-slate-100'
                        }`}
                    >
                        Un video
                    </button>
                    <button
                        type="button"
                        aria-pressed={mode === 'batch'}
                        onClick={() => handleModeChange('batch')}
                        disabled={submitting}
                        className={`h-8 rounded-lg px-3 font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                            mode === 'batch' ? 'bg-ink-700 text-white shadow-[0_1px_2px_rgba(0,0,0,0.4)] ring-1 ring-inset ring-white/10' : 'text-slate-400 hover:text-slate-100'
                        }`}
                    >
                        Varios videos
                    </button>
                </div>

                <form onSubmit={mode === 'single' ? handleSubmit : handleBatchSubmit} className="space-y-4">
                    {mode === 'single' ? (
                        <div>
                            <label className="label" htmlFor="new-video-topic">Tema</label>
                            <input
                                id="new-video-topic"
                                type="text"
                                value={topic}
                                onChange={(event) => setTopic(event.target.value)}
                                placeholder="Ej. Cómo elegir la mejor tasa hipotecaria"
                                className="field"
                                disabled={submitting}
                            />
                        </div>
                    ) : (
                        <div>
                            <label className="label" htmlFor="new-video-batch-topics">
                                Temas (uno por línea, máximo {MAX_BATCH_TOPICS})
                            </label>
                            <textarea
                                id="new-video-batch-topics"
                                rows={5}
                                value={batchTopics}
                                onChange={(event) => setBatchTopics(event.target.value)}
                                placeholder={'Cómo elegir la mejor tasa hipotecaria\nQué es el enganche\nPrecalificación vs preaprobación'}
                                className="field leading-relaxed"
                                disabled={submitting}
                            />
                            <p className={`mt-1.5 text-xs tabular-nums ${batchTopicsCount > MAX_BATCH_TOPICS ? 'text-red-300' : 'text-slate-400'}`}>
                                {batchTopicsCount}/{MAX_BATCH_TOPICS} temas
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                        <div>
                            <label className="label" htmlFor="new-video-platform">Plataforma</label>
                            <select
                                id="new-video-platform"
                                value={platform}
                                onChange={(event) => setPlatform(event.target.value as Platform)}
                                className="field"
                                disabled={submitting}
                            >
                                {PLATFORM_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="label" htmlFor="new-video-duration">Duración objetivo (segundos)</label>
                            <input
                                id="new-video-duration"
                                type="number"
                                min={5}
                                step={1}
                                value={duration}
                                onChange={(event) => setDuration(Number(event.target.value))}
                                className="field"
                                disabled={submitting}
                            />
                            {mode === 'batch' && (
                                <p className="hint mt-1.5">Se aplica a todos los videos del lote.</p>
                            )}
                        </div>
                    </div>
                    <div>
                        <label className="label" htmlFor="new-video-template">Plantilla</label>
                        <select
                            id="new-video-template"
                            value={template}
                            onChange={(event) => setTemplate(event.target.value as VideoTemplate)}
                            className="field"
                            disabled={submitting}
                        >
                            {VIDEO_TEMPLATES.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                            ))}
                        </select>
                        <p className="hint mt-1.5">{getTemplate(template).description}</p>
                    </div>

                    {mode === 'batch' && (
                        <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
                            <input
                                id="new-video-con-escenas"
                                type="checkbox"
                                checked={conEscenas}
                                onChange={(event) => setConEscenas(event.target.checked)}
                                disabled={submitting}
                                className="checkbox"
                            />
                            <label htmlFor="new-video-con-escenas" className="text-sm text-slate-100">
                                Generar escenas automáticamente
                                <span className="hint mt-0.5 block">
                                    Recomendado: un borrador con escenas ya se puede revisar. Sin esto habría que generarlas después, una por una.
                                </span>
                            </label>
                        </div>
                    )}

                    {formError && <p role="alert" className="alert alert-error">{formError}</p>}

                    {mode === 'batch' && submitting && (
                        <div className="alert alert-info text-xs" aria-live="polite">
                            <span className="spinner mt-0.5 text-brand-300" aria-hidden="true" />
                            <span>
                                Creando {batchTopicsList.length} videos con IA. Esto puede tardar varios minutos porque cada uno es al menos una llamada al modelo — no cierres esta pantalla.
                                {' '}
                                <span className="font-mono text-brand-200">{formatElapsed(batchElapsed)}</span>
                            </span>
                        </div>
                    )}

                    {mode === 'batch' && batchResult && !submitting && (() => {
                        const total = batchResult.createdCount + batchResult.failed.length;
                        // Every warning names a video that IS in `creados` - it isn't
                        // a third bucket of videos, it's a flag on some of the ones
                        // already counted as created.
                        const cleanCount = batchResult.createdCount - batchResult.warnings.length;
                        const hasIssues = batchResult.warnings.length > 0 || batchResult.failed.length > 0;
                        const breakdown = [
                            cleanCount > 0 ? `${cleanCount} sin problemas` : null,
                            batchResult.warnings.length > 0 ? `${batchResult.warnings.length} con advertencia` : null,
                            batchResult.failed.length > 0
                                ? `${batchResult.failed.length} fallido${batchResult.failed.length === 1 ? '' : 's'}`
                                : null,
                        ].filter(Boolean).join(', ');

                        return (
                            <div className="tile space-y-2 px-3.5 py-3 text-xs" aria-live="polite">
                                <p className="text-sm text-slate-100">
                                    Se crearon {batchResult.createdCount} de {total} video{total === 1 ? '' : 's'}
                                    {hasIssues ? `: ${breakdown}.` : '.'}
                                </p>

                                {batchResult.warnings.length > 0 && (
                                    <div className="space-y-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-2">
                                        <p className="font-medium text-amber-200">
                                            Advertencia: se crearon pero salieron incompletos. Revísalos antes de aprobarlos.
                                        </p>
                                        <ul className="space-y-1 text-amber-100">
                                            {batchResult.warnings.map((warning, index) => (
                                                <li key={`${warning.tema}-${index}`}>
                                                    <span className="font-medium">&quot;{warning.tema}&quot;</span>: {warning.motivo}
                                                    {' '}
                                                    <span className="text-amber-200/90">{warningNextStep(warning)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {batchResult.failed.length > 0 && (
                                    <div className="space-y-1 rounded-lg border border-red-400/30 bg-red-500/10 px-2.5 py-2">
                                        <p className="font-medium text-red-200">No se pudieron crear:</p>
                                        <ul className="space-y-1 text-red-200">
                                            {batchResult.failed.map((failure, index) => (
                                                <li key={`${failure.tema}-${index}`}>
                                                    <span className="font-medium">&quot;{failure.tema}&quot;</span>: {failure.error}
                                                </li>
                                            ))}
                                        </ul>
                                        <p className="text-slate-300">Esos temas quedaron arriba para reintentarlos.</p>
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    <button
                        type="submit"
                        disabled={submitting || (mode === 'batch' && (batchTopicsCount === 0 || batchTopicsCount > MAX_BATCH_TOPICS))}
                        className="btn btn-primary btn-block"
                    >
                        {submitting && <span className="spinner" aria-hidden="true" />}
                        {mode === 'single'
                            ? (submitting ? 'Generando guion con IA...' : 'Crear video')
                            : (submitting
                                ? 'Creando videos...'
                                : `Crear ${batchTopicsCount || ''} video${batchTopicsCount === 1 ? '' : 's'}`.trim())}
                    </button>
                </form>
            </section>

            <section className="panel panel-pad" aria-labelledby="video-list-title">
                <div className="panel-head mb-4">
                    <div className="panel-head-main items-center">
                        <SectionIcon name="library" />
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
                                <div className="skeleton h-14 w-10 shrink-0 rounded-lg" />
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
                    <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.012] px-4 py-10 text-center">
                        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500/20 to-accent-500/10 text-brand-200 ring-1 ring-inset ring-brand-400/25" aria-hidden="true">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="5" width="18" height="14" rx="3" />
                                <path d="m10 9 5 3-5 3z" />
                            </svg>
                        </span>
                        <p className="text-sm font-medium text-slate-200">Aún no hay videos</p>
                        <p className="hint mt-1">Crea el primero arriba o díselo al asistente.</p>
                    </div>
                )}
                {deleteError && <p role="alert" className="alert alert-error mb-3">{deleteError}</p>}
                <ul className="space-y-2">
                    {videos.map((video) => {
                        const isSelected = video.id === selectedId;
                        return (
                            <li
                                key={video.id}
                                className={`group relative rounded-2xl border transition-[border-color,background-color,box-shadow] duration-200 ${
                                    isSelected
                                        ? 'border-brand-400/45 bg-gradient-to-r from-brand-500/[0.12] to-brand-500/[0.03] shadow-[0_0_0_1px_rgba(129,137,248,0.15),0_8px_24px_-12px_rgba(99,102,241,0.5)]'
                                        : 'border-white/[0.07] bg-white/[0.018] hover:border-white/[0.14] hover:bg-white/[0.04]'
                                }`}
                            >
                                <button
                                    type="button"
                                    onClick={() => onSelect(video.id)}
                                    aria-current={isSelected ? 'true' : undefined}
                                    className="flex w-full items-start gap-3 rounded-2xl p-3 pr-11 text-left text-sm"
                                >
                                    {/* A tiny vertical "poster" so the list reads as videos,
                                        not rows of text. Purely decorative. */}
                                    <span
                                        aria-hidden="true"
                                        className={`relative flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1 ring-inset ${POSTER_CLASSES[video.status]}`}
                                    >
                                        {video.render_status === 'procesando' ? (
                                            <>
                                                <span
                                                    className="absolute inset-x-0 bottom-0 bg-brand-400/35 transition-[height] duration-700 ease-out-expo"
                                                    style={{ height: `${Math.max(4, video.render_progress)}%` }}
                                                />
                                                <span className="spinner relative h-3.5 w-3.5 text-white/90" />
                                            </>
                                        ) : (
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-white/85">
                                                <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
                                            </svg>
                                        )}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="line-clamp-2 font-medium leading-snug text-slate-50">{video.topic}</span>
                                        <span className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                            <span className="flex items-center gap-1.5 text-xs text-slate-400">
                                                {PLATFORM_LABELS[video.platform]}
                                                <span aria-hidden="true">·</span>
                                                <span className="tabular-nums">{video.target_duration_seconds}s</span>
                                                {video.render_status === 'procesando' && (
                                                    <span className="ml-1 inline-flex items-center gap-1 text-brand-200">
                                                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-300" aria-hidden="true" />
                                                        <span className="tabular-nums">{video.render_progress}%</span>
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
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                                            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
                                        </svg>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </section>
        </div>
    );
}
