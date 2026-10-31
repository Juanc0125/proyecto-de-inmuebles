'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SoundAsset } from '@shared-types/sounds';
import type { BrandTemplate } from '@shared-types/templates';
import {
    SIGN_IN_REQUIRED_EVENT, fetchBrandTemplates, fetchSession, fetchSounds, fetchVideos, logout, type VideoRecord,
} from './api';
import Assistant from './assistant';
import type { EntityMood } from './assistant-entity';
import AppSidebar from './app-sidebar';
import AppTopbar from './app-topbar';
import ApprovalBoard from './approval-board';
import BrandView from './brand-view';
import CommandPalette from './command-palette';
import type { CreateMode, CreateRequest } from './create-video-form';
import DashboardView from './dashboard-view';
import LibraryView from './library-view';
import ShortcutsHelp from './shortcuts-help';
import SoundsView from './sounds-view';
import StudioView, { type RevealRequest } from './studio-view';
import { parseHash, useHashRoute } from './use-hash-route';
import type { SharedLibraries } from './video-workspace';
import type { Section } from './studio-utils';

// At this width the copilot docks beside the content; below it, it opens as
// an overlay sheet. Must match the `xl:` classes on the dock.
const DOCK_QUERY = '(min-width: 1280px)';
const SIDEBAR_KEY = 'stickman:barra-contraida';
const NOW_TICK_MS = 30000;

const GO_KEYS: Record<string, Section> = {
    p: 'panel',
    e: 'estudio',
    b: 'biblioteca',
    f: 'flujo',
    m: 'marca',
    s: 'sonidos',
};

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

