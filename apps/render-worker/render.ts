import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import { createClient } from '@supabase/supabase-js';
import {
	createFrameCanvas,
	drawSceneFrame,
	drawTransitionFrame,
	pickTransition,
	renderTextOverlayPng,
	TRANSITION_SECONDS,
	type CharacterType,
	type FrameScene,
	type SceneAction,
	type ScenePropType,
} from './drawing';
import { estimateWordTimings, mouthEnvelope, speak, type Speech } from './voice';
import { aiVideoModel, buildScenePrompt, generateSceneVideo, isAiVideoEnabled } from './ai-video';
import { heygenMissingConfig, isHeygenEnabled, startAvatarScenes, type AvatarClip } from './heygen';
import { errorReportingStatus, reportError } from './error-reporting';
import { elevenlabsMissingConfig, elevenlabsVoiceLabel } from './elevenlabs';

// The render pipeline and everything a job needs around it (validation,
// progress and final-state writes on the video row, upload, cleanup of the
// previous object). It has two entry points that must behave identically:
// index.ts (the long-lived HTTP server, used for local dev) and run-job.ts
// (one Cloud Run Job execution = one video). Neither of them renders on its
// own; anything that changes how a job runs belongs here, so the two cannot
// drift apart.

// Frames are drawn with a real 2D graphics context and piped to ffmpeg, so
// this is the animation's frame rate as well as the output's.
const FRAME_RATE = 24;

// Containers on Railway (and similar platforms) commonly report the HOST's
// full CPU count via nproc/sysconf even though a much stricter cgroup
// limit actually applies - x264's default thread count follows that
// reported count (e.g. "threads=60" was observed live), which can over-
// allocate encoder buffers/threads and get the process OOM-killed almost
// immediately (confirmed live: ffmpeg was killed by signal within ~6s).
// Pinning a small explicit thread count avoids this regardless of what
// the container reports.
const ENCODER_THREADS = Number(process.env.FFMPEG_THREADS ?? 2);

// libx264's own working set - a SEPARATE process from this one, but counted
// against the same container memory limit as this Node process by whatever
// kills a container over budget - scales with preset, not with clip length:
// measured on a representative 1080x1920/threads=2 encode, 'veryfast' (what
// every per-scene and per-transition encode used) peaks ffmpeg itself around
// 295MB versus 'ultrafast' around 145MB. This is the fix for the actual
// production kills: every failing render used the ordinary per-scene path
// with no branding logo configured (see applyLogoOverlayOrFallback below,
// whose own 'medium'-preset problem is real but separate - that path only
// runs at all when a logo is set, which none of the failing renders had), so
// this ~150MB-per-scene/per-transition saving, stacked against sherpa-onnx's
// permanent WASM floor (see voice.ts) and this Node process's own working
// set, is what closes the gap to fit inside 1GB.
//
// CRF still targets the same visual quality regardless of preset - a faster
// preset spends more bits to reach it, not a worse-looking picture - so
// preset is a pure memory lever and CRF is the separate bitrate lever that
// pays that back down. Verified independently: 'veryfast' vs 'ultrafast'
// frames at the same CRF were visually identical; then CRF 20/24/26/28 at
// 'ultrafast' were compared side by side, including 2x-zoomed text (the
// highest-contrast, hardest-to-hide-artifacts content in the frame) - all
// four indistinguishable, so 28, the highest tested, is the default. The
// trade actually paid is a larger MP4 than the original 'veryfast'/crf20
// output even at crf 28 (roughly 3x on the scene tested, versus 5.6x had CRF
// stayed at 20), which is inconsequential here since every short-form
// platform this app targets (RF-014) re-encodes whatever is uploaded anyway.
const ENCODER_PRESET = process.env.FFMPEG_PRESET?.trim() || 'ultrafast';
const ENCODER_CRF = process.env.FFMPEG_CRF?.trim() || '28';

// Every clip's audio is encoded to the same rate and layout, and padded with
// silence to the clip's full length. The concat demuxer below copies packets
// without re-encoding, so it needs both: the narration comes out of the voice
// model as 22.05 kHz mono while transitions and silent scenes were 44.1 kHz
// stereo, and copying those into one track left the audio decoding at the
// wrong rate (measured: a 23 s video carried 39 s of narration, drifting
// further out of sync after every transition). And with -shortest alone a
// drawn scene ended where its narration did, so the requested duration and
// the pause after each line were cut, and every clip's audio length differed
// from its video length - which is also what RF-010's effects are timed by.
const CLIP_AUDIO_ARGS = ['-c:a', 'aac', '-ar', '48000', '-ac', '2'];

// The scene unions (CharacterType, SceneAction, ScenePropType) come from
// drawing.ts, the one copy checks/type-parity.ts holds against shared-types.
export type Platform = 'reels' | 'tiktok' | 'shorts';
export type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type RenderScene = {
	order: number;
	character: CharacterType;
	action: SceneAction;
	prop: ScenePropType;
	description: string;
	duration_seconds: number;
	audio_url: string | null;
	// RF-010: one optional effect per scene, already resolved to a public URL
	// by the web app (null when none, or when its id no longer exists).
	sound_effect_url?: string | null;
};

export type Branding = {
	logo_url: string | null;
	logo_position: LogoPosition;
	primary_color: string;
	secondary_color: string;
	font_family: string;
};

export type RenderJob = {
	id?: string;
	platform: Platform;
	branding: Branding;
	scenes: RenderScene[];
};

