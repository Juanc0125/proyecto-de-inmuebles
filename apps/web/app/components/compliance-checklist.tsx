'use client';

import { useState } from 'react';
import type { VideoRecord } from './api';
import { COMPLIANCE_RULES, scanVideo } from './compliance';
import { Icon } from './section-icon';

// Advisory only: shown next to "Enviar a aprobación" and to the approver, it
// lists risky phrases found in the script and the scenes. It never disables a
// button - the person decides (RF-012) - and says so in plain words.
export default function ComplianceChecklist({ video }: { video: VideoRecord }) {
    const findings = scanVideo(video);
    const [expanded, setExpanded] = useState(true);
    const flagged = new Set(findings.map((finding) => finding.rule.id));
    const hitCount = findings.reduce((sum, finding) => sum + finding.hits.length, 0);

    return (
        <div
            className={`rounded-xl border p-4 ${findings.length > 0 ? 'border-amber-400/25 bg-amber-400/[0.05]' : 'border-emerald-400/20 bg-emerald-400/[0.04]'}`}
            aria-labelledby={`compliance-${video.id}`}
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 id={`compliance-${video.id}`} className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Icon name={findings.length > 0 ? 'alert' : 'shield'} className={findings.length > 0 ? 'text-amber-300' : 'text-emerald-300'} />
                    Revisión de cumplimiento
                    <span className="eyebrow normal-case tracking-normal">orientativa</span>
                </h4>
                <button
                    type="button"
                    onClick={() => setExpanded((current) => !current)}
                    aria-expanded={expanded}
                    className="btn btn-ghost btn-sm"
                >
                    {expanded ? 'Ocultar detalle' : 'Ver detalle'}
                </button>
            </div>

            <p className={`mt-2 text-sm ${findings.length > 0 ? 'text-amber-100' : 'text-emerald-100'}`} role="status">
                {findings.length > 0
                    ? `${hitCount} ${hitCount === 1 ? 'frase podría' : 'frases podrían'} ser riesgosas en publicidad hipotecaria. Revísalas antes de continuar.`
                    : 'No se encontraron frases de riesgo comunes en el guion ni en las escenas.'}
            </p>

            {expanded && (
                <ul className="mt-3 space-y-2">
                    {COMPLIANCE_RULES.map((rule) => {
                        const finding = findings.find((entry) => entry.rule.id === rule.id);
                        const ok = !flagged.has(rule.id);
                        return (
                            <li key={rule.id} className="rounded-lg border border-white/[0.06] bg-ink-950/40 px-3 py-2.5">
                                <div className="flex items-start gap-2.5">
                                    <span
                                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${
                                            ok ? 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/30' : 'bg-amber-400/15 text-amber-300 ring-amber-400/40'
                                        }`}
                                    >
                                        <Icon name={ok ? 'check' : 'alert'} size={11} strokeWidth={2.5} />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm text-slate-100">
                                            <span className="sr-only">{ok ? 'Sin hallazgos: ' : 'Revisar: '}</span>
                                            {rule.label}
                                        </p>
                                        {finding && (
                                            <>
                                                <p className="hint mt-0.5">{rule.why}</p>
                                                <ul className="mt-1.5 space-y-1">
                                                    {finding.hits.map((hit, index) => (
                                                        <li key={`${hit.source}-${index}`} className="break-words text-xs text-amber-100/90">
                                                            <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-amber-300">{hit.source}</span>
                                                            {' · '}
                                                            &ldquo;{hit.excerpt}&rdquo;
                                                        </li>
                                                    ))}
                                                </ul>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            <p className="hint mt-3 border-t border-white/[0.06] pt-3">
                Revisión automática y orientativa: busca frases de riesgo frecuentes en publicidad de crédito hipotecario.
                No reemplaza la revisión legal o de cumplimiento, no bloquea el envío y un resultado limpio no garantiza que
                el contenido cumpla la normativa. La decisión es de la persona que aprueba.
            </p>
        </div>
    );
}
