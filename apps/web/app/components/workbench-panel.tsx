'use client';

import { useEffect, useRef, useState } from 'react';
import { startWorkbench, type VideoRecord } from './api';
import SectionIcon, { Icon } from './section-icon';
import {
    ROLE_LABEL, WORKBENCH_ROLES, currentStep, formatSpan, providerBadge, sortedSteps,
} from './workbench-meta';
import {
    WORKBENCH_STALLED_ERROR, isWorkbenchStale, type WorkbenchRole, type WorkbenchStep, type WorkbenchStepStatus,
} from '@shared-types/video';

// Raised from outside the panel (the command palette): bumping `seq` for this
// video starts a run as if the button had been pressed, so the panel's own
// error handling and 409 message apply to that path too.
export interface WorkbenchStartRequest {
    seq: number;
    videoId: string | null;
}

interface WorkbenchPanelProps {
    video: VideoRecord;
    onUpdated: (video: VideoRecord) => void;
    startRequest?: WorkbenchStartRequest;
    onStartRequestHandled?: () => void;
}

type SeatState = WorkbenchStepStatus | 'idle';

const SEAT_TEXT: Record<SeatState, string> = {
    idle: 'En espera',
    running: 'Trabajando…',
    done: 'Listo',
    error: 'Falló',
    skipped: 'Omitido',
};

const STEP_DOT: Record<WorkbenchStepStatus, string> = {
    running: 'bg-brand-400 ring-brand-300/40',
    done: 'bg-emerald-400 ring-emerald-300/30',
    error: 'bg-red-400 ring-red-300/30',
    skipped: 'bg-amber-400 ring-amber-300/30',
};

const STEP_STATUS_TEXT: Record<WorkbenchStepStatus, string> = {
    running: 'en curso',
    done: 'terminado',
    error: 'con error',
    skipped: 'omitido',
};

function seatState(steps: WorkbenchStep[]): SeatState {
    if (steps.length === 0) return 'idle';
    if (steps.some((step) => step.status === 'running')) return 'running';
    return steps[steps.length - 1].status;
}

function stepSeconds(step: WorkbenchStep): number | null {
    if (!step.finished_at) return null;
    const ms = Date.parse(step.finished_at) - Date.parse(step.started_at);
    return Number.isNaN(ms) ? null : Math.max(0, Math.round(ms / 1000));
}