export const port = Number(process.env.PORT ?? 8080);
// The worker now writes the finished video's URL itself, so it has to know
// where it is reachable. Only used when Supabase Storage isn't configured and
// the MP4 is served off local disk.
const publicBaseUrl = (process.env.PUBLIC_BASE_URL
	?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`)
).replace(/\/+$/, '');
export const renderDirectory = join(process.cwd(), 'renders');
const storageBucket = process.env.SUPABASE_RENDERS_BUCKET ?? 'renders';

const supabaseUrl = process.env.SUPABASE_URL;
// Accepts either name, matching the web app: Supabase now issues `sb_secret_`
// keys, which projects tend to store as SUPABASE_SECRET_KEY, while older
// setups use SUPABASE_SERVICE_ROLE_KEY. Reading only one of them silently
// leaves the worker unable to report progress or upload.
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const storageClient = supabaseUrl && supabaseServiceRoleKey
	? createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
	: null;

if (!storageClient) {
	console.warn('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_SECRET_KEY) no configuradas: los MP4 solo se guardaran en el filesystem local (no sobreviven un redeploy).');
}

// Surfaced on /health so it's possible to tell "storage was never configured"
// apart from "storage is configured but uploads are failing" without shell
// access to the container. Never holds credential values.
let lastStorageError: string | null = null;

// ---- Platform output dimensions (RF-014) ----
// Reels, TikTok and Shorts are all vertical short-form video with no real
// dimension difference between them, so all three map to the same 9:16 canvas.
const PLATFORM_DIMENSIONS: Record<Platform, { width: number; height: number }> = {
	reels: { width: 1080, height: 1920 },
	tiktok: { width: 1080, height: 1920 },
	shorts: { width: 1080, height: 1920 },
};

const DEFAULT_BRANDING: Branding = {
	logo_url: null,
	// Same default as packages/shared-types, so a job without branding puts
	// the logo where the web app's preview shows it.
	logo_position: 'top-right',
	primary_color: '#17202a',
	secondary_color: '#ffffff',
	font_family: 'Arial',
};

// ---- Branding colors (RF-026/RF-027 application, not capture) ----
// Frames are drawn on a canvas now, so these are CSS colors, not ffmpeg's
// 0xRRGGBB form - an invalid CSS color is ignored silently by the canvas and
// would paint the brand background black.
const DEFAULT_BACKGROUND_COLOR = '#17202a';
const DEFAULT_TEXT_COLOR = '#ffffff';
const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;

function toCssHexColor(value: unknown, fallback: string): string {
	if (typeof value === 'string' && HEX_COLOR_PATTERN.test(value.trim())) {
		return `#${value.trim().replace(/^#/, '')}`;
	}
	return fallback;
}

// Job ids name a directory that is later removed with rm -rf, so anything but
// a plain UUID (the web app's video row id) is refused before it reaches a path.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID_PATTERN.test(value);
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// supabase-js hands back plain error objects (PostgrestError, StorageError)
// rather than throwing; Sentry and the logs want a real Error with a stack.
function toError(value: unknown): Error {
	if (value instanceof Error) return value;
	if (value && typeof value === 'object' && 'message' in value) return new Error(String((value as { message: unknown }).message));
	return new Error(String(value));
}

// Every remote input ffmpeg opens gets a read timeout (microseconds): without
// it a server that accepts the connection and then stalls hangs the render
// forever, and the video row stays "procesando" with nobody told.
const REMOTE_READ_TIMEOUT_US = String(Math.max(1, Number(process.env.FFMPEG_RW_TIMEOUT_MS ?? 30_000)) * 1000);

function remoteInput(url: string): string[] {
	return ['-rw_timeout', REMOTE_READ_TIMEOUT_US, '-i', url];
}

// Ceiling on any single ffmpeg run. Generous on purpose: the logo pass
// re-encodes the whole video. It exists for the stuck process, not the slow one.
const FFMPEG_TIMEOUT_MS = Math.max(1000, Number(process.env.FFMPEG_TIMEOUT_MS ?? 20 * 60 * 1000));

// Each render gets its own object name, so a re-render never overwrites a URL
// a browser or the CDN already cached; the low max-age is only a backstop.
export const STORAGE_CACHE_CONTROL_SECONDS = '60';
const UPLOAD_ATTEMPTS = 3;

// Streamed from disk instead of read whole: the worker lives in 1 GB and the
// finished MP4 would otherwise sit in memory next to everything else. A fresh
// stream per attempt, since a consumed stream cannot be replayed. Throws once
// every attempt has failed - the caller decides what that means for the job.
async function uploadToSupabase(filePath: string, objectName: string): Promise<string> {
	if (!storageClient) throw new Error('Supabase Storage no esta configurado.');

	let lastError: unknown = null;
	for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
		try {
			const { error: uploadError } = await storageClient.storage.from(storageBucket).upload(objectName, createReadStream(filePath), {
				contentType: 'video/mp4',
				cacheControl: STORAGE_CACHE_CONTROL_SECONDS,
				upsert: true,
			});
			if (uploadError) throw toError(uploadError);

			const { data } = storageClient.storage.from(storageBucket).getPublicUrl(objectName);
			if (!data?.publicUrl) throw new Error('No se obtuvo una URL publica del bucket.');

			await unlink(filePath).catch(() => undefined);
			lastStorageError = null;
			return data.publicUrl;
		} catch (error) {
			lastError = error;
			lastStorageError = toError(error).message;
			console.warn(`Fallo el intento ${attempt}/${UPLOAD_ATTEMPTS} de subir el render a Supabase Storage.`, error);
			if (attempt < UPLOAD_ATTEMPTS) await sleep(2000 * attempt);
		}
	}
	throw toError(lastError);
}

// Public URL prefix of this worker's own bucket, used to recognise the object
// a previous render of the same video left behind.
const storagePublicPrefix = supabaseUrl
	? `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${storageBucket}/`
	: null;

// Only an object this video itself produced is ever deleted: the name must be
// the video's own id (old `<id>.mp4` or new `<id>-<timestamp>.mp4`), so a
// video_url that somehow points at another video's file is left alone.
function previousObjectName(previousUrl: string | null, videoId: string, currentObjectName: string): string | null {
	if (!previousUrl || !storagePublicPrefix || !isUuid(videoId)) return null;
	const withoutQuery = previousUrl.split('?')[0];
	if (!withoutQuery.startsWith(storagePublicPrefix)) return null;
	let name: string;
	try {
		name = decodeURIComponent(withoutQuery.slice(storagePublicPrefix.length));
	} catch {
		return null;
	}
	if (name === currentObjectName) return null;
	return new RegExp(`^${videoId}(-\\d+)?\\.mp4$`, 'i').test(name) ? name : null;
}

async function readPreviousVideoUrl(videoId: string): Promise<string | null> {
	if (!storageClient) return null;
	try {
		const { data, error } = await storageClient.from('videos').select('video_url').eq('id', videoId).maybeSingle();
		if (error) throw toError(error);
		const url = (data as { video_url?: unknown } | null)?.video_url;
		return typeof url === 'string' ? url : null;
	} catch (error) {
		console.warn('No se pudo leer el video anterior; no se borrara su archivo.', error);
		return null;
	}
}

// Best-effort: a leftover object only costs storage, never the person's video.
async function removePreviousObject(previousUrl: string | null, videoId: string, currentObjectName: string) {
	const name = previousObjectName(previousUrl, videoId, currentObjectName);
	if (!name || !storageClient) return;
	try {
		const { error } = await storageClient.storage.from(storageBucket).remove([name]);
		if (error) throw toError(error);
	} catch (error) {
		console.warn(`No se pudo borrar el render anterior ${name} del bucket.`, error);
	}
}

