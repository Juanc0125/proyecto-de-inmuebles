import { NextResponse } from 'next/server';
import type { CharacterType, Scene, SceneAction, ScenePropType } from '@shared-types/video';
import { MAX_SCENE_SECONDS, MIN_SCENE_SECONDS } from '@shared-types/video';
import { generateWithFallback } from '../../../../../../lib/ai-provider';
import { getSound } from '../../../../../../lib/sounds';
import { deleteScene, errorStatus, getVideo, updateScene } from '../../../../../../lib/video-persistence';

type RouteContext = { params: Promise<{ id: string; sceneId: string }> };
type SceneInput = Omit<Scene, 'id' | 'video_id'>;
type SceneContentPatch = Pick<SceneInput, 'character' | 'action' | 'prop' | 'description'>;

const CHARACTERS: CharacterType[] = ['broker', 'cliente', 'pareja', 'hombre', 'mujer', 'generico'];
const ACTIONS: SceneAction[] = ['hablar', 'caminar', 'senalar', 'sentarse', 'pensar', 'telefono', 'mostrar_objeto'];
const PROPS: ScenePropType[] = ['ninguno', 'casa', 'carro', 'banco', 'telefono', 'documento', 'dinero', 'grafico', 'oficina'];

function isCharacter(value: unknown): value is CharacterType {
    return typeof value === 'string' && (CHARACTERS as string[]).includes(value);
}

function isAction(value: unknown): value is SceneAction {
    return typeof value === 'string' && (ACTIONS as string[]).includes(value);
}

function isProp(value: unknown): value is ScenePropType {
    return typeof value === 'string' && (PROPS as string[]).includes(value);
}

function coerceCharacter(value: unknown, fallback: CharacterType): CharacterType {
    return isCharacter(value) ? value : fallback;
}

function coerceAction(value: unknown, fallback: SceneAction): SceneAction {
    return isAction(value) ? value : fallback;
}

function coerceProp(value: unknown, fallback: ScenePropType): ScenePropType {
    return isProp(value) ? value : fallback;
}

