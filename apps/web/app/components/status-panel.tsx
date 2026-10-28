'use client';

import { useEffect, useState } from 'react';
import type { Platform } from '@shared-types/video';
// Same threshold the server uses to write the give-up into the row, so the
// warning on screen and the stored state can never disagree.
import { RENDER_STALL_TIMEOUT_MS as STALLED_AFTER_MS } from '@shared-types/video';
import { duplicateVideo, transitionStatus, type StatusAction, type VideoRecord } from './api';
import { PLATFORM_LABELS, PLATFORM_OPTIONS } from './constants';
import StatusBadge from './status-badge';
import SectionIcon from './section-icon';
import ComplianceChecklist from './compliance-checklist';

interface StatusPanelProps {
    video: VideoRecord;
    onUpdated: (video: VideoRecord) => void;
    onDuplicated: (video: VideoRecord) => void;
}

export default function StatusPanel({ video, onUpdated, onDuplicated }: StatusPanelProps) {
    const [actionLoading, setActionLoading] = useState<StatusAction | null>(null);
    const [actionError, setActionError] = useState('');

    const otherPlatforms = PLATFORM_OPTIONS.filter((option) => option.value !== video.platform);
    const [duplicatePlatform, setDuplicatePlatform] = useState<Platform>(otherPlatforms[0]?.value ?? video.platform);
    const [duplicating, setDuplicating] = useState(false);
    const [duplicateError, setDuplicateError] = useState('');

    const busy = actionLoading !== null;

    // Reading the clock during render is impure, so it is held in state and
    // ticked only while a job is actually running.
    const rendering = video.render_status === 'procesando';
    const [now, setNow] = useState(0);
    useEffect(() => {
        if (!rendering) return;
        // First read is scheduled rather than immediate: setting state straight
        // inside the effect makes React re-render twice before paint.
        const first = setTimeout(() => setNow(Date.now()), 0);
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => { clearTimeout(first); clearInterval(timer); };
    }, [rendering]);

    const stalled = rendering
        && video.render_started_at !== null
        && now > 0
        && now - new Date(video.render_started_at).getTime() > STALLED_AFTER_MS;

    async function runAction(action: StatusAction) {
        setActionLoading(action);
        setActionError('');
        try {
            const updated = await transitionStatus(video.id, action);
            onUpdated(updated);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'No se pudo completar la acción.');
        } finally {
            setActionLoading(null);
        }
    }

    async function handleDuplicate() {
        setDuplicating(true);
        setDuplicateError('');
        try {
            const created = await duplicateVideo(video.id, duplicatePlatform);
            onDuplicated(created);
        } catch (err) {
            setDuplicateError(err instanceof Error ? err.message : 'No se pudo duplicar el video.');
        } finally {
            setDuplicating(false);
        }
    }

    return (
        <div className="space-y-5">
            {/* The human gate (RF-012). A faint brand ring sets it apart from the
                editing panels above, since it is where the decision is made. */}
            <section className="panel panel-pad relative overflow-hidden ring-1 ring-inset ring-brand-400/20">
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-brand-300/60 to-transparent"
                />
                <div className="panel-head">
                    <div className="panel-head-main">
                        <SectionIcon name="shield" />
                        <div className="min-w-0">
                            <h3 className="panel-title">Estado y aprobación</h3>
                            <p className="hint">Una persona decide. Nada se genera ni se publica sin su clic.</p>
                        </div>
                    </div>
                    <StatusBadge status={video.status} />
                </div>

                {actionError && <p className="alert alert-error mb-4" role="alert">{actionError}</p>}

                {video.status === 'borrador' && (
                    <div>
                        <p className="mb-4 text-sm leading-relaxed text-slate-300">
                            El video está en borrador. Envíalo a aprobación cuando el guion y las escenas estén listos.
                        </p>
                        {/* Advisory: it lists, it never disables the button. */}
                        <div className="mb-4">
                            <ComplianceChecklist video={video} />
                        </div>
                        <button
                            type="button"
                            onClick={() => runAction('submit')}
                            disabled={busy}
                            className="btn btn-primary"
                        >
                            {actionLoading === 'submit' && <span className="spinner" aria-hidden="true" />}
                            {actionLoading === 'submit' ? 'Enviando...' : 'Enviar a aprobación'}
                        </button>
                    </div>
                )}

                {video.status === 'pendiente_aprobacion' && (
                    <div className="rounded-2xl border border-amber-400/25 bg-gradient-to-b from-amber-400/[0.1] to-amber-400/[0.04] p-4 sm:p-5">
                        <div className="mb-5 flex gap-3">
                            <svg className="mt-0.5 shrink-0 text-amber-300" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" />
                                <path d="m9 12 2 2 4-4" />
                            </svg>
                            <p className="text-sm font-medium leading-relaxed text-amber-100">
                                Este video requiere aprobación humana antes de poder generarse o publicarse. Revisa el
                                guion, las escenas y la marca antes de decidir.
                            </p>
                        </div>
                        <div className="mb-5">
                            <ComplianceChecklist video={video} />
                        </div>
                        <div className="flex flex-col gap-2 min-[420px]:flex-row min-[420px]:flex-wrap">
                            <button
                                type="button"
                                onClick={() => runAction('approve')}
                                disabled={busy}
                                className="btn btn-approve btn-lg"
                            >
                                {actionLoading === 'approve' && <span className="spinner" aria-hidden="true" />}
                                {actionLoading === 'approve' ? 'Aprobando...' : 'Aprobar'}
                            </button>
                            <button
                                type="button"
                                onClick={() => runAction('reject')}
                                disabled={busy}
                                className="btn btn-danger btn-lg"
                            >
                                {actionLoading === 'reject' && <span className="spinner" aria-hidden="true" />}
                                {actionLoading === 'reject' ? 'Rechazando...' : 'Rechazar y volver a borrador'}
                            </button>
                        </div>
                    </div>
                )}

                {video.status === 'aprobado' && (
                    <div className="space-y-3">
                        <p className="text-sm text-slate-300">El video fue aprobado. Ya puedes generar el archivo final.</p>

                        {stalled ? (
                            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
                                <p className="text-sm font-medium text-amber-200">Esta generación se quedó colgada.</p>
                                <p className="mt-1 text-xs text-amber-100/90">
                                    Empezó hace más de {Math.round(STALLED_AFTER_MS / 60000)} minutos y el servidor dejó de
                                    reportar, normalmente porque se reinició a mitad del trabajo. Puedes volver a lanzarla.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => runAction('render')}
                                    disabled={busy}
                                    className="btn btn-warning mt-3"
                                >
                                    {actionLoading === 'render' ? 'Reintentando...' : 'Reintentar generación'}
                                </button>
                            </div>
                        ) : rendering ? (
                            <div className="rounded-2xl border border-brand-400/25 bg-gradient-to-b from-brand-500/[0.12] to-brand-500/[0.04] p-4 sm:p-5" aria-live="polite">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="flex items-center gap-2 text-sm font-medium text-brand-100">
                                        <span className="spinner text-brand-300" aria-hidden="true" />
                                        Generando el video...
                                    </span>
                                    <span className="font-mono text-sm tabular-nums text-brand-100">{video.render_progress}%</span>
                                </div>
                                <div className="h-2 w-full overflow-hidden rounded-full bg-ink-950/60 ring-1 ring-inset ring-white/[0.06]">
                                    <div
                                        className="bar-sheen h-full rounded-full bg-gradient-to-r from-brand-500 via-brand-400 to-accent-400 shadow-[0_0_12px_rgba(34,211,238,0.55)] transition-[width] duration-700 ease-out-expo"
                                        style={{ width: `${Math.max(2, video.render_progress)}%` }}
                                    />
                                </div>
                                <p className="mt-2 text-xs text-brand-200">
                                    Puedes cerrar esta pantalla: el trabajo sigue en el servidor y el progreso se actualiza solo.
                                </p>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => runAction('render')}
                                disabled={busy}
                                className="btn btn-primary"
                            >
                                {actionLoading === 'render' && <span className="spinner" aria-hidden="true" />}
                                {actionLoading === 'render' ? 'Enviando...' : video.video_url ? 'Regenerar video final' : 'Generar video'}
                            </button>
                        )}

                        {video.render_status === 'error' && video.render_error && (
                            <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-4">
                                <p className="text-sm font-medium text-red-200">No se pudo generar el video.</p>
                                <p className="mt-1 break-words font-mono text-xs text-red-300">{video.render_error}</p>
                            </div>
                        )}

                        {video.video_url && (
                            <div className="tile space-y-3 p-3.5">
                                <video controls src={video.video_url} className="w-full max-w-[16rem] rounded-xl border border-white/10 bg-black" />
                                <div className="flex flex-wrap items-center gap-3">
                                    <a href={video.video_url} download className="btn btn-secondary">
                                        Descargar MP4
                                    </a>
                                    {/* Hidden while a new render runs: the file on
                                        screen is the previous one and is about to be
                                        replaced, so publishing now would publish a
                                        video nobody approved in its final form. */}
                                    {rendering ? (
                                        <span className="text-xs text-slate-400">Podrás publicarlo cuando termine de generarse.</span>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => runAction('publish')}
                                            disabled={busy}
                                            className="btn btn-primary"
                                        >
                                            {actionLoading === 'publish' && <span className="spinner" aria-hidden="true" />}
                                            {actionLoading === 'publish' ? 'Publicando...' : 'Publicar'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {video.status === 'publicado' && (
                    <div className="space-y-3">
                        <p className="alert alert-success font-medium">Este video ya fue publicado.</p>
                        {video.video_url && (
                            <div className="tile space-y-3 p-3.5">
                                <video controls src={video.video_url} className="w-full max-w-[16rem] rounded-xl border border-white/10 bg-black" />
                                <a href={video.video_url} download className="btn btn-secondary">
                                    Descargar MP4
                                </a>
                            </div>
                        )}
                    </div>
                )}
            </section>

            <section className="panel panel-pad">
                <div className="panel-head">
                    <div className="panel-head-main">
                        <SectionIcon name="copy" />
                        <div className="min-w-0">
                            <h3 className="panel-title mb-1">Duplicar para otra plataforma</h3>
                            <p className="panel-subtitle">
                                Reutiliza el guion, las escenas y la marca de este video para crear un nuevo borrador dirigido a
                                otra plataforma. El nuevo video inicia su propio ciclo de aprobación.
                            </p>
                        </div>
                    </div>
                </div>
                {otherPlatforms.length === 0 ? (
                    <p className="text-sm text-slate-400">No hay otras plataformas disponibles.</p>
                ) : (
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={duplicatePlatform}
                            onChange={(event) => setDuplicatePlatform(event.target.value as Platform)}
                            disabled={duplicating}
                            aria-label="Plataforma del nuevo borrador"
                            className="field w-full sm:w-auto"
                        >
                            {otherPlatforms.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={handleDuplicate}
                            disabled={duplicating}
                            className="btn btn-secondary"
                        >
                            {duplicating && <span className="spinner" aria-hidden="true" />}
                            {duplicating ? 'Duplicando...' : `Duplicar para ${PLATFORM_LABELS[duplicatePlatform]}`}
                        </button>
                    </div>
                )}
                {duplicateError && <p className="alert alert-error mt-3" role="alert">{duplicateError}</p>}
            </section>
        </div>
    );
}
