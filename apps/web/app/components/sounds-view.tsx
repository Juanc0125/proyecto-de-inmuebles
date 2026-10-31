'use client';

import { useState } from 'react';
import type { SoundKind } from '@shared-types/sounds';
import type { VideoRecord } from './api';
import { BusinessSounds, KIND_LABELS, MusicPicker } from './sound-panel';
import SectionIcon, { Icon } from './section-icon';
import type { SharedLibraries } from './video-workspace';

interface SoundsViewProps {
    videos: VideoRecord[];
    selected: VideoRecord | null;
    libraries: SharedLibraries;
    onSelectVideo: (id: string | null) => void;
    onUpdated: (video: VideoRecord) => void;
}

type KindFilter = SoundKind | 'todos';

export default function SoundsView({ videos, selected, libraries, onSelectVideo, onUpdated }: SoundsViewProps) {
    const [kind, setKind] = useState<KindFilter>('todos');
    const [draftNoticeFor, setDraftNoticeFor] = useState<string | null>(null);
    const { sounds, soundsLoading, soundsError } = libraries;

    // How many videos use each sound, as music or as a scene effect: worth
    // knowing before deleting one.
    const usage = new Map<string, number>();
    for (const video of videos) {
        const used = new Set<string>();
        if (video.music_id) used.add(video.music_id);
        for (const scene of video.scenes) if (scene.sound_effect_id) used.add(scene.sound_effect_id);
        for (const id of used) usage.set(id, (usage.get(id) ?? 0) + 1);
    }

    const shown = sounds.filter((sound) => kind === 'todos' || sound.kind === kind);

    function handleEdited(updated: VideoRecord) {
        if (selected && updated.id === selected.id && updated.status !== selected.status && updated.status === 'borrador') {
            setDraftNoticeFor(updated.id);
        }
        onUpdated(updated);
    }
    const showDraftNotice = selected !== null && draftNoticeFor === selected.id && selected.status === 'borrador';

    return (
        <div className="enter space-y-5">
            <header className="min-w-0">
                <p className="eyebrow mb-1.5">Sonidos</p>
                <h1 className="text-2xl font-semibold tracking-[-0.025em] text-white sm:text-[1.75rem]">Música y efectos</h1>
                <p className="mt-1 max-w-2xl text-sm text-slate-400">
                    La biblioteca del proyecto y los audios del negocio. La música se elige por video; los efectos, por escena en el Estudio.
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
                                <p className="hint">Escucha cualquier sonido antes de usarlo.</p>
                            </div>
                        </div>
                        <div role="group" aria-label="Tipo de sonido" className="segmented">
                            {(['todos', 'musica', 'efecto'] as KindFilter[]).map((value) => (
                                <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>
                                    {value === 'todos' ? 'Todos' : value === 'musica' ? 'Música' : 'Efectos'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {soundsLoading && sounds.length === 0 ? (
                        <div className="space-y-2" aria-hidden="true">
                            <div className="skeleton h-20 w-full" />
                            <div className="skeleton h-20 w-full" />
                        </div>
                    ) : shown.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-white/[0.12] px-4 py-8 text-center text-sm text-slate-400">
                            No hay sonidos de este tipo.
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {shown.map((sound) => {
                                const count = usage.get(sound.id) ?? 0;
                                return (
                                    <li key={sound.id} className="tile px-3.5 py-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${
                                                sound.kind === 'musica' ? 'bg-brand-500/10 text-brand-300 ring-brand-400/25' : 'bg-accent-500/10 text-accent-300 ring-accent-400/25'
                                            }`} aria-hidden="true">
                                                <Icon name={sound.kind === 'musica' ? 'sound' : 'bolt'} size={14} />
                                            </span>
                                            <span className="min-w-[9rem] flex-1 truncate text-sm font-medium text-slate-100" title={sound.name}>{sound.name}</span>
                                            <span className="chip px-2 text-[0.6875rem]">{KIND_LABELS[sound.kind]}</span>
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
                    <section className="panel panel-pad" aria-labelledby="sound-music-title">
                        <h2 id="sound-music-title" className="panel-title mb-3">Música de un video</h2>
                        <label htmlFor="sound-video-picker" className="label">Video</label>
                        <select
                            id="sound-video-picker"
                            value={selected?.id ?? ''}
                            onChange={(event) => onSelectVideo(event.target.value || null)}
                            className="field mb-4"
                        >
                            <option value="">Elige un video…</option>
                            {videos.map((video) => (
                                <option key={video.id} value={video.id}>{video.topic}</option>
                            ))}
                        </select>
                        {showDraftNotice && (
                            <p className="alert alert-warning mb-3" role="status">El video volvió a borrador: hay que aprobarlo de nuevo.</p>
                        )}
                        {selected ? (
                            // Keyed by the stored choice, as in the workspace:
                            // the picker holds a candidate for listening.
                            <MusicPicker
                                key={`musica:${selected.id}:${selected.music_id ?? ''}`}
                                video={selected}
                                sounds={sounds}
                                soundsLoading={soundsLoading}
                                onUpdated={handleEdited}
                            />
                        ) : (
                            <p className="hint">Elige un video para escuchar y cambiar su música de fondo.</p>
                        )}
                    </section>

                    <section className="panel panel-pad" aria-label="Subir sonidos del negocio">
                        <BusinessSounds standalone sounds={sounds} onSoundsChanged={libraries.onSoundsChanged} onUpdated={onUpdated} />
                    </section>
                </div>
            </div>
        </div>
    );
}