// The logo URL comes from the request body and is handed to ffmpeg, which
// would fetch anything (file:, other hosts, internal addresses). Only logos
// the web app itself uploaded to the public branding-logos bucket are used.
const LOGO_URL_PREFIX = supabaseUrl
	? `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/branding-logos/`
	: null;

function trustedLogoUrl(raw: string): string | null {
	if (!LOGO_URL_PREFIX) return null;
	try {
		// new URL() resolves dot segments, so "<prefix>../other-bucket/x" can't
		// pass the prefix test and still escape the bucket.
		const parsed = new URL(raw);
		if (parsed.protocol !== 'https:') return null;
		return parsed.href.startsWith(LOGO_URL_PREFIX) ? parsed.href : null;
	} catch {
		return null;
	}
}

function getLogoOverlayPosition(position: LogoPosition | undefined): string {
	switch (position) {
		case 'top-left': return '24:24';
		case 'bottom-left': return '24:H-h-24';
		case 'bottom-right': return 'W-w-24:H-h-24';
		case 'top-right':
		default: return 'W-w-24:24';
	}
}

// Applies the brand logo (RF-026 application) as an overlay on the final,
// already-concatenated video. If the logo URL is unreachable or ffmpeg fails
// on it, this degrades gracefully to the un-logo'd video instead of failing
// the whole render, matching this file's existing resilience-over-hard-failure
// convention (see uploadToSupabase above).
async function applyLogoOverlayOrFallback(sourcePath: string, destinationPath: string, branding: Branding, jobId: string): Promise<void> {
	const requestedLogoUrl = typeof branding.logo_url === 'string' && branding.logo_url.trim().length > 0
		? branding.logo_url.trim()
		: null;

	if (!requestedLogoUrl) {
		await rename(sourcePath, destinationPath);
		return;
	}

	const logoUrl = trustedLogoUrl(requestedLogoUrl);
	if (!logoUrl) {
		console.warn('El logo de marca no viene del bucket branding-logos de este proyecto; se renderiza sin logo.');
		void reportError(new Error('logo_url rechazada: no es una URL https del bucket branding-logos'), { job_id: jobId, logo_url: requestedLogoUrl.slice(0, 300) });
		await rename(sourcePath, destinationPath);
		return;
	}

	try {
		const overlayPosition = getLogoOverlayPosition(branding.logo_position);
		await runFfmpeg([
			'-y',
			'-i', sourcePath,
			...remoteInput(logoUrl),
			'-filter_complex', `[1:v]scale=160:-1[logo];[0:v][logo]overlay=${overlayPosition}[outv]`,
			'-map', '[outv]',
			'-map', '0:a',
			'-c:v', 'libx264',
			'-threads', String(ENCODER_THREADS),
			// This path only runs when a logo is configured (see the early
			// return above), so it was not what killed the production renders
			// that had none - but without an explicit preset it re-encodes the
			// WHOLE assembled video (every scene, not one) at ffmpeg's own
			// default ('medium'), which measured close to 490MB of ffmpeg's own
			// memory versus ~145MB for ENCODER_PRESET - right at the tail of a
			// job, on top of whatever this worker is already holding from every
			// scene before it. A brand logo is common enough (RF-026) that this
			// path needs the same budget discipline as the per-scene encodes
			// above, not ffmpeg's default, so it would have died even harder
			// than the renders that actually failed.
			'-preset', ENCODER_PRESET,
			'-crf', ENCODER_CRF,
			'-c:a', 'copy',
			'-pix_fmt', 'yuv420p',
			'-movflags', '+faststart',
			destinationPath,
		]);
	} catch (error) {
		console.warn('Fallo al aplicar el logo de marca sobre el render final, se conserva el video sin logo.', error);
		void reportError(error, { job_id: jobId, stage: 'logo', logo_url: logoUrl });
		await unlink(destinationPath).catch(() => undefined);
		await rename(sourcePath, destinationPath);
	}
}

// ---- Sound effects (RF-010) ----

// Background music was removed from the product; only per-scene effects are
// mixed over the narration now. A job from an older web deployment may still
// carry `music_url`: it is not part of RenderJob any more and is never read.

