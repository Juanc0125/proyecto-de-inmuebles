'use client';

import { isRenderStalled } from '@shared-types/video';
import type { VideoStatus } from '@shared-types/video';
import type { VideoRecord } from './api';
import { STATUS_DOT_CLASSES, STATUS_LABELS } from './constants';
import StatusBadge from './status-badge';
import { Icon, type SectionIconName } from './section-icon';
import VideoPoster from './video-poster';
import { PLATFORM_SHORT, relativeTime } from './studio-utils';

interface DashboardViewProps {
    videos: VideoRecord[];
    loading: boolean;
    loadError: string;
    onRetry: () => void;
    // Held in state by the shell and ticked; 0 until the first tick.
    now: number;
    onOpen: (id: string) => void;
    onNewVideo: () => void;
    onNewBatch: () => void;
    onOpenCopilot: () => void;
    onGoToBoard: () => void;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const STATUS_ORDER: VideoStatus[] = ['borrador', 'pendiente_aprobacion', 'aprobado', 'publicado'];

type Severity = 'critical' | 'warning' | 'info';

interface AttentionItem {
    video: VideoRecord;
    reason: string;
    detail: string;
    severity: Severity;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
const SEVERITY_CLASSES: Record<Severity, string> = {
    critical: 'bg-red-500/10 text-red-300 ring-red-400/30',
    warning: 'bg-amber-400/10 text-amber-300 ring-amber-400/30',
    info: 'bg-brand-500/10 text-brand-300 ring-brand-400/30',
};

// What needs a person, most urgent first. Derived only from the record:
// a render whose worker stopped reporting, a render that failed, a video
// waiting for approval (only a human can give it), an approved video with no
// file, a draft with no scenes.
function attentionItems(videos: VideoRecord[], now: number): AttentionItem[] {
    const items: AttentionItem[] = [];
    for (const video of videos) {
        if (now > 0 && isRenderStalled(video.render_status, video.render_started_at, now)) {
            items.push({ video, severity: 'critical', reason: 'Generación colgada', detail: 'El servidor dejó de reportar progreso. Puedes reintentarla.' });
        } else if (video.render_status === 'error') {
            items.push({ video, severity: 'critical', reason: 'Error al generar', detail: video.render_error ?? 'La última generación falló.' });
        }
        if (video.status === 'pendiente_aprobacion') {
            items.push({ video, severity: 'warning', reason: 'Esperando tu aprobación', detail: 'Solo una persona puede aprobarlo.' });
        } else if (video.status === 'aprobado' && !video.video_url && video.render_status !== 'procesando' && video.render_status !== 'error') {
            items.push({ video, severity: 'info', reason: 'Aprobado sin MP4', detail: 'Falta generar el archivo final.' });
        } else if (video.status === 'borrador' && video.scenes.length === 0) {
            items.push({ video, severity: 'info', reason: 'Sin escenas', detail: 'Genera las escenas para poder revisarlo.' });
        }
    }
    return items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export default function DashboardView({
    videos, loading, loadError, onRetry, now, onOpen, onNewVideo, onNewBatch, onOpenCopilot, onGoToBoard,
}: DashboardViewProps) {
    const byStatus = Object.fromEntries(STATUS_ORDER.map((status) => [status, videos.filter((v) => v.status === status).length])) as Record<VideoStatus, number>;
    const rendering = videos.filter((v) => v.render_status === 'procesando');
    const createdThisWeek = now > 0 ? videos.filter((v) => now - Date.parse(v.created_at) < WEEK_MS).length : 0;
    const readyToPublish = videos.filter((v) => v.status === 'aprobado' && v.video_url && v.render_status !== 'procesando').length;
    const attention = attentionItems(videos, now);
    const recent = [...videos].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 6);
    const total = videos.length;

    const kpis: { label: string; value: number; sub: string; icon: SectionIconName; tone: string; live?: boolean }[] = [
        { label: 'Videos', value: total, sub: now > 0 ? `${createdThisWeek} creados en 7 días` : ' ', icon: 'film', tone: 'text-brand-300' },
        { label: 'Por aprobar', value: byStatus.pendiente_aprobacion, sub: 'Requieren una persona', icon: 'shield', tone: 'text-amber-300' },
        { label: 'Generando', value: rendering.length, sub: rendering.length > 0 ? 'MP4 en el servidor' : 'Sin trabajos activos', icon: 'bolt', tone: 'text-brand-300', live: rendering.length > 0 },
        { label: 'Publicados', value: byStatus.publicado, sub: `${readyToPublish} listos para publicar`, icon: 'check', tone: 'text-emerald-300' },
    ];

    return (
        <div className="enter space-y-5">
            <header className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                    <p className="eyebrow mb-1.5">Centro de control</p>
                    <h1 className="text-2xl font-semibold tracking-[-0.025em] text-white sm:text-[1.75rem]">Panel</h1>
                    <p className="mt-1 text-sm text-slate-400">El estado de toda la producción, y lo que necesita tu atención.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={onNewVideo} className="btn btn-primary">
                        <Icon name="plus" />
                        Nuevo video
                    </button>
                    <button type="button" onClick={onNewBatch} className="btn btn-secondary">
                        <Icon name="layers" />
                        Crear lote
                    </button>
                    <button type="button" onClick={onOpenCopilot} className="btn btn-secondary">
                        <Icon name="bot" />
                        Copiloto
                    </button>
                </div>
            </header>

            {loadError && !loading && (
                <div role="alert" className="alert alert-error flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">{loadError}</span>
                    <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm">Reintentar</button>
                </div>
            )}

            <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
                {kpis.map((kpi) => (
                    <div key={kpi.label} className="kpi">
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <p className="eyebrow">{kpi.label}</p>
                            <span className={`relative ${kpi.tone}`}>
                                <Icon name={kpi.icon} size={16} />
                                {kpi.live && (
                                    <span className="absolute -right-1 -top-1 flex h-2 w-2" aria-hidden="true">
                                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-300 opacity-75" />
                                        <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-300" />
                                    </span>
                                )}
                            </span>
                        </div>
                        {loading ? <div className="skeleton h-8 w-14" /> : <p className="kpi-value">{kpi.value}</p>}
                        <p className="mt-2 truncate text-xs text-slate-400">{kpi.sub}</p>
                    </div>
                ))}
            </section>

            <section className="panel panel-pad" aria-labelledby="pipeline-title">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h2 id="pipeline-title" className="panel-title">Flujo de producción</h2>
                    <button type="button" onClick={onGoToBoard} className="btn btn-ghost btn-sm">
                        Abrir tablero
                        <Icon name="arrow-right" size={14} />
                    </button>
                </div>
                <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-white/[0.04]" role="img" aria-label={STATUS_ORDER.map((s) => `${STATUS_LABELS[s]}: ${byStatus[s]}`).join(', ')}>
                    {total > 0 && STATUS_ORDER.map((status) => (
                        <div
                            key={status}
                            className={`h-full transition-[width] duration-700 ease-out-expo ${STATUS_DOT_CLASSES[status]}`}
                            style={{ width: `${(byStatus[status] / total) * 100}%` }}
                        />
                    ))}
                </div>
                <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {STATUS_ORDER.map((status, index) => (
                        <li key={status} className="flex items-center gap-2.5">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASSES[status]}`} aria-hidden="true" />
                            <span className="min-w-0">
                                <span className="block truncate text-xs text-slate-400">
                                    <span className="font-mono text-slate-500">0{index + 1} </span>
                                    {STATUS_LABELS[status]}
                                </span>
                                <span className="font-mono text-lg font-semibold tabular-nums text-white">{byStatus[status]}</span>
                            </span>
                        </li>
                    ))}
                </ul>
            </section>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <section className="panel panel-pad" aria-labelledby="attention-title">
                    <div className="mb-4 flex items-center justify-between gap-2">
                        <h2 id="attention-title" className="panel-title flex items-center gap-2">
                            <Icon name="alert" className="text-amber-300" />
                            Necesitan atención
                        </h2>
                        {attention.length > 0 && <span className="chip font-mono tabular-nums">{attention.length}</span>}
                    </div>
                    {loading ? (
                        <div className="space-y-2" aria-hidden="true">
                            <div className="skeleton h-14 w-full" />
                            <div className="skeleton h-14 w-full" />
                        </div>
                    ) : attention.length === 0 ? (
                        <p className="flex items-center gap-2.5 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] px-4 py-5 text-sm text-emerald-100">
                            <Icon name="check" className="text-emerald-300" />
                            Todo en orden: nada espera tu decisión.
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {attention.slice(0, 6).map((item) => (
                                <li key={`${item.video.id}-${item.reason}`}>
                                    <button
                                        type="button"
                                        onClick={() => onOpen(item.video.id)}
                                        className="tile tile-hover flex w-full items-center gap-3 p-3 text-left"
                                    >
                                        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${SEVERITY_CLASSES[item.severity]}`}>
                                            <Icon name={item.severity === 'critical' ? 'alert' : item.severity === 'warning' ? 'shield' : 'clock'} size={15} />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium text-slate-100">{item.video.topic}</span>
                                            <span className="block truncate text-xs text-slate-400">
                                                <span className="font-medium text-slate-300">{item.reason}</span> · {item.detail}
                                            </span>
                                        </span>
                                        <Icon name="chevron-right" className="text-slate-500" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="panel panel-pad" aria-labelledby="activity-title">
                    <div className="mb-4 flex items-center justify-between gap-2">
                        <h2 id="activity-title" className="panel-title flex items-center gap-2">
                            <Icon name="activity" className="text-brand-300" />
                            Actividad reciente
                        </h2>
                        <span className="hint">Por fecha de creación</span>
                    </div>
                    {loading ? (
                        <div className="space-y-2" aria-hidden="true">
                            <div className="skeleton h-12 w-full" />
                            <div className="skeleton h-12 w-full" />
                        </div>
                    ) : recent.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-white/[0.1] px-4 py-8 text-center">
                            <p className="text-sm text-slate-300">Aún no hay videos.</p>
                            <button type="button" onClick={onNewVideo} className="btn btn-primary btn-sm mt-3">Crear el primero</button>
                        </div>
                    ) : (
                        <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[1.05rem] before:top-3 before:w-px before:bg-white/[0.06]">
                            {recent.map((video) => (
                                <li key={video.id}>
                                    <button
                                        type="button"
                                        onClick={() => onOpen(video.id)}
                                        className="relative flex w-full items-center gap-3 rounded-lg p-1.5 text-left hover:bg-white/[0.035]"
                                    >
                                        <VideoPoster video={video} showSubtitle={false} className="w-6 shrink-0 rounded" />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm text-slate-100">{video.topic}</span>
                                            <span className="block truncate font-mono text-[0.6875rem] text-slate-500">
                                                {PLATFORM_SHORT[video.platform]} · creado {relativeTime(video.created_at, now)}
                                            </span>
                                        </span>
                                        <StatusBadge status={video.status} short />
                                    </button>
                                </li>
                            ))}
                        </ol>
                    )}
                </section>
            </div>
        </div>
    );
}
