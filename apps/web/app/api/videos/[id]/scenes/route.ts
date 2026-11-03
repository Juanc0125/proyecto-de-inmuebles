import { NextResponse } from 'next/server';
import { getTemplate, type VideoTemplate } from '@shared-types/templates';
import type { CharacterType, Scene, SceneAction, ScenePropType } from '@shared-types/video';
import { MAX_SCENE_SECONDS, MIN_SCENE_SECONDS } from '@shared-types/video';
import { generateWithProvider, providerIds } from '../../../../../lib/ai-provider';
import { getVideo, replaceScenes } from '../../../../../lib/video-persistence';

type RouteContext = { params: Promise<{ id: string }> };
type SceneInput = Omit<Scene, 'id' | 'video_id' | 'image_url' | 'image_prompt'>;

const CHARACTERS: CharacterType[] = ['broker', 'cliente', 'pareja', 'hombre', 'mujer', 'generico'];
const ACTIONS: SceneAction[] = ['hablar', 'caminar', 'senalar', 'sentarse', 'pensar', 'telefono', 'mostrar_objeto'];
const PROPS: ScenePropType[] = ['ninguno', 'casa', 'carro', 'banco', 'telefono', 'documento', 'dinero', 'grafico', 'oficina'];

const MIN_SCENES = 2;
const MAX_SCENES = 8;

function coerceCharacter(value: unknown): CharacterType {
    return typeof value === 'string' && (CHARACTERS as string[]).includes(value) ? (value as CharacterType) : 'generico';
}

function coerceAction(value: unknown): SceneAction {
    return typeof value === 'string' && (ACTIONS as string[]).includes(value) ? (value as SceneAction) : 'hablar';
}

function coerceProp(value: unknown): ScenePropType {
    return typeof value === 'string' && (PROPS as string[]).includes(value) ? (value as ScenePropType) : 'ninguno';
}

// The prompt asks for 2-10 s, but a model's number is a suggestion: clamp it
// instead of trusting it, so one 45 s scene cannot swallow the whole video.
function coerceDuration(value: unknown, fallback: number): number {
    const num = typeof value === 'number' ? value : Number(value);
    const seconds = Number.isFinite(num) && num > 0 ? num : fallback;
    return Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, seconds));
}

