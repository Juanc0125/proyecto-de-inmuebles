'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import type { SoundAsset } from '@shared-types/sounds';
import {
    deleteSound, fetchVideos, registerSound, requestSoundUpload, uploadSoundFile,
    type VideoRecord,
} from './api';
import SectionIcon from './section-icon';

interface SoundPanelProps {
    sounds: SoundAsset[];
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

const fieldClass = 'field';

export default function SoundPanel({ sounds, soundsError, onSoundsChanged, onUpdated }: SoundPanelProps) {
    return (
        <section className="panel panel-pad">
            <div className="panel-head">
                <div className="panel-head-main">
                    <SectionIcon name="sound" />
                    <div className="min-w-0">
                        <h3 className="panel-title">Efectos de sonido</h3>
                        <p className="hint">Cada escena elige su efecto en el Storyboard. Aquí se suben los efectos propios del negocio.</p>
                    </div>
                </div>
            </div>
            {soundsError && <p className="alert alert-error mb-4" role="alert">{soundsError}</p>}

            <BusinessSounds
                sounds={sounds}
                onSoundsChanged={onSoundsChanged}
                onUpdated={onUpdated}
            />
        </section>
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
    const [file, setFile] = useState<File | null>(null);
    const [license, setLicense] = useState('');
    const [rightsConfirmed, setRightsConfirmed] = useState(false);
    const [step, setStep] = useState<UploadStep>(null);
    const [error, setError] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Background music was dropped: a music file uploaded earlier stays in
    // storage but is no longer offered anywhere.
    const uploaded = sounds.filter((sound) => sound.origin === 'subido' && sound.kind === 'efecto');
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
            const created = await registerSound(name.trim(), 'efecto', ticket.path, license.trim());
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
        // The server clears sound_effect_id wherever the sound was
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
            <h4 className="panel-title mb-1">Efectos del negocio</h4>
            <p className="panel-subtitle mb-4">
                Sube efectos propios para usarlos en las escenas de cualquier video. Solo audios que el negocio pueda usar
                comercialmente: el video es publicidad.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                    <label className="label" htmlFor="sound-name">Nombre</label>
                    <input
                        id="sound-name"
                        type="text"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Ej. Campana de la marca"
                        maxLength={80}
                        disabled={uploading}
                        className={fieldClass}
                    />
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
                    {step ? UPLOAD_STEP_LABELS[step] : 'Subir efecto'}
                </button>
                {!uploading && !canUpload && (
                    <span className="hint">Completa nombre, archivo y licencia, y marca la casilla.</span>
                )}
            </div>

            {error && <p className="alert alert-error mt-3" role="alert">{error}</p>}

            {uploaded.length === 0 ? (
                <p className="mt-4 rounded-xl border border-dashed border-white/[0.12] px-4 py-5 text-center text-sm text-slate-400">Todavía no hay efectos subidos por el negocio.</p>
            ) : (
                <ul className="mt-4 space-y-2">
                    {uploaded.map((sound) => (
                        <li key={sound.id} className="tile px-3.5 py-3">
                            <div className="flex items-center gap-2">
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
