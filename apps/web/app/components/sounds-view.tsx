'use client';

import type { VideoRecord } from './api';
import { BusinessSounds } from './sound-panel';
import SectionIcon, { Icon } from './section-icon';
import type { SharedLibraries } from './video-workspace';

interface SoundsViewProps {
    videos: VideoRecord[];
    libraries: SharedLibraries;
    onUpdated: (video: VideoRecord) => void;
}

// Background music was dropped: this section only holds the per-scene
// effects. A music track still in the library or uploaded earlier is not
// offered anywhere, so it is not listed either.
export default function SoundsView({ videos, libraries, onUpdated }: SoundsViewProps) {
    const { sounds, soundsLoading, soundsError } = libraries;

    // How many videos use each effect in some scene: worth knowing before
    // deleting one.
    const usage = new Map<string, number>();
    for (const video of videos) {
        const used = new Set<string>();
        for (const scene of video.scenes) if (scene.sound_effect_id) used.add(scene.sound_effect_id);
        for (const id of used) usage.set(id, (usage.get(id) ?? 0) + 1);
    }

    const shown = sounds.filter((sound) => sound.kind === 'efecto');

    return (
        <div className="enter space-y-5">
            <header className="min-w-0">
                <p className="eyebrow mb-1.5">Efectos</p>
                <h1 className="text-2xl font-semibold tracking-[-0.025em] text-white sm:text-[1.75rem]">Efectos de sonido</h1>
                <p className="mt-1 max-w-2xl text-sm text-slate-400">
                    La biblioteca del proyecto y los efectos del negocio. Cada escena elige su efecto en el Storyboard del Estudio.
                </p>
            </header>

            {soundsError && <p className="alert alert-error" role="alert">{soundsError}</p>}

            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                <section className="panel panel-pad" aria-labelledby="sound-catalog-title">
                    <div className="panel-head">
                        <div className="panel-head-main min-w-[13rem]">
                            <SectionIcon name="sound" />
                            <div className="min-w-0">
                                <h2 id="sound-catalog-title" className="panel-title">Catálogo</h2>
                                <p className="hint">Escucha cualquier efecto antes de usarlo.</p>
                            </div>
                        </div>
                    </div>

                    {soundsLoading && sounds.length === 0 ? (
                        <div className="space-y-2" aria-hidden="true">
                            <div className="skeleton h-20 w-full" />
                            <div className="skeleton h-20 w-full" />
                        </div>
                    ) : shown.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-white/[0.12] px-4 py-8 text-center text-sm text-slate-400">
                            Todavía no hay efectos de sonido.
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {shown.map((sound) => {
                                const count = usage.get(sound.id) ?? 0;
                                return (
                                    <li key={sound.id} className="tile px-3.5 py-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-500/10 text-accent-300 ring-1 ring-inset ring-accent-400/25" aria-hidden="true">
                                                <Icon name="bolt" size={14} />
                                            </span>
                                            <span className="min-w-[9rem] flex-1 truncate text-sm font-medium text-slate-100" title={sound.name}>{sound.name}</span>
                                            <span className="chip px-2 text-[0.6875rem]">{sound.origin === 'subido' ? 'Subido' : 'Biblioteca'}</span>
                                            <span className="font-mono text-[0.6875rem] tabular-nums text-slate-500">
                                                {count === 0 ? 'sin uso' : `${count} ${count === 1 ? 'video' : 'videos'}`}
                                            </span>
                                        </div>
                                        <audio controls preload="none" src={sound.url} aria-label={`Escuchar ${sound.name}`} className="mt-2 h-9 w-full" />
                                        <p className="mt-1 truncate text-xs text-slate-500" title={sound.license}>Licencia: {sound.license}</p>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>

                <div className="space-y-5">
                    <section className="panel panel-pad" aria-label="Subir efectos del negocio">
                        <BusinessSounds standalone sounds={sounds} onSoundsChanged={libraries.onSoundsChanged} onUpdated={onUpdated} />
                    </section>
                </div>
            </div>
        </div>
    );
}
