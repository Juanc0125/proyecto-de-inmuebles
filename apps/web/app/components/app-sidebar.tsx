'use client';

import type { EntityMood } from './assistant-entity';
import Logo, { LogoMark } from './logo';
import Modal from './modal';
import { Icon, type SectionIconName } from './section-icon';
import { SECTIONS, type Section } from './studio-utils';

const SECTION_ICONS: Record<Section, SectionIconName> = {
    panel: 'dashboard',
    estudio: 'studio',
    biblioteca: 'library',
    flujo: 'board',
    marca: 'brand',
    sonidos: 'sound',
};

export const MOOD_TEXT: Record<EntityMood, string> = {
    idle: 'Disponible',
    listening: 'Escuchando',
    thinking: 'Pensando',
    speaking: 'Hablando',
};

export const MOOD_DOT: Record<EntityMood, string> = {
    idle: 'bg-emerald-400',
    listening: 'animate-pulse bg-red-400',
    thinking: 'bg-amber-400',
    speaking: 'animate-pulse bg-brand-300',
};

interface NavProps {
    current: Section;
    collapsed: boolean;
    pendingCount: number;
    renderingCount: number;
    copilotMood: EntityMood;
    onNavigate: (section: Section) => void;
    onNewVideo: () => void;
    onOpenCopilot: () => void;
    onShowShortcuts: () => void;
}

