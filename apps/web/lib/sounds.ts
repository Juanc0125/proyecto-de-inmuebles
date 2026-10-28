// RF-010: background music and sound effects.
//
// Two sources behind one id scheme (see packages/shared-types/sounds.ts): the
// library the project generates itself, which lives only in code plus the
// `sounds` bucket, and the files the business uploads, which get a row in
// `sound_assets`. Same shape as brand-templates.ts: Supabase through the
// service role, with an in-memory fallback so the studio keeps working while
// the migration is not applied yet.
//
// This module deliberately does not import video-persistence (which imports
// it to resolve URLs at render time); callers pass the user id in.

import type { SoundAsset, SoundKind } from '@shared-types/sounds';
import { SOUND_BUCKET, SOUND_LIBRARY, SOUND_SLUG_PATTERN } from '@shared-types/sounds';
import { videos as mockVideos } from '../app/api/videos/store';
import { getSupabaseClient } from './supabaseClient';

type DatabaseRow = Record<string, unknown>;
type SupabaseClient = NonNullable<ReturnType<typeof getSupabaseClient>>;

export const SOUND_KINDS: SoundKind[] = ['musica', 'efecto'];
export const MAX_SOUND_BYTES = 20 * 1024 * 1024;

// Browsers disagree on what they call the same file (an .mp3 arrives as
// audio/mpeg or audio/mp3, a .wav as any of three), so every alias is listed.
// The value is the extension used when the filename does not carry a usable one.
export const ACCEPTED_SOUND_TYPES: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/webm': 'webm',
};

const KNOWN_EXTENSIONS = new Set(['mp3', 'ogg', 'oga', 'wav', 'm4a', 'mp4', 'aac', 'webm']);
const UPLOAD_PREFIX = 'subidos/';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPLOAD_PATH_PATTERN = /^subidos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([a-z0-9]+)$/i;

// What the person reads when a sound feature needs a column or table that the
// pending RF-010 migration adds. Better than the 404 the generic fallback
// would otherwise produce for a video that does exist.
export const SOUNDS_MIGRATION_MISSING_ERROR = 'La base de datos todavía no tiene la actualización de sonidos. Pide que se aplique la migración de RF-010.';

type UploadedRecord = {
    id: string; // uuid, without the 'subido:' prefix
    kind: SoundKind;
    name: string;
    storage_path: string;
    license: string;
    created_at: string;
};

const mockUploads = new Map<string, UploadedRecord>();

export type ParsedSoundId =
    | { origin: 'biblioteca'; slug: string }
    | { origin: 'subido'; uuid: string };

export function parseSoundId(id: unknown): ParsedSoundId | null {
    if (typeof id !== 'string') return null;
    if (id.startsWith('biblioteca:')) {
        const slug = id.slice('biblioteca:'.length);
        return SOUND_SLUG_PATTERN.test(slug) ? { origin: 'biblioteca', slug } : null;
    }
    if (id.startsWith('subido:')) {
        const uuid = id.slice('subido:'.length);
        return UUID_PATTERN.test(uuid) ? { origin: 'subido', uuid: uuid.toLowerCase() } : null;
    }
    return null;
}

// PostgREST reports a column it does not know as PGRST204 on writes and
// Postgres as 42703 on filters; a missing table as PGRST205 / 42P01. These are
// exactly what a database without the RF-010 migration answers.
export function isMissingSchemaError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const code = (error as { code?: unknown }).code;
    return code === 'PGRST204' || code === '42703' || code === 'PGRST205' || code === '42P01';
}

function anyClient(): SupabaseClient | null {
    return getSupabaseClient({ serviceRole: true }) ?? getSupabaseClient();
}

function publicUrl(client: SupabaseClient | null, path: string): string {
    if (!client) return '';
    return client.storage.from(SOUND_BUCKET).getPublicUrl(path).data?.publicUrl ?? '';
}

function libraryAssets(client: SupabaseClient | null): SoundAsset[] {
    return SOUND_LIBRARY.map((entry) => ({
        id: `biblioteca:${entry.slug}`,
        kind: entry.kind,
        name: entry.name,
        url: publicUrl(client, `biblioteca/${entry.slug}.m4a`),
        origin: 'biblioteca',
        license: entry.license,
        source: entry.source,
    }));
}

function toUploadedRecord(row: DatabaseRow): UploadedRecord {
    return {
        id: String(row.id),
        kind: row.kind === 'efecto' ? 'efecto' : 'musica',
        name: String(row.name ?? 'Sin nombre'),
        storage_path: String(row.storage_path ?? ''),
        license: String(row.license ?? ''),
        created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    };
}

