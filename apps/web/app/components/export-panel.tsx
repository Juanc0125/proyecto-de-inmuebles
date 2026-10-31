'use client';

import { useState } from 'react';
import type { Platform } from '@shared-types/video';
import type { VideoRecord } from './api';
import { PLATFORM_LABELS } from './constants';
import SectionIcon, { Icon } from './section-icon';
import { formatClock, scenesSeconds } from './studio-utils';

// Format facts for the file the render worker produces (apps/render-worker:
// 1080x1920, H.264 + AAC in MP4, the same for every platform) and a short
// publishing note per platform. Guidance only; the platforms change limits.
const PLATFORM_NOTES: Record<Platform, string> = {
    reels: 'Instagram admite Reels de hasta 3 minutos; los más cortos suelen retener mejor.',
    tiktok: 'TikTok admite videos largos, pero el formato corto vertical es el que mejor funciona.',
    shorts: 'YouTube clasifica como Short un video vertical de hasta 3 minutos.',
};

export default function ExportPanel({ video }: { video: VideoRecord }) {
    const [copyState, setCopyState] = useState<'idle' | 'ok' | 'error'>('idle');
    const rendering = video.render_status === 'procesando';
    const seconds = scenesSeconds(video);
    const url = video.video_url;

    async function handleCopy() {
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            setCopyState('ok');
        } catch {
            // Clipboard refused (permissions, insecure context): the URL is
            // still visible and selectable in the field below.
            setCopyState('error');
        }
    }

    const facts: { label: string; value: string }[] = [
        { label: 'Plataforma', value: PLATFORM_LABELS[video.platform] },
        { label: 'Formato', value: 'MP4 · H.264 + AAC' },
        { label: 'Resolución', value: '1080 × 1920 (9:16)' },
        { label: 'Duración', value: seconds > 0 ? `${formatClock(seconds)} (objetivo ${formatClock(video.target_duration_seconds)})` : `Objetivo ${formatClock(video.target_duration_seconds)}` },
    ];

    return (
        <section className="panel panel-pad" aria-labelledby={`export-title-${video.id}`}>
            <div className="panel-head">
                <div className="panel-head-main">
                    <SectionIcon name="export" />
                    <div className="min-w-0">
                        <h3 id={`export-title-${video.id}`} className="panel-title">Exportar</h3>
                        <p className="hint">Descarga el MP4 final o comparte su enlace público.</p>
                    </div>
                </div>
                {url && !rendering && (
                    <span className="chip border-emerald-400/30 bg-emerald-400/10 text-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                        Archivo listo
                    </span>
                )}
            </div>

            <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.06] sm:grid-cols-2">
                {facts.map((fact) => (
                    <div key={fact.label} className="bg-ink-900/90 px-3.5 py-2.5">
                        <dt className="eyebrow">{fact.label}</dt>
                        <dd className="mt-0.5 font-mono text-sm tabular-nums text-slate-100">{fact.value}</dd>
                    </div>
                ))}
            </dl>
            <p className="hint mt-2">{PLATFORM_NOTES[video.platform]} Deja libre la franja inferior: la interfaz de la app tapa esa zona.</p>

            {url ? (
                <div className="mt-4 space-y-3">
                    {rendering && (
                        <p className="alert alert-info text-xs" role="status">
                            Se está generando una versión nueva. El archivo de abajo es el anterior hasta que termine.
                        </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                        <a href={url} download className="btn btn-primary">
                            <Icon name="download" />
                            Descargar MP4
                        </a>
                        <button type="button" onClick={() => { void handleCopy(); }} className="btn btn-secondary">
                            <Icon name={copyState === 'ok' ? 'check' : 'link'} />
                            {copyState === 'ok' ? 'URL copiada' : 'Copiar URL pública'}
                        </button>
                        <a href={url} target="_blank" rel="noreferrer" className="btn btn-ghost">
                            Abrir en otra pestaña
                            <Icon name="arrow-right" size={14} />
                        </a>
                    </div>
                    <div>
                        <label className="label" htmlFor={`export-url-${video.id}`}>URL pública del archivo</label>
                        <input
                            id={`export-url-${video.id}`}
                            type="text"
                            readOnly
                            value={url}
                            onFocus={(event) => event.target.select()}
                            className="field font-mono text-xs"
                        />
                    </div>
                    <p className="sr-only" aria-live="polite">
                        {copyState === 'ok' ? 'URL copiada al portapapeles.' : copyState === 'error' ? 'No se pudo copiar. Selecciona la URL del campo y cópiala a mano.' : ''}
                    </p>
                    {copyState === 'error' && (
                        <p className="alert alert-warning text-xs">No se pudo copiar. Selecciona la URL del campo y cópiala a mano.</p>
                    )}
                </div>
            ) : (
                <div className="mt-4 rounded-lg border border-dashed border-white/[0.1] px-4 py-6 text-center">
                    <p className="text-sm text-slate-300">
                        {rendering ? 'Generando el MP4…' : 'Todavía no hay archivo final.'}
                    </p>
                    <p className="hint mt-1">
                        El MP4 se genera desde «Estado y aprobación» cuando una persona aprueba el video.
                    </p>
                </div>
            )}
        </section>
    );
}