// The "mesa de trabajo": several free AI models, each in one role, take turns
// over the script, the scenes and (in the realistic style) one photo per
// scene. The panel only starts a run and shows what the server reports; the
// run's progress arrives through the shell's list polling. It never approves
// anything - RF-012 keeps that a human act in the approval panel.
export default function WorkbenchPanel({ video, onUpdated, startRequest, onStartRequestHandled }: WorkbenchPanelProps) {
    const [rewriteScript, setRewriteScript] = useState(false);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState('');
    // Ticked only while a run is going, to show elapsed time. 0 = unknown.
    const [now, setNow] = useState(0);

    const workbench = video.workbench ?? null;
    const reportedRunning = workbench?.status === 'running';
    // A run whose serverless function died keeps saying "running" forever.
    // Past the shared timeout it is treated as stopped, so it can be restarted.
    const stale = now > 0 && isWorkbenchStale(workbench, now);
    const running = reportedRunning && !stale;
    const steps = sortedSteps(workbench);
    const active = currentStep(workbench);
    const realista = video.visual_style === 'realista';

    useEffect(() => {
        if (!reportedRunning) return;
        const first = setTimeout(() => setNow(Date.now()), 0);
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => { clearTimeout(first); clearInterval(timer); };
    }, [reportedRunning]);

    async function start(rewrite: boolean) {
        if (starting || running) return;
        if (rewrite && video.script.trim() !== '') {
            const confirmed = window.confirm('La mesa reescribirá el guion actual y se perderán tus cambios en él. ¿Continuar?');
            if (!confirmed) return;
        }
        setStarting(true);
        setError('');
        try {
            onUpdated(await startWorkbench(video.id, rewrite));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo poner a trabajar la mesa.');
        } finally {
            setStarting(false);
        }
    }

    // The palette's request, consumed once and only by the panel of the video
    // it names. Deferred a tick: starting sets state, which an effect body
    // must not do synchronously.
    const startRef = useRef(start);
    useEffect(() => {
        startRef.current = start;
    });
    useEffect(() => {
        if (!startRequest || startRequest.seq === 0 || startRequest.videoId !== video.id) return;
        // Marked handled inside the timer: clearing the request re-runs this
        // effect, and its cleanup would cancel a timer set before the clear.
        const timer = setTimeout(() => {
            onStartRequestHandled?.();
            void startRef.current(false);
        }, 0);
        return () => clearTimeout(timer);
    }, [startRequest, video.id, onStartRequestHandled]);

    const startedAt = workbench?.started_at ? Date.parse(workbench.started_at) : NaN;
    const finishedAt = workbench?.finished_at ? Date.parse(workbench.finished_at) : NaN;
    const elapsedMs = running
        ? (now > 0 && !Number.isNaN(startedAt) ? now - startedAt : null)
        : (!Number.isNaN(startedAt) && !Number.isNaN(finishedAt) ? finishedAt - startedAt : null);

    const stepsByRole = new Map<WorkbenchRole, WorkbenchStep[]>();
    for (const step of steps) {
        stepsByRole.set(step.role, [...(stepsByRole.get(step.role) ?? []), step]);
    }
    const sceneCount = video.scenes.length;

    const headline = !workbench || workbench.status === 'idle'
        ? { text: 'Sin trabajar', tone: 'text-slate-400', dot: 'bg-slate-500' }
        : running
            ? { text: 'Trabajando', tone: 'text-brand-200', dot: 'bg-brand-400' }
            : stale
                ? { text: 'Interrumpida', tone: 'text-amber-300', dot: 'bg-amber-400' }
                : workbench.status === 'done'
                ? { text: 'Terminó', tone: 'text-emerald-300', dot: 'bg-emerald-400' }
                : { text: 'Con error', tone: 'text-red-300', dot: 'bg-red-400' };

    return (
        <section className="panel panel-pad" aria-labelledby={`mesa-title-${video.id}`}>
            <div className="panel-head">
                <div className="panel-head-main">
                    <SectionIcon name="team" />
                    <div className="min-w-0">
                        <h3 id={`mesa-title-${video.id}`} className="panel-title">Mesa de trabajo</h3>
                        <p className="hint">Varias IA gratuitas revisan el guion, las escenas y las imágenes por turnos. La mesa prepara; aprobar sigue siendo tuyo.</p>
                    </div>
                </div>
                <span className={`flex items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-wider ${headline.tone}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${headline.dot} ${running ? 'seat-blink' : ''}`} aria-hidden="true" />
                    {headline.text}
                    {elapsedMs !== null && <span className="tabular-nums text-slate-400">· {formatSpan(elapsedMs)}</span>}
                </span>
            </div>

            {/* The seats: who sits at the table and what each is doing now. */}
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Integrantes de la mesa">
                {WORKBENCH_ROLES.map((seat) => {
                    const roleSteps = stepsByRole.get(seat.role) ?? [];
                    const state = seatState(roleSteps);
                    const latest = roleSteps[roleSteps.length - 1] ?? null;
                    const offStyle = seat.visual && !realista && roleSteps.length === 0;
                    let sub = offStyle ? 'Solo con estilo Realista' : SEAT_TEXT[state];
                    if (seat.role === 'fotografo' && roleSteps.length > 0 && sceneCount > 0) {
                        const photos = roleSteps.filter((step) => step.status === 'done').length;
                        sub = `${SEAT_TEXT[state]} · ${photos}/${sceneCount} fotos`;
                    }
                    const rounds = roleSteps.reduce((max, step) => Math.max(max, step.round), 0);
                    return (
                        <li
                            key={seat.role}
                            className={`tile relative flex min-w-0 items-start gap-2.5 p-2.5 transition-colors sm:p-3 ${
                                state === 'running' ? 'border-brand-400/45 bg-brand-500/[0.07]' : ''
                            } ${offStyle ? 'opacity-55' : ''}`}
                            aria-label={`${seat.label}: ${sub}${latest ? `, ${providerBadge(latest.provider, latest.model)}` : ''}`}
                        >
                            <span
                                aria-hidden="true"
                                className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-[0.6875rem] font-semibold ring-1 ring-inset ${
                                    state === 'running'
                                        ? 'seat-live bg-brand-500/20 text-brand-100 ring-brand-300/60'
                                        : state === 'done'
                                            ? 'bg-emerald-400/10 text-emerald-200 ring-emerald-400/35'
                                            : state === 'error'
                                                ? 'bg-red-500/10 text-red-200 ring-red-400/40'
                                                : state === 'skipped'
                                                    ? 'bg-amber-400/10 text-amber-200 ring-amber-400/35'
                                                    : 'bg-white/[0.04] text-slate-400 ring-white/10'
                                }`}
                            >
                                {seat.mark}
                                {(state === 'done' || state === 'error' || state === 'skipped') && (
                                    <span
                                        className={`absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-ink-900 ${
                                            state === 'done' ? 'bg-emerald-400 text-ink-950' : state === 'error' ? 'bg-red-400 text-ink-950' : 'bg-amber-400 text-ink-950'
                                        }`}
                                    >
                                        <Icon name={state === 'done' ? 'check' : 'alert'} size={9} strokeWidth={3} />
                                    </span>
                                )}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-[0.8125rem] font-medium leading-snug text-slate-100">{seat.label}</span>
                                <span className={`block text-[0.6875rem] leading-snug ${
                                    state === 'running' ? 'text-brand-200' : state === 'error' ? 'text-red-300' : state === 'skipped' ? 'text-amber-200' : 'text-slate-400'
                                }`}
                                >
                                    {sub}
                                </span>
                                <span className="mt-1.5 flex min-w-0 items-center gap-1">
                                    <span className="block min-w-0 truncate rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-[0.625rem] text-slate-300 ring-1 ring-inset ring-white/[0.08]" title={latest?.model ?? undefined}>
                                        {latest ? providerBadge(latest.provider, latest.model) : '—'}
                                    </span>
                                    {rounds > 1 && (
                                        <span className="shrink-0 rounded-md bg-accent-500/10 px-1 py-0.5 font-mono text-[0.625rem] text-accent-300 ring-1 ring-inset ring-accent-400/30" title={`Ronda ${rounds}`}>
                                            R{rounds}
                                        </span>
                                    )}
                                </span>
                            </span>
                        </li>
                    );
                })}
            </ul>

            {/* Start control. Disabled while a run is going: the server would
                answer 409 anyway, and a second click must not look accepted. */}
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-ink-950/40 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                <label className={`flex items-start gap-2.5 text-sm text-slate-100 ${running || starting ? 'opacity-60' : ''}`}>
                    <input
                        type="checkbox"
                        checked={rewriteScript}
                        onChange={(event) => setRewriteScript(event.target.checked)}
                        disabled={running || starting}
                        className="checkbox mt-0.5"
                    />
                    <span>
                        Reescribir el guion
                        <span className="hint mt-0.5 block">Sin marcar, la mesa parte del guion actual y lo revisa.</span>
                    </span>
                </label>
                <button
                    type="button"
                    onClick={() => { void start(rewriteScript); }}
                    disabled={running || starting}
                    className="btn btn-primary btn-lg w-full sm:w-auto"
                >
                    {running || starting ? <span className="spinner" aria-hidden="true" /> : <Icon name="team" />}
                    {starting
                        ? 'Convocando a la mesa…'
                        : running
                            ? `La mesa está trabajando${elapsedMs !== null ? ` · ${formatSpan(elapsedMs)}` : '…'}`
                            : 'Poner a trabajar la mesa'}
                </button>
            </div>

            {/* Announced politely: who is working and on what, as it changes. */}
            <p className="sr-only" aria-live="polite">
                {active ? `${ROLE_LABEL[active.role]} trabajando: ${active.summary}` : workbench?.status === 'done' ? 'La mesa terminó.' : ''}
            </p>

            {error && <p role="alert" className="alert alert-error mt-3">{error}</p>}
            {stale && <p role="alert" className="alert alert-warning mt-3">{WORKBENCH_STALLED_ERROR}</p>}
            {workbench?.status === 'error' && !running && (
                <p role="alert" className="alert alert-error mt-3">
                    La mesa se detuvo: {workbench.error ?? 'ocurrió un error inesperado.'} Puedes volver a intentarlo.
                </p>
            )}
            {workbench?.status === 'done' && !error && (
                <p className="alert alert-info mt-3 text-xs">
                    La mesa terminó{elapsedMs !== null ? ` en ${formatSpan(elapsedMs)}` : ''}. Revisa el guion y el storyboard antes de enviarlo a aprobación.
                </p>
            )}

            {steps.length > 0 && (
                <div className="mt-5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="eyebrow">Bitácora · {steps.length} {steps.length === 1 ? 'paso' : 'pasos'}</p>
                    </div>
                    <ol className="thin-scroll relative max-h-[30rem] space-y-1 overflow-y-auto pr-1 before:absolute before:bottom-3 before:left-[0.6875rem] before:top-3 before:w-px before:bg-white/[0.07]" aria-label="Pasos de la mesa en orden">
                        {steps.map((step, index) => {
                            const previous = steps[index - 1];
                            const newRound = step.round > 1 && (!previous || previous.round !== step.round);
                            const offset = !Number.isNaN(startedAt) ? Date.parse(step.started_at) - startedAt : NaN;
                            const seconds = stepSeconds(step);
                            return (
                                <li key={step.id}>
                                    {newRound && (
                                        <p className="relative mb-1 ml-8 mt-2 inline-flex rounded-full bg-accent-500/10 px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-wider text-accent-300 ring-1 ring-inset ring-accent-400/30">
                                            Ronda {step.round}
                                        </p>
                                    )}
                                    <div className="relative flex gap-3 rounded-lg p-1.5">
                                        <span className="relative z-[1] mt-1 flex h-[1.375rem] w-[1.375rem] shrink-0 items-center justify-center" aria-hidden="true">
                                            <span className={`h-2.5 w-2.5 rounded-full ring-4 ${STEP_DOT[step.status]} ${step.status === 'running' ? 'seat-blink' : ''}`} />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                                <span className="font-medium text-slate-100">{ROLE_LABEL[step.role] ?? step.role}</span>
                                                <span className="rounded bg-white/[0.04] px-1.5 py-px font-mono text-[0.625rem] text-slate-300 ring-1 ring-inset ring-white/[0.08]">
                                                    {providerBadge(step.provider, step.model)}
                                                </span>
                                                {step.scene_order !== null && (
                                                    <span className="font-mono text-[0.625rem] text-brand-200">Escena {step.scene_order}</span>
                                                )}
                                                {step.round > 1 && <span className="font-mono text-[0.625rem] text-accent-300">Ronda {step.round}</span>}
                                                <span className="sr-only">, {STEP_STATUS_TEXT[step.status]}</span>
                                                <span className="ml-auto font-mono text-[0.625rem] tabular-nums text-slate-500">
                                                    {!Number.isNaN(offset) && `+${formatSpan(offset)}`}
                                                    {seconds !== null && ` · ${seconds} s`}
                                                    {step.status === 'running' && ' · en curso'}
                                                </span>
                                            </p>
                                            <p className={`mt-0.5 text-[0.8125rem] leading-relaxed ${
                                                step.status === 'error' ? 'text-red-200' : step.status === 'skipped' ? 'text-amber-100' : 'text-slate-300'
                                            }`}
                                            >
                                                {step.summary}
                                            </p>
                                            {step.detail && (
                                                <details className="group mt-1">
                                                    <summary className="inline-flex cursor-pointer select-none items-center gap-1 rounded text-[0.6875rem] font-medium text-brand-300 hover:text-brand-200">
                                                        <Icon name="chevron-right" size={12} className="transition-transform group-open:rotate-90" />
                                                        Ver detalle
                                                    </summary>
                                                    <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-ink-950/50 p-2.5 text-xs leading-relaxed text-slate-300">
                                                        {step.detail}
                                                    </p>
                                                </details>
                                            )}
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            )}
        </section>
    );
}