function coerceDescription(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

// Defensive JSON extraction: models sometimes wrap the object in markdown fences or add prose.
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

function buildRegenerateSystemPrompt(): string {
    return [
        'Eres un planificador de escenas para videos cortos de marketing de creditos hipotecarios / vivienda, protagonizados por un personaje 2D tipo "stickman" (muneco de palitos simple, en 2D, sin animacion 3D ni personajes complejos ni fotorrealistas).',
        'Se te pide regenerar UNA sola escena de un video existente. Usa el tema, el guion completo y las escenas vecinas (si existen) solo como contexto para mantener continuidad narrativa; no regeneres las escenas vecinas.',
        'Responde UNICAMENTE con un objeto JSON valido (sin texto adicional, sin explicaciones, sin bloques de markdown) con EXACTAMENTE estas claves:',
        '- "character": uno de estos valores exactos: "broker", "cliente", "pareja", "hombre", "mujer", "generico"',
        '- "action": uno de estos valores exactos: "hablar", "caminar", "senalar", "sentarse", "pensar", "telefono", "mostrar_objeto"',
        '- "prop": uno de estos valores exactos: "ninguno", "casa", "carro", "banco", "telefono", "documento", "dinero", "grafico", "oficina" (usa "ninguno" si no aplica ningun objeto)',
        '- "description": una linea corta de narracion/subtitulo nueva para esa escena, basada en el guion',
    ].join('\n');
}

export async function PATCH(request: Request, context: RouteContext) {
    const { id, sceneId } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;

    if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'Cuerpo de la solicitud invalido.' }, { status: 400 });
    }

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

    const scene = video.scenes.find((entry) => entry.id === sceneId);
    if (!scene) {
        return NextResponse.json({ error: 'Escena no encontrada.' }, { status: 404 });
    }

    // RF-007: regenerate just this one scene via AI, using neighboring scenes as continuity context.
    if (body.regenerate === true) {
        const sorted = [...video.scenes].sort((a, b) => a.order - b.order);
        const index = sorted.findIndex((entry) => entry.id === sceneId);
        const previous = index > 0 ? sorted[index - 1] : null;
        const next = index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : null;

        const contextLines = [
            `Tema del video: ${video.topic}`,
            `Guion completo: ${video.script}`,
            `Escena actual a regenerar -> character: ${scene.character}, action: ${scene.action}, prop: ${scene.prop}, description: "${scene.description}"`,
        ];
        if (previous) {
            contextLines.push(`Escena anterior (no modificar) -> character: ${previous.character}, action: ${previous.action}, prop: ${previous.prop}, description: "${previous.description}"`);
        }
        if (next) {
            contextLines.push(`Escena siguiente (no modificar) -> character: ${next.character}, action: ${next.action}, prop: ${next.prop}, description: "${next.description}"`);
        }

        // Default: keep the scene completely unchanged unless the AI gives us a usable replacement.
        // A failed regeneration must never destroy the existing scene content.
        let patch: SceneContentPatch = {
            character: scene.character,
            action: scene.action,
            prop: scene.prop,
            description: scene.description,
        };

        try {
            const result = await generateWithFallback(
                buildRegenerateSystemPrompt(),
                [{ role: 'user', content: contextLines.join('\n') }],
                { maxTokens: 300 },
            );
            if (result?.text) {
                const parsed = extractJson(result.text);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const record = parsed as Record<string, unknown>;
                    patch = {
                        character: coerceCharacter(record.character, scene.character),
                        action: coerceAction(record.action, scene.action),
                        prop: coerceProp(record.prop, scene.prop),
                        description: coerceDescription(record.description, scene.description),
                    };
                }
            }
        } catch (error) {
            console.warn('Fallo al regenerar la escena con IA, se conserva la escena original.', error);
        }

        try {
            // duration_seconds is intentionally left untouched by regeneration.
            const updated = await updateScene(id, sceneId, patch);
            return NextResponse.json({ video: updated });
        } catch (error) {
            console.error('Error al guardar la escena regenerada', error);
            return NextResponse.json({ error: 'No se pudo regenerar la escena.' }, { status: 500 });
        }
    }

    // RF-022: manual, partial edit of a scene's fields. Strict validation since this is a direct user edit.
    const patch: Partial<SceneInput> = {};

    if ('character' in body) {
        if (!isCharacter(body.character)) {
            return NextResponse.json({ error: 'El personaje no es valido.' }, { status: 400 });
        }
        patch.character = body.character;
    }

    if ('action' in body) {
        if (!isAction(body.action)) {
            return NextResponse.json({ error: 'La accion no es valida.' }, { status: 400 });
        }
        patch.action = body.action;
    }

    if ('prop' in body) {
        if (!isProp(body.prop)) {
            return NextResponse.json({ error: 'El objeto de la escena no es valido.' }, { status: 400 });
        }
        patch.prop = body.prop;
    }

    if ('description' in body) {
        if (typeof body.description !== 'string' || !body.description.trim()) {
            return NextResponse.json({ error: 'La descripcion debe ser un texto no vacio.' }, { status: 400 });
        }
        patch.description = body.description;
    }

    if ('duration_seconds' in body) {
        const value = body.duration_seconds;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_SCENE_SECONDS || value > MAX_SCENE_SECONDS) {
            return NextResponse.json(
                { error: `La duración de una escena debe estar entre ${MIN_SCENE_SECONDS} y ${MAX_SCENE_SECONDS} segundos.` },
                { status: 400 },
            );
        }
        patch.duration_seconds = value;
    }

    // RF-010: one optional effect per scene, from the library or an upload.
    if ('sound_effect_id' in body) {
        const value = body.sound_effect_id;
        if (value !== null) {
            if (typeof value !== 'string') {
                return NextResponse.json({ error: 'sound_effect_id debe ser un texto o null.' }, { status: 400 });
            }
            const sound = await getSound(value);
            if (!sound) {
                return NextResponse.json({ error: 'El efecto de sonido elegido no existe.' }, { status: 400 });
            }
            if (sound.kind !== 'efecto') {
                return NextResponse.json({ error: 'El sonido elegido es una musica de fondo, no un efecto.' }, { status: 400 });
            }
        }
        patch.sound_effect_id = value;
    }

    if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: 'No se proporcionaron campos validos para actualizar.' }, { status: 400 });
    }

    try {
        const updated = await updateScene(id, sceneId, patch);
        return NextResponse.json({ video: updated });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido';
        return NextResponse.json({ error: message }, { status: errorStatus(error, 500) });
    }
}

export async function DELETE(_request: Request, context: RouteContext) {
    const { id, sceneId } = await context.params;
    try {
        const updated = await deleteScene(id, sceneId);
        return NextResponse.json({ video: updated });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido';
        return NextResponse.json({ error: message }, { status: errorStatus(error, 500) });
    }
}
