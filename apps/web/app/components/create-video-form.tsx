'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { VIDEO_TEMPLATES, type VideoTemplate } from '@shared-types/templates';
import type { Platform } from '@shared-types/video';
import {
    createVideo,
    createVideosBatch,
    type BatchCreateFailure,
    type BatchCreateWarning,
    type BatchWarningCause,
    type VideoRecord,
} from './api';
import { PLATFORM_OPTIONS, TEMPLATE_TEXT } from './constants';
import { PLATFORM_SHORT } from './studio-utils';
import SectionIcon, { Icon } from './section-icon';

// RF-024: the same form makes one video or several. A person making one must
// not pay for the batch machinery, so the two paths only share the fields
// that genuinely apply to both (platform, template, duration).
export type CreateMode = 'single' | 'batch';

// Raised by the shell ("Nuevo video", "Crear lote", the command palette):
// bumping `seq` switches the form to `mode` and puts the cursor in it,
// without remounting it and losing what was already typed.
export interface CreateRequest {
    seq: number;
    mode: CreateMode;
    // False once the operator has moved elsewhere, so coming back to the
    // Estudio later does not grab focus (and pop a phone keyboard) again.
    focus: boolean;
}

interface CreateVideoFormProps {
    onCreated: (video: VideoRecord) => void;
    // A batch lands in the list without leaving the form: the summary below
    // (warnings, failed topics left for a retry) is what the operator needs
    // to read next, and opening a video would unmount it.
    onBatchCreated: (videos: VideoRecord[]) => void;
    request: CreateRequest;
}

const MAX_BATCH_TOPICS = 8;
const DURATION_PRESETS = [15, 30, 45, 60];

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

