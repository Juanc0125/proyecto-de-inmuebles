// Small line icons, all on one 24px grid with the same stroke so the whole
// interface reads as one set. `SectionIcon` draws one on the `.section-icon`
// tile for panel headers; `Icon` is the bare glyph for buttons, the sidebar
// and inline labels. Inline SVG on purpose: no icon dependency to ship.

export type SectionIconName =
    | 'sparkles'
    | 'library'
    | 'script'
    | 'scenes'
    | 'sound'
    | 'brand'
    | 'shield'
    | 'copy'
    | 'dashboard'
    | 'studio'
    | 'board'
    | 'search'
    | 'command'
    | 'export'
    | 'menu'
    | 'close'
    | 'chevron-left'
    | 'chevron-right'
    | 'alert'
    | 'play'
    | 'grid'
    | 'list'
    | 'bolt'
    | 'clock'
    | 'keyboard'
    | 'bot'
    | 'plus'
    | 'layers'
    | 'check'
    | 'download'
    | 'link'
    | 'user'
    | 'activity'
    | 'film'
    | 'arrow-right'
    | 'trash'
    | 'team'
    | 'image'
    | 'refresh';

const PATHS: Record<SectionIconName, React.ReactNode> = {
    sparkles: (
        <>
            <path d="M12 3.5c.6 3.6 2.4 5.4 6 6-3.6.6-5.4 2.4-6 6-.6-3.6-2.4-5.4-6-6 3.6-.6 5.4-2.4 6-6Z" />
            <path d="M18.5 15.5c.3 1.5 1 2.2 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.3 2.2-1 2.5-2.5Z" />
        </>
    ),
    library: (
        <>
            <rect x="3" y="4" width="7" height="7" rx="1.5" />
            <rect x="14" y="4" width="7" height="7" rx="1.5" />
            <rect x="3" y="15" width="7" height="5" rx="1.5" />
            <rect x="14" y="15" width="7" height="5" rx="1.5" />
        </>
    ),
    script: (
        <>
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5M9 13h6M9 17h4" />
        </>
    ),
    scenes: (
        <>
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <path d="M3 9h18M8 4l-1.5 5M13.5 4 12 9M19 4l-1.5 5" />
        </>
    ),
    sound: (
        <>
            <path d="M9 18V5l11-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="17" cy="16" r="3" />
        </>
    ),
    brand: (
        <>
            <path d="M12 21a9 9 0 1 1 9-9c0 2.5-2 3.5-3.5 3.5H15a2 2 0 0 0-1.4 3.4c.6.6.4 2.1-1.6 2.1Z" />
            <circle cx="7.5" cy="11" r="1" />
            <circle cx="10.5" cy="7" r="1" />
            <circle cx="15.5" cy="7.5" r="1" />
        </>
    ),
    shield: (
        <>
            <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" />
            <path d="m9 12 2 2 4-4" />
        </>
    ),
    copy: (
        <>
            <rect x="8" y="8" width="13" height="13" rx="2.5" />
            <path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8" />
        </>
    ),
    dashboard: (
        <>
            <rect x="3" y="3" width="8" height="10" rx="1.5" />
            <rect x="13" y="3" width="8" height="6" rx="1.5" />
            <rect x="13" y="11" width="8" height="10" rx="1.5" />
            <rect x="3" y="15" width="8" height="6" rx="1.5" />
        </>
    ),
    studio: (
        <>
            <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
            <path d="m10.5 9 4 3-4 3z" />
        </>
    ),
    board: (
        <>
            <rect x="3" y="3" width="18" height="18" rx="2.5" />
            <path d="M9 3v18M15 3v18" />
            <path d="M5.5 7h1.5M11 7h2M17 7h1.5M11 11h2" />
        </>
    ),
    search: (
        <>
            <circle cx="11" cy="11" r="6.5" />
            <path d="m20 20-4.2-4.2" />
        </>
    ),
    command: (
        <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />
    ),
    export: (
        <>
            <path d="M12 15V3M7 8l5-5 5 5" />
            <path d="M5 13v5a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-5" />
        </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    'chevron-left': <path d="m15 6-6 6 6 6" />,
    'chevron-right': <path d="m9 6 6 6-6 6" />,
    alert: (
        <>
            <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9.5v4M12 17h.01" />
        </>
    ),
    play: <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />,
    grid: (
        <>
            <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
            <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
            <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
            <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
        </>
    ),
    list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
    bolt: <path d="M13 2 4.5 13.5H12L11 22l8.5-11.5H12z" />,
    clock: (
        <>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
        </>
    ),
    keyboard: (
        <>
            <rect x="2.5" y="6" width="19" height="12" rx="2" />
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
        </>
    ),
    bot: (
        <>
            <rect x="4" y="8" width="16" height="11" rx="3" />
            <path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5" />
            <circle cx="12" cy="3.5" r="1" />
        </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    layers: (
        <>
            <path d="m12 3 9 5-9 5-9-5z" />
            <path d="m3 13 9 5 9-5" />
        </>
    ),
    check: <path d="m5 12 5 5L20 7" />,
    download: (
        <>
            <path d="M12 3v12M7 10l5 5 5-5" />
            <path d="M5 20h14" />
        </>
    ),
    link: (
        <>
            <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
            <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
        </>
    ),
    user: (
        <>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
        </>
    ),
    activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
    film: (
        <>
            <rect x="3" y="3" width="18" height="18" rx="2.5" />
            <path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" />
        </>
    ),
    'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
    trash: <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />,
    // Three seats around a table: the AI workbench.
    team: (
        <>
            <circle cx="12" cy="6.5" r="2.5" />
            <circle cx="5" cy="9.5" r="2" />
            <circle cx="19" cy="9.5" r="2" />
            <path d="M3 15.5h18M5.5 15.5 4.5 20M18.5 15.5l1 4.5M8.5 15.5c0-2.2 1.6-4 3.5-4s3.5 1.8 3.5 4" />
        </>
    ),
    image: (
        <>
            <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
            <circle cx="9" cy="10" r="1.75" />
            <path d="m20.5 16-5-5-9 8.5" />
        </>
    ),
    refresh: <path d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.3L20 15.5M20 20v-4.5h-4.5" />,
};

interface IconProps {
    name: SectionIconName;
    size?: number;
    className?: string;
    strokeWidth?: number;
}

// The bare glyph. Always decorative: whatever carries it supplies the
// accessible name (a visible label or an aria-label).
export function Icon({ name, size = 16, className = '', strokeWidth = 1.75 }: IconProps) {
    const filled = name === 'play';
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={filled ? 'currentColor' : 'none'}
            stroke={filled ? 'none' : 'currentColor'}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`shrink-0 ${className}`}
        >
            {PATHS[name]}
        </svg>
    );
}

export default function SectionIcon({ name, className = '' }: { name: SectionIconName; className?: string }) {
    return (
        <span className={`section-icon ${className}`} aria-hidden="true">
            <Icon name={name} size={18} />
        </span>
    );
}
