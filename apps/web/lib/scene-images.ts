import { getSupabaseClient } from './supabaseClient';

// Photorealistic stills for 'realista' videos. Free sources, tried in order:
// Cloudflare Workers AI (needs an account id and a token) with its main model,
// then FLUX.1 schnell on the same account, then Pollinations (no account,
// slower, rate limited per IP). Any of them can be down, hence the chain.

export const SCENE_IMAGE_BUCKET = 'scene-images';

// FLUX.2 [klein] 4B takes width/height (256-1920 each, steps fixed at 4) and
// costs ~26 neurons per output 512x512 tile, so a 768x1344 picture is 6 tiles,
// ~156 neurons: about 60 a day inside the 10,000-neuron free allocation.
// FLUX.1 schnell is cheaper but only makes 1024x1024 squares, which a 9:16
// crop turns into ~576 real pixels of width - kept only as the fallback.
// Override with CLOUDFLARE_IMAGE_MODEL (e.g. @cf/leonardo/lucid-origin, which
// also takes width/height but costs ~25x more per image).
export const CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
export const CLOUDFLARE_FALLBACK_MODEL = '@cf/black-forest-labs/flux-1-schnell';
export const POLLINATIONS_IMAGE_MODEL = 'flux';

// Vertical, multiples of 64 and close to 9:16 (0.571 vs 0.5625): the worker's
// cover crop to 1080x1920 trims a sliver of the sides instead of half the frame.
export const CLOUDFLARE_IMAGE_WIDTH = 768;
export const CLOUDFLARE_IMAGE_HEIGHT = 1344;

// FLUX.1 schnell on Workers AI caps steps at 8; 6 trades a little time for
// noticeably cleaner faces than the default 4.
const SCHNELL_STEPS = 6;
export const IMAGE_TIMEOUT_MS = 60_000;

export function cloudflareModels(): string[] {
    const configured = process.env.CLOUDFLARE_IMAGE_MODEL?.trim();
    const primary = configured && /^@cf\/[\w.-]+\/[\w.-]+$/.test(configured) ? configured : CLOUDFLARE_IMAGE_MODEL;
    return primary === CLOUDFLARE_FALLBACK_MODEL ? [primary] : [primary, CLOUDFLARE_FALLBACK_MODEL];
}

export interface GeneratedImage {
    bytes: Uint8Array;
    mimeType: string;
    provider: 'cloudflare' | 'pollinations';
    model: string;
}

/**
 * The REST API wraps the model output as { result: { image }, success }, while
 * the Workers binding returns { image } directly. Both are accepted, plus a bare
 * string, because a shape change should degrade to "try Pollinations" rather
 * than to a crash.
 */
export function extractCloudflareImage(payload: unknown): string | null {
    if (typeof payload === 'string') return payload.trim() || null;
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    if (record.success === false) return null;
    if (typeof record.image === 'string' && record.image.trim()) return record.image.trim();
    if (record.result !== undefined) return extractCloudflareImage(record.result);
    return null;
}

/** Decodes base64 (optionally a data URL) into bytes; null when it is not an image. */
export function decodeBase64Image(value: string): { bytes: Uint8Array; mimeType: string } | null {
    const base64 = value.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '');
    if (!base64 || !/^[A-Za-z0-9+/]+=*$/.test(base64)) return null;
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    const mimeType = sniffImageType(bytes);
    return mimeType ? { bytes, mimeType } : null;
}

// Magic numbers, so an error page served with a 200 is never stored as a picture.
export function sniffImageType(bytes: Uint8Array): string | null {
    if (bytes.length < 12) return null;
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return null;
}

class ImageSourceError extends Error {}

// Each model family wants its own request: FLUX.2 only accepts multipart form
// data (even for a bare prompt), FLUX.1 schnell takes JSON without a size, and
// the Leonardo models take JSON with width/height.
function cloudflareBody(model: string, prompt: string, seed: number): { body: BodyInit; headers: Record<string, string> } {
    const text = prompt.slice(0, 2048); // the documented prompt limit on these models
    if (model.startsWith('@cf/black-forest-labs/flux-2')) {
        const form = new FormData();
        form.append('prompt', text);
        form.append('width', String(CLOUDFLARE_IMAGE_WIDTH));
        form.append('height', String(CLOUDFLARE_IMAGE_HEIGHT));
        form.append('seed', String(seed));
        // No Content-Type here: fetch adds it with the multipart boundary.
        return { body: form, headers: {} };
    }
    const json = model === CLOUDFLARE_FALLBACK_MODEL
        ? { prompt: text, steps: SCHNELL_STEPS, seed }
        : { prompt: text, width: CLOUDFLARE_IMAGE_WIDTH, height: CLOUDFLARE_IMAGE_HEIGHT, seed };
    return { body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } };
}