// The app shell: sidebar, top bar, the section on screen and the docked
// copilot. It owns the video list (and the libraries several sections share)
// so every section and the copilot read the same records.
export default function VideoStudio() {
    const [videos, setVideos] = useState<VideoRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    // Who is signed in, for the top bar - null for a visitor. The studio is
    // open to anyone (proxy.ts), so a missing session only swaps "Salir" for
    // "Entrar"; it never blocks the page.
    const [email, setEmail] = useState<string | null>(null);
    const [loggingOut, setLoggingOut] = useState(false);
    // Set once any action answered 401: only then is "Entrar" worth showing.
    const [signInNeeded, setSignInNeeded] = useState(false);

    const { route, navigate } = useHashRoute();
    // The video the operator last opened. Outlives the URL so the copilot
    // keeps talking about it from any section, and Marca/Sonidos start on it.
    const [stickyId, setStickyId] = useState<string | null>(null);
    const [reveal, setReveal] = useState<RevealRequest>({ seq: 0, focus: false });
    const [createRequest, setCreateRequest] = useState<CreateRequest>({ seq: 0, mode: 'single', focus: false });

    // null = automatic: docked open on wide screens, closed on narrow ones.
    // Decided by CSS so the server render and the first client paint agree.
    const [copilotOpen, setCopilotOpen] = useState<boolean | null>(null);
    const [copilotMood, setCopilotMood] = useState<EntityMood>('idle');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    // The clock, held in state and ticked (reading it during render is
    // impure). 0 until the first tick; views treat that as "unknown".
    const [now, setNow] = useState(0);

    // Bumped by every local change to the list (create, update, delete). A
    // list fetch that started before the latest bump answers with a snapshot
    // older than what is on screen, and applying it would make a new video
    // vanish or a saved edit revert.
    const mutationRef = useRef(0);
    const deletedIdsRef = useRef(new Set<string>());

    const loadVideos = useCallback(async () => {
        const startedAt = mutationRef.current;
        try {
            const loaded = await fetchVideos();
            if (mutationRef.current === startedAt) {
                setVideos(loaded);
            } else {
                // Something was created, edited or deleted while this load
                // was in flight: keep the local versions and only add the
                // rows this browser had not seen yet.
                setVideos((current) => {
                    const known = new Set(current.map((video) => video.id));
                    const missing = loaded.filter((video) => !known.has(video.id) && !deletedIdsRef.current.has(video.id));
                    return [...current, ...missing];
                });
            }
            setLoadError('');
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar los videos.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // Deferred by a tick: state only changes once the fetch resolves, but
        // the lint rule sees a call inside the effect body and cannot tell.
        const timer = setTimeout(() => { void loadVideos(); }, 0);
        return () => clearTimeout(timer);
    }, [loadVideos]);

    function retryLoad() {
        setLoading(true);
        setLoadError('');
        void loadVideos();
    }

    useEffect(() => {
        fetchSession()
            .then((session) => setEmail(session.email))
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        const onSignInRequired = () => setSignInNeeded(true);
        window.addEventListener(SIGN_IN_REQUIRED_EVENT, onSignInRequired);
        return () => window.removeEventListener(SIGN_IN_REQUIRED_EVENT, onSignInRequired);
    }, []);

    useEffect(() => {
        const first = setTimeout(() => setNow(Date.now()), 0);
        const timer = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
        return () => { clearTimeout(first); clearInterval(timer); };
    }, []);

    // RF-010 / RF-028: one sound list and one brand-template list for the
    // whole shell. They used to live in the workspace; the Marca and Sonidos
    // sections need them too, and lifting them further keeps the original
    // reason intact (no panel owns a list it can be rebuilt out of mid-save).
    const [sounds, setSounds] = useState<SoundAsset[]>([]);
    const [soundsLoading, setSoundsLoading] = useState(true);
    const [soundsError, setSoundsError] = useState('');
    const [brandTemplates, setBrandTemplates] = useState<BrandTemplate[]>([]);
    const [brandTemplatesLoading, setBrandTemplatesLoading] = useState(true);
    const [brandTemplatesError, setBrandTemplatesError] = useState('');

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
        const timer = setTimeout(() => { void loadSounds(); void loadBrandTemplates(); }, 0);
        return () => clearTimeout(timer);
    }, [loadSounds, loadBrandTemplates]);

    function retryBrandTemplates() {
        setBrandTemplatesLoading(true);
        setBrandTemplatesError('');
        void loadBrandTemplates();
    }

    const libraries: SharedLibraries = {
        sounds,
        soundsLoading,
        soundsError,
        onSoundsChanged: setSounds,
        brandTemplates,
        brandTemplatesLoading,
        brandTemplatesError,
        onBrandTemplatesChanged: setBrandTemplates,
        onRetryBrandTemplates: retryBrandTemplates,
    };

    // A deep link (#/estudio/<id>) or the back button names a video: it
    // becomes the one the copilot and the other sections talk about.
    useEffect(() => {
        const adopt = () => {
            const { videoId } = parseHash(window.location.hash);
            if (videoId) setStickyId(videoId);
        };
        const timer = setTimeout(adopt, 0);
        window.addEventListener('hashchange', adopt);
        return () => { clearTimeout(timer); window.removeEventListener('hashchange', adopt); };
    }, []);

    // Section changes start at the top of the page, like a page would.
    const section = route.section;
    useEffect(() => {
        window.scrollTo({ top: 0 });
    }, [section]);

    useEffect(() => {
        try {
            if (window.localStorage.getItem(SIDEBAR_KEY) === '1') {
                const timer = setTimeout(() => setSidebarCollapsed(true), 0);
                return () => clearTimeout(timer);
            }
        } catch {
            // no stored preference; the sidebar stays expanded
        }
        return undefined;
    }, []);

    function toggleSidebar() {
        setSidebarCollapsed((current) => {
            const next = !current;
            try {
                window.localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
            } catch {
                // works for this visit anyway
            }
            return next;
        });
    }

    async function handleLogout() {
        setLoggingOut(true);
        try {
            await logout();
        } catch {
            // The cookie may already be gone (e.g. expired seconds ago) -
            // either way, the destination is the same.
        }
        // The studio stays open after signing out; reload so every panel
        // drops what it knew about the session.
        window.location.href = '/';
    }

    // Rendering runs in the background on the worker, which reports progress on
    // the video row - so while anything is rendering, keep refreshing the list.
    const isRendering = videos.some((video) => video.render_status === 'procesando');
    useEffect(() => {
        if (!isRendering) return;
        const timer = setInterval(() => {
            const startedAt = mutationRef.current;
            fetchVideos()
                .then((loaded) => {
                    // Stale: a local change landed after this poll left. The
                    // next tick brings a snapshot that already includes it.
                    if (mutationRef.current !== startedAt) return;
                    setVideos(loaded);
                })
                .catch(() => undefined);
        }, 4000);
        return () => clearInterval(timer);
    }, [isRendering]);

    function openVideo(id: string, focus: boolean) {
        setCreateRequest((current) => (current.focus ? { ...current, focus: false } : current));
        setStickyId(id);
        navigate('estudio', id);
        setReveal((current) => ({ seq: current.seq + 1, focus }));
    }

    function handleCreated(video: VideoRecord, focus = true) {
        mutationRef.current += 1;
        setVideos((current) => [video, ...current.filter((entry) => entry.id !== video.id)]);
        openVideo(video.id, focus);
    }

    // RF-024: in the order typed, the first topic selected, the form (and its
    // summary of warnings and failures) left on screen.
    function handleBatchCreated(created: VideoRecord[]) {
        mutationRef.current += 1;
        const ids = new Set(created.map((video) => video.id));
        setVideos((current) => [...created, ...current.filter((entry) => !ids.has(entry.id))]);
        setStickyId(created[0].id);
    }

    function handleUpdated(video: VideoRecord) {
        mutationRef.current += 1;
        setVideos((current) => current.map((entry) => (entry.id === video.id ? video : entry)));
    }

    function handleDeleted(id: string) {
        mutationRef.current += 1;
        deletedIdsRef.current.add(id);
        setVideos((current) => current.filter((entry) => entry.id !== id));
        setStickyId((current) => (current === id ? null : current));
        if (route.videoId === id) navigate('estudio');
    }

    function goTo(target: Section) {
        setCreateRequest((current) => (current.focus ? { ...current, focus: false } : current));
        // "Estudio" returns to the video being worked on, if there is one.
        if (target === 'estudio' && stickyId && videos.some((video) => video.id === stickyId)) {
            navigate('estudio', stickyId);
            return;
        }
        navigate(target);
    }

    function requestCreate(mode: CreateMode) {
        navigate('estudio');
        setCreateRequest((current) => ({ seq: current.seq + 1, mode, focus: true }));
    }

    const copilotVisible = (): boolean => (copilotOpen === null ? window.matchMedia(DOCK_QUERY).matches : copilotOpen);
    function toggleCopilot() {
        setCopilotOpen(!copilotVisible());
    }

    // The latest handlers, for the global key listener registered once.
    const keyActionsRef = useRef({ goTo, requestCreate, toggleCopilot });
    useEffect(() => {
        keyActionsRef.current = { goTo, requestCreate, toggleCopilot };
    });
    const dialogOpen = paletteOpen || helpOpen || mobileNavOpen;
    const dialogOpenRef = useRef(false);
    useEffect(() => {
        dialogOpenRef.current = dialogOpen;
    }, [dialogOpen]);

    useEffect(() => {
        let goPending: ReturnType<typeof setTimeout> | null = null;
        const clearGo = () => {
            if (goPending) clearTimeout(goPending);
            goPending = null;
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                setHelpOpen(false);
                setPaletteOpen((current) => !current);
                return;
            }
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (dialogOpenRef.current || isTypingTarget(event.target)) return;

            if (event.key === 'Escape') {
                // On narrow screens the copilot is an overlay; Esc closes it.
                if (!window.matchMedia(DOCK_QUERY).matches) setCopilotOpen((current) => (current ? false : current));
                return;
            }
            const key = event.key.toLowerCase();
            if (goPending) {
                clearGo();
                const target = GO_KEYS[key];
                if (target) {
                    event.preventDefault();
                    keyActionsRef.current.goTo(target);
                }
                return;
            }
            if (event.key === '?') {
                event.preventDefault();
                setHelpOpen(true);
            } else if (key === 'g') {
                goPending = setTimeout(clearGo, 1200);
            } else if (key === 'n') {
                event.preventDefault();
                keyActionsRef.current.requestCreate('single');
            } else if (key === 'c') {
                event.preventDefault();
                keyActionsRef.current.toggleCopilot();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => { window.removeEventListener('keydown', onKeyDown); clearGo(); };
    }, []);

    const selectedId = route.section === 'estudio' && route.videoId ? route.videoId : stickyId;
    const selectedVideo = videos.find((video) => video.id === selectedId) ?? null;
    const pendingCount = videos.filter((video) => video.status === 'pendiente_aprobacion').length;
    const renderingCount = videos.filter((video) => video.render_status === 'procesando').length;

    // Dock visibility: explicit choice, or CSS decides by width (null).
    const dockVisibility = copilotOpen === null ? 'hidden xl:flex' : copilotOpen ? 'flex' : 'hidden';
    // What the toggle reports to assistive tech; "auto" reads as visible on
    // wide screens, which is the common desk setup.
    const copilotPressed = copilotOpen ?? true;

    let content: React.ReactNode;
    switch (route.section) {
        case 'estudio':
            content = (
                <StudioView
                    videos={videos}
                    loading={loading}
                    loadError={loadError}
                    onRetry={retryLoad}
                    routeVideoId={route.videoId}
                    selectedId={selectedId}
                    libraries={libraries}
                    createRequest={createRequest}
                    reveal={reveal}
                    onSelect={(id) => openVideo(id, true)}
                    onCreated={(video) => handleCreated(video)}
                    onBatchCreated={handleBatchCreated}
                    onUpdated={handleUpdated}
                    onDuplicated={(video) => handleCreated(video)}
                    onDeleted={handleDeleted}
                    onBackToList={() => navigate('estudio')}
                    onNewVideo={() => requestCreate('single')}
                    onShowAll={() => navigate('biblioteca')}
                />
            );
            break;
        case 'biblioteca':
            content = (
                <LibraryView
                    videos={videos}
                    loading={loading}
                    loadError={loadError}
                    onRetry={retryLoad}
                    now={now}
                    onOpen={(id) => openVideo(id, true)}
                    onNewVideo={() => requestCreate('single')}
                />
            );
            break;
        case 'flujo':
            content = <ApprovalBoard videos={videos} loading={loading} now={now} onOpen={(id) => openVideo(id, true)} />;
            break;
        case 'marca':
            content = (
                <BrandView
                    videos={videos}
                    selected={selectedVideo}
                    libraries={libraries}
                    onSelectVideo={setStickyId}
                    onUpdated={handleUpdated}
                />
            );
            break;
        case 'sonidos':
            content = (
                <SoundsView
                    videos={videos}
                    selected={selectedVideo}
                    libraries={libraries}
                    onSelectVideo={setStickyId}
                    onUpdated={handleUpdated}
                />
            );
            break;
        default:
            content = (
                <DashboardView
                    videos={videos}
                    loading={loading}
                    loadError={loadError}
                    onRetry={retryLoad}
                    now={now}
                    onOpen={(id) => openVideo(id, true)}
                    onNewVideo={() => requestCreate('single')}
                    onNewBatch={() => requestCreate('batch')}
                    onOpenCopilot={() => setCopilotOpen(true)}
                    onGoToBoard={() => navigate('flujo')}
                />
            );
    }

    return (
        <div className="relative flex min-h-screen flex-1 flex-col">
            <div aria-hidden="true" className="app-backdrop" />

            <AppSidebar
                current={route.section}
                collapsed={sidebarCollapsed}
                onToggleCollapsed={toggleSidebar}
                mobileOpen={mobileNavOpen}
                onCloseMobile={() => setMobileNavOpen(false)}
                pendingCount={pendingCount}
                renderingCount={renderingCount}
                copilotMood={copilotMood}
                onNavigate={goTo}
                onNewVideo={() => requestCreate('single')}
                onOpenCopilot={() => setCopilotOpen(true)}
                onShowShortcuts={() => setHelpOpen(true)}
            />

            <div className={`flex min-w-0 flex-1 flex-col transition-[padding] duration-300 ease-out-expo ${sidebarCollapsed ? 'lg:pl-[4.5rem]' : 'lg:pl-64'}`}>
                <AppTopbar
                    section={route.section}
                    renderingCount={renderingCount}
                    email={email}
                    signInNeeded={signInNeeded}
                    loggingOut={loggingOut}
                    copilotVisible={copilotPressed}
                    copilotMood={copilotMood}
                    onOpenMobileNav={() => setMobileNavOpen(true)}
                    onOpenPalette={() => setPaletteOpen(true)}
                    onShowShortcuts={() => setHelpOpen(true)}
                    onToggleCopilot={toggleCopilot}
                    onLogout={() => { void handleLogout(); }}
                />

                <div className="flex min-w-0 flex-1">
                    <main id="contenido" className="min-w-0 flex-1 px-4 pb-16 pt-5 sm:px-6 sm:pt-7 lg:px-8">
                        <div key={route.section} className="mx-auto max-w-[96rem]">
                            {content}
                        </div>
                    </main>

                    {copilotOpen === true && (
                        <button
                            type="button"
                            aria-label="Cerrar el copiloto"
                            onClick={() => setCopilotOpen(false)}
                            className="fixed inset-0 z-30 animate-fade-in bg-ink-950/60 backdrop-blur-[2px] xl:hidden"
                        />
                    )}
                    {/* Always mounted: closing only hides it, so the
                        conversation, the voice and an open hands-free
                        microphone survive moving between sections. */}
                    <aside
                        id="copilot-dock"
                        aria-label="Copiloto"
                        className={`${dockVisibility} glass fixed inset-y-0 right-0 z-40 w-full max-w-[25rem] flex-col border-l border-white/[0.07] xl:sticky xl:top-[3.75rem] xl:z-10 xl:h-[calc(100dvh-3.75rem)] xl:w-[24rem] xl:max-w-none xl:shrink-0`}
                    >
                        <Assistant
                            videos={videos}
                            loading={loading}
                            loadError={loadError}
                            selected={selectedVideo}
                            onCreated={(video) => handleCreated(video, false)}
                            onUpdated={handleUpdated}
                            onSelect={(id) => openVideo(id, false)}
                            onDeleted={handleDeleted}
                            onClose={() => setCopilotOpen(false)}
                            onMoodChange={setCopilotMood}
                            className="h-full !rounded-none !border-0 !bg-transparent !shadow-none"
                        />
                    </aside>
                </div>
            </div>

            <CommandPalette
                open={paletteOpen}
                onClose={() => setPaletteOpen(false)}
                videos={videos}
                actions={{
                    goTo,
                    openVideo: (id) => openVideo(id, true),
                    newVideo: () => requestCreate('single'),
                    newBatch: () => requestCreate('batch'),
                    toggleCopilot,
                    showShortcuts: () => setHelpOpen(true),
                }}
            />
            <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
        </div>
    );
}
