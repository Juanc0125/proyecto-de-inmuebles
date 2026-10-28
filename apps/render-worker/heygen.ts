import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { reportError } from './error-reporting';

// The main video engine when it is configured: every scene becomes a HeyGen
// avatar - a realistic person - saying that scene's narration, lip-synced, in
// the avatar's own filmed set. The worker then puts its own subtitles,
// logo and music on top, exactly as it does for drawn scenes.
//
// Billing: this uses HeyGen's API wallet (pay-as-you-go, per second of
// output), which is separate from a HeyGen web subscription - the
// subscription's credits do not work here. With no HEYGEN_API_KEY nothing
// changes and nothing is charged. Every regenerate charges again.
//
// It is best-effort per scene, like the fal.ai path: a scene HeyGen cannot
// produce (no balance, timeout, a bad avatar id) is narrated and drawn by the
// worker instead, so a render never fails because of HeyGen.
const API_KEY = process.env.HEYGEN_API_KEY?.trim();
const AVATAR_ID = process.env.HEYGEN_AVATAR_ID?.trim();
const VOICE_ID = process.env.HEYGEN_VOICE_ID?.trim();
// avatar_iv is HeyGen's own default; avatar_iii is cheaper and less lifelike.
const ENGINE = process.env.HEYGEN_ENGINE?.trim();
const RESOLUTION = process.env.HEYGEN_RESOLUTION?.trim() || '720p';
const LOCALE = process.env.HEYGEN_LOCALE?.trim() || 'es-MX';
// HeyGen's public avatars are filmed in a real room (office, living room,
// kitchen), which is most of what makes them look real, so that set is kept by
// default. HEYGEN_BACKGROUND=marca swaps it for the brand's primary colour.
const BRAND_BACKGROUND = process.env.HEYGEN_BACKGROUND?.trim().toLowerCase() === 'marca';
const API_BASE = 'https://api.heygen.com';

// HeyGen renders in its own queue and a busy day means minutes per clip. All
// scenes are submitted up front (see startAvatarScenes), so this is a ceiling
// on the whole batch, not per scene.
const TIMEOUT_MS = Number(process.env.HEYGEN_TIMEOUT_MS ?? 15 * 60 * 1000);
const POLL_MS = 5000;
const MAX_SUBMIT_ATTEMPTS = 4;
// Per HTTP call; TIMEOUT_MS bounds the polling loop, not a single hung request.
const REQUEST_TIMEOUT_MS = 30_000;
// The download is streamed and this signal also bounds reading the body.
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export interface AvatarClip {
	path: string;
	durationSeconds: number;
}

export interface AvatarScene {
	description: string;
	audio_url?: string | null;
}

/** Why the engine is off, or null when it is on. Shown in the worker's /health. */
export function heygenMissingConfig(): string | null {
	if (!API_KEY) return 'falta HEYGEN_API_KEY';
	if (!AVATAR_ID) return 'falta HEYGEN_AVATAR_ID';
	if (!VOICE_ID) return 'falta HEYGEN_VOICE_ID';
	return null;
}

export function isHeygenEnabled(): boolean {
	return heygenMissingConfig() === null;
}

