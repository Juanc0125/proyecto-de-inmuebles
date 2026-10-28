'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SoundAsset } from '@shared-types/sounds';
import type { BrandTemplate } from '@shared-types/templates';
import { fetchBrandTemplates, fetchSounds, type VideoRecord } from './api';
import { PLATFORM_LABELS } from './constants';
import StatusBadge from './status-badge';
import ScriptPanel from './script-panel';
import ScenePanel from './scene-panel';
import BrandingPanel from './branding-panel';
import StatusPanel from './status-panel';
import SoundPanel from './sound-panel';
import { LogoMark } from './logo';

interface VideoWorkspaceProps {
    video: VideoRecord | null;
    onUpdated: (video: VideoRecord) => void;
    onDuplicated: (video: VideoRecord) => void;
}

// Content edits on a video already sent to approval (or approved, or
// published) send it back to draft on the server. Said out loud, because the
// status badge changing on its own reads as a glitch.
const BACK_TO_DRAFT_NOTICE = 'El video volvió a borrador: hay que aprobarlo de nuevo.';

export default function VideoWorkspace({ video, onUpdated, onDuplicated }: VideoWorkspaceProps) {
    // RF-010: one sound list for the music picker, the per-scene effect
    // pickers and the business uploads, so a sound uploaded in one place is
    // offered in the others without a second fetch.
    const [sounds, setSounds] = useState<SoundAsset[]>([]);
    const [soundsLoading, setSoundsLoading] = useState(true);
    const [soundsError, setSoundsError] = useState('');

    const loadSounds = useCallback(async () => {
        try {
            setSounds(await fetchSounds());
            setSoundsError('');
        } catch (err) {
            setSoundsError(err instanceof Error ? err.message : 'No se pudieron cargar los sonidos.');
        } finally {
            setSoundsLoading(false);
        }
    }, []);

    useEffect(() => {
        // Deferred by a tick: the lint rule cannot tell that state only
        // changes once the fetch resolves.
        const timer = setTimeout(() => { void loadSounds(); }, 0);
        return () => clearTimeout(timer);
    }, [loadSounds]);

    // Brand templates live here rather than in the branding panel for the
    // same reason as the sounds, plus one: the panel's form follows the
    // video's brand, and saving a template first saves pending brand edits.
    // When the list lived in the panel, that save changed the brand
    // mid-request, the panel was rebuilt, and the new template (or its error)
    // landed in a component that no longer existed.
    const [brandTemplates, setBrandTemplates] = useState<BrandTemplate[]>([]);
    const [brandTemplatesLoading, setBrandTemplatesLoading] = useState(true);
    const [brandTemplatesError, setBrandTemplatesError] = useState('');

    const loadBrandTemplates = useCallback(async () => {
        try {
            setBrandTemplates(await fetchBrandTemplates());
            setBrandTemplatesError('');
        } catch (err) {
            setBrandTemplatesError(err instanceof Error ? err.message : 'No se pudieron cargar las plantillas de marca.');
        } finally {
            setBrandTemplatesLoading(false);
        }
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => { void loadBrandTemplates(); }, 0);
        return () => clearTimeout(timer);
    }, [loadBrandTemplates]);

    function retryBrandTemplates() {
        setBrandTemplatesLoading(true);
        setBrandTemplatesError('');
        void loadBrandTemplates();
    }

    // Tied to the video it is about, so switching videos hides it.
    const [notice, setNotice] = useState<{ videoId: string; text: string } | null>(null);

    if (!video) {
        return (
            <section className="panel enter relative overflow-hidden px-5 py-12 sm:px-10 sm:py-16">
                {/* Soft spotlight behind the hero. Decorative only. */}
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-72 max-w-2xl rounded-full bg-[radial-gradient(closest-side,rgba(99,102,241,0.28),transparent)] blur-2xl"
                />
                <div className="relative mx-auto max-w-4xl">
                    <div className="mb-12 text-center">
                        <div className="float-soft mx-auto mb-6 w-fit">
                            <LogoMark size={64} />
                        </div>
                        <p className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-xs font-medium text-slate-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                            Estudio de video con IA
                        </p>
                        <h2 className="text-gradient mx-auto mb-4 max-w-2xl text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[2.75rem]">
                            Convierte un tema en un video{' '}
                            <span className="text-gradient-brand pr-1 font-display text-[1.12em] font-normal italic tracking-[-0.01em]">listo para publicar</span>
                        </h2>
                        <p className="mx-auto max-w-xl text-pretty text-sm leading-relaxed text-slate-400 sm:text-base">
                            Stickman escribe la historia, la reparte en escenas, la narra en español y arma el MP4
                            vertical para Reels, TikTok o Shorts. Tú solo dices el tema.
                        </p>
                    </div>

                    <ol className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {[
                            { n: '01', t: 'Dices el tema', d: 'Hablas o escribes. Se genera un guion con forma de historia, no un folleto.' },
                            { n: '02', t: 'Se arma en escenas', d: 'Cada escena con su personaje, su acción y su objeto. Puedes editarlas o borrarlas.' },
                            { n: '03', t: 'Tú lo apruebas', d: 'Nada se publica sin que una persona lo revise. El asistente no puede saltarse este paso.' },
                            { n: '04', t: 'Sale el video', d: 'MP4 vertical con voz y subtítulos, listo para descargar o publicar.' },
                        ].map((step) => (
                            <li key={step.n} className="tile tile-hover group relative overflow-hidden p-5">
                                <span
                                    aria-hidden="true"
                                    className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-300/50 to-transparent opacity-40 transition-opacity duration-300 group-hover:opacity-100"
                                />
                                <span className="mb-4 block font-mono text-xs font-medium tracking-wider text-brand-300">{step.n}</span>
                                <h3 className="mb-1.5 text-sm font-semibold text-white">{step.t}</h3>
                                <p className="text-xs leading-relaxed text-slate-400">{step.d}</p>
                            </li>
                        ))}
                    </ol>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="tile p-5">
                            <h3 className="eyebrow mb-4">Pruébalo diciendo</h3>
                            <ul className="space-y-2">
                                {[
                                    'Crea un video sobre tasas fijas para TikTok',
                                    'Genera las escenas',
                                    'En la escena 2 que el broker camine con una casa',
                                    '¿Cuántos videos tengo pendientes?',
                                ].map((example) => (
                                    <li
                                        key={example}
                                        className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-ink-950/40 px-3 py-2 text-sm text-slate-200"
                                    >
                                        <svg className="mt-[3px] shrink-0 text-brand-300" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <rect x="9" y="3" width="6" height="11" rx="3" />
                                            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                                        </svg>
                                        <span>&ldquo;{example}&rdquo;</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="tile p-5">
                            <h3 className="eyebrow mb-4">También puedes</h3>
                            <ul className="space-y-3 text-sm text-slate-200">
                                {[
                                    'Editar el guion y cada escena a mano',
                                    'Poner tu logo, tus colores y tu tipografía',
                                    'Reutilizar un video para otra plataforma',
                                    'Descargar el MP4 o publicarlo',
                                ].map((item) => (
                                    <li key={item} className="flex items-start gap-2.5">
                                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300 ring-1 ring-inset ring-emerald-400/25" aria-hidden="true">
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="m5 12 5 5L20 7" />
                                            </svg>
                                        </span>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </section>
        );
    }

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
        if (updated.id === video?.id && updated.status !== previousStatus && updated.status === 'borrador') {
            setNotice({ videoId: updated.id, text: BACK_TO_DRAFT_NOTICE });
        }
        onUpdated(updated);
    }
    // Once it is back in approval there is nothing left to warn about.
    const visibleNotice = notice && notice.videoId === video.id && video.status === 'borrador' ? notice.text : '';

    return (
        <div key={video.id} className="enter space-y-5 sm:space-y-6">
            <header className="panel relative overflow-hidden">
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgba(154,92,246,0.2),transparent)]"
                />
                <div className="panel-pad relative">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <p className="eyebrow mb-2">Video seleccionado</p>
                            <h2 className="text-balance break-words text-2xl font-semibold leading-tight tracking-[-0.025em] text-white sm:text-[1.75rem]">{video.topic}</h2>
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                                <span className="chip">{PLATFORM_LABELS[video.platform]}</span>
                                <span className="chip tabular-nums">Duración objetivo: {video.target_duration_seconds}s</span>
                                <span className="chip tabular-nums">
                                    {video.scenes.length} {video.scenes.length === 1 ? 'escena' : 'escenas'}
                                </span>
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
                                className={`relative min-w-0 px-2 py-3 sm:px-5 sm:py-4 ${index > 0 ? 'border-l border-white/[0.06]' : ''}`}
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
                                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-semibold transition-colors duration-300 ${
                                            step.done
                                                ? 'bg-brand-500 text-white'
                                                : current
                                                    ? 'bg-brand-500/15 text-brand-200 ring-1 ring-inset ring-brand-400/50'
                                                    : 'bg-white/[0.05] text-slate-400 ring-1 ring-inset ring-white/10'
                                        }`}
                                    >
                                        {step.done ? (
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="m5 12 5 5L20 7" />
                                            </svg>
                                        ) : (
                                            index + 1
                                        )}
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

            {visibleNotice && (
                <div className="alert alert-warning flex items-start justify-between gap-3" role="status">
                    <span className="min-w-0">{visibleNotice}</span>
                    <button
                        type="button"
                        onClick={() => setNotice(null)}
                        aria-label="Cerrar aviso"
                        className="btn-icon -my-1 shrink-0"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                    </button>
                </div>
            )}

            {/* The script panel seeds its textarea from the record when it
                mounts. The copilot can change the same video from outside, so
                the key gives it fresh initial state when the script actually
                changed - without it the textarea keeps the old script. The
                branding panel does the same reseeding inside itself, because
                remounting it would also drop its template list mid-save. */}
            <ScriptPanel key={`guion:${video.script}`} video={video} onUpdated={handleEdited} />
            <ScenePanel video={video} sounds={sounds} soundsLoading={soundsLoading} onUpdated={handleEdited} />
            <SoundPanel
                video={video}
                sounds={sounds}
                soundsLoading={soundsLoading}
                soundsError={soundsError}
                onSoundsChanged={setSounds}
                onUpdated={handleEdited}
            />
            <BrandingPanel
                video={video}
                onUpdated={handleEdited}
                templates={brandTemplates}
                templatesLoading={brandTemplatesLoading}
                templatesError={brandTemplatesError}
                onTemplatesChanged={setBrandTemplates}
                onRetryTemplates={retryBrandTemplates}
            />
            <StatusPanel video={video} onUpdated={onUpdated} onDuplicated={onDuplicated} />
        </div>
    );
}
