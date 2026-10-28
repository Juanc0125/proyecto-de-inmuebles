'use client';

import type { Scene } from '@shared-types/video';
import type { VideoRecord } from './api';
import { ACTION_OPTIONS, CHARACTER_OPTIONS } from './constants';
import VideoPoster from './video-poster';
import { formatClock } from './studio-utils';

interface StoryboardProps {
    video: VideoRecord;
    // Already sorted by order.
    scenes: Scene[];
    activeId: string | null;
    onPick: (sceneId: string) => void;
}

const CHARACTER_LABEL = Object.fromEntries(CHARACTER_OPTIONS.map((option) => [option.value, option.label]));
const ACTION_LABEL = Object.fromEntries(ACTION_OPTIONS.map((option) => [option.value, option.label]));

// Read-only overview of the scenes in sequence: a frame per scene and a
// proportional timeline under them. Picking a frame jumps to that scene's
// editor below; every edit still happens there, so this adds no second way
// to change a scene that could drift from the first.
export default function Storyboard({ video, scenes, activeId, onPick }: StoryboardProps) {
    const total = scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0);
    const longest = Math.max(...scenes.map((scene) => scene.duration_seconds), 1);
    const target = video.target_duration_seconds;
    const drift = target > 0 ? (total - target) / target : 0;
    const off = Math.abs(drift) > 0.2;

    // Where each scene starts on the timeline, in seconds.
    const starts = scenes.map((_, index) => scenes.slice(0, index).reduce((sum, scene) => sum + scene.duration_seconds, 0));

    return (
        <div className="mb-5 rounded-xl border border-white/[0.06] bg-ink-950/40 p-3.5 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="eyebrow">Storyboard · {scenes.length} {scenes.length === 1 ? 'escena' : 'escenas'}</p>
                <p className="flex items-center gap-2 font-mono text-xs tabular-nums">
                    <span className="text-white">{formatClock(total)}</span>
                    <span className="text-slate-500">/ objetivo {formatClock(target)}</span>
                    {off && (
                        <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-amber-200 ring-1 ring-inset ring-amber-400/30">
                            {drift > 0 ? '+' : ''}{Math.round(drift * 100)}%
                        </span>
                    )}
                </p>
            </div>

            <ol className="thin-scroll -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2" aria-label="Escenas en orden">
                {scenes.map((scene, index) => {
                    const active = scene.id === activeId;
                    return (
                        <li key={scene.id} className="w-[6.75rem] shrink-0 snap-start sm:w-[7.5rem]">
                            <button
                                type="button"
                                onClick={() => onPick(scene.id)}
                                aria-label={`Ir a la escena ${index + 1}: ${scene.description}`}
                                className={`group block w-full rounded-lg p-1 text-left transition-colors ${
                                    active ? 'bg-brand-500/15 ring-1 ring-brand-400/50' : 'hover:bg-white/[0.04]'
                                }`}
                            >
                                <VideoPoster video={video} sceneIndex={index} className={`w-full ${active ? 'hud-frame' : ''}`} />
                                <span className="mt-1.5 flex items-center justify-between gap-1 font-mono text-[0.6875rem] tabular-nums">
                                    <span className={active ? 'text-brand-200' : 'text-slate-300'}>E{String(index + 1).padStart(2, '0')}</span>
                                    <span className="text-slate-400">{scene.duration_seconds}s</span>
                                </span>
                                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/[0.06]">
                                    <span
                                        className="block h-full rounded-full bg-brand-400/80 transition-[width] duration-500"
                                        style={{ width: `${(scene.duration_seconds / longest) * 100}%` }}
                                    />
                                </span>
                                <span className="mt-1 block truncate text-[0.6875rem] text-slate-400">
                                    {CHARACTER_LABEL[scene.character] ?? scene.character} · {ACTION_LABEL[scene.action] ?? scene.action}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ol>

            {/* Proportional timeline: each block is as wide as its share of
                the total, with the start time of each scene underneath. */}
            <div className="mt-2" aria-hidden="true">
                <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full">
                    {scenes.map((scene, index) => (
                        <div
                            key={scene.id}
                            title={`Escena ${index + 1}: ${scene.duration_seconds}s`}
                            className={`h-full transition-[width] duration-500 ease-out-expo ${
                                scene.id === activeId ? 'bg-brand-300' : index % 2 === 0 ? 'bg-brand-500/80' : 'bg-accent-500/70'
                            }`}
                            style={{ width: `${total > 0 ? (scene.duration_seconds / total) * 100 : 0}%` }}
                        />
                    ))}
                </div>
                <div className="relative mt-1 h-4 font-mono text-[0.625rem] tabular-nums text-slate-500">
                    {scenes.map((scene, index) => {
                        const left = total > 0 ? (starts[index] / total) * 100 : 0;
                        // Skip labels that would sit on top of each other.
                        return scene.duration_seconds / Math.max(total, 1) > 0.07 && left < 88 ? (
                            <span key={scene.id} className="absolute" style={{ left: `${left}%` }}>{formatClock(starts[index])}</span>
                        ) : null;
                    })}
                    <span className="absolute right-0">{formatClock(total)}</span>
                </div>
            </div>
        </div>
    );
}
