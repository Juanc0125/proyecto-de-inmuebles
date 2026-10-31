// Client-side, advisory scan of a video's words for phrases that tend to get
// mortgage advertising in trouble: promised approval, skipped requirements,
// specific rates or payments, unprovable superlatives. It is a reminder for
// the person who approves (RF-012), not a filter: it never blocks anything,
// and a clean result does not mean the copy is compliant.

import type { VideoRecord } from './api';
import { normalizeText, sortedScenes } from './studio-utils';

export interface ComplianceRule {
    id: string;
    label: string;
    why: string;
    // Matched against accent-free, lower-case text, so "aprobación" and
    // "APROBACION" are the same phrase.
    patterns: RegExp[];
}

export const COMPLIANCE_RULES: ComplianceRule[] = [
    {
        id: 'garantia',
        label: 'Promesa de aprobación o resultado garantizado',
        why: 'Ningún crédito se puede garantizar antes de evaluar a la persona.',
        patterns: [
            /\bgarantizad[oa]s?\b/,
            /\bgarantizamos\b/,
            /\bgarantia de aprobacion\b/,
            /\baprobacion (asegurada|segura|inmediata|instantanea|al instante)\b/,
            /\b(te|lo|la|los) aprobamos\b/,
            /\b100 ?% aprobad[oa]s?\b/,
            /\b(todos|todas|cualquiera|cualquier persona) (califica|califican|calificas)\b/,
            /\bseguro que (calificas|te aprueban|te lo aprueban)\b/,
            /\baprobad[oa] (al instante|en minutos|sin falta)\b/,
        ],
    },
    {
        id: 'requisitos',
        label: 'Omisión de requisitos o del historial crediticio',
        why: 'Sugerir que no se evalúan ingresos, historial o documentos es engañoso.',
        patterns: [
            /\bsin requisitos\b/,
            /\bsin (papeleo|tramites|comprobar ingresos|comprobantes|aval)\b/,
            /\bsin (buro|historial|historial crediticio|revisar tu historial)\b/,
            /\bsin importar (tu|su) (historial|buro|score|puntaje)\b/,
            /\bno importa (tu|su) (historial|buro|score|puntaje)\b/,
            /\bmal historial no (importa|es problema)\b/,
        ],
    },
    {
        id: 'tasa',
        label: 'Tasa, porcentaje o cifra específica',
        why: 'Una tasa o cifra concreta exige condiciones y vigencia; no se inventan ni se prometen.',
        patterns: [
            /\b\d+(?:[.,]\d+)? ?%/,
            /\btasa (de|del) \d/,
            /\b\d+(?:[.,]\d+)? (por ciento|puntos porcentuales)\b/,
            /\bcat (de |del )?\d/,
        ],
    },
    {
        id: 'pago',
        label: 'Montos o pagos concretos',
        why: 'Una cuota o monto depende de cada caso; mostrarlo como general puede inducir a error.',
        patterns: [
            /\$ ?\d/,
            /\b(cuota|mensualidad|pago|enganche|cuota inicial)(es)? (de|desde) (solo )?\$? ?\d/,
            /\bpagaras (solo|unicamente)\b/,
            /\b\d[\d.,]* (pesos|dolares|mil pesos|millones)\b/,
        ],
    },
    {
        id: 'superlativo',
        label: 'Afirmación comparativa que no se puede sustentar',
        why: '"El mejor" o "la más baja" requieren prueba y suelen estar prohibidos sin ella.',
        patterns: [
            /\b(el|la) mejor (credito|tasa|hipoteca|opcion del mercado|prestamo)\b/,
            /\b(la|el) (tasa|credito|hipoteca) mas (baja|barata|barato)\b/,
            /\b(el|la) mas barat[oa] del mercado\b/,
            /\bnumero uno\b/,
            /\bmejor que (cualquier|todos los) (banco|bancos)\b/,
        ],
    },
    {
        id: 'riesgo',
        label: 'Ausencia de riesgo o presión de urgencia',
        why: 'Un crédito siempre tiene riesgos; la urgencia artificial presiona la decisión.',
        patterns: [
            /\bsin (ningun )?riesgo\b/,
            /\blibre de riesgo\b/,
            /\bsolo (por )?hoy\b/,
            /\bultima oportunidad\b/,
            /\bantes de que se acabe\b/,
        ],
    },
];

export interface ComplianceHit {
    source: string;
    excerpt: string;
}

export interface ComplianceFinding {
    rule: ComplianceRule;
    hits: ComplianceHit[];
}

// A short window of the original (accented) text around the match, so the
// operator can find the phrase without reading the whole script again.
function excerptAround(original: string, index: number, length: number): string {
    const start = Math.max(0, index - 28);
    const end = Math.min(original.length, index + length + 28);
    return `${start > 0 ? '…' : ''}${original.slice(start, end).replace(/\s+/g, ' ').trim()}${end < original.length ? '…' : ''}`;
}

export function scanVideo(video: VideoRecord): ComplianceFinding[] {
    const sources: { source: string; text: string }[] = [
        { source: 'Guion', text: video.script },
        ...sortedScenes(video).map((scene, index) => ({ source: `Escena ${index + 1}`, text: scene.description })),
    ];

    const findings: ComplianceFinding[] = [];
    for (const rule of COMPLIANCE_RULES) {
        const hits: ComplianceHit[] = [];
        for (const { source, text } of sources) {
            if (!text) continue;
            // NFD removal of combining marks keeps every base character in
            // place for Spanish text, so an index in the normalised string
            // points at the same spot in the original.
            const normalized = normalizeText(text);
            for (const pattern of rule.patterns) {
                const match = pattern.exec(normalized);
                if (match) {
                    hits.push({ source, excerpt: excerptAround(text, match.index, match[0].length) });
                    break;
                }
            }
        }
        if (hits.length > 0) findings.push({ rule, hits });
    }
    return findings;
}
