'use client';

import Modal from './modal';
import { Icon } from './section-icon';

// `sequence`: pressed one after the other (G, then P); otherwise together.
export const SHORTCUTS: { keys: string[]; label: string; sequence?: boolean }[] = [
    { keys: ['Ctrl', 'K'], label: 'Abrir la paleta de comandos (⌘ K en Mac)' },
    { keys: ['?'], label: 'Mostrar esta ayuda' },
    { keys: ['N'], label: 'Nuevo video' },
    { keys: ['C'], label: 'Abrir o cerrar el copiloto' },
    { sequence: true, keys: ['G', 'P'], label: 'Ir al Panel' },
    { sequence: true, keys: ['G', 'E'], label: 'Ir al Estudio' },
    { sequence: true, keys: ['G', 'B'], label: 'Ir a la Biblioteca' },
    { sequence: true, keys: ['G', 'F'], label: 'Ir al Flujo de aprobación' },
    { sequence: true, keys: ['G', 'M'], label: 'Ir a Marca' },
    { sequence: true, keys: ['G', 'S'], label: 'Ir a Efectos de sonido' },
    { keys: ['Esc'], label: 'Cerrar un diálogo o el copiloto en pantallas pequeñas' },
];

export default function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
    return (
        <Modal open={open} onClose={onClose} labelledBy="shortcuts-title">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
                <h2 id="shortcuts-title" className="flex items-center gap-2.5 text-base font-semibold text-white">
                    <Icon name="keyboard" className="text-brand-300" />
                    Atajos de teclado
                </h2>
                <button type="button" onClick={onClose} aria-label="Cerrar la ayuda de atajos" className="btn-icon">
                    <Icon name="close" />
                </button>
            </div>
            <dl className="divide-y divide-white/[0.05] px-5 py-2">
                {SHORTCUTS.map((shortcut) => (
                    <div key={shortcut.label} className="flex items-center justify-between gap-4 py-2.5">
                        <dt className="text-sm text-slate-300">{shortcut.label}</dt>
                        <dd className="flex shrink-0 items-center gap-1">
                            {shortcut.keys.map((key, index) => (
                                <span key={key} className="flex items-center gap-1">
                                    {index > 0 && (
                                        <span className="text-[0.625rem] text-slate-500">{shortcut.sequence ? 'luego' : '+'}</span>
                                    )}
                                    <kbd className="kbd">{key}</kbd>
                                </span>
                            ))}
                        </dd>
                    </div>
                ))}
            </dl>
            <p className="hint border-t border-white/[0.07] px-5 py-3">
                Las teclas de una letra no actúan mientras escribes en un campo de texto.
            </p>
        </Modal>
    );
}