function heygenError(status: number, body: unknown): Error {
	const record = body && typeof body === 'object' ? body as { error?: { code?: unknown; message?: unknown } | string; message?: unknown } : {};
	const detail = typeof record.error === 'object'
		? `${String(record.error?.code ?? '')} ${String(record.error?.message ?? '')}`.trim()
		: String(record.error ?? record.message ?? '');
	return new Error(`HeyGen respondio ${status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
}

async function heygenFetch(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown>; retryAfter: number | null }> {
	const response = await fetch(`${API_BASE}${path}`, {
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		...init,
		headers: { 'x-api-key': API_KEY ?? '', accept: 'application/json', 'Content-Type': 'application/json', ...init?.headers },
	});
	const body = await response.json().catch(() => ({})) as Record<string, unknown>;
	const retryAfter = Number(response.headers.get('retry-after'));
	return { status: response.status, body, retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null };
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submit(scene: AvatarScene, aspectRatio: string, backgroundColor: string): Promise<string> {
	const audioUrl = typeof scene.audio_url === 'string' && scene.audio_url.trim() ? scene.audio_url.trim() : null;
	const payload: Record<string, unknown> = {
		type: 'avatar',
		avatar_id: AVATAR_ID,
		aspect_ratio: aspectRatio,
		resolution: RESOLUTION,
		...(BRAND_BACKGROUND ? { background: { type: 'color', value: backgroundColor } } : {}),
		// A scene that already carries the app's own narration keeps it, and
		// HeyGen only lip-syncs to it; otherwise HeyGen's voice reads the text.
		...(audioUrl
			? { audio_url: audioUrl }
			: { script: scene.description, voice_id: VOICE_ID, voice_settings: { locale: LOCALE } }),
		...(ENGINE ? { engine: { type: ENGINE } } : {}),
	};

	for (let attempt = 1; ; attempt += 1) {
		const { status, body, retryAfter } = await heygenFetch('/v3/videos', { method: 'POST', body: JSON.stringify(payload) });
		// Scenes are submitted all at once; a rate limit is expected on long
		// videos and is the one error worth waiting out.
		if (status === 429 && attempt < MAX_SUBMIT_ATTEMPTS) {
			await sleep((retryAfter ?? 5 * attempt) * 1000);
			continue;
		}
		if (status < 200 || status >= 300) throw heygenError(status, body);
		const videoId = (body.data as { video_id?: unknown } | undefined)?.video_id;
		if (typeof videoId !== 'string' || !videoId) throw new Error('HeyGen no devolvio video_id.');
		return videoId;
	}
}

async function waitAndDownload(videoId: string, destinationPath: string, deadline: number): Promise<number | null> {
	while (Date.now() < deadline) {
		await sleep(POLL_MS);
		const { status, body } = await heygenFetch(`/v3/videos/${encodeURIComponent(videoId)}`);
		if (status === 429) continue;
		if (status < 200 || status >= 300) throw heygenError(status, body);

		const detail = (body.data ?? {}) as { status?: unknown; video_url?: unknown; duration?: unknown; failure_code?: unknown; failure_message?: unknown };
		if (detail.status === 'failed') {
			throw new Error(`HeyGen no pudo generar la escena: ${String(detail.failure_code ?? '')} ${String(detail.failure_message ?? '')}`.trim());
		}
		if (detail.status !== 'completed') continue;
		if (typeof detail.video_url !== 'string') throw new Error('HeyGen termino sin video_url.');

		// Streamed straight to disk: the worker lives in 1 GB and a 1080p clip
		// should never sit whole in memory.
		const download = await fetch(detail.video_url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
		if (!download.ok || !download.body) throw new Error(`No se pudo descargar la escena de HeyGen: HTTP ${download.status}`);
		await pipeline(Readable.fromWeb(download.body as unknown as WebReadableStream), createWriteStream(destinationPath));

		const duration = Number(detail.duration);
		return Number.isFinite(duration) && duration > 0 ? duration : null;
	}
	throw new Error(`HeyGen excedio el tiempo limite (${TIMEOUT_MS} ms).`);
}

/**
 * Submits every scene to HeyGen at once and returns one promise per scene, in
 * order. The render loop awaits them one by one, so by the time it reaches a
 * scene HeyGen has usually finished it already - sequential submission would
 * make a six-scene video wait six HeyGen queues back to back.
 *
 * A promise never rejects: it resolves to null when that scene could not be
 * generated, and the caller draws the scene instead. `fallbackDuration` is used
 * only when HeyGen does not report the clip's length.
 */
export function startAvatarScenes(
	scenes: AvatarScene[],
	destinationPathFor: (index: number) => string,
	options: { aspectRatio: string; backgroundColor: string; fallbackDurations: number[] },
): Array<Promise<AvatarClip | null>> {
	const deadline = Date.now() + TIMEOUT_MS;
	return scenes.map(async (scene, index) => {
		if (!scene.description.trim() && !scene.audio_url) return null;
		try {
			const videoId = await submit(scene, options.aspectRatio, options.backgroundColor);
			const path = destinationPathFor(index);
			const reported = await waitAndDownload(videoId, path, deadline);
			return { path, durationSeconds: Math.min(60, reported ?? options.fallbackDurations[index] ?? 5) };
		} catch (error) {
			console.warn(`Fallo HeyGen en la escena ${index + 1}; se narrara y dibujara en su lugar.`, error);
			void reportError(error, { stage: 'heygen_scene', scene_index: index + 1, avatar_id: AVATAR_ID });
			return null;
		}
	});
}