function coerceDescription(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

// Models sometimes wrap JSON in markdown fences or add stray prose; strip that defensively
// before attempting JSON.parse, and fall back to locating the first JSON-looking block.
function extractJson(text: string): unknown {
    const withoutFences = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
        return JSON.parse(withoutFences);
    } catch {
        const match = withoutFences.match(/[[{][\s\S]*[\]}]/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch {
            return null;
        }
    }
}

function buildSystemPrompt(targetDurationSeconds: number, template: VideoTemplate): string {
    const guidance = getTemplate(template).guidance;
    return [
        'Eres un planificador de escenas para mini-telenovelas verticales de marketing de creditos hipotecarios / vivienda, al estilo de las "frutinovelas" virales.',
        `Divide el guion recibido en entre ${MIN_SCENES} y ${MAX_SCENES} escenas, segun lo que requiera la duracion objetivo del video.`,
        `La suma de "duration_seconds" de todas las escenas debe aproximarse a ${targetDurationSeconds} segundos en total.`,
        'Montalo como telenovela: la primera escena engancha, las del medio muestran el conflicto y el giro, y la ultima cierra. Alterna personajes entre escenas para que se sienta un dialogo y no un monologo: si una escena la protagoniza el "cliente", la siguiente suele ser el "broker" respondiendo.',
        'Elige la accion y el objeto por lo que ocurre en esa escena, no al azar: quien duda va con "pensar", quien explica con "senalar" o "mostrar_objeto", una mala noticia por telefono con "telefono", el cierre feliz frente a la "casa".',
        'Cada "description" es la linea que el personaje dice en voz alta en esa escena. Escribela como dialogo hablado y corto, no como narracion en tercera persona.',
        'Responde UNICAMENTE con un arreglo JSON valido (sin texto adicional, sin explicaciones, sin bloques de markdown ni comillas envolventes) de objetos, cada uno con EXACTAMENTE estas claves:',
        '- "character": uno de estos valores exactos: "broker", "cliente", "pareja", "hombre", "mujer", "generico"',
        '- "action": uno de estos valores exactos: "hablar", "caminar", "senalar", "sentarse", "pensar", "telefono", "mostrar_objeto"',
        '- "prop": uno de estos valores exactos: "ninguno", "casa", "carro", "banco", "telefono", "documento", "dinero", "grafico", "oficina" (usa "ninguno" si no aplica ningun objeto)',
        '- "description": una linea corta de narracion/subtitulo para esa escena, basada en el guion',
        `- "duration_seconds": un numero entre ${MIN_SCENE_SECONDS} y ${MAX_SCENE_SECONDS}`,
        // Last so the chosen template overrides the generic staging advice above.
        ...(guidance ? ['', `ESTRUCTURA OBLIGATORIA PARA ESTE VIDEO: ${guidance}`] : []),
    ].join('\n');
}

function buildScenesFromAiJson(raw: unknown): SceneInput[] | null {
    let list: unknown = raw;
    if (!Array.isArray(list) && list && typeof list === 'object' && Array.isArray((list as Record<string, unknown>).scenes)) {
        list = (list as Record<string, unknown>).scenes;
    }
    if (!Array.isArray(list) || list.length === 0) return null;

    // The prompt asks for at most MAX_SCENES, but like the duration that is a
    // suggestion to the model: a longer list is cut here, since every extra
    // scene is another narration, another render pass and another subtitle.
    return list.slice(0, MAX_SCENES).map((item, index) => {
        const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        return {
            order: index + 1,
            character: coerceCharacter(record.character),
            action: coerceAction(record.action),
            prop: coerceProp(record.prop),
            description: coerceDescription(record.description, `Escena ${index + 1}`),
            duration_seconds: coerceDuration(record.duration_seconds, 4),
            audio_url: null,
            sound_effect_id: null,
        };
    });
}

// A long script without the model would otherwise become one scene per
// sentence. Neighbouring sentences are joined instead of dropped, so the
// narration still says the whole script, just in fewer, longer scenes.
function mergeIntoAtMost(sentences: string[], max: number): string[] {
    if (sentences.length <= max) return sentences;
    const merged: string[] = [];
    let start = 0;
    for (let group = 0; group < max; group += 1) {
        // Spread the remainder over the first groups so sizes differ by one at most.
        const size = Math.floor(sentences.length / max) + (group < sentences.length % max ? 1 : 0);
        merged.push(sentences.slice(start, start + size).join('. '));
        start += size;
    }
    return merged;
}

function buildSentenceFallback(script: string, targetDurationSeconds: number, template: VideoTemplate): SceneInput[] {
    const sentences = script
        .split(/[.!?]+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
    const lines = mergeIntoAtMost(sentences.length ? sentences : [script.trim() || 'Contenido del video.'], MAX_SCENES);
    const safeTarget = Number.isFinite(targetDurationSeconds) && targetDurationSeconds > 0 ? targetDurationSeconds : 30;
    const rawDuration = safeTarget / lines.length;
    const clampedDuration = Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, Number.isFinite(rawDuration) ? rawDuration : 4));

    // Without the model this is what the user actually gets, so it casts each
    // scene from cues in its own line rather than stamping every one as
    // generico/hablar/ninguno. Blind rotation was worse than no casting: it put
    // the broker on the line "llame al asesor casi llorando", which the client
    // is obviously the one saying.
    const beats = getTemplate(template).beats;

    return lines.map((line, index) => {
        const text = line.toLowerCase();
        const isLast = index === lines.length - 1;

        // A picked template is an explicit decision about staging, so it wins
        // over guessing from the words. Its last beat is reserved for the
        // closing line; the rest cycle.
        if (beats.length > 0) {
            const beat = isLast ? beats[beats.length - 1] : beats[index % Math.max(1, beats.length - 1)];
            return { order: index + 1, ...beat, description: line, duration_seconds: clampedDuration, audio_url: null, sound_effect_id: null };
        }

        // Who is speaking, read off the line itself. A line that quotes or
        // reports someone else ("me dijo", "me explico") is still the client
        // talking, so those keep the client.
        let character: SceneInput['character'] = index % 2 === 0 ? 'cliente' : 'broker';
        if (/\bnosotr|\bpareja\b|firmamos|comparamos|encontramos|pedimos\b/.test(text)) character = 'pareja';
        else if (/me dijo|me explico|le pregunte|llame a|mi cuñado|no me decido|me quede/.test(text)) character = 'cliente';
        else if (/\bel asesor\b|\bte explico\b|\brecuerda\b|\bcompara\b|\brevisa\b|\bpide\b/.test(text)) character = 'broker';

        // What is on screen, also from the line, so the prop illustrates what is
        // being said instead of decorating at random.
        let prop: SceneInput['prop'] = 'ninguno';
        if (/casa|vivienda|hogar|inmueble/.test(text)) prop = 'casa';
        else if (/banco|entidad|sucursal/.test(text)) prop = 'banco';
        else if (/carta|oferta|documento|contrato|papel|firma/.test(text)) prop = 'documento';
        else if (/simulador|numero|tasa|grafic|compar/.test(text)) prop = 'grafico';
        else if (/cuota|precio|costo|plata|dinero|pago/.test(text)) prop = 'dinero';
        else if (/llame|llamo|telefono|marque/.test(text)) prop = 'telefono';
        else if (/oficina|asesor/.test(text)) prop = 'oficina';

        let action: SceneInput['action'] = 'hablar';
        if (/llame|llamo|telefono|marque/.test(text)) action = 'telefono';
        else if (/no se|no me decido|dudo|pensar|vueltas|entiendo menos|me quede/.test(text)) action = 'pensar';
        else if (/compara|revisa|mira|explico|te explico|senal/.test(text)) action = 'senalar';
        else if (/muestra|aqui esta|te traigo|resultado/.test(text)) action = 'mostrar_objeto';

        // Every one of these stories resolves the same way: the couple, the house.
        if (isLast) return { order: index + 1, character: 'pareja' as const, action: 'hablar' as const, prop: 'casa' as const, description: line, duration_seconds: clampedDuration, audio_url: null, sound_effect_id: null };

        return { order: index + 1, character, action, prop, description: line, duration_seconds: clampedDuration, audio_url: null, sound_effect_id: null };
    });
}

