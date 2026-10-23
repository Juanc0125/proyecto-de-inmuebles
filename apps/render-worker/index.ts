import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
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
import { ensureVoiceModel, estimateWordTimings, mouthEnvelope, speak } from './voice';
import { aiVideoModel, buildScenePrompt, generateSceneVideo, isAiVideoEnabled } from './ai-video';
import { heygenMissingConfig, isHeygenEnabled, startAvatarScenes, type AvatarClip } from './heygen';
import { errorReportingStatus, reportError } from './error-reporting';
import { elevenlabsMissingConfig, elevenlabsVoiceLabel } from './elevenlabs';

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

type RenderScene = {
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

type RenderJob = {
	id?: string;
	platform: Platform;
	branding: Branding;
	scenes: RenderScene[];
	// RF-010: one background track for the whole video, as a public URL.
	music_url?: string | null;
};

const port = Number(process.env.PORT ?? 8080);
// The worker now writes the finished video's URL itself, so it has to know
// where it is reachable. Only used when Supabase Storage isn't configured and
// the MP4 is served off local disk.
const publicBaseUrl = (process.env.PUBLIC_BASE_URL
	?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`)
).replace(/\/+$/, '');
const renderDirectory = join(process.cwd(), 'renders');
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

// Same production check video-persistence.ts already uses for RENDER_WORKER_URL
// on the web side, kept consistent rather than inventing a second signal for
// the same question ("are we the deployed thing or someone's machine?").
const isProductionEnvironment = process.env.NODE_ENV === 'production';

// Empty-string is treated the same as unset: a blank "secret" protects
// nothing and would only make hasValidBearerToken() below compare against
// an empty string, which is a valid-looking but worthless token.
const renderWorkerToken = process.env.RENDER_WORKER_TOKEN?.trim() || null;

if (!renderWorkerToken) {
	// The unset-token case splits on environment because "fail open" and
	// "fail closed" are each right on one side of it:
	//
	// - Outside production, failing OPEN is what keeps `npm run dev` and a
	//   brand-new local checkout working with zero setup, same as this file
	//   already does for missing Supabase storage, the TTS key and fal.ai.
	//   Nobody sets this variable on their own machine today.
	// - In production, failing open would leave the deployed worker taking
	//   render jobs (real CPU minutes, real storage, real bill) from anyone
	//   who finds the URL, from the moment this ships until someone happens
	//   to set the variable in Railway - exactly the hole this task exists
	//   to close. A loud log line does not close that hole; nobody reads a
	//   healthy service's startup log. So production fails CLOSED instead
	//   (see the /render handler and /health below) and this stays loud
	//   only to make the reason visible in seconds, not to substitute for it.
	if (isProductionEnvironment) {
		console.error('¡¡¡ RENDER_WORKER_TOKEN no esta configurada en produccion !!!');
		console.error('El endpoint /render va a rechazar todos los pedidos con 503 hasta que se configure.');
		console.error('Configura RENDER_WORKER_TOKEN en Railway para que el worker vuelva a aceptar trabajos.');
	} else {
		console.error('¡¡¡ RENDER_WORKER_TOKEN no esta configurada !!!');
		console.error('El endpoint /render acepta pedidos de cualquiera, sin clave, mientras esto no se corrija.');
		console.error('Configura RENDER_WORKER_TOKEN en Railway (o en .env.local para desarrollo) antes de exponer este worker.');
	}
}

// Fixed-length digest comparison: timingSafeEqual() requires equal-length
// buffers (it throws otherwise, which would itself leak a length mismatch),
// and comparing raw strings of different lengths short-circuits early,
// leaking length through timing. Hashing both sides to the same 32-byte
// SHA-256 digest first removes both leaks.
function hashToken(value: string): Buffer {
	return createHash('sha256').update(value, 'utf8').digest();
}

// Only called once a token is known to be configured - the caller (the
// /render handler) deals with the unset-token case itself, since that one
// branches on environment (fail open in dev, fail closed in production)
// rather than on anything about the request.
function hasValidBearerToken(request: IncomingMessage, expectedToken: string): boolean {
	const header = request.headers.authorization;
	if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;

	const provided = header.slice('Bearer '.length);
	return timingSafeEqual(hashToken(provided), hashToken(expectedToken));
}

// Surfaced on /health (see below) so a worker that is up but refusing every
// render for lack of a token is diagnosable from outside in seconds, instead
// of looking either dead or silently insecure.
function renderAuthStatus(): string {
	if (renderWorkerToken) return 'configurado';
	if (isProductionEnvironment) return 'bloqueado: falta RENDER_WORKER_TOKEN, /render rechaza todo con 503';
	return 'sin token: modo desarrollo, /render acepta todo sin clave';
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
	logo_position: 'top-left',
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

async function uploadToSupabase(filePath: string, filename: string): Promise<string | null> {
	if (!storageClient) return null;

	try {
		const fileBuffer = await readFile(filePath);
		const { error: uploadError } = await storageClient.storage.from(storageBucket).upload(filename, fileBuffer, {
			contentType: 'video/mp4',
			upsert: true,
		});
		if (uploadError) throw uploadError;

		const { data } = storageClient.storage.from(storageBucket).getPublicUrl(filename);
		if (!data?.publicUrl) throw new Error('No se obtuvo una URL publica del bucket.');

		await unlink(filePath).catch(() => undefined);
		lastStorageError = null;
		return data.publicUrl;
	} catch (error) {
		lastStorageError = error instanceof Error ? error.message : String(error);
		console.warn('Fallo al subir el render a Supabase Storage, se conserva en disco local.', error);
		return null;
	}
}

function getLogoOverlayPosition(position: LogoPosition | undefined): string {
	switch (position) {
		case 'top-right': return 'W-w-24:24';
		case 'bottom-left': return '24:H-h-24';
		case 'bottom-right': return 'W-w-24:H-h-24';
		case 'top-left':
		default: return '24:24';
	}
}

// Applies the brand logo (RF-026 application) as an overlay on the final,
// already-concatenated video. If the logo URL is unreachable or ffmpeg fails
// on it, this degrades gracefully to the un-logo'd video instead of failing
// the whole render, matching this file's existing resilience-over-hard-failure
// convention (see uploadToSupabase above).
async function applyLogoOverlayOrFallback(sourcePath: string, destinationPath: string, branding: Branding): Promise<void> {
	const logoUrl = typeof branding.logo_url === 'string' && branding.logo_url.trim().length > 0
		? branding.logo_url.trim()
		: null;

	if (!logoUrl) {
		await rename(sourcePath, destinationPath);
		return;
	}

	try {
		const overlayPosition = getLogoOverlayPosition(branding.logo_position);
		await runFfmpeg([
			'-y',
			'-i', sourcePath,
			'-i', logoUrl,
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
		await unlink(destinationPath).catch(() => undefined);
		await rename(sourcePath, destinationPath);
	}
}

// ---- Music and sound effects (RF-010) ----

// Background music sits well under the narration even before ducking: the
// library is normalised to about -18 dB mean, so this puts it near -33 dB.
const MUSIC_VOLUME = 0.18;
// Effects are short, peak-normalised accents; at 1.0 they jumped out over the
// voice, so they are pulled down a little.
const EFFECT_VOLUME = 0.6;
const MUSIC_FADE_IN_SECONDS = 1;
const MUSIC_FADE_OUT_SECONDS = 1.5;
// Overlap between two consecutive copies of a track that is shorter than the
// video. A plain splice would click: AAC can't reproduce a file's first and
// last ~20ms exactly, so even the library's sample-exact loops end up with a
// step at the seam, and an uploaded song was never meant to loop at all.
const MUSIC_LOOP_CROSSFADE_SECONDS = 0.08;
const MUSIC_MIN_SECONDS = 1;
// Every input is brought to one format before mixing, since narration (mono,
// whatever rate the voice model speaks at), music and effects all differ.
const MIX_SAMPLE_RATE = 48000;
const MIX_FORMAT = `aresample=${MIX_SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;
// Ducking: the narration is the compressor's key, so the music dips about
// 8-10 dB while someone speaks and comes back within half a second of a pause.
const DUCKING = 'sidechaincompress=threshold=0.04:ratio=4:attack=20:release=400:knee=4';

type TimedEffect = { url: string; startSeconds: number };

function nonEmptyUrl(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

// One extra ffmpeg pass over the concatenated video that only touches audio:
// the video stream is copied, so this costs a few seconds and the memory of an
// audio decode, not another x264 encode. Returns the path of the mixed video,
// or the untouched source when there is nothing to mix or the mix fails - a
// broken music URL must never cost the person their video (same convention as
// applyLogoOverlayOrFallback).
async function mixSoundsOrKeep(
	sourcePath: string,
	jobDirectory: string,
	musicUrl: string | null,
	effects: TimedEffect[],
	totalSeconds: number,
): Promise<string> {
	if (!musicUrl && effects.length === 0) return sourcePath;

	const mixedPath = join(jobDirectory, 'mixed-output.mp4');
	try {
		const inputs: string[] = ['-i', sourcePath];
		const graph: string[] = [];
		const mixLabels = ['[voice]'];
		let nextInput = 1;

		if (musicUrl) {
			// Decoded once to raw PCM on disk, and only as much as the video
			// needs (a three-minute upload is cut at the video's length): the
			// copies below then read a local file instead of downloading the URL
			// once per loop, and the byte count gives the exact duration without
			// a separate probe.
			const musicPcmPath = join(jobDirectory, 'music.pcm');
			await runFfmpeg([
				'-y', '-i', musicUrl, '-vn',
				'-t', String(totalSeconds + 1),
				'-ac', '2', '-ar', String(MIX_SAMPLE_RATE), '-f', 's16le', musicPcmPath,
			]);
			const musicSeconds = (await stat(musicPcmPath)).size / (MIX_SAMPLE_RATE * 2 * 2);
			if (musicSeconds < MUSIC_MIN_SECONDS) throw new Error(`La musica dura ${musicSeconds.toFixed(2)} s, demasiado corta para usarla de fondo.`);

			const copies = musicSeconds >= totalSeconds
				? 1
				: 1 + Math.ceil((totalSeconds - musicSeconds) / (musicSeconds - MUSIC_LOOP_CROSSFADE_SECONDS));
			for (let copy = 0; copy < copies; copy += 1) {
				inputs.push('-f', 's16le', '-ar', String(MIX_SAMPLE_RATE), '-ac', '2', '-i', musicPcmPath);
			}

			let musicLabel = `[${nextInput}:a]`;
			for (let copy = 1; copy < copies; copy += 1) {
				const joined = `[loop${copy}]`;
				graph.push(`${musicLabel}[${nextInput + copy}:a]acrossfade=d=${MUSIC_LOOP_CROSSFADE_SECONDS}:c1=qsin:c2=qsin${joined}`);
				musicLabel = joined;
			}
			nextInput += copies;

			const fadeOutStart = Math.max(0, totalSeconds - MUSIC_FADE_OUT_SECONDS);
			graph.push(`[0:a]${MIX_FORMAT},asplit=2[voice][duckkey]`);
			graph.push(
				`${musicLabel}${MIX_FORMAT},atrim=0:${totalSeconds.toFixed(3)},asetpts=PTS-STARTPTS,volume=${MUSIC_VOLUME},`
				+ `afade=t=in:st=0:d=${MUSIC_FADE_IN_SECONDS},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${MUSIC_FADE_OUT_SECONDS}[bed]`,
			);
			graph.push(`[bed][duckkey]${DUCKING}[music]`);
			mixLabels.push('[music]');
		} else {
			graph.push(`[0:a]${MIX_FORMAT}[voice]`);
		}

		effects.forEach((effect, effectIndex) => {
			inputs.push('-i', effect.url);
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
		console.warn('Fallo al mezclar la musica o los efectos de sonido, se conserva el video sin mezcla.', error);
		await unlink(mixedPath).catch(() => undefined);
		return sourcePath;
	}
}

function runFfmpeg(args: string[]) {
	return new Promise<void>((resolve, reject) => {
		const childProcess = spawn(process.env.FFMPEG_PATH ?? ffmpegPath ?? 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
		let errorOutput = '';

		childProcess.stderr.on('data', (chunk: Buffer) => {
			errorOutput += chunk.toString();
		});
		childProcess.on('error', (error) => reject(error));
		childProcess.on('close', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`FFmpeg termino con codigo ${code}: ${errorOutput.slice(-2000)}`));
		});
	});
}

// Same as runFfmpeg, but feeds ffmpeg raw RGBA frames on stdin instead of
// giving it an input file. renderFrame() must return exactly width*height*4
// bytes; the buffer is handed straight to the pipe, respecting backpressure so
// a long scene can't buffer the whole uncompressed video in memory.
function runFfmpegWithFrames(args: string[], frameCount: number, renderFrame: (frameIndex: number) => Buffer) {
	return new Promise<void>((resolve, reject) => {
		const childProcess = spawn(process.env.FFMPEG_PATH ?? ffmpegPath ?? 'ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
		let errorOutput = '';
		let settled = false;

		const fail = (error: Error) => {
			if (settled) return;
			settled = true;
			childProcess.kill();
			reject(error);
		};

		childProcess.stderr.on('data', (chunk: Buffer) => {
			errorOutput += chunk.toString();
		});
		childProcess.on('error', fail);
		childProcess.on('close', (code) => {
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
async function reportProgress(videoId: string, fields: Record<string, unknown>) {
	if (!storageClient) return;
	try {
		await storageClient.from('videos').update(fields).eq('id', videoId);
	} catch (error) {
		console.warn('No se pudo reportar el progreso del render.', error);
	}
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

	const jobId = job.id ?? randomUUID();
	const jobDirectory = join(renderDirectory, jobId);
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

			// A scene must never cut its own narration off mid-sentence, so
			// speech length wins when it exceeds the planned duration.
			const duration = avatarClip
				? avatarClip.durationSeconds
				: speech
					? Math.min(60, Math.max(requestedDuration, speech.durationSeconds + 0.35))
					: requestedDuration;

			// Every clip gets both a video AND an audio stream - real audio when
			// available, otherwise a silent anullsrc track of the same duration -
			// so the concat demuxer below sees a uniform stream layout across all
			// clips regardless of which scenes had narration.
			let audioInputArgs: string[];
			if (audioUrl) {
				audioInputArgs = ['-i', audioUrl];
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
			const mouth = speech ? mouthEnvelope(speech, FRAME_RATE, frameCount) : null;
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

		// Mixed before the logo so the logo's re-encode (the expensive one)
		// copies the finished audio rather than the other way round.
		const soundtrackPath = await mixSoundsOrKeep(concatOutputPath, jobDirectory, nonEmptyUrl(job.music_url), timedEffects, elapsedSeconds);

		const outputPath = join(renderDirectory, `${jobId}.mp4`);
		await applyLogoOverlayOrFallback(soundtrackPath, outputPath, branding);

		const filename = `${jobId}.mp4`;
		const uploadedUrl = await uploadToSupabase(outputPath, filename);
		return { job_id: jobId, filename, output_path: outputPath, url: uploadedUrl, persisted: uploadedUrl !== null };
	} finally {
		await rm(jobDirectory, { recursive: true, force: true });
	}
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
	response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
	response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (request, response) => {
	if (request.method === 'GET' && request.url === '/health') {
		// Stays open and answers 200 even when /render is refusing every job
		// below (no token, in production): a deploy that cannot be inspected
		// is worse than one that is visibly down, and render_auth is exactly
		// what turns "looks dead" into "diagnosable in seconds".
		sendJson(response, 200, {
			ok: true,
			service: 'render-worker',
			storage: storageClient ? 'supabase' : 'local-disk',
			video_engine: isHeygenEnabled() ? 'heygen' : isAiVideoEnabled() ? aiVideoModel() : 'canvas',
			// Why HeyGen is off, so a missing avatar or voice id is visible here
			// instead of looking like "the key did nothing".
			heygen: heygenMissingConfig() ?? 'configurado',
			bucket: storageBucket,
			last_storage_error: lastStorageError,
			render_auth: renderAuthStatus(),
			error_reporting: errorReportingStatus(),
			// Which voice narrates, and why it is not ElevenLabs when it is not.
			voice: elevenlabsMissingConfig() ? `piper (${elevenlabsMissingConfig()})` : `elevenlabs ${elevenlabsVoiceLabel()}`,
		});
		return;
	}

	if (request.method === 'GET' && request.url?.startsWith('/renders/')) {
		const filename = request.url.slice('/renders/'.length);
		if (!/^[a-zA-Z0-9-]+\.mp4$/.test(filename)) {
			sendJson(response, 400, { error: 'Nombre de archivo no valido.' });
			return;
		}

		const filePath = join(renderDirectory, filename);
		try {
			await access(filePath);
		} catch {
			sendJson(response, 404, { error: 'Video no encontrado.' });
			return;
		}

		response.writeHead(200, { 'content-type': 'video/mp4', 'cache-control': 'public, max-age=3600' });
		createReadStream(filePath).pipe(response);
		return;
	}

	if (request.method !== 'POST' || request.url !== '/render') {
		sendJson(response, 404, { error: 'Ruta no encontrada.' });
		return;
	}

	// Checked before parsing the body: a rejected caller - unauthorized or
	// hitting a misconfigured deploy - shouldn't cost us even the JSON parse,
	// let alone a render.
	if (!renderWorkerToken) {
		if (isProductionEnvironment) {
			// 503, not 401: the server is missing its own configuration, the
			// caller did nothing wrong. That distinction is what should point
			// whoever reads this at "set RENDER_WORKER_TOKEN in Railway"
			// instead of a permissions rabbit hole that isn't theirs to fix.
			sendJson(response, 503, { error: 'El worker no puede aceptar renders: falta configurar RENDER_WORKER_TOKEN en este despliegue.' });
			return;
		}
		// Outside production: fail open (see the loud startup warning above)
		// so `npm run dev` and a fresh, not-yet-configured deploy keep working.
	} else if (!hasValidBearerToken(request, renderWorkerToken)) {
		// Missing header and wrong token get the exact same status and
		// message so neither response tells an attacker which one they got
		// wrong.
		sendJson(response, 401, { error: 'No autorizado.' });
		return;
	}

	let job: RenderJob;
	try {
		job = await readJson(request) as RenderJob;
		if (!Array.isArray(job?.scenes) || job.scenes.length === 0) {
			throw new Error('El trabajo necesita al menos una escena.');
		}
	} catch (error) {
		sendJson(response, 400, { error: error instanceof Error ? error.message : 'Trabajo no valido.' });
		return;
	}

	// Accept and answer immediately. A render can run for minutes once scenes
	// are generated by an AI model, which is far past any HTTP timeout, so the
	// caller follows the job through render_status on the video row instead of
	// holding the connection open.
	const jobId = job.id ?? randomUUID();
	sendJson(response, 202, { job_id: jobId, status: 'procesando' });

	await reportProgress(jobId, {
		render_status: 'procesando',
		render_progress: 0,
		render_error: null,
		render_started_at: new Date().toISOString(),
	});

	try {
		const result = await render({ ...job, id: jobId }, (percent) => {
			void reportProgress(jobId, { render_progress: percent });
		});
		const videoUrl = result.url ?? `${publicBaseUrl}/renders/${encodeURIComponent(result.filename)}`;
		await reportProgress(jobId, {
			render_status: 'listo',
			render_progress: 100,
			render_error: null,
			video_url: videoUrl,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error de render desconocido.';
		console.error(`Render ${jobId} fallo:`, error);
		void reportError(error, { job_id: jobId, scenes: job.scenes.length });
		await reportProgress(jobId, { render_status: 'error', render_error: message.slice(0, 500) });
	}
});

mkdir(renderDirectory, { recursive: true }).then(() => {
	server.listen(port, () => console.log(`render worker escuchando en http://localhost:${port}`));
	// Warm the voice model in the background: it is a ~67MB download on a cold
	// container, and paying it here means the first render doesn't stall on it.
	void ensureVoiceModel();
});
