'use client';

import { useEffect, useRef } from 'react';

export type EntityMood = 'idle' | 'listening' | 'thinking' | 'speaking';

interface AssistantEntityProps {
    mood: EntityMood;
    /**
     * Bumped by the parent on every sign of life - a recognised word while
     * listening, a word boundary while speaking. Each bump adds energy that the
     * figure spends over the next few hundred milliseconds, so it reacts to the
     * conversation instead of looping a fixed animation.
     */
    pulse: number;
    size?: number;
}

// One palette per mood: the operator should be able to tell from across the
// desk whether it is listening, thinking or talking without reading a label.
const PALETTE: Record<EntityMood, { core: string; glow: string; rim: string }> = {
    idle: { core: '#3b82f6', glow: 'rgba(59, 130, 246, 0.38)', rim: '#bfd6fe' },
    listening: { core: '#34d399', glow: 'rgba(52, 211, 153, 0.42)', rim: '#bbf7d0' },
    thinking: { core: '#a78bfa', glow: 'rgba(167, 139, 250, 0.42)', rim: '#ddd6fe' },
    speaking: { core: '#22d3ee', glow: 'rgba(34, 211, 238, 0.5)', rim: '#cffafe' },
};

const LOBES = 7;

function mix(from: string, to: string, t: number): string {
    const a = parseInt(from.slice(1), 16);
    const b = parseInt(to.slice(1), 16);
    const channel = (shift: number) => Math.round(((a >> shift) & 255) + ((((b >> shift) & 255) - ((a >> shift) & 255)) * t));
    return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/**
 * The assistant's body: a soft, breathing blob with a face, drawn on a canvas.
 * It breathes when idle, leans in and ripples with your voice while listening,
 * swirls while the model thinks, and pulses with each spoken word.
 */
export default function AssistantEntity({ mood, pulse, size = 132 }: AssistantEntityProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // Read every frame; refs so a mood change or a pulse never restarts the loop.
    const moodRef = useRef<EntityMood>(mood);
    const energyRef = useRef(0);
    const lastPulseRef = useRef(pulse);

    useEffect(() => {
        moodRef.current = mood;
    }, [mood]);

    useEffect(() => {
        if (pulse !== lastPulseRef.current) {
            lastPulseRef.current = pulse;
            energyRef.current = Math.min(1, energyRef.current + 0.45);
        }
    }, [pulse]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;

        const ratio = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = size * ratio;
        canvas.height = size * ratio;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);

        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        const speed = reducedMotion ? 0.35 : 1;

        // Per-lobe phase so the outline never repeats exactly.
        const phases = Array.from({ length: LOBES }, (_, i) => i * 1.7 + 0.3);
        let colorFrom = PALETTE[moodRef.current];
        let colorTo = colorFrom;
        let colorT = 1;
        let shownMood = moodRef.current;
        let blinkAt = 2.5;
        let frame = 0;
        let previous = performance.now();
        let elapsed = 0;

        const draw = (now: number) => {
            const dt = Math.min(0.05, (now - previous) / 1000) * speed;
            previous = now;
            elapsed += dt;
            const t = elapsed;
            const currentMood = moodRef.current;

            if (currentMood !== shownMood) {
                colorFrom = colorTo;
                colorTo = PALETTE[currentMood];
                colorT = 0;
                shownMood = currentMood;
            }
            colorT = Math.min(1, colorT + dt * 2.5);

            // Energy decays on its own; listening and speaking keep a floor so
            // the figure never looks frozen mid-conversation.
            const floor = currentMood === 'speaking' ? 0.18 : currentMood === 'listening' ? 0.1 : 0;
            energyRef.current = Math.max(floor, energyRef.current - dt * 1.6);
            const energy = energyRef.current;

            const center = size / 2;
            const breathe = Math.sin(t * (currentMood === 'idle' ? 1.3 : 2.1)) * 0.035;
            const base = size * (0.27 + breathe + energy * 0.05);
            const wobble = size * (currentMood === 'thinking' ? 0.035 : 0.02 + energy * 0.06);
            const spin = currentMood === 'thinking' ? t * 1.8 : t * 0.4;

            context.clearRect(0, 0, size, size);

            const core = mix(colorFrom.core, colorTo.core, colorT);
            const rim = mix(colorFrom.rim, colorTo.rim, colorT);
            const glow = colorT < 0.5 ? colorFrom.glow : colorTo.glow;

            // Halo
            const halo = context.createRadialGradient(center, center, base * 0.6, center, center, size * 0.5);
            halo.addColorStop(0, glow);
            halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
            context.fillStyle = halo;
            context.fillRect(0, 0, size, size);

            // Body outline: a circle pushed in and out by a few slow waves.
            const points = 64;
            context.beginPath();
            for (let i = 0; i <= points; i += 1) {
                const angle = (i / points) * Math.PI * 2;
                let offset = 0;
                for (let k = 0; k < LOBES; k += 1) {
                    offset += Math.sin(angle * (k % 3 + 2) + spin + phases[k] + t * (0.6 + k * 0.15)) / LOBES;
                }
                const radius = base + offset * wobble * 2.2;
                const x = center + Math.cos(angle) * radius;
                const y = center + Math.sin(angle) * radius;
                if (i === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            }
            context.closePath();
            const body = context.createRadialGradient(center - base * 0.35, center - base * 0.4, base * 0.1, center, center, base * 1.25);
            body.addColorStop(0, rim);
            body.addColorStop(0.55, core);
            body.addColorStop(1, 'rgba(15, 23, 42, 0.9)');
            context.fillStyle = body;
            context.shadowColor = glow;
            context.shadowBlur = 18 + energy * 22;
            context.fill();
            context.shadowBlur = 0;

            // Orbiting motes while thinking: the visible "working on it".
            if (currentMood === 'thinking') {
                for (let i = 0; i < 3; i += 1) {
                    const angle = t * 2.4 + (i * Math.PI * 2) / 3;
                    const orbit = base * 1.35;
                    context.beginPath();
                    context.arc(center + Math.cos(angle) * orbit, center + Math.sin(angle) * orbit * 0.55, size * 0.02, 0, Math.PI * 2);
                    context.fillStyle = rim;
                    context.fill();
                }
            }

            // Face. Eyes drift toward where the mood "looks": up while thinking,
            // straight at you otherwise; they blink every few seconds.
            const look = currentMood === 'thinking' ? -base * 0.12 : Math.sin(t * 0.7) * base * 0.04;
            const eyeY = center - base * 0.12 + look;
            const eyeGap = base * 0.34;
            if (t > blinkAt + 0.14) blinkAt = t + 2.5 + Math.random() * 3;
            const blinking = t > blinkAt;
            const eyeHeight = blinking ? base * 0.03 : base * (currentMood === 'listening' ? 0.2 : 0.16);
            context.fillStyle = 'rgba(255, 255, 255, 0.95)';
            for (const side of [-1, 1]) {
                context.beginPath();
                context.ellipse(center + side * eyeGap, eyeY, base * 0.085, eyeHeight / 2 + base * 0.02, 0, 0, Math.PI * 2);
                context.fill();
            }

            // Mouth: opens with the speech energy, a small smile otherwise.
            const mouthY = center + base * 0.32;
            context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            context.fillStyle = 'rgba(15, 23, 42, 0.75)';
            context.lineWidth = Math.max(1.5, size * 0.016);
            context.lineCap = 'round';
            if (currentMood === 'speaking') {
                const open = base * (0.05 + energy * 0.16 + Math.abs(Math.sin(t * 14)) * energy * 0.05);
                context.beginPath();
                context.ellipse(center, mouthY, base * 0.17, open, 0, 0, Math.PI * 2);
                context.fill();
                context.stroke();
            } else {
                context.beginPath();
                const curve = currentMood === 'thinking' ? base * 0.02 : base * 0.09;
                context.moveTo(center - base * 0.16, mouthY);
                context.quadraticCurveTo(center, mouthY + curve, center + base * 0.16, mouthY);
                context.stroke();
            }

            frame = requestAnimationFrame(draw);
        };

        frame = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(frame);
    }, [size]);

    return (
        <canvas
            ref={canvasRef}
            role="img"
            aria-label={
                mood === 'listening' ? 'El asistente te está escuchando'
                    : mood === 'thinking' ? 'El asistente está pensando'
                    : mood === 'speaking' ? 'El asistente está hablando'
                    : 'El asistente está disponible'
            }
            style={{ width: size, height: size }}
        />
    );
}
