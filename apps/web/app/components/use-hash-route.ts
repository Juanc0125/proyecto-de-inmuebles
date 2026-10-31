'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { SECTIONS, type Section } from './studio-utils';

// Navigation lives in the URL hash (#/flujo, #/estudio/<id>) instead of app
// routes: the shell, the copilot's open conversation and its microphone must
// survive moving between sections, and a route change would remount them.
// The hash still gives deep links and a working back button.

export interface HashRoute {
    section: Section;
    videoId: string | null;
}

const KNOWN = new Set<string>(SECTIONS.map((entry) => entry.id));

export function parseHash(hash: string): HashRoute {
    const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const section = KNOWN.has(parts[0] ?? '') ? (parts[0] as Section) : 'panel';
    const videoId = section === 'estudio' && parts[1] ? decodeURIComponent(parts[1]) : null;
    return { section, videoId };
}

export function buildHash(section: Section, videoId: string | null = null): string {
    return section === 'estudio' && videoId ? `#/estudio/${encodeURIComponent(videoId)}` : `#/${section}`;
}

function subscribe(onChange: () => void) {
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
}

const readHash = () => window.location.hash;
// The server has no hash; it renders the dashboard and the client corrects
// itself right after hydration.
const readServerHash = () => '';

export function useHashRoute() {
    const hash = useSyncExternalStore(subscribe, readHash, readServerHash);
    const route = parseHash(hash);

    const navigate = useCallback((section: Section, videoId: string | null = null) => {
        const next = buildHash(section, videoId);
        if (window.location.hash !== next) window.location.hash = next;
    }, []);

    return { route, navigate };
}