// Effects are short, peak-normalised accents; at 1.0 they jumped out over the
// voice, so they are pulled down a little.
const EFFECT_VOLUME = 0.6;
// Every input is brought to one format before mixing, since narration (mono,
// whatever rate the voice model speaks at) and effects differ.
const MIX_SAMPLE_RATE = 48000;
const MIX_FORMAT = `aresample=${MIX_SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;

type TimedEffect = { url: string; startSeconds: number };

function nonEmptyUrl(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

// Downloads and decodes one remote audio file to raw 16-bit PCM on disk, at
// most `maxSeconds` of it, and returns how long it actually is. Decoding up
// front means a broken URL fails here, on its own, instead of inside a
// multi-input ffmpeg graph where it would take every other input down with it;
// and the byte count gives the exact length without a separate probe.
async function decodeToPcm(url: string, pcmPath: string, maxSeconds: number, channels: number, sampleRate: number): Promise<number> {
	await runFfmpeg([
		'-y', ...remoteInput(url), '-vn',
		'-t', String(maxSeconds),
		'-ac', String(channels), '-ar', String(sampleRate), '-f', 's16le', pcmPath,
	]);
	return (await stat(pcmPath)).size / (sampleRate * channels * 2);
}

function pcmInput(path: string, channels: number, sampleRate: number): string[] {
	return ['-f', 's16le', '-ar', String(sampleRate), '-ac', String(channels), '-i', path];
}

// One extra ffmpeg pass over the concatenated video that only touches audio:
// the video stream is copied, so this costs a few seconds and the memory of an
// audio decode, not another x264 encode. Returns the path of the mixed video,
// or the untouched source when there is nothing usable to mix or the mix
// fails - a broken effect URL must never cost the person their video (same
// convention as applyLogoOverlayOrFallback). Each effect is decoded on its own
// first, so one bad effect drops only that effect, not the rest.
async function mixSoundsOrKeep(
	sourcePath: string,
	jobDirectory: string,
	effects: TimedEffect[],
	totalSeconds: number,
	jobId: string,
): Promise<string> {
	if (effects.length === 0) return sourcePath;

	const usableEffects: Array<{ path: string; startSeconds: number }> = [];
	for (const [effectIndex, effect] of effects.entries()) {
		const effectPcmPath = join(jobDirectory, `effect-${effectIndex}.pcm`);
		try {
			await decodeToPcm(effect.url, effectPcmPath, Math.max(1, totalSeconds), 2, MIX_SAMPLE_RATE);
			usableEffects.push({ path: effectPcmPath, startSeconds: effect.startSeconds });
		} catch (error) {
			console.warn(`No se pudo usar el efecto de sonido ${effectIndex + 1}; se omite solo ese efecto.`, error);
			void reportError(error, { job_id: jobId, stage: 'sound_effect', effect_url: effect.url, start_seconds: effect.startSeconds });
		}
	}

	if (usableEffects.length === 0) return sourcePath;

	const mixedPath = join(jobDirectory, 'mixed-output.mp4');
	try {
		const inputs: string[] = ['-i', sourcePath];
		const graph: string[] = [`[0:a]${MIX_FORMAT}[voice]`];
		const mixLabels = ['[voice]'];
		let nextInput = 1;

		usableEffects.forEach((effect, effectIndex) => {
			inputs.push(...pcmInput(effect.path, 2, MIX_SAMPLE_RATE));
			const delayMs = Math.max(0, Math.round(effect.startSeconds * 1000));
			graph.push(`[${nextInput}:a]${MIX_FORMAT},adelay=delays=${delayMs}:all=1,volume=${EFFECT_VOLUME}[fx${effectIndex}]`);
			mixLabels.push(`[fx${effectIndex}]`);
			nextInput += 1;
		});

		// normalize=0: amix would otherwise divide every input by the input
		// count, and the narration has to stay exactly as loud as it was.
		// duration=first: the narration track defines the video's length.
		graph.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0:normalize=0[mixed]`);

		await runFfmpeg([
			'-y',
			...inputs,
			'-filter_complex', graph.join(';'),
			'-map', '0:v',
			'-map', '[mixed]',
			'-c:v', 'copy',
			'-c:a', 'aac',
			'-b:a', '160k',
			'-ar', String(MIX_SAMPLE_RATE),
			'-movflags', '+faststart',
			mixedPath,
		]);
		return mixedPath;
	} catch (error) {
		console.warn('Fallo al mezclar los efectos de sonido, se conserva el video sin mezcla.', error);
		void reportError(error, { job_id: jobId, stage: 'mix', effects: usableEffects.length });
		await unlink(mixedPath).catch(() => undefined);
		return sourcePath;
	}
}

// Best-effort removal of intermediate files that are no longer needed.
async function discardFiles(paths: string[]): Promise<void> {
	await Promise.all(paths.map((path) => unlink(path).catch(() => undefined)));
}

// Kills ffmpeg once it has run past `timeoutMs`; SIGKILL because a process
// stuck in I/O can ignore SIGTERM.
function runFfmpeg(args: string[], timeoutMs: number = FFMPEG_TIMEOUT_MS) {
	return new Promise<void>((resolve, reject) => {
		const childProcess = spawn(process.env.FFMPEG_PATH ?? ffmpegPath ?? 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
		let errorOutput = '';
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			childProcess.kill('SIGKILL');
		}, timeoutMs);

		childProcess.stderr.on('data', (chunk: Buffer) => {
			// Only the tail is ever reported; keep a chatty run from growing
			// this without bound.
			errorOutput = (errorOutput + chunk.toString()).slice(-8000);
		});
		childProcess.on('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		childProcess.on('close', (code) => {
			clearTimeout(timer);
			if (timedOut) reject(new Error(`FFmpeg excedio el tiempo limite (${timeoutMs} ms) y fue detenido: ${errorOutput.slice(-1000)}`));
			else if (code === 0) resolve();
			else reject(new Error(`FFmpeg termino con codigo ${code}: ${errorOutput.slice(-2000)}`));
		});
	});
}

// Same as runFfmpeg, but feeds ffmpeg raw RGBA frames on stdin instead of
// giving it an input file. renderFrame() must return exactly width*height*4
// bytes; the buffer is handed straight to the pipe, respecting backpressure so
// a long scene can't buffer the whole uncompressed video in memory.
function runFfmpegWithFrames(args: string[], frameCount: number, renderFrame: (frameIndex: number) => Buffer, timeoutMs: number = FFMPEG_TIMEOUT_MS) {
	return new Promise<void>((resolve, reject) => {
		const childProcess = spawn(process.env.FFMPEG_PATH ?? ffmpegPath ?? 'ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
		let errorOutput = '';
		let settled = false;

		const fail = (error: Error, signal: NodeJS.Signals = 'SIGTERM') => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			childProcess.kill(signal);
			reject(error);
		};

		// Same ceiling as runFfmpeg: a wedged encoder must not hold the job,
		// and the single render slot, forever.
		const timer = setTimeout(() => {
			fail(new Error(`FFmpeg excedio el tiempo limite (${timeoutMs} ms) y fue detenido: ${errorOutput.slice(-1000)}`), 'SIGKILL');
		}, timeoutMs);

		childProcess.stderr.on('data', (chunk: Buffer) => {
			errorOutput = (errorOutput + chunk.toString()).slice(-8000);
		});
		childProcess.on('error', (error) => fail(error));
		childProcess.on('close', (code) => {
			clearTimeout(timer);
			if (settled) return;
			settled = true;
			if (code === 0) resolve();
			else reject(new Error(`FFmpeg termino con codigo ${code}: ${errorOutput.slice(-2000)}`));
		});

		// EPIPE is expected if ffmpeg dies first - the 'close' handler above
		// reports the real reason, so don't let it surface as an unhandled error.
		childProcess.stdin.on('error', () => undefined);

		void (async () => {
			for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
				if (settled || childProcess.stdin.destroyed) return;
				if (!childProcess.stdin.write(renderFrame(frameIndex))) {
					await once(childProcess.stdin, 'drain');
				}
			}
			childProcess.stdin.end();
		})().catch((error) => {
			// A write failure here is almost always ffmpeg having already exited
			// (EPIPE/EOF), in which case its stderr holds the real reason and
			// this error is only the symptom. Give 'close' a moment to report
			// that instead, and fall back to the write error if it never fires.
			setTimeout(() => fail(error instanceof Error ? error : new Error(String(error))), 400);
		});
	});
}

// Narration the web app already produced (scene.audio_url), decoded to mono
// 16-bit PCM: mono because it is one voice and the envelope wants one channel,
// 48 kHz because it is also what the clip is encoded from, so nothing is lost.
// At most 61 s, since a scene is capped at 60.
const SCENE_AUDIO_SAMPLE_RATE = 48000;

