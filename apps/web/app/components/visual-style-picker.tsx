'use client';

import type { VisualStyle } from '@shared-types/video';

export const VISUAL_STYLE_LABELS: Record<VisualStyle, string> = {
    ilustracion: 'Ilustración 2D',
    realista: 'Realista (fotos IA)',
};

export const REALISTA_NOTE = 'Imágenes generadas por IA gratuita; revisa que representen bien al negocio.';

interface VisualStylePickerProps {
    value: VisualStyle;
    onChange: (value: VisualStyle) => void;
    disabled?: boolean;
    // Distinguishes the create form's picker from the workspace's when both
    // could be on screen; also names the group for assistive tech.
    idPrefix: string;
    compact?: boolean;
}

const OPTIONS: VisualStyle[] = ['ilustracion', 'realista'];

// Two looks for the same scenes: the drawn stick figures, or one AI photo per
// scene. Shared by the create form (single and batch) and the workspace
// header so the two places name and explain the choice identically.
export default function VisualStylePicker({ value, onChange, disabled = false, idPrefix, compact = false }: VisualStylePickerProps) {
    return (
        <fieldset aria-describedby={value === 'realista' ? `${idPrefix}-realista-note` : undefined}>
            <legend className={compact ? 'sr-only' : 'label'}>Estilo visual</legend>
            <div className={`segmented grid w-full grid-cols-2 ${compact ? 'sm:w-auto' : ''}`}>
                {OPTIONS.map((option) => (
                    <button
                        key={option}
                        type="button"
                        aria-pressed={value === option}
                        onClick={() => { if (option !== value) onChange(option); }}
                        disabled={disabled}
                    >
                        {VISUAL_STYLE_LABELS[option]}
                    </button>
                ))}
            </div>
            {value === 'realista' && (
                <p id={`${idPrefix}-realista-note`} className="hint mt-1.5 text-amber-200/90">{REALISTA_NOTE}</p>
            )}
        </fieldset>
    );
}