function NavContent({ current, collapsed, pendingCount, renderingCount, copilotMood, onNavigate, onNewVideo, onOpenCopilot, onShowShortcuts }: NavProps) {
    return (
        <>
            <div className={`flex h-[3.75rem] shrink-0 items-center border-b border-white/[0.06] ${collapsed ? 'justify-center px-2' : 'px-4'}`}>
                {collapsed ? <LogoMark size={30} /> : <Logo size={30} />}
            </div>

            <div className={`flex flex-1 flex-col gap-1 overflow-y-auto py-4 ${collapsed ? 'px-2' : 'px-3'}`}>
                <button
                    type="button"
                    onClick={onNewVideo}
                    className={`btn btn-primary mb-4 ${collapsed ? 'w-full px-0' : 'w-full justify-start'}`}
                    aria-label={collapsed ? 'Nuevo video' : undefined}
                    title={collapsed ? 'Nuevo video (N)' : undefined}
                >
                    <Icon name="plus" />
                    {!collapsed && <span>Nuevo video</span>}
                    {!collapsed && <span className="ml-auto rounded border border-white/20 px-1 font-mono text-[0.625rem] text-white/80">N</span>}
                </button>

                {!collapsed && <p className="eyebrow mb-1 px-3">Navegación</p>}
                <nav aria-label="Secciones">
                    <ul className="space-y-1 pl-2">
                        {SECTIONS.map((section) => {
                            const badge = section.id === 'flujo' ? pendingCount : section.id === 'panel' ? renderingCount : 0;
                            return (
                                <li key={section.id}>
                                    <button
                                        type="button"
                                        onClick={() => onNavigate(section.id)}
                                        aria-current={current === section.id ? 'page' : undefined}
                                        aria-label={collapsed ? section.label : undefined}
                                        title={collapsed ? section.label : undefined}
                                        className={`nav-item ${collapsed ? 'justify-center px-0' : ''}`}
                                    >
                                        <Icon name={SECTION_ICONS[section.id]} size={17} />
                                        {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{section.label}</span>}
                                        {badge > 0 && (
                                            <span className="sr-only">{section.id === 'flujo' ? `, ${badge} por aprobar` : `, ${badge} generando`}</span>
                                        )}
                                        {badge > 0 && (
                                            <span
                                                aria-hidden="true"
                                                className={`font-mono text-[0.625rem] font-semibold tabular-nums ${
                                                    collapsed
                                                        ? 'absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1'
                                                        : 'rounded-full px-1.5 py-px'
                                                } ${section.id === 'flujo' ? 'bg-amber-400/15 text-amber-200 ring-1 ring-inset ring-amber-400/30' : 'bg-brand-500/15 text-brand-200 ring-1 ring-inset ring-brand-400/30'}`}
                                            >
                                                {badge}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </nav>
            </div>

            <div className={`shrink-0 space-y-2 border-t border-white/[0.06] py-3 ${collapsed ? 'px-2' : 'px-3'}`}>
                <button
                    type="button"
                    onClick={onOpenCopilot}
                    className={`tile tile-hover flex w-full items-center gap-2.5 text-left ${collapsed ? 'justify-center p-2' : 'p-2.5'}`}
                    aria-label={`Abrir el copiloto. Estado: ${MOOD_TEXT[copilotMood]}`}
                >
                    <span className="relative">
                        <Icon name="bot" size={18} className="text-brand-300" />
                        <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-ink-900 ${MOOD_DOT[copilotMood]}`} aria-hidden="true" />
                    </span>
                    {!collapsed && (
                        <span className="min-w-0 flex-1">
                            <span className="block text-xs font-medium text-slate-100">Copiloto</span>
                            <span className="block text-[0.6875rem] text-slate-400">{MOOD_TEXT[copilotMood]}</span>
                        </span>
                    )}
                    {!collapsed && <span className="kbd">C</span>}
                </button>
                <button
                    type="button"
                    onClick={onShowShortcuts}
                    className={`btn btn-ghost btn-sm w-full ${collapsed ? 'px-0' : 'justify-start'}`}
                    aria-label="Atajos de teclado"
                    title="Atajos de teclado (?)"
                >
                    <Icon name="keyboard" size={15} />
                    {!collapsed && <span className="flex-1 text-left">Atajos de teclado</span>}
                    {!collapsed && <span className="kbd">?</span>}
                </button>
            </div>
        </>
    );
}

interface AppSidebarProps extends Omit<NavProps, 'collapsed'> {
    collapsed: boolean;
    onToggleCollapsed: () => void;
    mobileOpen: boolean;
    onCloseMobile: () => void;
}

export default function AppSidebar({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile, ...nav }: AppSidebarProps) {
    return (
        <>
            <aside
                className={`glass fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-white/[0.06] transition-[width] duration-300 ease-out-expo lg:flex ${collapsed ? 'w-[4.5rem]' : 'w-64'}`}
                aria-label="Navegación principal"
            >
                <NavContent {...nav} collapsed={collapsed} />
                <button
                    type="button"
                    onClick={onToggleCollapsed}
                    aria-label={collapsed ? 'Expandir la barra lateral' : 'Contraer la barra lateral'}
                    aria-expanded={!collapsed}
                    className="absolute -right-3 top-[4.5rem] flex h-6 w-6 items-center justify-center rounded-full border border-white/[0.12] bg-ink-800 text-slate-400 shadow-panel hover:text-white"
                >
                    <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={13} />
                </button>
            </aside>

            {/* Phones and tablets: the same navigation as a modal sheet, so
                focus stays inside it and Esc closes it. */}
            <Modal open={mobileOpen} onClose={onCloseMobile} labelledBy="mobile-nav-title" variant="drawer" className="relative">
                <h2 id="mobile-nav-title" className="sr-only">Navegación</h2>
                <button type="button" onClick={onCloseMobile} aria-label="Cerrar la navegación" className="btn-icon absolute right-3 top-3.5 z-10">
                    <Icon name="close" />
                </button>
                <NavContent
                    {...nav}
                    collapsed={false}
                    onNavigate={(section) => { onCloseMobile(); nav.onNavigate(section); }}
                    onNewVideo={() => { onCloseMobile(); nav.onNewVideo(); }}
                    onOpenCopilot={() => { onCloseMobile(); nav.onOpenCopilot(); }}
                    onShowShortcuts={() => { onCloseMobile(); nav.onShowShortcuts(); }}
                />
            </Modal>
        </>
    );
}