async function decodeSceneAudio(url: string, pcmPath: string): Promise<Speech> {
	await decodeToPcm(url, pcmPath, 61, 1, SCENE_AUDIO_SAMPLE_RATE);
	const bytes = await readFile(pcmPath);
	const samples = new Float32Array(Math.floor(bytes.length / 2));
	for (let i = 0; i < samples.length; i += 1) samples[i] = bytes.readInt16LE(i * 2) / 32768;
	return { samples, sampleRate: SCENE_AUDIO_SAMPLE_RATE, durationSeconds: samples.length / SCENE_AUDIO_SAMPLE_RATE };
}

// 16-bit PCM mono WAV. The narration comes back as float samples and ffmpeg
// needs a file, and this is small enough not to justify a dependency.
async function writeWavFile(path: string, samples: Float32Array, sampleRate: number) {
	const dataBytes = samples.length * 2;
	const buffer = Buffer.alloc(44 + dataBytes);

	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + dataBytes, 4);
	buffer.write('WAVE', 8);
	buffer.write('fmt ', 12);
	buffer.writeUInt32LE(16, 16);      // PCM header size
	buffer.writeUInt16LE(1, 20);       // format: PCM
	buffer.writeUInt16LE(1, 22);       // channels
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
	buffer.writeUInt16LE(2, 32);       // block align
	buffer.writeUInt16LE(16, 34);      // bits per sample
	buffer.write('data', 36);
	buffer.writeUInt32LE(dataBytes, 40);

	for (let i = 0; i < samples.length; i += 1) {
		const clamped = Math.max(-1, Math.min(1, samples[i]));
		buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
	}

	await writeFile(path, buffer);
}

// Progress is written straight onto the video row, so it survives a worker
// restart and the UI can read it from the endpoint it already polls. Failing
// to report progress must never fail the render itself.
//
// supabase-js does not throw on a failed update, it returns { error }, so that
// is what is checked. Intermediate percentages are fire-and-forget; a final
// state ('listo' / 'error') is what the web app waits on, so `final` retries
// it with backoff and reports to Sentry if it still can't be written - a lost
// final write leaves the row "procesando" forever. Returns whether it landed.
const FINAL_WRITE_ATTEMPTS = 4;

async function reportProgress(videoId: string, fields: Record<string, unknown>, options: { final?: boolean } = {}): Promise<boolean> {
	if (!storageClient) return true;
	const attempts = options.final ? FINAL_WRITE_ATTEMPTS : 1;
	let lastError: unknown = null;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const { error } = await storageClient.from('videos').update(fields).eq('id', videoId);
			if (!error) return true;
			lastError = error;
		} catch (error) {
			lastError = error;
		}
		if (attempt < attempts) await sleep(1000 * 2 ** (attempt - 1));
	}
	console.warn(`No se pudo reportar el estado del render ${videoId}.`, lastError);
	if (options.final) {
		void reportError(toError(lastError), { job_id: videoId, stage: 'report_final_state', render_status: fields.render_status });
	}
	return false;
}

// The frame the outgoing scene's own last drawn pose comes from (for a
// transition's "from" side) needs a matching frame for the *next* scene's
// first pose - built from the raw scene data before that scene has been
// narrated or timed. At t=0 nothing in drawSceneFrame depends on the total
// duration (every t/duration ratio is 0), so a placeholder duration is safe.
function previewFrameScene(scene: RenderScene, index: number): FrameScene {
	const description = (scene.description || '').trim();
	return { index, character: scene.character, action: scene.action, prop: scene.prop, description: description || `Escena ${index + 1}` };
}

