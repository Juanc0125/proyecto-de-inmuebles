'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import type { SoundAsset } from '@shared-types/sounds';
import type { BrandTemplate } from '@shared-types/templates';
import type { VideoRecord } from './api';
import { PLATFORM_LABELS, TEMPLATE_TEXT } from './constants';
import StatusBadge from './status-badge';
import ScriptPanel from './script-panel';
import ScenePanel from './scene-panel';
import BrandingPanel from './branding-panel';
import StatusPanel from './status-panel';
import SoundPanel from './sound-panel';
import ExportPanel from './export-panel';
import VideoPoster from './video-poster';
import { Icon, type SectionIconName } from './section-icon';
import { formatClock, scenesSeconds } from './studio-utils';

// The sound list and the brand templates are owned by the shell now (the
// Marca and Sonidos sections show the same lists), which keeps the reason
// they were lifted out of the panels: a save that changes the brand
// mid-request cannot lose the template it was creating, and a sound uploaded
// in one place is offered everywhere without a second fetch.
export interface SharedLibraries {
    sounds: SoundAsset[];
    soundsLoading: boolean;
    soundsError: string;
    onSoundsChanged: Dispatch<SetStateAction<SoundAsset[]>>;
    brandTemplates: BrandTemplate[];
    brandTemplatesLoading: boolean;
    brandTemplatesError: string;
    onBrandTemplatesChanged: Dispatch<SetStateAction<BrandTemplate[]>>;
    onRetryBrandTemplates: () => void;
}

interface VideoWorkspaceProps {
    video: VideoRecord;
    libraries: SharedLibraries;
    onUpdated: (video: VideoRecord) => void;
    onDuplicated: (video: VideoRecord) => void;
}

// Content edits on a video already sent to approval (or approved, or
// published) send it back to draft on the server. Said out loud, because the
// status badge changing on its own reads as a glitch.
const BACK_TO_DRAFT_NOTICE = 'El video volvió a borrador: hay que aprobarlo de nuevo.';

const JUMPS: { id: string; label: string; icon: SectionIconName }[] = [
    { id: 'guion', label: 'Guion', icon: 'script' },
    { id: 'escenas', label: 'Storyboard', icon: 'scenes' },
    { id: 'sonido', label: 'Sonido', icon: 'sound' },
    { id: 'marca', label: 'Marca', icon: 'brand' },
    { id: 'aprobacion', label: 'Aprobación', icon: 'shield' },
    { id: 'exportar', label: 'Exportar', icon: 'export' },
];

