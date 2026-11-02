'use client';

import { useState, type KeyboardEvent } from 'react';
import type { VideoRecord } from './api';
import Modal from './modal';
import { Icon, type SectionIconName } from './section-icon';
import StatusBadge from './status-badge';
import { PLATFORM_SHORT, SECTIONS, normalizeText, type Section } from './studio-utils';

export interface PaletteActions {
    goTo: (section: Section) => void;
    openVideo: (id: string) => void;
    newVideo: () => void;
    newBatch: () => void;
    toggleCopilot: () => void;
    showShortcuts: () => void;
}

interface CommandPaletteProps {
    open: boolean;
    onClose: () => void;
    videos: VideoRecord[];
    actions: PaletteActions;
}

interface Command {
    id: string;
    group: 'Acciones' | 'Ir a' | 'Videos';
    label: string;
    hint?: string;
    icon: SectionIconName;
    keywords: string;
    video?: VideoRecord;
    run: () => void;
}

const SECTION_ICONS: Record<Section, SectionIconName> = {
    panel: 'dashboard',
    estudio: 'studio',
    biblioteca: 'library',
    flujo: 'board',
    marca: 'brand',
    sonidos: 'sound',
};

const MAX_VIDEOS = 8;

export default function CommandPalette({ open, onClose, videos, actions }: CommandPaletteProps) {
    return (
        <Modal open={open} onClose={onClose} labelledBy="palette-title" className="max-w-2xl">
            {/* Mounted only while open, so every opening starts with an empty
                query and the first item active. */}
            {open && <PaletteBody onClose={onClose} videos={videos} actions={actions} />}
        </Modal>
    );
}

function PaletteBody({ onClose, videos, actions }: Omit<CommandPaletteProps, 'open'>) {
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);

    function run(command: Command) {
        onClose();
        command.run();
    }

    const commands: Command[] = [
        { id: 'new', group: 'Acciones', label: 'Nuevo video', hint: 'N', icon: 'plus', keywords: 'crear nuevo video tema', run: actions.newVideo },
        { id: 'batch', group: 'Acciones', label: 'Crear varios videos (lote)', icon: 'layers', keywords: 'lote varios batch masivo', run: actions.newBatch },
        { id: 'copilot', group: 'Acciones', label: 'Abrir o cerrar el copiloto', hint: 'C', icon: 'bot', keywords: 'copiloto asistente voz chat ia', run: actions.toggleCopilot },
        { id: 'help', group: 'Acciones', label: 'Ver atajos de teclado', hint: '?', icon: 'keyboard', keywords: 'atajos teclado ayuda shortcuts', run: actions.showShortcuts },
        ...SECTIONS.map((section) => ({
            id: `go-${section.id}`,
            group: 'Ir a' as const,
            label: section.label,
            hint: section.description,
            icon: SECTION_ICONS[section.id],
            keywords: `${section.id} ${section.label} ${section.description} ir seccion`,
            run: () => actions.goTo(section.id),
        })),
        ...videos.map((video) => ({
            id: `video-${video.id}`,
            group: 'Videos' as const,
            label: video.topic,
            icon: 'film' as const,
            keywords: `${video.topic} ${PLATFORM_SHORT[video.platform]} ${video.status}`,
            video,
            run: () => actions.openVideo(video.id),
        })),
    ];

    const needle = normalizeText(query.trim());
    const matched = needle
        ? commands.filter((command) => normalizeText(`${command.label} ${command.keywords}`).includes(needle))
        : commands;
    // Videos are capped so a long library does not bury the actions; typing
    // narrows them down to the one wanted.
    const visible = [
        ...matched.filter((command) => command.group !== 'Videos'),
        ...matched.filter((command) => command.group === 'Videos').slice(0, MAX_VIDEOS),
    ];
    const activeIndex = visible.length === 0 ? -1 : Math.min(active, visible.length - 1);

    function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((activeIndex + 1) % Math.max(1, visible.length));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((activeIndex - 1 + visible.length) % Math.max(1, visible.length));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const command = visible[activeIndex];
            if (command) run(command);
        }
    }

    return (
        <div>
            <h2 id="palette-title" className="sr-only">Paleta de comandos</h2>
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
                <Icon name="search" size={18} className="text-slate-400" />
                <input
                    autoFocus
                    value={query}
                    onChange={(event) => { setQuery(event.target.value); setActive(0); }}
                    onKeyDown={handleKeyDown}
                    placeholder="Busca un video, una sección o una acción…"
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="palette-list"
                    aria-activedescendant={activeIndex >= 0 ? `palette-${visible[activeIndex].id}` : undefined}
                    aria-label="Buscar comandos y videos"
                    className="h-14 min-w-0 flex-1 bg-transparent text-[0.9375rem] text-white placeholder:text-slate-500 focus:outline-none"
                    style={{ backgroundColor: 'transparent' }}
                />
                <span className="kbd hidden sm:inline-flex">Esc</span>
            </div>
            <ul id="palette-list" role="listbox" aria-label="Resultados" className="thin-scroll max-h-[min(60vh,26rem)] overflow-y-auto p-2">
                {visible.length === 0 && (
                    <li className="px-3 py-8 text-center text-sm text-slate-400" role="presentation">
                        Nada coincide con &ldquo;{query}&rdquo;.
                    </li>
                )}
                {visible.map((command, index) => {
                    const header = index === 0 || visible[index - 1].group !== command.group ? command.group : null;
                    const selected = index === activeIndex;
                    return (
                        <li key={command.id} role="presentation">
                            {header && <p className="eyebrow px-3 pb-1 pt-3" role="presentation">{header}</p>}
                            <div
                                id={`palette-${command.id}`}
                                role="option"
                                aria-selected={selected}
                                onMouseMove={() => { if (!selected) setActive(index); }}
                                onClick={() => run(command)}
                                className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${
                                    selected ? 'bg-brand-500/[0.12] text-white ring-1 ring-inset ring-brand-400/25' : 'text-slate-300'
                                }`}
                            >
                                <Icon name={command.icon} className={selected ? 'text-brand-300' : 'text-slate-500'} />
                                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                                {command.video ? (
                                    <span className="hidden shrink-0 items-center gap-2 sm:flex">
                                        <span className="text-xs text-slate-500">{PLATFORM_SHORT[command.video.platform]}</span>
                                        <StatusBadge status={command.video.status} />
                                    </span>
                                ) : command.hint && command.hint.length <= 2 ? (
                                    <span className="kbd">{command.hint}</span>
                                ) : command.hint ? (
                                    <span className="hidden truncate text-xs text-slate-500 sm:inline">{command.hint}</span>
                                ) : null}
                            </div>
                        </li>
                    );
                })}
            </ul>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.07] px-4 py-2.5 text-[0.6875rem] text-slate-500">
                <span className="flex items-center gap-1.5"><span className="kbd">↑</span><span className="kbd">↓</span> moverse</span>
                <span className="flex items-center gap-1.5"><span className="kbd">Enter</span> abrir</span>
                <span className="flex items-center gap-1.5"><span className="kbd">Esc</span> cerrar</span>
            </div>
        </div>
    );
}
