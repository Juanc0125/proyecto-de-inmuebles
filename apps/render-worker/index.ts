import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { ensureVoiceModel } from './voice';
import {
	parseRenderJob,
	port,
	removeOrphanWorkDirectories,
	renderDirectory,
	renderHealth,
	runRenderJob,
	STORAGE_CACHE_CONTROL_SECONDS,
	type RenderJob,
} from './render';

// The long-lived HTTP mode: POST /render accepts a job and renders it in the
// background, GET /health and GET /renders/<file> serve diagnostics and local
// MP4s. Used for local dev (`npm run dev`). In production each video is one
// Cloud Run Job execution instead (run-job.ts); both run the same pipeline
// from render.ts.

// Kept exported from here because checks and older callers know them by this
// module; the definitions live in render.ts.
export type { Branding, LogoPosition, Platform } from './render';
export { render } from './render';

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

function sendJson(response: ServerResponse, status: number, body: unknown) {
	response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
	response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Video ids with a render in flight in THIS process, with when it started.
// Per-process on purpose: every instance has its own memory budget.
const MAX_CONCURRENT_RENDERS = 1;
const activeRenders = new Map<string, number>();

const server = createServer(async (request, response) => {
	if (request.method === 'GET' && request.url === '/health') {
		// Stays open and answers 200 even when /render is refusing every job
		// below (no token, in production): a deploy that cannot be inspected
		// is worse than one that is visibly down, and render_auth is exactly
		// what turns "looks dead" into "diagnosable in seconds".
		sendJson(response, 200, {
			ok: true,
			service: 'render-worker',
			...renderHealth(),
			render_auth: renderAuthStatus(),
			// Busy means /render answers 503 until the current job finishes.
			active_renders: activeRenders.size,
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

		// Names are unique per render now, so a long cache can't serve a stale
		// video; kept short anyway to match the bucket's cacheControl.
		response.writeHead(200, { 'content-type': 'video/mp4', 'cache-control': `public, max-age=${STORAGE_CACHE_CONTROL_SECONDS}` });
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
		job = parseRenderJob(await readJson(request));
	} catch (error) {
		sendJson(response, 400, { error: error instanceof Error ? error.message : 'Trabajo no valido.' });
		return;
	}

	const jobId = job.id ?? randomUUID();

	// Both checks and the registration below run synchronously, with no await
	// in between, so two requests arriving together can't both pass.
	// Same video already rendering: a double click or a retry while the first
	// attempt is still alive. Two attempts would race on the same row.
	if (activeRenders.has(jobId)) {
		sendJson(response, 409, { error: 'Este video ya se esta renderizando. Espera a que termine.' });
		return;
	}
	// One render at a time: a render peaks around 0.8 GB of a 1 GB container
	// (see the encoder notes at the top), so a second one would get both
	// killed for memory. The web app tells the person to try again shortly.
	if (activeRenders.size >= MAX_CONCURRENT_RENDERS) {
		sendJson(response, 503, { error: 'El worker esta ocupado con otro video. Intenta de nuevo en unos minutos.' });
		return;
	}
	activeRenders.set(jobId, Date.now());

	try {
		// Accept and answer immediately. A render can run for minutes once
		// scenes are generated by an AI model, which is far past any HTTP
		// timeout, so the caller follows the job through render_status on the
		// video row instead of holding the connection open.
		sendJson(response, 202, { job_id: jobId, status: 'procesando' });
		// The pipeline never throws: success and failure both end as a final
		// state on the video row, written inside runRenderJob.
		await runRenderJob({ ...job, id: jobId });
	} finally {
		activeRenders.delete(jobId);
	}
});

mkdir(renderDirectory, { recursive: true }).then(async () => {
	await removeOrphanWorkDirectories();
	server.listen(port, () => console.log(`render worker escuchando en http://localhost:${port}`));
	// Warm the voice model in the background: it is a ~67MB download on a cold
	// container, and paying it here means the first render doesn't stall on it.
	void ensureVoiceModel();
});
