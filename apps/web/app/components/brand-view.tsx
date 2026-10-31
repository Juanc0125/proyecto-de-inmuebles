'use client';

import { useState } from 'react';
import type { BrandTemplate } from '@shared-types/templates';
import type { Branding } from '@shared-types/video';
import { applyBrandTemplate, deleteBrandTemplate, type VideoRecord } from './api';
import BrandingPanel from './branding-panel';
import { FONT_OPTIONS } from './constants';
import { Icon } from './section-icon';
import VideoPoster, { brandFont } from './video-poster';
import type { SharedLibraries } from './video-workspace';

interface BrandViewProps {
    videos: VideoRecord[];
    selected: VideoRecord | null;
    libraries: SharedLibraries;
    onSelectVideo: (id: string | null) => void;
    onUpdated: (video: VideoRecord) => void;
}

const FONT_LABEL = Object.fromEntries(FONT_OPTIONS.map((option) => [option.value, option.label.split(' (')[0]]));

// A brand template drawn as a frame: its colours, logo and typeface.
function BrandFrame({ branding, name }: { branding: Branding; name: string }) {
    return (
        <div
            className="relative aspect-[9/16] w-full overflow-hidden rounded-lg ring-1 ring-inset ring-white/10"
            style={{ backgroundColor: branding.primary_color }}
            aria-hidden="true"
        >
            <div className="absolute inset-0 bg-[radial-gradient(120%_70%_at_50%_0%,rgba(255,255,255,0.16),transparent_60%)]" />
            {branding.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL, not a static asset.
                <img src={branding.logo_url} alt="" className="absolute right-[8%] top-[6%] h-[9%] w-auto max-w-[36%] object-contain" />
            )}
            <div className="absolute inset-x-[8%] top-1/3 text-center" style={{ color: branding.secondary_color, fontFamily: brandFont(branding) }}>
                <p className="text-3xl font-bold leading-none">Aa</p>
                <p className="mt-2 line-clamp-2 text-[0.6875rem] font-semibold leading-tight">{name}</p>
            </div>
            <div className="absolute inset-x-0 bottom-0 flex h-[12%]">
                <span className="flex-1" style={{ backgroundColor: branding.primary_color, filter: 'brightness(0.8)' }} />
                <span className="flex-1" style={{ backgroundColor: branding.secondary_color }} />
            </div>
        </div>
    );
}

