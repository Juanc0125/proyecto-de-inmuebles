// Display-only helpers for the "mesa de trabajo": names, order and provider
// badges. Nothing here decides what the workbench does; the server owns that.

import type { Workbench, WorkbenchRole, WorkbenchStep } from '@shared-types/video';

export const WORKBENCH_ROLES: { role: WorkbenchRole; label: string; task: string; mark: string; visual: boolean }[] = [
    { role: 'guionista', label: 'Guionista', task: 'Escribe y pule el guion', mark: 'GU', visual: false },
    { role: 'director', label: 'Director', task: 'Reparte la historia en escenas', mark: 'DI', visual: false },
    { role: 'cumplimiento', label: 'Cumplimiento', task: 'Revisa las reglas del marketing financiero', mark: 'CU', visual: false },
    { role: 'critico', label: 'Crítico', task: 'Señala lo que no funciona', mark: 'CR', visual: false },
    { role: 'director_arte', label: 'Director de arte', task: 'Define el aspecto de cada escena', mark: 'DA', visual: true },
    { role: 'fotografo', label: 'Fotógrafo', task: 'Genera la imagen de cada escena', mark: 'FO', visual: true },
    { role: 'revisor_visual', label: 'Revisor visual', task: 'Comprueba que cada imagen corresponda', mark: 'RV', visual: true },
    { role: 'productor', label: 'Productor', task: 'Cierra y deja todo listo', mark: 'PR', visual: false },
];

export const ROLE_LABEL: Record<WorkbenchRole, string> = Object.fromEntries(
    WORKBENCH_ROLES.map((entry) => [entry.role, entry.label]),
) as Record<WorkbenchRole, string>;

const PROVIDER_LABEL: Record<string, string> = {
    gemini: 'Gemini',
    google: 'Gemini',
    groq: 'Groq',
    mistral: 'Mistral',
    openrouter: 'OpenRouter',
    cloudflare: 'Cloudflare',
    pollinations: 'Pollinations',
    local: 'Local',
};

// Model families worth naming next to the provider. The full model id is too
// long for a badge and changes every few weeks; the family is what the
// operator recognises.
const MODEL_FAMILIES: [RegExp, string][] = [
    [/llama/i, 'Llama'],
    [/flux/i, 'FLUX'],
    [/gemma/i, 'Gemma'],
    [/qwen/i, 'Qwen'],
    [/deepseek/i, 'DeepSeek'],
    [/mixtral/i, 'Mixtral'],
    [/grok/i, 'Grok'],
    [/sdxl|stable-diffusion/i, 'SDXL'],
    [/gpt/i, 'GPT'],
];

export function providerBadge(provider: string, model: string | null): string {
    const key = provider.trim().toLowerCase();
    const base = PROVIDER_LABEL[key] ?? (provider.trim() ? provider.trim().charAt(0).toUpperCase() + provider.trim().slice(1) : 'IA');
    if (!model) return base;
    const family = MODEL_FAMILIES.find(([pattern]) => pattern.test(model));
    if (!family || family[1].toLowerCase() === base.toLowerCase()) return base;
    return `${base} · ${family[1]}`;
}

export function sortedSteps(workbench: Workbench | null | undefined): WorkbenchStep[] {
    if (!workbench) return [];
    return [...workbench.steps].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
}

// The step being worked on right now, if any: the most recent running one.
export function currentStep(workbench: Workbench | null | undefined): WorkbenchStep | null {
    const running = sortedSteps(workbench).filter((step) => step.status === 'running');
    return running.length > 0 ? running[running.length - 1] : null;
}

export function formatSpan(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
