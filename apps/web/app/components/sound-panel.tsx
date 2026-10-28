'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import type { SoundAsset, SoundKind } from '@shared-types/sounds';
import {
    deleteSound, fetchVideos, registerSound, requestSoundUpload, setVideoMusic, uploadSoundFile,
    type VideoRecord,
} from './api';
import SectionIcon from './section-icon';

interface SoundPanelProps {
    video: VideoRecord;
    sounds: SoundAsset[];
    soundsLoading: boolean;
    soundsError: string;
    onSoundsChanged: (update: (current: SoundAsset[]) => SoundAsset[]) => void;
    onUpdated: (video: VideoRecord) => void;
}

// Mirrors the types /api/sounds/upload-url accepts. The server still decides;
// this only keeps the file picker from offering the rest.
const ACCEPTED_AUDIO_TYPES = 'audio/mpeg,audio/mp3,audio/ogg,audio/wav,audio/x-wav,audio/wave,audio/mp4,audio/x-m4a,audio/aac,audio/webm,.mp3,.m4a,.wav,.ogg,.aac,.webm';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// Windows often reports an empty type for .m4a or .aac. Without one the
// server would reject the file and storage would keep it as octet-stream, so
// fill it in from the extension; a type the browser did report is kept.
const TYPE_BY_EXTENSION: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    aac: 'audio/aac',
    webm: 'audio/webm',
};

function withAudioType(file: File): File {
    if (file.type) return file;
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const type = TYPE_BY_EXTENSION[extension];
    return type ? new File([file], file.name, { type }) : file;
}

export const KIND_LABELS: Record<SoundKind, string> = {
    musica: 'Música',
    efecto: 'Efecto',
};

const fieldClass = 'field';

export default function SoundPanel({ video, sounds, soundsLoading, soundsError, onSoundsChanged, onUpdated }: SoundPanelProps) {
    return (
        <section className="panel panel-pad">
            <div className="panel-head">
                <div className="panel-head-main">
                    <SectionIcon name="sound" />
                    <div className="min-w-0">
                        <h3 className="panel-title">Música y sonidos</h3>
                        <p className="hint">La música de fondo de este video y los audios propios del negocio.</p>
                    </div>
                </div>
            </div>
            {soundsError && <p className="alert alert-error mb-4" role="alert">{soundsError}</p>}

            {/* Keyed by the stored choice: the picker holds a candidate in its
                own state for listening, and the copilot or a deleted sound can
                change music_id from outside. */}
            <MusicPicker
                key={`musica:${video.music_id ?? ''}`}
                video={video}
                sounds={sounds}
                soundsLoading={soundsLoading}
                onUpdated={onUpdated}
            />

            <BusinessSounds
                sounds={sounds}
                onSoundsChanged={onSoundsChanged}
                onUpdated={onUpdated}
            />
        </section>
    );
}

interface MusicPickerProps {
    video: VideoRecord;
    sounds: SoundAsset[];
    soundsLoading: boolean;
    onUpdated: (video: VideoRecord) => void;
}

