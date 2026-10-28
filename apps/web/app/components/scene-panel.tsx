'use client';

import { useEffect, useState } from 'react';
import type { SoundAsset } from '@shared-types/sounds';
import type { CharacterType, Scene, SceneAction, ScenePropType } from '@shared-types/video';
import { deleteScene, generateScenes, generateVoice, regenerateScene, updateScene, type ScenePatch, type VideoRecord } from './api';
import { ACTION_OPTIONS, CHARACTER_OPTIONS, PROP_OPTIONS } from './constants';
import SectionIcon from './section-icon';
import Storyboard from './storyboard';

interface ScenePanelProps {
    video: VideoRecord;
    sounds: SoundAsset[];
    soundsLoading: boolean;
    onUpdated: (video: VideoRecord) => void;
}

export default function ScenePanel({ video, sounds, soundsLoading, onUpdated }: ScenePanelProps) {
    const [generatingAll, setGeneratingAll] = useState(false);
    const [generatingVoice, setGeneratingVoice] = useState(false);
    const [panelError, setPanelError] = useState('');
    const [voiceNotice, setVoiceNotice] = useState('');
    // The scene picked on the storyboard; its editor is scrolled to and
    // outlined. Only a highlight - no state is copied from it.
    const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
    const [pickSeq, setPickSeq] = useState(0);

    useEffect(() => {
        if (pickSeq === 0 || !activeSceneId) return;
        const row = document.getElementById(`scene-row-${activeSceneId}`);
        if (!row) return;
        const frame = requestAnimationFrame(() => {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [pickSeq, activeSceneId]);

    function pickScene(sceneId: string) {
        setActiveSceneId(sceneId);
        setPickSeq((current) => current + 1);
    }

    const effects = sounds.filter((sound) => sound.kind === 'efecto');
    const scenes = [...video.scenes].sort((a, b) => a.order - b.order);

    async function handleGenerateScenes() {
        if (scenes.length > 0) {
            const confirmed = window.confirm(
                'Ya existen escenas para este video (pueden tener ediciones manuales o audio generado). ' +
                'Generar de nuevo reemplazará TODAS las escenas actuales y se perderá lo anterior. ¿Deseas continuar?',
            );
            if (!confirmed) return;
        }

        setGeneratingAll(true);
        setPanelError('');
        setVoiceNotice('');
        try {
            const updated = await generateScenes(video.id);
            onUpdated(updated);
        } catch (err) {
            setPanelError(err instanceof Error ? err.message : 'No se pudieron generar las escenas.');
        } finally {
            setGeneratingAll(false);
        }
    }

    async function handleGenerateVoice() {
        setGeneratingVoice(true);
        setPanelError('');
        setVoiceNotice('');
        try {
            const result = await generateVoice(video.id);
            onUpdated(result.video);
            setVoiceNotice(
                result.ttsConfigured
                    ? 'Voz generada con el servicio externo. El video usará este audio en vez de la voz local.'
                    // Not a problem: the render worker narrates every scene with its own
                    // offline voice. The external service is only an alternative voice.
                    : 'No hace falta: el video ya se narra solo, con la voz en español del servidor de render. '
                      + 'Este botón sirve únicamente si configuras un servicio de voz externo (TTS_API_URL / TTS_API_KEY) '
                      + 'y prefieres esa voz a la incluida.',
            );
        } catch (err) {
            setPanelError(err instanceof Error ? err.message : 'No se pudo generar la voz.');
        } finally {
            setGeneratingVoice(false);
        }
    }

    return (
        <section className="panel panel-pad">
            <div className="panel-head">
                <div className="panel-head-main">
                    <SectionIcon name="scenes" />
                    <div className="min-w-0">
                        <h3 className="panel-title">Storyboard y escenas</h3>
                        <p className="hint">La secuencia completa arriba; personaje, acción, objeto y texto de cada escena abajo.</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={handleGenerateScenes}
                        disabled={generatingAll}
                        className="btn btn-secondary h-9 px-3.5"
                    >
                        {generatingAll && <span className="spinner" aria-hidden="true" />}
                        {generatingAll ? 'Generando escenas...' : scenes.length > 0 ? 'Regenerar todas las escenas' : 'Generar escenas'}
                    </button>
                    <button
                        type="button"
                        onClick={handleGenerateVoice}
                        disabled={generatingVoice || scenes.length === 0}
                        title="El video ya se narra solo. Usa esto solo si configuras un servicio de voz externo."
                        className="btn btn-ghost h-9 px-3.5"
                    >
                        {generatingVoice && <span className="spinner" aria-hidden="true" />}
                        {generatingVoice ? 'Generando voz...' : 'Voz externa (opcional)'}
                    </button>
                </div>
            </div>

            {panelError && <p className="alert alert-error mb-4" role="alert">{panelError}</p>}
            {voiceNotice && <p className="alert alert-info mb-4">{voiceNotice}</p>}

            {scenes.length === 0 ? (
                <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.012] px-4 py-10 text-center">
                    <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04] text-slate-400 ring-1 ring-inset ring-white/[0.08]" aria-hidden="true">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="16" rx="2.5" />
                            <path d="M3 9h18M8 4l-1.5 5M13.5 4 12 9M19 4l-1.5 5" />
                        </svg>
                    </span>
                    <p className="text-sm font-medium text-slate-200">Aún no hay escenas</p>
                    <p className="hint mt-1">Genera el guion y pulsa &quot;Generar escenas&quot;.</p>
                </div>
            ) : (
                <>
                    <Storyboard video={video} scenes={scenes} activeId={activeSceneId} onPick={pickScene} />
                    <ul className="space-y-3">
                        {scenes.map((scene, index) => (
                            // Keyed only by what the row copies into its own
                            // state (description and duration). Character,
                            // action, prop and effect are read straight from
                            // the record, so changing one of those selects
                            // must not remount the row and wipe a description
                            // the operator is still typing.
                            <SceneRow
                                key={`${scene.id}:${scene.description}:${scene.duration_seconds}`}
                                videoId={video.id}
                                scene={scene}
                                index={index}
                                effects={effects}
                                soundsLoading={soundsLoading}
                                active={scene.id === activeSceneId}
                                onUpdated={onUpdated}
                            />
                        ))}
                    </ul>
                </>
            )}
        </section>
    );
}

interface SceneRowProps {
    videoId: string;
    scene: Scene;
    index: number;
    effects: SoundAsset[];
    soundsLoading: boolean;
    active: boolean;
    onUpdated: (video: VideoRecord) => void;
}

function SceneRow({ videoId, scene, index, effects, soundsLoading, active, onUpdated }: SceneRowProps) {
    const [description, setDescription] = useState(scene.description);
    const [durationSeconds, setDurationSeconds] = useState(scene.duration_seconds);
    const [busyAction, setBusyAction] = useState<'select' | 'text' | 'regenerate' | 'delete' | null>(null);
    const [error, setError] = useState('');

    const busy = busyAction !== null;
    const effectId = scene.sound_effect_id ?? '';
    const selectedEffect = effects.find((effect) => effect.id === effectId) ?? null;
    const textDirty = description !== scene.description || durationSeconds !== scene.duration_seconds;

    async function applyPatch(patch: ScenePatch, mode: 'select' | 'text') {
        setBusyAction(mode);
        setError('');
        try {
            const updated = await updateScene(videoId, scene.id, patch);
            onUpdated(updated);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo actualizar la escena.');
        } finally {
            setBusyAction(null);
        }
    }

    async function handleCharacterChange(value: CharacterType) {
        await applyPatch({ character: value }, 'select');
    }

    async function handleActionChange(value: SceneAction) {
        await applyPatch({ action: value }, 'select');
    }

    async function handlePropChange(value: ScenePropType) {
        await applyPatch({ prop: value }, 'select');
    }

    async function handleEffectChange(value: string) {
        await applyPatch({ sound_effect_id: value === '' ? null : value }, 'select');
    }

    async function handleSaveText() {
        if (!description.trim()) {
            setError('La descripción no puede quedar vacía.');
            return;
        }
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
            setError('La duración debe ser un número positivo.');
            return;
        }
        await applyPatch({ description, duration_seconds: durationSeconds }, 'text');
    }

    async function handleDelete() {
        const confirmed = window.confirm(`Se eliminará la escena ${index + 1}. Las siguientes se renumeran. ¿Continuar?`);
        if (!confirmed) return;
        setBusyAction('delete');
        setError('');
        try {
            onUpdated(await deleteScene(videoId, scene.id));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo eliminar la escena.');
        } finally {
            setBusyAction(null);
        }
    }

    async function handleRegenerate() {
        setBusyAction('regenerate');
        setError('');
        try {
            const updated = await regenerateScene(videoId, scene.id);
            onUpdated(updated);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo regenerar la escena.');
        } finally {
            setBusyAction(null);
        }
    }

    return (
        // Focusable (not tabbable) so a pick on the storyboard can move the
        // keyboard here along with the scroll.
        <li
            id={`scene-row-${scene.id}`}
            tabIndex={-1}
            aria-label={`Escena ${index + 1}`}
            className={`tile tile-hover scroll-mt-24 p-3.5 outline-none sm:p-5 ${active ? 'border-brand-400/40 shadow-[0_0_0_1px_rgba(34,211,238,0.18)]' : ''}`}
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2.5 text-xs font-semibold text-slate-200">
                    <span className="flex h-7 min-w-[2.25rem] items-center justify-center rounded-md bg-brand-500/15 px-1.5 font-mono text-[0.6875rem] text-brand-100 ring-1 ring-inset ring-brand-400/30">
                        E{String(index + 1).padStart(2, '0')}
                    </span>
                    Escena {index + 1} · <span className="tabular-nums">{scene.duration_seconds}s</span>
                </span>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={handleRegenerate}
                        disabled={busy}
                        className="btn btn-secondary btn-sm"
                    >
                        {busyAction === 'regenerate' && <span className="spinner h-3 w-3" aria-hidden="true" />}
                        {busyAction === 'regenerate' ? 'Regenerando con IA...' : 'Regenerar con IA'}
                    </button>
                    <button
                        type="button"
                        onClick={handleDelete}
                        disabled={busy}
                        aria-label={`Eliminar escena ${index + 1}`}
                        title="Eliminar esta escena"
                        className="btn-icon btn-icon-danger"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
                        </svg>
                    </button>
                </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                    <label className="label" htmlFor={`character-${scene.id}`}>Personaje</label>
                    <select
                        id={`character-${scene.id}`}
                        value={scene.character}
                        onChange={(event) => handleCharacterChange(event.target.value as CharacterType)}
                        disabled={busy}
                        className="field field-sm"
                    >
                        {CHARACTER_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="label" htmlFor={`action-${scene.id}`}>Acción</label>
                    <select
                        id={`action-${scene.id}`}
                        value={scene.action}
                        onChange={(event) => handleActionChange(event.target.value as SceneAction)}
                        disabled={busy}
                        className="field field-sm"
                    >
                        {ACTION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="label" htmlFor={`prop-${scene.id}`}>Objeto</label>
                    <select
                        id={`prop-${scene.id}`}
                        value={scene.prop}
                        onChange={(event) => handlePropChange(event.target.value as ScenePropType)}
                        disabled={busy}
                        className="field field-sm"
                    >
                        {PROP_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="mt-3">
                <label className="label" htmlFor={`description-${scene.id}`}>Descripción / subtítulo</label>
                <textarea
                    id={`description-${scene.id}`}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={2}
                    disabled={busy}
                    className="field field-sm"
                />
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3">
                <div>
                    <label className="label" htmlFor={`duration-${scene.id}`}>Duración (s)</label>
                    <input
                        id={`duration-${scene.id}`}
                        type="number"
                        min={1}
                        step={0.5}
                        value={durationSeconds}
                        onChange={(event) => setDurationSeconds(Number(event.target.value))}
                        disabled={busy}
                        className="field field-sm w-28"
                    />
                </div>
                <button
                    type="button"
                    onClick={handleSaveText}
                    disabled={busy || !textDirty}
                    className="btn btn-primary h-9 px-3.5"
                >
                    {busyAction === 'text' && <span className="spinner h-3.5 w-3.5" aria-hidden="true" />}
                    {busyAction === 'text' ? 'Guardando...' : 'Guardar cambios'}
                </button>
            </div>

            <div className="mt-3">
                <label className="label" htmlFor={`effect-${scene.id}`}>Efecto de sonido</label>
                {/* Read straight from the record, not copied into state, so the
                    row's key does not need it: re-keying on every effect change
                    would throw away an unsaved description. */}
                <div className="flex flex-wrap items-center gap-2">
                    <select
                        id={`effect-${scene.id}`}
                        value={effectId}
                        onChange={(event) => handleEffectChange(event.target.value)}
                        disabled={busy}
                        className="field field-sm min-w-0 flex-1 sm:max-w-xs"
                    >
                        <option value="">Ninguno</option>
                        {effectId !== '' && !selectedEffect && (
                            <option value={effectId} disabled>
                                {soundsLoading ? 'Cargando sonidos...' : 'Sonido no disponible'}
                            </option>
                        )}
                        {effects.map((effect) => (
                            <option key={effect.id} value={effect.id}>
                                {effect.origin === 'subido' ? `${effect.name} (subido)` : effect.name}
                            </option>
                        ))}
                    </select>
                    {selectedEffect && (
                        <audio
                            key={selectedEffect.id}
                            controls
                            preload="none"
                            src={selectedEffect.url}
                            aria-label={`Escuchar el efecto ${selectedEffect.name}`}
                            className="h-9 min-w-0 flex-1"
                        />
                    )}
                </div>
                <p className="hint mt-1.5">Suena al empezar la escena.</p>
            </div>

            {scene.audio_url && (
                <div className="mt-3">
                    <audio controls src={scene.audio_url} className="w-full" />
                </div>
            )}

            {error && <p className="alert alert-error mt-3" role="alert">{error}</p>}
        </li>
    );
}