// In-page jumps are buttons, not #anchors: the hash is the shell's router.
function jumpTo(id: string) {
    const target = document.getElementById(`ws-${id}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
}

export default function VideoWorkspace({ video, libraries, onUpdated, onDuplicated }: VideoWorkspaceProps) {
    // Tied to the video it is about, so switching videos hides it.
    const [notice, setNotice] = useState<{ videoId: string; text: string } | null>(null);

    // Read-only progress strip: where this video sits in guion -> escenas ->
    // aprobacion -> video. Derived from the record; it has no controls, so it
    // cannot move a video forward on its own (RF-012).
    const approved = video.status === 'aprobado' || video.status === 'publicado';
    const steps = [
        { label: 'Guion', done: video.script.trim() !== '' },
        { label: 'Escenas', done: video.scenes.length > 0 },
        { label: 'Aprobación', done: approved },
        { label: 'Video', done: Boolean(video.video_url) },
    ];
    // The first step not yet done is "where you are": highlighted, not clickable.
    const currentIndex = steps.findIndex((step) => !step.done);

    // For the editing panels only. The approval panel's own "reject" also
    // lands in draft, but there the operator asked for exactly that.
    const previousStatus = video.status;
    function handleEdited(updated: VideoRecord) {
        if (updated.id === video.id && updated.status !== previousStatus && updated.status === 'borrador') {
            setNotice({ videoId: updated.id, text: BACK_TO_DRAFT_NOTICE });
        }
        onUpdated(updated);
    }
    // Once it is back in approval there is nothing left to warn about.
    const visibleNotice = notice && notice.videoId === video.id && video.status === 'borrador' ? notice.text : '';
    const seconds = scenesSeconds(video);

    return (
        <div key={video.id} className="enter space-y-5">
            <header className="panel relative overflow-hidden">
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgba(34,211,238,0.14),transparent)]"
                />
                <div className="panel-pad relative">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <p className="eyebrow mb-2">Video en edición</p>
                            <h2 className="text-balance break-words text-xl font-semibold leading-tight tracking-[-0.025em] text-white sm:text-[1.625rem]">{video.topic}</h2>
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                                <span className="chip">{PLATFORM_LABELS[video.platform]}</span>
                                <span className="chip font-mono tabular-nums">Objetivo {formatClock(video.target_duration_seconds)}</span>
                                {seconds > 0 && <span className="chip font-mono tabular-nums">Real {formatClock(seconds)}</span>}
                                <span className="chip tabular-nums">
                                    {video.scenes.length} {video.scenes.length === 1 ? 'escena' : 'escenas'}
                                </span>
                                <span className="chip">Plantilla: {TEMPLATE_TEXT[video.template]?.label ?? video.template}</span>
                            </div>
                        </div>
                        <StatusBadge status={video.status} />
                    </div>
                </div>
                <ol className="relative grid grid-cols-4 border-t border-white/[0.06] bg-ink-950/30" aria-label="Avance del video">
                    {steps.map((step, index) => {
                        const current = index === currentIndex;
                        return (
                            <li
                                key={step.label}
                                aria-current={current ? 'step' : undefined}
                                className={`relative min-w-0 px-2 py-3 sm:px-5 ${index > 0 ? 'border-l border-white/[0.06]' : ''}`}
                            >
                                <span
                                    aria-hidden="true"
                                    className={`absolute inset-x-0 top-0 h-0.5 transition-colors duration-500 ${
                                        step.done ? 'bg-gradient-to-r from-brand-400 to-accent-400' : current ? 'bg-brand-400/35' : 'bg-transparent'
                                    }`}
                                />
                                <span className="flex min-w-0 items-center gap-2">
                                    <span
                                        aria-hidden="true"
                                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[0.625rem] font-semibold transition-colors duration-300 ${
                                            step.done
                                                ? 'bg-brand-400 text-ink-950'
                                                : current
                                                    ? 'bg-brand-500/15 text-brand-200 ring-1 ring-inset ring-brand-400/50'
                                                    : 'bg-white/[0.05] text-slate-400 ring-1 ring-inset ring-white/10'
                                        }`}
                                    >
                                        {step.done ? <Icon name="check" size={10} strokeWidth={3.5} /> : index + 1}
                                    </span>
                                    <span className={`truncate text-[0.6875rem] font-medium sm:text-xs ${step.done || current ? 'text-slate-100' : 'text-slate-400'}`}>
                                        <span className="sr-only">{step.done ? 'Completado: ' : current ? 'Paso actual: ' : 'Pendiente: '}</span>
                                        {step.label}
                                    </span>
                                </span>
                            </li>
                        );
                    })}
                </ol>
            </header>

            {/* Jump bar: sticks under the top bar so a long workspace stays
                navigable. Scrolls sideways on phones instead of wrapping. */}
            <nav aria-label="Secciones del video" className="glass sticky top-[3.75rem] z-10 -mx-1 rounded-xl border border-white/[0.06] px-1">
                <ul className="thin-scroll flex gap-1 overflow-x-auto py-1">
                    {JUMPS.map((jump) => (
                        <li key={jump.id} className="shrink-0">
                            <button type="button" onClick={() => jumpTo(jump.id)} className="btn btn-ghost btn-sm">
                                <Icon name={jump.icon} size={14} className="text-slate-500" />
                                {jump.label}
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>

            {visibleNotice && (
                <div className="alert alert-warning flex items-start justify-between gap-3" role="status">
                    <span className="min-w-0">{visibleNotice}</span>
                    <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso" className="btn-icon -my-1 shrink-0">
                        <Icon name="close" size={14} />
                    </button>
                </div>
            )}

            <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-[minmax(0,1fr)_13rem]">
                <div id="ws-guion" tabIndex={-1} className="min-w-0 scroll-mt-32 outline-none">
                    {/* The script panel seeds its textarea from the record when
                        it mounts. The copilot can change the same video from
                        outside, so the key gives it fresh initial state when
                        the script actually changed - without it the textarea
                        keeps the old script. The branding panel does the same
                        reseeding inside itself, because remounting it would
                        also drop its template list mid-save. */}
                    <ScriptPanel key={`guion:${video.script}`} video={video} onUpdated={handleEdited} />
                </div>
                <PreviewMonitor video={video} />
            </div>

            <div id="ws-escenas" tabIndex={-1} className="scroll-mt-32 outline-none">
                <ScenePanel video={video} sounds={libraries.sounds} soundsLoading={libraries.soundsLoading} onUpdated={handleEdited} />
            </div>
            <div id="ws-sonido" tabIndex={-1} className="scroll-mt-32 outline-none">
                <SoundPanel
                    video={video}
                    sounds={libraries.sounds}
                    soundsLoading={libraries.soundsLoading}
                    soundsError={libraries.soundsError}
                    onSoundsChanged={libraries.onSoundsChanged}
                    onUpdated={handleEdited}
                />
            </div>
            <div id="ws-marca" tabIndex={-1} className="scroll-mt-32 outline-none">
                <BrandingPanel
                    video={video}
                    onUpdated={handleEdited}
                    templates={libraries.brandTemplates}
                    templatesLoading={libraries.brandTemplatesLoading}
                    templatesError={libraries.brandTemplatesError}
                    onTemplatesChanged={libraries.onBrandTemplatesChanged}
                    onRetryTemplates={libraries.onRetryBrandTemplates}
                />
            </div>
            <div id="ws-aprobacion" tabIndex={-1} className="scroll-mt-32 outline-none">
                <StatusPanel video={video} onUpdated={onUpdated} onDuplicated={onDuplicated} />
            </div>
            <div id="ws-exportar" tabIndex={-1} className="scroll-mt-32 outline-none">
                <ExportPanel video={video} />
            </div>
        </div>
    );
}

// The real MP4 once it exists; until then a sketch drawn from the record
// (brand colours, first scene), labelled as such so nobody mistakes it for
// the render.
function PreviewMonitor({ video }: { video: VideoRecord }) {
    return (
        <aside className="panel p-3 md:sticky md:top-[7.5rem]" aria-label="Vista previa">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <p className="eyebrow">Monitor</p>
                <span className={`flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-wider ${video.video_url ? 'text-emerald-300' : 'text-slate-500'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${video.video_url ? 'bg-emerald-400' : 'bg-slate-500'}`} aria-hidden="true" />
                    {video.video_url ? 'MP4' : 'Boceto'}
                </span>
            </div>
            <div className="hud-frame mx-auto w-full max-w-[11rem] md:max-w-none">
                {video.video_url ? (
                    <video
                        key={video.video_url}
                        controls
                        playsInline
                        preload="metadata"
                        src={video.video_url}
                        aria-label={`Video final de ${video.topic}`}
                        className="aspect-[9/16] w-full rounded-lg border border-white/10 bg-black object-cover"
                    />
                ) : (
                    <VideoPoster video={video} className="w-full" />
                )}
            </div>
            <p className="hint mt-2 px-1">
                {video.video_url
                    ? 'Archivo final generado por el servidor.'
                    : 'Boceto con tu marca y la primera escena. El video real se genera tras la aprobación.'}
            </p>
        </aside>
    );
}
