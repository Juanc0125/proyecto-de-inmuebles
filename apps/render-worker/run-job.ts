import { randomUUID } from 'node:crypto';
import { flushErrorReports, reportError } from './error-reporting';
import { isUuid, markRenderFailed, parseRenderJob, runRenderJob, type RenderJob } from './render';

// One Cloud Run Job execution = one video. The web app starts an execution
// with RENDER_JOB_B64 set to base64 of the exact JSON body it would POST to
// /render; this renders it with the same pipeline as the HTTP server
// (render.ts), writes progress and the final state on the video row, and
// exits. It never starts the HTTP server: nothing calls into a job.
//
// Exit codes are the contract with whoever reads the execution's result:
//   0  the video is 'listo' and the row says so
//   1  the render failed, or it finished but the row could not be updated
//   2  RENDER_JOB_B64 is missing or is not a valid job (retrying cannot help)

const EXIT_DONE = 0;
const EXIT_FAILED = 1;
const EXIT_INVALID_JOB = 2;

// Cloud Run gives a task 10 s between SIGTERM (timeout or cancel) and SIGKILL.
// The 'error' write retries with backoff for up to ~7 s; this caps the whole
// shutdown so the row gets its best attempt and the process still exits on
// its own terms rather than being killed mid-write.
const SHUTDOWN_DEADLINE_MS = 8000;
const FORCED_EXIT_DELAY_MS = 1500;

// The video being rendered, so a signal or a crash can still close its row.
let activeJobId: string | null = null;
let exiting = false;

async function exitWith(code: number): Promise<void> {
	if (exiting) return;
	exiting = true;
	await flushErrorReports();
	// Let the process end on its own first: calling process.exit() while
	// fetch's keep-alive sockets are still closing aborts Node on Windows
	// (a libuv assertion, exit 127 instead of the code above). The unref'd
	// timer below is the guarantee: if anything (a keep-alive socket, the
	// sherpa-onnx runtime, a stray timer) holds the event loop open, the
	// process is forced out, since an execution that never exits is billed
	// until its timeout.
	process.exitCode = code;
	setTimeout(() => process.exit(code), FORCED_EXIT_DELAY_MS).unref();
}

// For the paths where runRenderJob did not get to write a final state itself.
async function failAndExit(message: string, code: number): Promise<void> {
	if (exiting) return;
	const jobId = activeJobId;
	activeJobId = null;
	if (jobId) {
		const deadline = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_DEADLINE_MS).unref());
		await Promise.race([markRenderFailed(jobId, message), deadline]);
	}
	await exitWith(code);
}

type DecodedJob =
	| { ok: true; job: RenderJob & { id: string } }
	| { ok: false; reason: string; videoId: string | null };

function decodeJob(encoded: string | undefined): DecodedJob {
	const raw = encoded?.trim();
	if (!raw) return { ok: false, reason: 'RENDER_JOB_B64 no esta definida o esta vacia.', videoId: null };

	let parsed: unknown;
	try {
		// Node's base64 decoder also accepts the URL-safe alphabet, so either
		// encoding the caller picks works.
		parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
	} catch {
		return { ok: false, reason: 'RENDER_JOB_B64 no es base64 de un JSON valido.', videoId: null };
	}

	try {
		const job = parseRenderJob(parsed);
		// Same as the HTTP handler: a job without an id still renders, under a
		// fresh one (there is then no row to report to).
		return { ok: true, job: { ...job, id: job.id ?? randomUUID() } };
	} catch (error) {
		// The web app has already claimed the row ("procesando") before
		// starting the execution, so when the id itself is usable the row is
		// closed with the reason instead of being left spinning.
		const candidateId = parsed && typeof parsed === 'object' ? (parsed as { id?: unknown }).id : undefined;
		return {
			ok: false,
			reason: error instanceof Error ? error.message : 'Trabajo no valido.',
			videoId: isUuid(candidateId) ? candidateId : null,
		};
	}
}

async function main(): Promise<void> {
	const decoded = decodeJob(process.env.RENDER_JOB_B64);
	if (!decoded.ok) {
		console.error(`Trabajo de render rechazado: ${decoded.reason}`);
		if (decoded.videoId) {
			activeJobId = decoded.videoId;
			await failAndExit(`El trabajo de render no es valido: ${decoded.reason}`, EXIT_INVALID_JOB);
		} else {
			await exitWith(EXIT_INVALID_JOB);
		}
		return;
	}

	const { job } = decoded;
	activeJobId = job.id;
	console.log(`Render ${job.id}: ${job.scenes.length} escenas, plataforma ${job.platform} (modo job).`);

	const outcome = await runRenderJob(job);
	// From here the row holds runRenderJob's own final state; a late signal
	// must not overwrite it with 'error'.
	activeJobId = null;

	if (outcome.status === 'error') {
		console.error(`Render ${job.id} termino con error.`);
		await exitWith(EXIT_FAILED);
		return;
	}
	if (!outcome.persisted) {
		console.log(`Render ${job.id} listo, guardado solo en disco local: ${outcome.output_path}`);
	} else {
		console.log(`Render ${job.id} listo y subido al almacenamiento.`);
	}
	if (!outcome.written) {
		// The MP4 exists but the row still says "procesando": report the
		// execution as failed so it is visible, rather than a silent success.
		console.error(`Render ${job.id}: el video se genero pero no se pudo marcar como listo en la base de datos.`);
		await exitWith(EXIT_FAILED);
		return;
	}
	await exitWith(EXIT_DONE);
}

// Cloud Run sends SIGTERM when the task times out or the execution is
// cancelled; SIGINT is Ctrl+C on a dev machine. Either way the render is not
// going to finish, so the row is closed now instead of staying "procesando".
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
	process.once(signal, () => {
		console.error(`Senal ${signal} recibida: el render se detiene.`);
		void failAndExit('El render se detuvo antes de terminar (tiempo limite o cancelacion). Vuelve a intentarlo.', EXIT_FAILED);
	});
}

// An unhandled rejection is raised as an uncaught exception under Node's
// default mode, so this one handler covers both.
process.on('uncaughtException', (error) => {
	console.error('Error no controlado durante el render:', error);
	void reportError(error, { stage: 'run_job_crash', job_id: activeJobId });
	void failAndExit('El render fallo por un error inesperado del worker. Vuelve a intentarlo.', EXIT_FAILED);
});

main().catch((error: unknown) => {
	console.error('Error no controlado durante el render:', error);
	void reportError(error, { stage: 'run_job_main', job_id: activeJobId });
	void failAndExit('El render fallo por un error inesperado del worker. Vuelve a intentarlo.', EXIT_FAILED);
});