// Extra direction for a re-plan (the workbench passes the critic's notes).
// Capped: it goes into the planner prompt and comes from outside.
const MAX_GUIDANCE_CHARS = 1500;

export async function POST(request: Request, context: RouteContext) {
    const { id } = await context.params;
    // Optional body. The panel posts none; the workbench names the provider it
    // prefers for the director role and may add guidance. Anything else is ignored.
    const body = await request.json().catch(() => null) as { provider?: unknown; guidance?: unknown } | null;
    const preferred = typeof body?.provider === 'string' && providerIds().includes(body.provider) ? body.provider : '';
    const guidance = typeof body?.guidance === 'string' ? body.guidance.trim().slice(0, MAX_GUIDANCE_CHARS) : '';

    let video;
    try {
        video = await getVideo(id);
    } catch (error) {
        console.error('Error al cargar el video', error);
        return NextResponse.json({ error: 'No se pudo cargar el video.' }, { status: 500 });
    }

    if (!video) {
        return NextResponse.json({ error: 'Video no encontrado.' }, { status: 404 });
    }

    const targetDurationSeconds = Number.isFinite(video.target_duration_seconds) && video.target_duration_seconds > 0
        ? video.target_duration_seconds
        : 30;

    let scenes: SceneInput[] | null = null;
    let provider: string | null = null;
    let model: string | null = null;
    try {
        const extra = guidance ? `\n\nIndicaciones adicionales:\n${guidance}` : '';
        const result = await generateWithProvider(
            preferred,
            buildSystemPrompt(targetDurationSeconds, video.template),
            [{ role: 'user', content: `Tema: ${video.topic}\n\nGuion completo:\n${video.script}${extra}` }],
            { maxTokens: 900 },
        );
        if (result?.text) {
            scenes = buildScenesFromAiJson(extractJson(result.text));
            if (scenes?.length) {
                provider = result.provider;
                model = result.model ?? null;
            }
        }
    } catch (error) {
        console.warn('Fallo al generar escenas con IA, se usara el respaldo por oraciones.', error);
    }

    if (!scenes || scenes.length === 0) {
        scenes = buildSentenceFallback(video.script, targetDurationSeconds, video.template);
    }

    try {
        const updated = await replaceScenes(id, scenes);
        // provider/model say who planned it; null when the sentence fallback did.
        return NextResponse.json({ video: updated, provider, model });
    } catch (error) {
        console.error('Error al guardar las escenas generadas', error);
        return NextResponse.json({ error: 'No se pudieron generar las escenas.' }, { status: 500 });
    }
}