async function fromCloudflare(model: string, prompt: string, seed: number, timeoutMs: number): Promise<GeneratedImage> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const token = process.env.CLOUDFLARE_AI_TOKEN?.trim();
    if (!accountId || !token) throw new ImageSourceError('Cloudflare no está configurado.');

    const { body, headers } = cloudflareBody(model, prompt, seed);
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`, {
        method: 'POST',
        headers: { ...headers, Authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new ImageSourceError(`Cloudflare (${model}) respondió con ${response.status}.`);

    // Most models answer JSON with base64; some (Phoenix) stream the image itself.
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.startsWith('image/')) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        const mimeType = sniffImageType(bytes);
        if (!mimeType) throw new ImageSourceError(`Cloudflare (${model}) no devolvió una imagen legible.`);
        return { bytes, mimeType, provider: 'cloudflare', model };
    }
    const base64 = extractCloudflareImage(await response.json().catch(() => null));
    const decoded = base64 ? decodeBase64Image(base64) : null;
    if (!decoded) throw new ImageSourceError(`Cloudflare (${model}) no devolvió una imagen legible.`);
    return { ...decoded, provider: 'cloudflare', model };
}

export function pollinationsUrl(prompt: string, seed: number): string {
    // Long prompts make an over-long URL; the important part comes first.
    const encoded = encodeURIComponent(prompt.slice(0, 1500));
    return `https://image.pollinations.ai/prompt/${encoded}?width=1080&height=1920&model=${POLLINATIONS_IMAGE_MODEL}&nologo=true&seed=${seed}`;
}

async function fromPollinations(prompt: string, seed: number, timeoutMs: number): Promise<GeneratedImage> {
    const token = process.env.POLLINATIONS_TOKEN?.trim();
    const response = await fetch(pollinationsUrl(prompt, seed), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new ImageSourceError(`Pollinations respondió con ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mimeType = sniffImageType(bytes);
    if (!mimeType) throw new ImageSourceError('Pollinations no devolvió una imagen.');
    return { bytes, mimeType, provider: 'pollinations', model: POLLINATIONS_IMAGE_MODEL };
}

/**
 * Cloudflare's main model (vertical 768x1344), then FLUX.1 schnell (square
 * 1024x1024, the prompt keeps the subject centred for the 9:16 crop), then
 * Pollinations (1080x1920). A source is skipped on missing credentials, 429 or
 * any failure. `timeoutMs` bounds the whole chain, not each attempt, so a slow
 * first source cannot push one scene past the caller's budget. Throws a Spanish
 * message when every source fails.
 */
export async function generateSceneImage(prompt: string, seed: number, timeoutMs: number = IMAGE_TIMEOUT_MS): Promise<GeneratedImage> {
    const deadline = Date.now() + timeoutMs;
    const remaining = () => Math.max(1_000, deadline - Date.now());
    const reasons: string[] = [];
    const cloudflareReady = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID?.trim() && process.env.CLOUDFLARE_AI_TOKEN?.trim());
    if (!cloudflareReady) reasons.push('Cloudflare no está configurado.');
    for (const model of cloudflareReady ? cloudflareModels() : []) {
        if (Date.now() >= deadline) break;
        try {
            return await fromCloudflare(model, prompt, seed, remaining());
        } catch (error) {
            reasons.push(error instanceof Error ? error.message : String(error));
        }
    }
    try {
        return await fromPollinations(prompt, seed, remaining());
    } catch (error) {
        reasons.push(error instanceof Error ? error.message : String(error));
    }
    console.warn('No se pudo generar la imagen de la escena.', reasons);
    throw new Error(`No se pudo generar la imagen (${reasons.join(' ')})`);
}

let bucketReady = false;

/**
 * Stores the image in the public bucket and returns its URL. Without Supabase
 * (local development only) it returns a data URL so the panel still shows it.
 */
export async function uploadSceneImage(videoId: string, sceneId: string, image: GeneratedImage): Promise<string> {
    const client = getSupabaseClient({ serviceRole: true });
    if (!client) {
        if (process.env.NODE_ENV === 'production') throw new Error('No hay almacenamiento configurado para guardar la imagen.');
        return `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString('base64')}`;
    }

    if (!bucketReady) {
        // The migration creates the bucket; this covers a database it has not reached yet.
        const { data: buckets, error: listError } = await client.storage.listBuckets();
        if (!listError && !(buckets ?? []).some((bucket) => bucket.name === SCENE_IMAGE_BUCKET)) {
            const { error: createError } = await client.storage.createBucket(SCENE_IMAGE_BUCKET, { public: true });
            if (createError) console.warn('No fue posible crear el bucket de imágenes de escena.', createError.message);
        }
        bucketReady = true;
    }

    const path = `${videoId}/${sceneId}-${Date.now()}.jpg`;
    const { error } = await client.storage.from(SCENE_IMAGE_BUCKET).upload(path, Buffer.from(image.bytes), {
        contentType: image.mimeType,
        upsert: true,
    });
    if (error) throw new Error(`No se pudo guardar la imagen: ${error.message}`);
    return client.storage.from(SCENE_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}