// Exported so a memory/measurement harness (or a future test) can drive a
// render directly, without going through HTTP and a fake video row.
export async function render(job: RenderJob, onProgress?: (percent: number) => void) {
	if (!Array.isArray(job.scenes) || job.scenes.length === 0) {
		throw new Error('El trabajo necesita al menos una escena.');
	}

	// Checked here too, not only in the HTTP handler: the id becomes a path
	// that the finally below removes recursively.
	if (job.id !== undefined && !isUuid(job.id)) {
		throw new Error('El id del trabajo no es un UUID valido.');
	}
	const jobId = job.id ?? randomUUID();
	// One directory per attempt, not per video: a retry of the same video that
	// overlapped a dying attempt would otherwise have its files removed by the
	// other attempt's cleanup.
	const jobDirectory = join(renderDirectory, `${jobId}-${randomUUID()}`);
	await mkdir(jobDirectory, { recursive: true });

	const branding = job.branding ?? DEFAULT_BRANDING;
	const backgroundColor = toCssHexColor(branding.primary_color, DEFAULT_BACKGROUND_COLOR);
	const textColor = toCssHexColor(branding.secondary_color, DEFAULT_TEXT_COLOR);
	const { width, height } = PLATFORM_DIMENSIONS[job.platform] ?? PLATFORM_DIMENSIONS.reels;

	try {
		const clips: string[] = [];
		const scenes = [...job.scenes].sort((first, second) => first.order - second.order);
		// Running length of the assembled video, so each scene's sound effect
		// can be placed where that scene starts once the clips are concatenated.
		// Counted from what each clip actually encodes (whole frames), not the
		// requested duration, and transitions included, or every effect after
		// the first transition would land early.
		let elapsedSeconds = 0;
		const timedEffects: TimedEffect[] = [];

		// Every canvas here is a native (Skia) surface plus an 8MB-at-1080x1920
		// RGBA backing buffer that V8's garbage collector does not feel much
		// pressure from - the JS wrapper object is tiny, so the collector has no
		// reason to run promptly just because a handful of these are unreachable.
		// The previous code allocated one of these per scene, plus three more
		// per scene *boundary* for the transition (from/to/blend), so an 8-scene
		// job held dozens of full-frame surfaces alive across its run before GC
		// caught up - measured as the render's dominant source of peak RSS (see
		// the render-worker-agent memory report). Allocating the three surfaces
		// a render ever needs once, up front, and reusing them for every scene
		// and every boundary removes that churn entirely: each frame's
		// background fill (see drawBackground in drawing.ts) overwrites the
		// whole canvas before anything is read back, so reusing one across
		// scenes is safe.
		const canvas = createFrameCanvas(width, height);
		const context = canvas.getContext('2d');
		const toCanvas = createFrameCanvas(width, height);
		const toContext = toCanvas.getContext('2d');
		const transitionCanvas = createFrameCanvas(width, height);
		const transitionContext = transitionCanvas.getContext('2d');

		// HeyGen, when configured, is the main engine: every scene is sent to it
		// before the first one is drawn, so its queue works in parallel with the
		// loop below. A scene it cannot produce comes back null and is drawn.
		const avatarClips: Array<Promise<AvatarClip | null>> | null = isHeygenEnabled()
			? startAvatarScenes(
				scenes.map((scene) => ({ description: (scene.description || '').trim(), audio_url: scene.audio_url })),
				(index) => join(jobDirectory, `scene-${index + 1}-heygen.mp4`),
				{
					aspectRatio: width === height ? '1:1' : width > height ? '16:9' : '9:16',
					backgroundColor,
					fallbackDurations: scenes.map((scene) => Math.max(1, Math.min(60, Number(scene.duration_seconds) || 1))),
				},
			)
			: null;

		for (let index = 0; index < scenes.length; index += 1) {
			const scene = scenes[index];
			const requestedDuration = Math.max(1, Math.min(60, Number(scene.duration_seconds) || 1));
			const clipPath = join(jobDirectory, `scene-${index + 1}.mp4`);
			const narration = (scene.description || '').trim();

			const audioUrl = typeof scene.audio_url === 'string' && scene.audio_url.trim().length > 0
				? scene.audio_url.trim()
				: null;

			// A HeyGen clip brings its own lip-synced voice and sets the scene's
			// length; nothing below narrates or draws it.
			const avatarClip = avatarClips ? await avatarClips[index] : null;

			// Narrate locally unless the scene already carries audio from the
			// app's own TTS. Doing it here rather than upstream also hands us the
			// waveform, which is what drives the lip sync below.
			const speech = audioUrl || avatarClip ? null : await speak(narration);

			// Audio the app already narrated is decoded here too, for the same
			// two reasons: its real length (a line longer than the planned
			// duration was being cut off) and its waveform for the lip sync.
			// The clip below then reads the local PCM instead of fetching the
			// URL a second time.
			const providedAudioPath = join(jobDirectory, `scene-${index + 1}-audio.pcm`);
			const providedAudio = audioUrl && !avatarClip ? await decodeSceneAudio(audioUrl, providedAudioPath) : null;
			const voiceTrack: Speech | null = speech ?? providedAudio;

			// A scene must never cut its own narration off mid-sentence, so
			// speech length wins when it exceeds the planned duration.
			const duration = avatarClip
				? avatarClip.durationSeconds
				: voiceTrack
					? Math.min(60, Math.max(requestedDuration, voiceTrack.durationSeconds + 0.35))
					: requestedDuration;

			// Every clip gets both a video AND an audio stream - real audio when
			// available, otherwise a silent anullsrc track of the same duration -
			// so the concat demuxer below sees a uniform stream layout across all
			// clips regardless of which scenes had narration.
			let audioInputArgs: string[];
			if (providedAudio) {
				audioInputArgs = pcmInput(providedAudioPath, 1, SCENE_AUDIO_SAMPLE_RATE);
			} else if (speech) {
				const voicePath = join(jobDirectory, `scene-${index + 1}.wav`);
				await writeWavFile(voicePath, speech.samples, speech.sampleRate);
				audioInputArgs = ['-i', voicePath];
			} else {
				audioInputArgs = ['-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${duration}`];
			}

			const frameScene = {
				index,
				character: scene.character,
				action: scene.action,
				prop: scene.prop,
				description: narration || `Escena ${index + 1}`,
			};
			const frameStyle = { width, height, background: backgroundColor, ink: textColor, fontFamily: branding.font_family };
			const frameCount = Math.max(1, Math.round(duration * FRAME_RATE));
			const mouth = voiceTrack ? mouthEnvelope(voiceTrack, FRAME_RATE, frameCount) : null;
			// ElevenLabs reports when each word is spoken, so its timings are used
			// as they come. Piper does not, so there the subtitle highlight is
			// approximated from word length and refined against the loudness
			// envelope (see estimateWordTimings in voice.ts).
			const wordTimings = speech?.words?.length
				? speech.words
				: estimateWordTimings(frameScene.description, duration, mouth, FRAME_RATE);
			const isFirstScene = index === 0;
			const isLastScene = index === scenes.length - 1;

			const effectUrl = nonEmptyUrl(scene.sound_effect_url);
			if (effectUrl) timedEffects.push({ url: effectUrl, startSeconds: elapsedSeconds });

			// When an AI model is configured, the scene's footage comes from it
			// and we only add our own text and narration on top. Generation is
			// best-effort: if it fails or is not configured, the scene is drawn
			// instead, so a render always produces a video.
			let generatedPath: string | null = avatarClip ? avatarClip.path : null;
			if (!generatedPath && isAiVideoEnabled()) {
				const candidate = join(jobDirectory, `scene-${index + 1}-ai.mp4`);
				const prompt = buildScenePrompt(scene);
				if (await generateSceneVideo(prompt, duration, candidate)) generatedPath = candidate;
			}

			if (generatedPath) {
				const overlayPath = join(jobDirectory, `scene-${index + 1}-text.png`);
				await writeFile(overlayPath, renderTextOverlayPng(frameScene, frameStyle));

				// The generated clip rarely matches the narration exactly, so it
				// is scaled to the canvas, padded if the aspect differs, and
				// looped in case it came back shorter than the voice line.
				await runFfmpeg([
					'-y',
					// A HeyGen clip already is the whole scene, voice included,
					// at the exact length; only the fal.ai footage is looped and
					// gets the narration laid over it.
					...(avatarClip ? [] : ['-stream_loop', '-1']),
					'-i', generatedPath,
					'-i', overlayPath,
					...(avatarClip ? [] : audioInputArgs),
					'-filter_complex',
					`[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${FRAME_RATE}[bg];`
					+ `[bg][1:v]overlay=0:0[outv]`,
					'-map', '[outv]',
					'-map', avatarClip ? '0:a' : '2:a',
					'-af', 'apad',
					'-t', String(duration),
					'-c:v', 'libx264',
					'-threads', String(ENCODER_THREADS),
					'-preset', ENCODER_PRESET,
					'-crf', ENCODER_CRF,
					...CLIP_AUDIO_ARGS,
					'-pix_fmt', 'yuv420p',
					'-movflags', '+faststart',
					clipPath,
				]);
			} else {
				await runFfmpegWithFrames([
					'-y',
					'-f', 'rawvideo',
					'-pix_fmt', 'rgba',
					'-s', `${width}x${height}`,
					'-r', String(FRAME_RATE),
					'-i', 'pipe:0',
					...audioInputArgs,
					'-map', '0:v',
					'-map', '1:a',
					'-af', 'apad',
					'-t', String(frameCount / FRAME_RATE),
					'-c:v', 'libx264',
					'-threads', String(ENCODER_THREADS),
					'-preset', ENCODER_PRESET,
					'-crf', ENCODER_CRF,
					...CLIP_AUDIO_ARGS,
					'-shortest',
					'-pix_fmt', 'yuv420p',
					'-movflags', '+faststart',
					clipPath,
				], frameCount, (frameIndex) => {
					drawSceneFrame(
						context,
						frameScene,
						frameIndex / FRAME_RATE,
						duration,
						frameStyle,
						mouth ? mouth[frameIndex] ?? 0 : null,
						wordTimings,
						{ in: isFirstScene, out: isLastScene },
					);
					// canvas.data() reads the surface's raw RGBA pixels directly, in
					// the exact byte layout ffmpeg's rawvideo/rgba input expects.
					// context.getImageData(...).data did the same read plus an
					// un-premultiply pass and returned a fresh Uint8ClampedArray that
					// Buffer.from() then copied a second time - two full 8MB
					// allocations per frame where one suffices, since every frame
					// here is fully opaque by construction (drawBackground paints the
					// whole canvas first) and un-premultiplying an opaque pixel is a
					// no-op. Verified byte-identical (a handful of pixels differ by
					// 1/255 from unrelated antialiasing rounding) against the old
					// path before switching.
					return canvas.data();
				});
			}

			clips.push(clipPath);
			// Cloud Run's filesystem is RAM: once a scene is encoded, its inputs
			// (narration WAV/PCM, the generated footage, the text overlay) are only
			// taking memory away from the next scene.
			await discardFiles([
				providedAudioPath,
				join(jobDirectory, `scene-${index + 1}.wav`),
				join(jobDirectory, `scene-${index + 1}-text.png`),
				join(jobDirectory, `scene-${index + 1}-ai.mp4`),
				join(jobDirectory, `scene-${index + 1}-heygen.mp4`),
			]);
			// The AI path cuts at -t duration; the drawn path ends with its last
			// frame (its audio is padded to that length, see CLIP_AUDIO_ARGS).
			elapsedSeconds += generatedPath ? duration : frameCount / FRAME_RATE;

			// The join to the next scene: a hard cut, a crossfade or a slide (see
			// pickTransition). Built as a handful of extra frames blending the
			// frozen last pose of this scene with the frozen first pose of the
			// next, rather than an ffmpeg crossfade filter - that would have to
			// re-encode the whole assembled video to re-time every frame after
			// it, which is exactly the "doubles the render" cost the frame
			// budget can't absorb for a transition that lasts a third of a
			// second. It only applies between two canvas-drawn scenes: an AI clip
			// has no frame of ours to blend from, and generation is best-effort
			// per scene, so whether the *next* scene will need one isn't known
			// yet here - simplest to keep every AI-video boundary a plain cut.
			if (!isLastScene && !generatedPath && !isAiVideoEnabled() && !avatarClips) {
				const nextFrameScene = previewFrameScene(scenes[index + 1], index + 1);
				const narrationWordCount = frameScene.description.split(/\s+/).filter(Boolean).length;
				const wordsPerSecond = duration > 0 ? narrationWordCount / duration : 0;
				const kind = pickTransition(frameScene, nextFrameScene, wordsPerSecond, index);

				if (kind !== 'cut') {
					// The "from" side is just-drawn: `canvas` still holds this
					// scene's very last frame exactly as the loop above left it (its
					// last drawSceneFrame call above already rendered this same
					// instant), so re-rendering it onto a second canvas would be a
					// wasted duplicate draw plus a wasted duplicate surface. Reusing
					// it is both cheaper and strictly more accurate: it's the frame
					// that actually shipped, not a second simulation of it.
					//
					// duration=1 is a placeholder: at t=0 every t/duration ratio
					// drawSceneFrame uses (camera easing, pose phase) is 0
					// regardless of the real duration, which isn't known yet -
					// the next scene hasn't been narrated at this point in the loop.
					drawSceneFrame(toContext, nextFrameScene, 0, 1, frameStyle, null, null);

					const transitionFrameCount = Math.max(1, Math.round(TRANSITION_SECONDS * FRAME_RATE));
					const transitionClipPath = join(jobDirectory, `scene-${index + 1}-transition.mp4`);

					await runFfmpegWithFrames([
						'-y',
						'-f', 'rawvideo',
						'-pix_fmt', 'rgba',
						'-s', `${width}x${height}`,
						'-r', String(FRAME_RATE),
						'-i', 'pipe:0',
						'-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${TRANSITION_SECONDS}`,
						'-map', '0:v',
						'-map', '1:a',
						'-c:v', 'libx264',
						'-threads', String(ENCODER_THREADS),
						'-preset', ENCODER_PRESET,
						'-crf', ENCODER_CRF,
						...CLIP_AUDIO_ARGS,
						'-shortest',
						'-pix_fmt', 'yuv420p',
						'-movflags', '+faststart',
						transitionClipPath,
					], transitionFrameCount, (frameIndex) => {
						drawTransitionFrame(transitionContext, canvas, toCanvas, kind, (frameIndex + 1) / transitionFrameCount, width);
						return transitionCanvas.data();
					});

					clips.push(transitionClipPath);
					elapsedSeconds += transitionFrameCount / FRAME_RATE;
				}
			}

			// Scene rendering is the long part; the tail (concat, logo, upload)
			// is quick, so the last 10% is left for it.
			onProgress?.(Math.round(((index + 1) / scenes.length) * 90));
		}

		const concatPath = join(jobDirectory, 'concat.txt');
		await writeFile(concatPath, clips.map((clip) => `file '${clip.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
		const concatOutputPath = join(jobDirectory, 'concat-output.mp4');

		await runFfmpeg([
			'-y',
			'-f', 'concat',
			'-safe', '0',
			'-i', concatPath,
			'-c', 'copy',
			'-movflags', '+faststart',
			concatOutputPath,
		]);
		// The per-scene clips now live on in concat-output.mp4.
		await discardFiles([...clips, concatPath]);

		// Mixed before the logo so the logo's re-encode (the expensive one)
		// copies the finished audio rather than the other way round.
		const soundtrackPath = await mixSoundsOrKeep(concatOutputPath, jobDirectory, timedEffects, elapsedSeconds, jobId);

		// A new name per render (not `<id>.mp4`): the web app stores whatever
		// URL is written, so a re-render gets a URL no cache has seen yet.
		const filename = `${jobId}-${Date.now()}.mp4`;
		const outputPath = join(renderDirectory, filename);
		await applyLogoOverlayOrFallback(soundtrackPath, outputPath, branding, jobId);
		// Whatever is left in the job directory (the pre-mix video, effect
		// PCM, the pre-logo video) is superseded by outputPath; free it
		// before the upload rather than in the finally after it.
		await rm(jobDirectory, { recursive: true, force: true });

		// Without storage configured, the local file served by /renders is the
		// only copy by design (development). With storage configured, a local
		// URL would die with the container on the next deploy, so a failed
		// upload fails the job instead of reporting it 'listo'.
		if (!storageClient) {
			return { job_id: jobId, filename, output_path: outputPath, url: null, persisted: false };
		}
		try {
			const uploadedUrl = await uploadToSupabase(outputPath, filename);
			return { job_id: jobId, filename, output_path: outputPath, url: uploadedUrl, persisted: true };
		} catch (error) {
			await unlink(outputPath).catch(() => undefined);
			throw new Error('El video se generó, pero no se pudo guardar en el almacenamiento. Vuelve a intentarlo en unos minutos.', { cause: error });
		}
	} finally {
		await rm(jobDirectory, { recursive: true, force: true });
	}
}
// The one validation both entry points apply before anything touches disk or
// the video row. The id is checked again inside render() because it becomes a
// path that is later removed recursively; here it is checked so a bad job is
// refused up front with a clear reason.
export function parseRenderJob(value: unknown): RenderJob {
	const job = value as RenderJob | null;
	if (!job || typeof job !== 'object' || !Array.isArray(job.scenes) || job.scenes.length === 0) {
		throw new Error('El trabajo necesita al menos una escena.');
	}
	if (job.id !== undefined && !isUuid(job.id)) {
		throw new Error('El id del trabajo no es un UUID valido.');
	}
	return job;
}

// Writes the final 'error' state on a video whose job never reached render()
// (an invalid payload) or was interrupted mid-way (a signal, a crash), so the
// row does not stay "procesando" forever. Returns whether the write landed.
export async function markRenderFailed(videoId: string, message: string): Promise<boolean> {
	return reportProgress(videoId, { render_status: 'error', render_error: message.slice(0, 500) }, { final: true });
}

export type RenderOutcome =
	| { status: 'listo'; video_url: string; output_path: string; persisted: boolean; written: boolean }
	| { status: 'error'; message: string; written: boolean };

// One job from start to finish: progress on the video row, the render, the
// final state, and removal of the object the previous render left behind.
// Never throws - every failure ends as an 'error' outcome that has already
// been written to the row (as far as the row could be reached) and reported.
export async function runRenderJob(job: RenderJob & { id: string }): Promise<RenderOutcome> {
	const jobId = job.id;

	// Read before the render so the object it replaces can be removed once
	// the new URL is safely on the row (see removePreviousObject).
	const previousVideoUrl = await readPreviousVideoUrl(jobId);

	await reportProgress(jobId, {
		render_status: 'procesando',
		render_progress: 0,
		render_error: null,
		render_started_at: new Date().toISOString(),
	});

	let result: Awaited<ReturnType<typeof render>>;
	try {
		result = await render(job, (percent) => {
			void reportProgress(jobId, { render_progress: percent });
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error de render desconocido.';
		console.error(`Render ${jobId} fallo:`, error);
		const cause = error instanceof Error && error.cause !== undefined ? toError(error.cause).message : undefined;
		void reportError(error, { job_id: jobId, scenes: job.scenes.length, ...(cause ? { cause } : {}) });
		const written = await markRenderFailed(jobId, message);
		return { status: 'error', message, written };
	}

	// result.url is null only when no storage is configured at all (see
	// render), the one case where the local /renders URL is the real copy.
	const videoUrl = result.url ?? `${publicBaseUrl}/renders/${encodeURIComponent(result.filename)}`;
	const written = await reportProgress(jobId, {
		render_status: 'listo',
		render_progress: 100,
		render_error: null,
		video_url: videoUrl,
	}, { final: true });

	// The old object is only removed once the row points at the new one;
	// if the write failed, the row still references the old file.
	if (written && result.persisted) {
		await removePreviousObject(previousVideoUrl, jobId, result.filename);
	}
	return { status: 'listo', video_url: videoUrl, output_path: result.output_path, persisted: result.persisted, written };
}

// The render-side half of /health: what stores the video, what draws it and
// what narrates it. Never holds credential values.
export function renderHealth() {
	return {
		storage: storageClient ? 'supabase' : 'local-disk',
		video_engine: isHeygenEnabled() ? 'heygen' : isAiVideoEnabled() ? aiVideoModel() : 'canvas',
		// Why HeyGen is off, so a missing avatar or voice id is visible here
		// instead of looking like "the key did nothing".
		heygen: heygenMissingConfig() ?? 'configurado',
		bucket: storageBucket,
		last_storage_error: lastStorageError,
		error_reporting: errorReportingStatus(),
		// Which voice narrates, and why it is not ElevenLabs when it is not.
		voice: elevenlabsMissingConfig() ? `piper (${elevenlabsMissingConfig()})` : `elevenlabs ${elevenlabsVoiceLabel()}`,
	};
}

// A crash or a redeploy mid-render leaves its working directory behind; at
// boot nothing in this process can be using one, so every directory under
// renders/ is an orphan. Files are kept: without storage, finished MP4s live
// there and /renders serves them. Rows left "procesando" are NOT touched here -
// with several instances, another one may still be rendering that video.
// Only the long-lived server calls this: a one-shot job sharing a dev machine's
// renders/ with a running server would delete that server's live work.
export async function removeOrphanWorkDirectories() {
	try {
		const entries = await readdir(renderDirectory, { withFileTypes: true });
		const orphans = entries.filter((entry) => entry.isDirectory());
		await Promise.all(orphans.map((entry) => rm(join(renderDirectory, entry.name), { recursive: true, force: true })));
		if (orphans.length > 0) console.log(`Se borraron ${orphans.length} carpetas de trabajo huerfanas de renders anteriores.`);
	} catch (error) {
		console.warn('No se pudieron limpiar las carpetas de trabajo huerfanas.', error);
	}
}
