import type { Config } from 'tailwindcss';

const config: Config = {
    content: ['./app/**/*.{js,ts,jsx,tsx,mdx}'],
    theme: {
        extend: {
            // The faces are loaded in layout.tsx as CSS variables. Inter carries
            // the UI, Geist Mono the technical layer (labels, numbers, codes);
            // Instrument Serif stays loaded for the login page's headline.
            fontFamily: {
                sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
                display: ['var(--font-display)', 'ui-serif', 'Georgia', 'serif'],
                mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
            },
            colors: {
                // Brand: one restrained electric cyan, the "mission control"
                // accent. 700 is the lightest shade white text still passes
                // WCAG AA on, so it is the fill for primary buttons; 200-400
                // are for text, focus rings and glows on the dark ground.
                brand: {
                    50: '#ecfeff',
                    100: '#cffafe',
                    200: '#a5f3fc',
                    300: '#67e8f9',
                    400: '#22d3ee',
                    500: '#06b6d4',
                    600: '#0891b2',
                    700: '#0e7490',
                    800: '#155e75',
                    900: '#164e63',
                },
                // Secondary tone for gradients only: a cool steel blue next to
                // the cyan, so a gradient reads as light, not as a second brand.
                accent: {
                    300: '#93c5fd',
                    400: '#60a5fa',
                    500: '#3b82f6',
                    600: '#2563eb',
                },
                // Surfaces, from the page ground up to a raised control: a deep
                // navy graphite, so the cyan is what reads as colour on screen.
                ink: {
                    950: '#04070d',
                    900: '#070b14',
                    850: '#0b111d',
                    800: '#101828',
                    700: '#172135',
                    600: '#223049',
                },
            },
            boxShadow: {
                panel: '0 1px 0 0 rgba(255, 255, 255, 0.05) inset, 0 0 0 1px rgba(0, 0, 0, 0.25), 0 24px 48px -24px rgba(0, 0, 0, 0.85)',
                glow: '0 0 0 1px rgba(34, 211, 238, 0.35), 0 8px 32px -8px rgba(6, 182, 212, 0.5)',
                'glow-emerald': '0 0 0 1px rgba(52, 211, 153, 0.4), 0 8px 28px -10px rgba(16, 185, 129, 0.6)',
            },
            transitionTimingFunction: {
                'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
            },
            keyframes: {
                'slide-in-right': {
                    from: { opacity: '0', transform: 'translateX(16px)' },
                    to: { opacity: '1', transform: 'translateX(0)' },
                },
                'fade-up': {
                    from: { opacity: '0', transform: 'translateY(6px)' },
                    to: { opacity: '1', transform: 'translateY(0)' },
                },
                'fade-in': {
                    from: { opacity: '0' },
                    to: { opacity: '1' },
                },
            },
            animation: {
                'slide-in-right': 'slide-in-right 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
                'fade-up': 'fade-up 0.45s cubic-bezier(0.16, 1, 0.3, 1) both',
                'fade-in': 'fade-in 0.3s ease-out both',
            },
        },
    },
    plugins: [],
};

export default config;