export default function CreateVideoForm({ onCreated, onBatchCreated, request }: CreateVideoFormProps) {
    const [mode, setMode] = useState<CreateMode>(request.mode);
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
    const sectionRef = useRef<HTMLElement>(null);
    const topicRef = useRef<HTMLInputElement>(null);
    const batchRef = useRef<HTMLTextAreaElement>(null);

    // "Adjust state when a prop changes", done during render so the old mode
    // never paints. Ignored mid-submit: switching then would orphan the result.
    const [seenSeq, setSeenSeq] = useState(request.seq);
    if (seenSeq !== request.seq) {
        setSeenSeq(request.seq);
        if (!submitting && request.mode !== mode) {
            setMode(request.mode);
            setFormError('');
            setBatchResult(null);
        }
    }

    // Focus is a DOM side effect, so it waits for the commit.
    useEffect(() => {
        if (request.seq === 0 || !request.focus) return;
        const frame = requestAnimationFrame(() => {
            sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            (request.mode === 'batch' ? batchRef.current : topicRef.current)?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [request.seq, request.mode, request.focus]);

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
            // In the order the operator typed them; the shell selects the
            // first topic (RF-024) without navigating away from this summary.
            if (result.creados.length > 0) onBatchCreated(result.creados);
            setBatchResult({
                createdCount: result.creados.length,
                failed: result.fallidos,
                // Defensive default: an older response without the field must
                // still render cleanly.
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
        <section ref={sectionRef} className="panel panel-pad scroll-mt-24" aria-labelledby="create-video-title">
            <div className="panel-head">
                <div className="panel-head-main">
                    <SectionIcon name="sparkles" />
                    <div className="min-w-0">
                        <h2 id="create-video-title" className="panel-title">Crear nuevo video</h2>
                        <p className="hint">Del tema al guion con IA. También puedes pedírselo al copiloto.</p>
                    </div>
                </div>
                <div role="group" aria-label="Modo de creación" className="segmented">
                    <button type="button" aria-pressed={mode === 'single'} onClick={() => handleModeChange('single')} disabled={submitting}>
                        <Icon name="plus" size={14} />
                        Un video
                    </button>
                    <button type="button" aria-pressed={mode === 'batch'} onClick={() => handleModeChange('batch')} disabled={submitting}>
                        <Icon name="layers" size={14} />
                        Lote
                    </button>
                </div>
            </div>

            <form onSubmit={mode === 'single' ? handleSubmit : handleBatchSubmit} className="space-y-5">
                {mode === 'single' ? (
                    <div>
                        <label className="label" htmlFor="new-video-topic">Tema</label>
                        <input
                            ref={topicRef}
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
                            ref={batchRef}
                            id="new-video-batch-topics"
                            rows={5}
                            value={batchTopics}
                            onChange={(event) => setBatchTopics(event.target.value)}
                            placeholder={'Cómo elegir la mejor tasa hipotecaria\nQué es el enganche\nPrecalificación vs preaprobación'}
                            className="field leading-relaxed"
                            disabled={submitting}
                        />
                        <p className={`mt-1.5 font-mono text-xs tabular-nums ${batchTopicsCount > MAX_BATCH_TOPICS ? 'text-red-300' : 'text-slate-400'}`}>
                            {batchTopicsCount}/{MAX_BATCH_TOPICS} temas
                        </p>
                    </div>
                )}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <fieldset>
                        <legend className="label">Plataforma</legend>
                        <div className="segmented grid w-full grid-cols-3">
                            {PLATFORM_OPTIONS.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    aria-pressed={platform === option.value}
                                    onClick={() => setPlatform(option.value)}
                                    disabled={submitting}
                                    aria-label={option.label}
                                    title={option.label}
                                >
                                    {PLATFORM_SHORT[option.value]}
                                </button>
                            ))}
                        </div>
                    </fieldset>
                    <div>
                        <label className="label" htmlFor="new-video-duration">Duración objetivo (segundos)</label>
                        <div className="flex items-center gap-2">
                            <input
                                id="new-video-duration"
                                type="number"
                                min={5}
                                step={1}
                                value={duration}
                                onChange={(event) => setDuration(Number(event.target.value))}
                                className="field w-24 font-mono tabular-nums"
                                disabled={submitting}
                            />
                            <div className="flex flex-wrap gap-1" role="group" aria-label="Duraciones rápidas">
                                {DURATION_PRESETS.map((preset) => (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() => setDuration(preset)}
                                        aria-pressed={duration === preset}
                                        disabled={submitting}
                                        className={`h-8 rounded-md border px-2 font-mono text-xs tabular-nums transition-colors ${
                                            duration === preset
                                                ? 'border-brand-400/40 bg-brand-500/15 text-brand-100'
                                                : 'border-white/[0.08] text-slate-400 hover:border-white/20 hover:text-slate-100'
                                        }`}
                                    >
                                        {preset}s
                                    </button>
                                ))}
                            </div>
                        </div>
                        {mode === 'batch' && <p className="hint mt-1.5">Se aplica a todos los videos del lote.</p>}
                    </div>
                </div>

                <fieldset>
                    <legend className="label">Plantilla de historia</legend>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                        {VIDEO_TEMPLATES.map((option) => {
                            const checked = template === option.id;
                            const text = TEMPLATE_TEXT[option.id];
                            return (
                                <label
                                    key={option.id}
                                    className={`relative flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                                        checked
                                            ? 'border-brand-400/45 bg-brand-500/[0.09] shadow-[0_0_0_1px_rgba(34,211,238,0.12)]'
                                            : 'border-white/[0.07] bg-white/[0.015] hover:border-white/[0.16]'
                                    } ${submitting ? 'cursor-not-allowed opacity-60' : ''}`}
                                >
                                    <input
                                        type="radio"
                                        name="new-video-template"
                                        value={option.id}
                                        checked={checked}
                                        onChange={() => setTemplate(option.id)}
                                        disabled={submitting}
                                        className="checkbox mt-1 rounded-full"
                                    />
                                    <span className="min-w-0">
                                        <span className="block text-sm font-medium text-slate-100">{text.label}</span>
                                        <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">{text.description}</span>
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </fieldset>

                {mode === 'batch' && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
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
                    className="btn btn-primary btn-block btn-lg"
                >
                    {submitting ? <span className="spinner" aria-hidden="true" /> : <Icon name="sparkles" />}
                    {mode === 'single'
                        ? (submitting ? 'Generando guion con IA...' : 'Crear video')
                        : (submitting
                            ? 'Creando videos...'
                            : `Crear ${batchTopicsCount || ''} video${batchTopicsCount === 1 ? '' : 's'}`.replace('  ', ' ').trim())}
                </button>
            </form>
        </section>
    );
}