function toUploadedAsset(client: SupabaseClient | null, record: UploadedRecord): SoundAsset {
    return {
        id: `subido:${record.id}`,
        kind: record.kind,
        name: record.name,
        url: publicUrl(client, record.storage_path),
        origin: 'subido',
        license: record.license,
        source: null,
    };
}

function sortNewestFirst(records: UploadedRecord[]): UploadedRecord[] {
    return [...records].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function listUploadedRecords(client: SupabaseClient | null): Promise<UploadedRecord[]> {
    if (client) {
        try {
            const { data, error } = await client.from('sound_assets').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            // Rows uploaded while the table did not exist yet only live in
            // memory; show them too until the process restarts.
            const rows = (data ?? []).map(toUploadedRecord);
            const known = new Set(rows.map((row) => row.id));
            return sortNewestFirst([...rows, ...[...mockUploads.values()].filter((row) => !known.has(row.id))]);
        } catch (error) {
            console.warn('Fallo al listar los sonidos subidos en Supabase, usando fallback en memoria.', error);
        }
    }
    return sortNewestFirst([...mockUploads.values()]);
}

async function findUploadedRecord(client: SupabaseClient | null, uuid: string): Promise<UploadedRecord | null> {
    if (client) {
        try {
            const { data, error } = await client.from('sound_assets').select('*').eq('id', uuid).maybeSingle();
            if (error) throw error;
            if (data) return toUploadedRecord(data);
        } catch (error) {
            console.warn('Fallo al leer el sonido subido en Supabase, usando fallback en memoria.', error);
        }
    }
    return mockUploads.get(uuid) ?? null;
}

export async function listSounds(): Promise<SoundAsset[]> {
    const client = anyClient();
    const uploaded = await listUploadedRecords(client);
    return [...libraryAssets(client), ...uploaded.map((record) => toUploadedAsset(client, record))];
}

// A library id resolves without touching the database: the catalog is code. It
// may still point at a file the generation script has not uploaded yet; the
// worker treats an unreachable URL as "no sound" rather than failing.
export async function getSound(id: unknown): Promise<SoundAsset | null> {
    const parsed = parseSoundId(id);
    if (!parsed) return null;
    const client = anyClient();
    if (parsed.origin === 'biblioteca') {
        return libraryAssets(client).find((asset) => asset.id === `biblioteca:${parsed.slug}`) ?? null;
    }
    const record = await findUploadedRecord(client, parsed.uuid);
    return record ? toUploadedAsset(client, record) : null;
}

// One lookup per distinct id, so a video that uses the same effect on every
// scene does not query the table once per scene. Unknown ids map to null: a
// sound deleted after it was chosen must not break the render.
export async function resolveSoundUrls(ids: Array<string | null | undefined>): Promise<Map<string, string | null>> {
    const resolved = new Map<string, string | null>();
    for (const id of new Set(ids.filter((value): value is string => typeof value === 'string' && value.length > 0))) {
        try {
            const asset = await getSound(id);
            resolved.set(id, asset?.url || null);
        } catch (error) {
            console.warn('No fue posible resolver el sonido; se renderiza sin el.', id, error);
            resolved.set(id, null);
        }
    }
    return resolved;
}

// Lazily created like branding-logos, so a fresh project needs no manual
// bucket setup. The size cap is enforced by Storage too, because the browser
// uploads straight to it with the signed URL and never passes through here.
// No MIME allow-list on the bucket: the library script uploads its own .m4a
// files and a mismatch there would fail silently on every library sound.
async function ensureSoundBucket(client: SupabaseClient): Promise<void> {
    const { data: buckets, error: listError } = await client.storage.listBuckets();
    if (listError) throw listError;
    if ((buckets ?? []).some((bucket) => bucket.name === SOUND_BUCKET)) return;
    const { error: createError } = await client.storage.createBucket(SOUND_BUCKET, { public: true, fileSizeLimit: MAX_SOUND_BYTES });
    if (createError) throw createError;
}

function uploadExtension(filename: string, contentType: string): string {
    const fromName = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    if (fromName && KNOWN_EXTENSIONS.has(fromName)) return fromName;
    return ACCEPTED_SOUND_TYPES[contentType] ?? 'bin';
}

export class SoundStorageUnavailableError extends Error {}

export async function createSoundUploadUrl(filename: string, contentType: string): Promise<{ path: string; token: string; signed_url: string }> {
    const client = getSupabaseClient({ serviceRole: true });
    if (!client) throw new SoundStorageUnavailableError('La subida de sonidos requiere que Supabase Storage esté configurado.');

    await ensureSoundBucket(client);
    const path = `${UPLOAD_PREFIX}${crypto.randomUUID()}.${uploadExtension(filename, contentType)}`;
    const { data, error } = await client.storage.from(SOUND_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw error ?? new Error('No se obtuvo una URL de subida.');
    return { path: data.path, token: data.token, signed_url: data.signedUrl };
}

export type RegisterSoundResult =
    | { ok: true; sonido: SoundAsset }
    | { ok: false; status: number; error: string };

export async function registerSound(
    input: { name: string; kind: SoundKind; path: string; license: string },
    userId: string | null,
): Promise<RegisterSoundResult> {
    const match = input.path.match(UPLOAD_PATH_PATTERN);
    if (!match) return { ok: false, status: 400, error: 'La ruta del archivo no es valida: debe ser la que devolvio la solicitud de subida (subidos/...).' };
    const uuid = match[1].toLowerCase();

    const client = getSupabaseClient({ serviceRole: true });
    if (!client) return { ok: false, status: 500, error: 'El registro de sonidos requiere que Supabase Storage esté configurado.' };

    const { data: exists } = await client.storage.from(SOUND_BUCKET).exists(input.path);
    if (exists !== true) return { ok: false, status: 400, error: 'El archivo no se encuentra en el almacenamiento. Súbelo antes de registrarlo.' };

    if (await findUploadedRecord(client, uuid)) {
        return { ok: false, status: 409, error: 'Ese archivo ya está registrado como sonido.' };
    }

    const record: UploadedRecord = {
        id: uuid,
        kind: input.kind,
        name: input.name,
        storage_path: input.path,
        license: input.license,
        created_at: new Date().toISOString(),
    };

    try {
        // The row id is the storage uuid on purpose: `subido:<uuid>` then names
        // both the row and the file, and deleting one finds the other.
        const { data, error } = await client
            .from('sound_assets')
            .insert({ id: uuid, user_id: userId, kind: record.kind, name: record.name, storage_path: record.storage_path, license: record.license })
            .select()
            .single();
        if (error || !data) throw error ?? new Error('No se pudo guardar el sonido.');
        return { ok: true, sonido: toUploadedAsset(client, toUploadedRecord(data)) };
    } catch (error) {
        console.warn('Fallo al guardar el sonido en Supabase, usando fallback en memoria.', error);
    }

    mockUploads.set(uuid, record);
    return { ok: true, sonido: toUploadedAsset(client, record) };
}

export type DeleteSoundResult = 'eliminado' | 'no_encontrado' | 'id_invalido';

export async function deleteUploadedSound(id: string): Promise<DeleteSoundResult> {
    const parsed = parseSoundId(id);
    if (!parsed || parsed.origin !== 'subido') return 'id_invalido';

    const client = getSupabaseClient({ serviceRole: true });
    const record = await findUploadedRecord(client, parsed.uuid);
    if (!record) return 'no_encontrado';

    if (client) {
        // Row first, file only once the row is gone: the other order could
        // leave a catalog entry pointing at a file that no longer exists, and
        // every video using it would render silent with no sign of why.
        const { error: rowError } = await client.from('sound_assets').delete().eq('id', parsed.uuid);
        if (rowError) {
            console.error('Fallo al eliminar la fila del sonido en Supabase.', rowError);
            throw new Error('No se pudo eliminar el sonido. Intenta de nuevo.');
        }

        try {
            const { error } = await client.storage.from(SOUND_BUCKET).remove([record.storage_path]);
            if (error) throw error;
        } catch (error) {
            // An orphaned file costs storage, not correctness: nothing can
            // reference it once the row and the video references are gone.
            console.warn('Fallo al eliminar el archivo del sonido en Storage.', error);
        }

        // Clear the references so a later render does not look the id up. A
        // database without the RF-010 columns has nothing to clear.
        const sound = `subido:${parsed.uuid}`;
        for (const [table, column] of [['videos', 'music_id'], ['scenes', 'sound_effect_id']] as const) {
            try {
                const { error } = await client.from(table).update({ [column]: null }).eq(column, sound);
                if (error && !isMissingSchemaError(error)) throw error;
            } catch (error) {
                console.warn(`Fallo al limpiar ${column} tras eliminar el sonido.`, error);
            }
        }
    }

    mockUploads.delete(parsed.uuid);
    const sound = `subido:${parsed.uuid}`;
    for (const [videoId, video] of mockVideos) {
        const usesSound = video.music_id === sound || video.scenes.some((scene) => scene.sound_effect_id === sound);
        if (!usesSound) continue;
        mockVideos.set(videoId, {
            ...video,
            music_id: video.music_id === sound ? null : video.music_id,
            scenes: video.scenes.map((scene) => (scene.sound_effect_id === sound ? { ...scene, sound_effect_id: null } : scene)),
        });
    }
    return 'eliminado';
}
