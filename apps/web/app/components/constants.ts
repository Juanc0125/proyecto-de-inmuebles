import type {
    CharacterType,
    LogoPosition,
    Platform,
    SceneAction,
    ScenePropType,
    VideoStatus,
} from '@shared-types/video';
import type { VideoTemplate } from '@shared-types/templates';

export const PLATFORM_OPTIONS: { value: Platform; label: string }[] = [
    { value: 'reels', label: 'Instagram Reels' },
    { value: 'tiktok', label: 'TikTok' },
    { value: 'shorts', label: 'YouTube Shorts' },
];

export const PLATFORM_LABELS: Record<Platform, string> = {
    reels: 'Instagram Reels',
    tiktok: 'TikTok',
    shorts: 'YouTube Shorts',
};

export const CHARACTER_OPTIONS: { value: CharacterType; label: string }[] = [
    { value: 'broker', label: 'Asesor / broker' },
    { value: 'cliente', label: 'Cliente' },
    { value: 'pareja', label: 'Pareja' },
    { value: 'hombre', label: 'Hombre' },
    { value: 'mujer', label: 'Mujer' },
    { value: 'generico', label: 'Genérico' },
];

export const ACTION_OPTIONS: { value: SceneAction; label: string }[] = [
    { value: 'hablar', label: 'Hablar' },
    { value: 'caminar', label: 'Caminar' },
    { value: 'senalar', label: 'Señalar' },
    { value: 'sentarse', label: 'Sentarse' },
    { value: 'pensar', label: 'Pensar' },
    { value: 'telefono', label: 'Hablar por teléfono' },
    { value: 'mostrar_objeto', label: 'Mostrar objeto' },
];

export const PROP_OPTIONS: { value: ScenePropType; label: string }[] = [
    { value: 'ninguno', label: 'Ninguno' },
    { value: 'casa', label: 'Casa' },
    { value: 'carro', label: 'Carro' },
    { value: 'banco', label: 'Banco' },
    { value: 'telefono', label: 'Teléfono' },
    { value: 'documento', label: 'Documento' },
    { value: 'dinero', label: 'Dinero' },
    { value: 'grafico', label: 'Gráfico' },
    { value: 'oficina', label: 'Oficina' },
];

export const LOGO_POSITION_OPTIONS: { value: LogoPosition; label: string }[] = [
    { value: 'top-left', label: 'Superior izquierda' },
    { value: 'top-right', label: 'Superior derecha' },
    { value: 'bottom-left', label: 'Inferior izquierda' },
    { value: 'bottom-right', label: 'Inferior derecha' },
];

export const STATUS_LABELS: Record<VideoStatus, string> = {
    borrador: 'Borrador',
    pendiente_aprobacion: 'Pendiente de aprobación',
    aprobado: 'Aprobado',
    publicado: 'Publicado',
};

// Tinted on the dark ground, each with a matching dot colour, so a status
// reads by colour and by text and every pair keeps WCAG AA contrast.
export const STATUS_BADGE_CLASSES: Record<VideoStatus, string> = {
    borrador: 'bg-slate-400/10 text-slate-200 ring-slate-400/25',
    pendiente_aprobacion: 'bg-amber-400/10 text-amber-200 ring-amber-400/30',
    aprobado: 'bg-brand-400/10 text-brand-200 ring-brand-400/30',
    publicado: 'bg-emerald-400/10 text-emerald-200 ring-emerald-400/30',
};

export const STATUS_DOT_CLASSES: Record<VideoStatus, string> = {
    borrador: 'bg-slate-400',
    pendiente_aprobacion: 'bg-amber-400',
    aprobado: 'bg-brand-400',
    publicado: 'bg-emerald-400',
};

// The four typefaces the renderer actually bundles. A brand can only pick from
// these, so the field is a select rather than free text.
export const FONT_OPTIONS = [
    { value: 'sans', label: 'Sans (neutra, tipo Arial)' },
    { value: 'serif', label: 'Serif (clásica, tipo Georgia)' },
    { value: 'condensed', label: 'Condensada (estrecha, titulares)' },
    { value: 'mono', label: 'Monoespaciada (técnica)' },
] as const;

// The template catalogue lives in shared-types without accents (it doubles as
// prompt text for the model). What a person reads on screen goes through this
// map so it carries proper Spanish spelling.
export const TEMPLATE_TEXT: Record<VideoTemplate, { label: string; description: string }> = {
    libre: { label: 'Libre', description: 'Sin estructura fija. La IA decide cómo contar el tema.' },
    conversacion: { label: 'Conversación', description: 'Dos personas hablando. El cliente pregunta, el asesor responde.' },
    explicacion: { label: 'Explicación', description: 'Un asesor explica un concepto de principio a fin, a cámara.' },
    comparacion: { label: 'Comparación', description: 'Dos opciones enfrentadas, y en qué se diferencian de verdad.' },
    llamada: { label: 'Llamada telefónica', description: 'Una llamada que resuelve una duda urgente.' },
    presentacion: { label: 'Presentación de propiedad', description: 'Se muestra una vivienda y lo que hace falta para acceder a ella.' },
};
