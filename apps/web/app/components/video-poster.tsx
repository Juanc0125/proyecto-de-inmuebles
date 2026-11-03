'use client';

import { useRef } from 'react';
import type { Branding, CharacterType, ScenePropType } from '@shared-types/video';
import type { VideoRecord } from './api';
import { sortedScenes } from './studio-utils';

// A small 9:16 "frame" drawn from the record itself: the brand's colours, a
// stick figure, the prop and the first line as a subtitle, the logo in its
// corner. It is an impression of the video, not a render - the real MP4 only
// exists after approval - so it costs nothing and is always available.

const FONT_STACKS: Record<string, string> = {
    sans: 'ui-sans-serif, system-ui, Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    condensed: '"Arial Narrow", "Roboto Condensed", ui-sans-serif, sans-serif',
    mono: 'ui-monospace, Consolas, monospace',
};

export function brandFont(branding: Branding): string {
    return FONT_STACKS[branding.font_family] ?? FONT_STACKS.sans;
}

const LOGO_CORNER: Record<Branding['logo_position'], string> = {
    'top-left': 'left-[7%] top-[5%]',
    'top-right': 'right-[7%] top-[5%]',
    'bottom-left': 'left-[7%] bottom-[24%]',
    'bottom-right': 'right-[7%] bottom-[24%]',
};

function Figure({ x, color }: { x: number; color: string }) {
    return (
        <g stroke={color} strokeWidth="3.2" strokeLinecap="round" fill="none">
            <circle cx={x} cy="40" r="7" fill={color} stroke="none" />
            <path d={`M${x} 48v24M${x} 55l-10 8M${x} 55l10 6M${x} 72l-8 16M${x} 72l8 16`} />
        </g>
    );
}

// Just enough of each prop to be recognisable at 60px wide.
function Prop({ prop, color }: { prop: ScenePropType; color: string }) {
    const common = { stroke: color, strokeWidth: 2.4, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
    switch (prop) {
        case 'casa':
            return <path {...common} d="M62 88V70l12-10 12 10v18zM70 88v-9h8v9" />;
        case 'carro':
            return <path {...common} d="M58 84h30v-7l-5-6H66l-5 6h-3zM64 86a2.5 2.5 0 1 0 .01 0M82 86a2.5 2.5 0 1 0 .01 0" />;
        case 'banco':
            return <path {...common} d="M60 70h28l-14-8zM63 72v13M70 72v13M78 72v13M85 72v13M60 87h28" />;
        case 'telefono':
            return <rect {...common} x="68" y="64" width="12" height="22" rx="2.5" />;
        case 'documento':
            return <path {...common} d="M66 62h12l6 6v20H66zM70 72h10M70 77h10M70 82h6" />;
        case 'dinero':
            return <path {...common} d="M62 68h24v16H62zM74 72a4 4 0 1 0 .01 0" />;
        case 'grafico':
            return <path {...common} d="M62 88V64M62 88h26M67 82l6-7 5 4 8-10" />;
        case 'oficina':
            return <path {...common} d="M60 76h28M64 76v12M84 76v12M68 76v-8h12v8" />;
        default:
            return null;
    }
}

interface VideoPosterProps {
    video: VideoRecord;
    // Which scene to draw; defaults to the first one.
    sceneIndex?: number;
    className?: string;
    // Plays the real MP4 on hover/focus when one exists (Biblioteca).
    hoverPreview?: boolean;
    showSubtitle?: boolean;
}

export default function VideoPoster({ video, sceneIndex = 0, className = '', hoverPreview = false, showSubtitle = true }: VideoPosterProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const { branding } = video;
    const scenes = sortedScenes(video);
    const scene = scenes[sceneIndex] ?? null;
    const character: CharacterType = scene?.character ?? 'broker';
    const subtitle = scene?.description ?? video.topic;
    const rendering = video.render_status === 'procesando';
    // A realistic video shows the scene's AI photo instead of the drawn
    // figure. Hidden when the operator switched back to the illustrated look:
    // the photo stays on the scene, but it is no longer what will be rendered.
    const photo = video.visual_style !== 'ilustracion' ? scene?.image_url ?? null : null;

    function play() {
        const element = videoRef.current;
        if (!element) return;
        element.currentTime = 0;
        // A refused autoplay just leaves the poster showing.
        void element.play().catch(() => undefined);
    }

    function stop() {
        videoRef.current?.pause();
    }

    const previewable = hoverPreview && Boolean(video.video_url);

    return (
        <div
            className={`group/poster relative aspect-[9/16] overflow-hidden rounded-lg ring-1 ring-inset ring-white/10 ${className}`}
            // Container query units size the subtitle to the frame, whatever
            // width the frame is drawn at.
            style={{ backgroundColor: branding.primary_color, containerType: 'inline-size' }}
            onMouseEnter={previewable ? play : undefined}
            onMouseLeave={previewable ? stop : undefined}
            aria-hidden="true"
        >
            {/* Depth: a soft light from the top and a vignette at the bottom
                where the subtitle sits. */}
            {photo && (
                // eslint-disable-next-line @next/next/no-img-element -- generated image in Supabase Storage, not a static asset.
                <img src={photo} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
            )}
            {!photo && <div className="absolute inset-0 bg-[radial-gradient(120%_70%_at_50%_0%,rgba(255,255,255,0.16),transparent_60%)]" />}
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/45 to-transparent" />

            {!photo && <svg viewBox="0 0 100 120" className="absolute inset-x-0 top-[8%] mx-auto w-[86%]">
                {character === 'pareja' ? (
                    <>
                        <Figure x={30} color={branding.secondary_color} />
                        <Figure x={48} color={branding.secondary_color} />
                    </>
                ) : (
                    <Figure x={38} color={branding.secondary_color} />
                )}
                {scene && <Prop prop={scene.prop} color={branding.secondary_color} />}
                <path d="M14 92h72" stroke={branding.secondary_color} strokeOpacity="0.35" strokeWidth="1.5" />
            </svg>}

            {branding.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL, not a static asset.
                <img src={branding.logo_url} alt="" className={`absolute h-[9%] w-auto max-w-[34%] object-contain ${LOGO_CORNER[branding.logo_position]}`} />
            )}

            {showSubtitle && (
                <p
                    className="absolute inset-x-[7%] bottom-[7%] line-clamp-3 text-center text-[clamp(0.4rem,7cqw,0.9rem)] font-semibold leading-tight"
                    style={{ color: branding.secondary_color, fontFamily: brandFont(branding), textShadow: '0 1px 2px rgba(0,0,0,0.45)' }}
                >
                    {subtitle}
                </p>
            )}

            {previewable && video.video_url && (
                <video
                    ref={videoRef}
                    src={video.video_url}
                    muted
                    loop
                    playsInline
                    preload="none"
                    className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300 group-hover/poster:opacity-100"
                />
            )}

            {rendering && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-ink-950/60 backdrop-blur-[1px]">
                    <span className="spinner h-4 w-4 text-brand-300" />
                    <span className="font-mono text-[0.625rem] font-semibold tabular-nums text-brand-100">{video.render_progress}%</span>
                    <span className="absolute inset-x-0 bottom-0 h-1 bg-ink-950/80">
                        <span className="block h-full bg-brand-400 transition-[width] duration-700" style={{ width: `${Math.max(3, video.render_progress)}%` }} />
                    </span>
                </div>
            )}
        </div>
    );
}