export default function BrandView({ videos, selected, libraries, onSelectVideo, onUpdated }: BrandViewProps) {
    const [applyingId, setApplyingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [error, setError] = useState('');
    const templates = libraries.brandTemplates;
    // Same rule as the workspace: a brand edit on a video already in review
    // sends it back to draft, and that is said out loud.
    const [draftNoticeFor, setDraftNoticeFor] = useState<string | null>(null);

    function handleEdited(updated: VideoRecord) {
        if (selected && updated.id === selected.id && updated.status !== selected.status && updated.status === 'borrador') {
            setDraftNoticeFor(updated.id);
        }
        onUpdated(updated);
    }
    const showDraftNotice = selected !== null && draftNoticeFor === selected.id && selected.status === 'borrador';

    async function handleApply(template: BrandTemplate) {
        if (!selected) return;
        setApplyingId(template.id);
        setError('');
        try {
            handleEdited(await applyBrandTemplate(selected.id, template.id));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo aplicar la plantilla de marca.');
        } finally {
            setApplyingId(null);
        }
    }

    async function handleDelete(template: BrandTemplate) {
        const confirmed = window.confirm(`Se eliminará la plantilla de marca "${template.name}". ¿Continuar?`);
        if (!confirmed) return;
        setDeletingId(template.id);
        setError('');
        try {
            await deleteBrandTemplate(template.id);
            libraries.onBrandTemplatesChanged((current) => current.filter((item) => item.id !== template.id));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo eliminar la plantilla de marca.');
        } finally {
            setDeletingId(null);
        }
    }

    return (
        <div className="enter space-y-5">
            <header className="min-w-0">
                <p className="eyebrow mb-1.5">Marca</p>
                <h1 className="text-2xl font-semibold tracking-[-0.025em] text-white sm:text-[1.75rem]">Identidad visual</h1>
                <p className="mt-1 max-w-2xl text-sm text-slate-400">
                    Las plantillas de marca guardan logo, colores y tipografía para aplicarlos a cualquier video. La marca se guarda por video.
                </p>
            </header>

            <section className="panel panel-pad" aria-labelledby="brand-gallery-title">
                <div className="panel-head">
                    <div className="min-w-0">
                        <h2 id="brand-gallery-title" className="panel-title">Plantillas de marca</h2>
                        <p className="hint">
                            {selected
                                ? <>«Aplicar» la usa en <span className="text-slate-200">{selected.topic}</span>.</>
                                : 'Elige un video abajo para poder aplicarlas.'}
                        </p>
                    </div>
                    <span className="chip font-mono tabular-nums">{templates.length}</span>
                </div>

                {error && <p className="alert alert-error mb-4" role="alert">{error}</p>}
                {libraries.brandTemplatesError && (
                    <div className="alert alert-error mb-4 flex flex-wrap items-center justify-between gap-2" role="alert">
                        <span className="min-w-0">{libraries.brandTemplatesError}</span>
                        <button type="button" onClick={libraries.onRetryBrandTemplates} disabled={libraries.brandTemplatesLoading} className="btn btn-secondary btn-sm">
                            Reintentar
                        </button>
                    </div>
                )}

                {libraries.brandTemplatesLoading && templates.length === 0 ? (
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" aria-hidden="true">
                        {[0, 1, 2].map((key) => <div key={key} className="skeleton aspect-[9/16] w-full rounded-lg" />)}
                    </div>
                ) : templates.length === 0 ? (
                    !libraries.brandTemplatesError && (
                        <p className="rounded-lg border border-dashed border-white/[0.12] px-4 py-8 text-center text-sm text-slate-400">
                            Todavía no hay plantillas. Ajusta la marca de un video abajo y pulsa «Guardar como plantilla».
                        </p>
                    )
                ) : (
                    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                        {templates.map((template) => (
                            <li key={template.id} className="tile flex flex-col p-2.5">
                                <BrandFrame branding={template.branding} name={template.name} />
                                <p className="mt-2.5 truncate text-sm font-medium text-slate-100" title={template.name}>{template.name}</p>
                                <p className="mt-1 flex items-center gap-1.5 font-mono text-[0.625rem] uppercase text-slate-400">
                                    <span className="h-2.5 w-2.5 rounded-full ring-1 ring-white/20" style={{ backgroundColor: template.branding.primary_color }} aria-hidden="true" />
                                    {template.branding.primary_color}
                                    <span className="h-2.5 w-2.5 rounded-full ring-1 ring-white/20" style={{ backgroundColor: template.branding.secondary_color }} aria-hidden="true" />
                                    {template.branding.secondary_color}
                                </p>
                                <p className="mt-0.5 text-[0.6875rem] text-slate-500">{FONT_LABEL[template.branding.font_family] ?? template.branding.font_family}</p>
                                <div className="mt-2.5 flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => { void handleApply(template); }}
                                        disabled={!selected || applyingId === template.id}
                                        aria-label={selected ? `Aplicar la plantilla ${template.name} a ${selected.topic}` : `Aplicar la plantilla ${template.name} (elige un video primero)`}
                                        className="btn btn-primary btn-sm flex-1"
                                    >
                                        {applyingId === template.id ? 'Aplicando...' : 'Aplicar'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { void handleDelete(template); }}
                                        disabled={deletingId === template.id}
                                        aria-label={`Eliminar la plantilla ${template.name}`}
                                        title="Eliminar plantilla"
                                        className="btn-icon btn-icon-danger"
                                    >
                                        <Icon name="trash" />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section aria-labelledby="brand-editor-title" className="space-y-4">
                <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
                    <div className="min-w-0 flex-1">
                        <h2 id="brand-editor-title" className="panel-title mb-2">Marca de un video</h2>
                        <label htmlFor="brand-video-picker" className="label">Video</label>
                        <select
                            id="brand-video-picker"
                            value={selected?.id ?? ''}
                            onChange={(event) => onSelectVideo(event.target.value || null)}
                            className="field"
                        >
                            <option value="">Elige un video…</option>
                            {videos.map((video) => (
                                <option key={video.id} value={video.id}>{video.topic}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {showDraftNotice && (
                    <div className="alert alert-warning flex items-start justify-between gap-3" role="status">
                        <span className="min-w-0">El video volvió a borrador: hay que aprobarlo de nuevo.</span>
                        <button type="button" onClick={() => setDraftNoticeFor(null)} aria-label="Cerrar aviso" className="btn-icon -my-1 shrink-0">
                            <Icon name="close" size={14} />
                        </button>
                    </div>
                )}

                {selected ? (
                    <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-[minmax(0,1fr)_13rem]">
                        <BrandingPanel
                            key={selected.id}
                            video={selected}
                            onUpdated={handleEdited}
                            templates={libraries.brandTemplates}
                            templatesLoading={libraries.brandTemplatesLoading}
                            templatesError={libraries.brandTemplatesError}
                            onTemplatesChanged={libraries.onBrandTemplatesChanged}
                            onRetryTemplates={libraries.onRetryBrandTemplates}
                        />
                        <aside className="panel p-3 md:sticky md:top-20" aria-label="Vista previa de la marca">
                            <p className="eyebrow mb-2 px-1">Vista previa guardada</p>
                            <VideoPoster video={selected} className="hud-frame mx-auto w-full max-w-[11rem] md:max-w-none" />
                            <p className="hint mt-2 px-1">Refleja la marca guardada en el video. Guarda los cambios para verlos aquí.</p>
                        </aside>
                    </div>
                ) : (
                    <p className="panel px-4 py-10 text-center text-sm text-slate-400">
                        Elige un video para editar su logo, colores y tipografía.
                    </p>
                )}
            </section>
        </div>
    );
}
