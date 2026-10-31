'use client';

import type { EntityMood } from './assistant-entity';
import { MOOD_DOT, MOOD_TEXT } from './app-sidebar';
import { LogoMark } from './logo';
import { Icon } from './section-icon';
import { SECTIONS, type Section } from './studio-utils';

interface AppTopbarProps {
    section: Section;
    renderingCount: number;
    email: string | null;
    signInNeeded: boolean;
    loggingOut: boolean;
    copilotVisible: boolean;
    copilotMood: EntityMood;
    onOpenMobileNav: () => void;
    onOpenPalette: () => void;
    onShowShortcuts: () => void;
    onToggleCopilot: () => void;
    onLogout: () => void;
}

export default function AppTopbar({
    section, renderingCount, email, signInNeeded, loggingOut, copilotVisible, copilotMood,
    onOpenMobileNav, onOpenPalette, onShowShortcuts, onToggleCopilot, onLogout,
}: AppTopbarProps) {
    const current = SECTIONS.find((entry) => entry.id === section);

    return (
        <header className="glass sticky top-0 z-20 border-b border-white/[0.06]">
            <div className="flex h-[3.75rem] items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
                <button type="button" onClick={onOpenMobileNav} aria-label="Abrir la navegación" className="btn-icon h-9 w-9 lg:hidden">
                    <Icon name="menu" size={18} />
                </button>
                <span className="lg:hidden"><LogoMark size={28} /></span>

                <div className="hidden min-w-0 items-center gap-2 text-sm sm:flex">
                    <span className="text-slate-500">Stickman</span>
                    <Icon name="chevron-right" size={13} className="text-slate-600" />
                    <span className="truncate font-medium text-slate-100">{current?.label}</span>
                </div>
                <h1 className="sr-only">Stickman Studio · {current?.label}</h1>

                <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
                    <button
                        type="button"
                        onClick={onOpenPalette}
                        aria-label="Buscar o ir a… (Ctrl+K)"
                        aria-keyshortcuts="Control+K Meta+K"
                        className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-sm text-slate-400 transition-colors hover:border-white/[0.16] hover:text-slate-200 md:w-64 lg:w-72"
                    >
                        <Icon name="search" size={15} />
                        <span className="hidden flex-1 truncate text-left md:inline">Buscar o ir a…</span>
                        <span className="kbd hidden md:inline-flex">Ctrl K</span>
                    </button>

                    {renderingCount > 0 && (
                        <span className="hidden items-center gap-1.5 rounded-full bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-200 ring-1 ring-inset ring-brand-400/25 xl:inline-flex">
                            <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-300 opacity-75" />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-300" />
                            </span>
                            <span className="font-mono tabular-nums">{renderingCount}</span> generando
                        </span>
                    )}

                    <button type="button" onClick={onShowShortcuts} aria-label="Atajos de teclado" title="Atajos de teclado (?)" className="btn-icon hidden h-9 w-9 md:inline-flex">
                        <Icon name="keyboard" size={17} />
                    </button>

                    <div className="flex items-center gap-2 border-l border-white/[0.08] pl-2 sm:pl-3">
                        {email ? (
                            <>
                                <span className="hidden items-center gap-2 lg:flex" title={email}>
                                    <span
                                        aria-hidden="true"
                                        className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/15 font-mono text-xs font-semibold uppercase text-brand-100 ring-1 ring-inset ring-brand-400/30"
                                    >
                                        {email.charAt(0)}
                                    </span>
                                    <span className="max-w-[10rem] truncate text-xs text-slate-300">{email}</span>
                                </span>
                                <button
                                    type="button"
                                    onClick={onLogout}
                                    disabled={loggingOut}
                                    aria-label="Cerrar sesión"
                                    className="btn btn-secondary btn-sm"
                                >
                                    {loggingOut ? 'Saliendo...' : 'Salir'}
                                </button>
                            </>
                        ) : signInNeeded ? (
                            <a href="/login" className="btn btn-primary btn-sm">Entrar</a>
                        ) : (
                            // "Entrar" only after an action answered 401: since
                            // 13-oct-2026 nothing needs an account unless
                            // REQUIRE_LOGIN is on, so a permanent button would
                            // suggest a login the studio does not ask for.
                            <span className="hidden items-center gap-1.5 text-xs text-slate-500 xl:flex" title="El estudio está abierto; algunas acciones piden sesión.">
                                <Icon name="user" size={14} />
                                Sin sesión
                            </span>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={onToggleCopilot}
                        aria-pressed={copilotVisible}
                        aria-controls="copilot-dock"
                        aria-label={`${copilotVisible ? 'Ocultar' : 'Mostrar'} el copiloto. Estado: ${MOOD_TEXT[copilotMood]}`}
                        aria-keyshortcuts="C"
                        className={`btn btn-sm relative ${copilotVisible ? 'border border-brand-400/40 bg-brand-500/15 text-brand-100 hover:bg-brand-500/25' : 'btn-secondary'}`}
                    >
                        <Icon name="bot" size={15} />
                        <span className="hidden sm:inline">Copiloto</span>
                        <span className={`h-1.5 w-1.5 rounded-full ${MOOD_DOT[copilotMood]}`} aria-hidden="true" />
                    </button>
                </div>
            </div>
        </header>
    );
}