export function MusicPicker({ video, sounds, soundsLoading, onUpdated }: MusicPickerProps) {
    const stored = video.music_id ?? '';
    // A candidate separate from the stored value so the person can listen to
    // a track before it becomes the video's music.
    const [candidate, setCandidate] = useState(stored);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const music = sounds.filter((sound) => sound.kind === 'musica');
    const library = music.filter((sound) => sound.origin === 'biblioteca');
    const uploaded = music.filter((sound) => sound.origin === 'subido');
    const selected = music.find((sound) => sound.id === candidate) ?? null;
    const candidateMissing = candidate !== '' && !selected;
    const dirty = candidate !== stored;

    async function handleApply() {
        setSaving(true);
        setError('');
        try {
            onUpdated(await setVideoMusic(video.id, candidate === '' ? null : candidate));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo guardar la música de fondo.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div>
            <label className="label" htmlFor={`music-${video.id}`}>Música de fondo</label>
            <div className="flex flex-wrap items-center gap-2">
                <select
                    id={`music-${video.id}`}
                    value={candidate}
                    onChange={(event) => setCandidate(event.target.value)}
                    disabled={saving}
                    className={`${fieldClass} min-w-0 flex-1`}
                >
                    <option value="">Sin música</option>
                    {candidateMissing && (
                        <option value={candidate} disabled>
                            {soundsLoading ? 'Cargando sonidos...' : 'Sonido no disponible'}
                        </option>
                    )}
                    {library.length > 0 && (
                        <optgroup label="Biblioteca">
                            {library.map((sound) => (
                                <option key={sound.id} value={sound.id}>{sound.name}</option>
                            ))}
                        </optgroup>
                    )}
                    {uploaded.length > 0 && (
                        <optgroup label="Subidos por el negocio">
                            {uploaded.map((sound) => (
                                <option key={sound.id} value={sound.id}>{sound.name}</option>
                            ))}
                        </optgroup>
                    )}
                </select>
                <button
                    type="button"
                    onClick={handleApply}
                    disabled={saving || !dirty}
                    className="btn btn-primary"
                >
                    {saving && <span className="spinner" aria-hidden="true" />}
                    {saving ? 'Guardando...' : candidate === '' ? 'Quitar música' : 'Usar esta música'}
                </button>
            </div>

            {selected ? (
                <div className="mt-2">
                    <audio
                        key={selected.id}
                        controls
                        preload="none"
                        src={selected.url}
                        aria-label={`Escuchar ${selected.name}`}
                        className="w-full"
                    />
                    <p className="hint mt-1.5">
                        Licencia: {selected.license}
                        {selected.source && (
                            <>
                                {' · '}
                                <a href={selected.source} target="_blank" rel="noreferrer" className="text-brand-300 underline-offset-2 hover:underline">
                                    Fuente
                                </a>
                            </>
                        )}
                    </p>
                </div>
            ) : (
                <p className="hint mt-1.5">
                    La música suena de fondo durante todo el video y baja sola cuando habla la voz.
                </p>
            )}
            {dirty && !saving && (
                <p className="mt-1.5 text-xs text-amber-200">Escúchala y pulsa el botón para aplicarla al video.</p>
            )}
            {error && <p className="alert alert-error mt-3" role="alert">{error}</p>}
        </div>
    );
}

interface BusinessSoundsProps {
    sounds: SoundAsset[];
    onSoundsChanged: (update: (current: SoundAsset[]) => SoundAsset[]) => void;
    onUpdated: (video: VideoRecord) => void;
    // In the Sonidos section it is a panel of its own, with nothing above
    // it to divide from.
    standalone?: boolean;
}

type UploadStep = 'preparing' | 'uploading' | 'registering' | null;

const UPLOAD_STEP_LABELS: Record<Exclude<UploadStep, null>, string> = {
    preparing: 'Preparando subida...',
    uploading: 'Subiendo archivo...',
    registering: 'Registrando sonido...',
};

export function BusinessSounds({ sounds, onSoundsChanged, onUpdated, standalone = false }: BusinessSoundsProps) {
    const [name, setName] = useState('');
    const [kind, setKind] = useState<SoundKind>('musica');
    const [file, setFile] = useState<File | null>(null);
    const [license, setLicense] = useState('');
    const [rightsConfirmed, setRightsConfirmed] = useState(false);
    const [step, setStep] = useState<UploadStep>(null);
    const [error, setError] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const uploaded = sounds.filter((sound) => sound.origin === 'subido');
    const uploading = step !== null;
    const canUpload = !uploading && name.trim() !== '' && file !== null && license.trim() !== '' && rightsConfirmed;

    function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
        const picked = event.target.files?.[0] ?? null;
        setError('');
        if (picked && picked.size > MAX_UPLOAD_BYTES) {
            setError('El archivo pesa más de 20 MB. Usa uno más liviano.');
            setFile(null);
            event.target.value = '';
            return;
        }
        setFile(picked ? withAudioType(picked) : null);
        // Saves typing: the file name is usually a fine starting label.
        if (picked && !name.trim()) setName(picked.name.replace(/\.[^.]+$/, '').slice(0, 80));
    }

    async function handleUpload() {
        if (!file || !canUpload) return;
        setError('');
        try {
            setStep('preparing');
            const ticket = await requestSoundUpload(file);
            setStep('uploading');
            await uploadSoundFile(ticket, file);
            setStep('registering');
            const created = await registerSound(name.trim(), kind, ticket.path, license.trim());
            onSoundsChanged((current) => [...current, created]);
            setName('');
            setFile(null);
            setLicense('');
            setRightsConfirmed(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo subir el sonido.');
        } finally {
            setStep(null);
        }
    }

    async function handleDelete(sound: SoundAsset) {
        const confirmed = window.confirm(
            `Se eliminará el sonido "${sound.name}". Los videos y escenas que lo usan se quedarán sin él. ¿Continuar?`,
        );
        if (!confirmed) return;

        setDeletingId(sound.id);
        setError('');
        try {
            await deleteSound(sound.id);
            onSoundsChanged((current) => current.filter((item) => item.id !== sound.id));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo eliminar el sonido.');
            setDeletingId(null);
            return;
        }
        // The server clears music_id / sound_effect_id wherever the sound was
        // used, in any video. Re-read the records instead of mirroring that
        // rule here, so every panel shows what the database holds. A failed
        // refresh is not a failed delete: the pickers already label an id
        // that is no longer in the list as unavailable.
        try {
            (await fetchVideos()).forEach(onUpdated);
        } catch {
            // Next list refresh catches up.
        } finally {
            setDeletingId(null);
        }
    }

    return (
        <div className={standalone ? '' : 'divider mt-6 pt-5'}>
            <h4 className="panel-title mb-1">Sonidos del negocio</h4>
            <p className="panel-subtitle mb-4">
                Sube música o efectos propios para usarlos en cualquier video. Solo audios que el negocio pueda usar
                comercialmente: el video es publicidad.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                    <label className="label" htmlFor="sound-name">Nombre</label>
                    <input
                        id="sound-name"
                        type="text"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Ej. Jingle de la marca"
                        maxLength={80}
                        disabled={uploading}
                        className={fieldClass}
                    />
                </div>
                <div>
                    <label className="label" htmlFor="sound-kind">Tipo</label>
                    <select
                        id="sound-kind"
                        value={kind}
                        onChange={(event) => setKind(event.target.value as SoundKind)}
                        disabled={uploading}
                        className={fieldClass}
                    >
                        <option value="musica">Música de fondo</option>
                        <option value="efecto">Efecto de sonido</option>
                    </select>
                </div>
                <div className="sm:col-span-2">
                    <label className="label" htmlFor="sound-file">Archivo de audio</label>
                    <input
                        id="sound-file"
                        ref={fileInputRef}
                        type="file"
                        accept={ACCEPTED_AUDIO_TYPES}
                        onChange={handleFileChange}
                        disabled={uploading}
                        className="file-input"
                    />
                    <p className="hint mt-1.5">MP3, M4A, WAV, OGG, AAC o WEBM. Máximo 20 MB.</p>
                </div>
                <div className="sm:col-span-2">
                    <label className="label" htmlFor="sound-license">
                        Licencia (obligatoria)
                    </label>
                    <input
                        id="sound-license"
                        type="text"
                        value={license}
                        onChange={(event) => setLicense(event.target.value)}
                        placeholder="Ej. Comprada en X con licencia comercial, o grabación propia"
                        maxLength={300}
                        required
                        disabled={uploading}
                        className={fieldClass}
                    />
                </div>
            </div>

            <label className="mt-4 flex items-start gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-sm text-slate-200" htmlFor="sound-rights">
                <input
                    id="sound-rights"
                    type="checkbox"
                    checked={rightsConfirmed}
                    onChange={(event) => setRightsConfirmed(event.target.checked)}
                    disabled={uploading}
                    className="checkbox"
                />
                <span>Confirmo que el negocio tiene derecho de uso comercial de este audio</span>
            </label>

            <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    onClick={handleUpload}
                    disabled={!canUpload}
                    className="btn btn-secondary"
                >
                    {step && <span className="spinner" aria-hidden="true" />}
                    {step ? UPLOAD_STEP_LABELS[step] : 'Subir sonido'}
                </button>
                {!uploading && !canUpload && (
                    <span className="hint">Completa nombre, archivo y licencia, y marca la casilla.</span>
                )}
            </div>

            {error && <p className="alert alert-error mt-3" role="alert">{error}</p>}

            {uploaded.length === 0 ? (
                <p className="mt-4 rounded-xl border border-dashed border-white/[0.12] px-4 py-5 text-center text-sm text-slate-400">Todavía no hay sonidos subidos por el negocio.</p>
            ) : (
                <ul className="mt-4 space-y-2">
                    {uploaded.map((sound) => (
                        <li key={sound.id} className="tile px-3.5 py-3">
                            <div className="flex items-center gap-2">
                                <span className="chip shrink-0 px-2 text-[11px]">
                                    {KIND_LABELS[sound.kind]}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-sm" title={sound.name}>{sound.name}</span>
                                <button
                                    type="button"
                                    onClick={() => handleDelete(sound)}
                                    disabled={deletingId === sound.id}
                                    aria-label={`Eliminar el sonido ${sound.name}`}
                                    title="Eliminar sonido"
                                    className="btn-icon btn-icon-danger"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                                        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
                                    </svg>
                                </button>
                            </div>
                            <audio
                                controls
                                preload="none"
                                src={sound.url}
                                aria-label={`Escuchar ${sound.name}`}
                                className="mt-2 h-9 w-full"
                            />
                            <p className="mt-1 truncate text-xs text-slate-400" title={sound.license}>Licencia: {sound.license}</p>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
