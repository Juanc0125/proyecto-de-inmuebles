// Generates the base sound-effect library (RF-010): four short effects,
// synthesised from scratch with ffmpeg. Synthesised rather than downloaded for
// the same reason the backdrop art is drawn: a sound the project made itself
// has no licence to trace, and no binary has to live in git.
//
//   npm run sounds:library                    -> writes the .m4a files to <tmp>/stickman-sounds
//   npm run sounds:library -- --out <dir>     -> somewhere else
//   npm run sounds:library -- --upload        -> also upserts them to Storage: sounds/biblioteca/<slug>.m4a
//
// The slugs are a contract with packages/shared-types (SOUND_LIBRARY): the web
// app builds each public URL from the slug, so renaming one here breaks it.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
// 48 kHz: the render mixes at 48 kHz, so the effects need no resampling there.
// (Background music, which this script used to synthesise too, was removed
// from the product; its old Storage objects are simply no longer referenced.)
const SAMPLE_RATE = 48000;
const BUCKET = 'sounds';
const LICENSE = 'Propia del proyecto (CC0)';

const args = process.argv.slice(2);
const upload = args.includes('--upload');
const outFlag = args.indexOf('--out');
const outDir = outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1] : join(tmpdir(), 'stickman-sounds');

// ---- Effects ------------------------------------------------------------------
//
// Each one starts from silence (an attack ramp rather than a step) and ends
// with a fade, so none of them clicks when it is dropped into the mix.

// Inharmonic bell partials (ratio, amplitude, decay per second).
const BELL = [
	[0.5, 0.3, 1.2], [1, 1, 2.2], [1.183, 0.55, 2.8], [1.506, 0.4, 3.2],
	[2, 0.35, 3.8], [2.514, 0.22, 4.6], [2.662, 0.14, 5.2], [3.011, 0.09, 6.4],
];

const EFFECTS = [
	{
		slug: 'transicion',
		name: 'Transición (barrido)',
		duration: 1.1,
		// Band-limited pink noise that swells and fades, with a phaser for the
		// sense of movement a "whoosh" needs.
		input: ['-f', 'lavfi', '-i', `anoisesrc=d=1.1:c=pink:a=0.6:r=${SAMPLE_RATE}:s=7`],
		filters: 'highpass=f=350,lowpass=f=5000,aphaser=type=t:speed=1.6:decay=0.5,afade=t=in:d=0.6:curve=qsin,afade=t=out:st=0.6:d=0.5:curve=qsin',
	},
	{
		slug: 'campana',
		name: 'Campana',
		duration: 1.9,
		expression: '(1-exp(-t*300))*(' + BELL
			.map(([ratio, amplitude, decay]) => `${amplitude}*exp(-t*${decay})*sin(2*PI*${(784 * ratio).toFixed(3)}*t)`)
			.join('+') + ')',
		filters: 'afade=t=out:st=1.5:d=0.4',
	},
	{
		slug: 'pop',
		name: 'Pop',
		duration: 0.25,
		// A sine whose pitch drops fast from ~680 Hz to 180 Hz; the phase is
		// the integral of that frequency curve, so the sweep is continuous.
		expression: '(1-exp(-t*900))*exp(-t*26)*sin(2*PI*(180*t+500*(1-exp(-45*t))/45))',
		filters: 'afade=t=out:st=0.18:d=0.07',
	},
	{
		slug: 'notificacion',
		name: 'Notificación',
		duration: 1.1,
		// Two-note rising chime, C6 then G6.
		expression: '(1-exp(-t*500))*exp(-t*6)*(sin(2*PI*1046.5*t)+0.2*sin(4*PI*1046.5*t))'
			+ '+gt(t,0.14)*(1-exp(-(t-0.14)*500))*exp(-(t-0.14)*5)*(sin(2*PI*1568*t)+0.2*sin(4*PI*1568*t))',
		filters: 'afade=t=out:st=0.85:d=0.25',
	},
];

// ---- ffmpeg plumbing ---------------------------------------------------------

function ffmpeg(ffmpegArgs) {
	return new Promise((resolve, reject) => {
		const child = spawn(FFMPEG, ['-hide_banner', '-nostdin', ...ffmpegArgs], { stdio: ['ignore', 'ignore', 'pipe'] });
		let stderr = '';
		child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve(stderr);
			else reject(new Error(`ffmpeg termino con codigo ${code}: ${stderr.slice(-1500)}`));
		});
	});
}

async function levels(path) {
	const report = await ffmpeg(['-i', path, '-af', 'volumedetect', '-f', 'null', '-']);
	const mean = Number(report.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1]);
	const max = Number(report.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1]);
	return { mean, max };
}

async function durationOf(path) {
	const report = await ffmpeg(['-i', path, '-f', 'null', '-']);
	// The last "time=" is the decoded length, which is what a player hears.
	const times = [...report.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
	const last = times[times.length - 1];
	return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : NaN;
}

// Effects are peak-normalised, since they are too short for an average to
// mean much.
const EFFECT_PEAK_DB = -3;

async function generate(workDir) {
	const results = [];

	for (const effect of EFFECTS) {
		const raw = join(workDir, `${effect.slug}.wav`);
		const input = effect.input ?? ['-f', 'lavfi', '-i', `aevalsrc='${effect.expression}':s=${SAMPLE_RATE}:d=${effect.duration}`];
		await ffmpeg(['-y', ...input, '-af', `${effect.filters},aformat=channel_layouts=stereo`, '-c:a', 'pcm_s16le', raw]);
		const { max } = await levels(raw);
		results.push({ ...effect, kind: 'efecto', raw, gain: EFFECT_PEAK_DB - max, bitrate: '128k' });
	}

	const files = [];
	for (const sound of results) {
		const path = join(outDir, `${sound.slug}.m4a`);
		await ffmpeg([
			'-y', '-i', sound.raw,
			'-af', `volume=${sound.gain.toFixed(2)}dB,aformat=channel_layouts=stereo`,
			'-ar', String(SAMPLE_RATE), '-c:a', 'aac', '-b:a', sound.bitrate,
			'-movflags', '+faststart', path,
		]);
		const { mean, max } = await levels(path);
		files.push({ slug: sound.slug, kind: sound.kind, name: sound.name, path, seconds: await durationOf(path), mean, max });
	}
	return files;
}

// ---- Upload -------------------------------------------------------------------

// Same env loading as scripts/e2e.mjs: secrets live in .env.local files, later
// files win, the repo root last.
function loadEnv() {
	const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
	const candidates = [
		join(root, 'apps', 'render-worker', '.env.local'),
		join(root, 'apps', 'web', '.env.local'),
		join(root, '.env.local'),
	];
	for (const file of candidates) {
		let text;
		try { text = readFileSync(file, 'utf8'); } catch { continue; }
		for (const line of text.split('\n')) {
			const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
			if (match && match[2].trim()) process.env[match[1]] = match[2].trim();
		}
	}
}

async function uploadAll(files) {
	loadEnv();
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_ROLE_KEY) en .env.local.');

	const { createClient } = await import('@supabase/supabase-js');
	const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

	// Created lazily and public, same as the web app does for branding-logos.
	const { data: buckets, error: listError } = await client.storage.listBuckets();
	if (listError) throw listError;
	if (!(buckets ?? []).some((bucket) => bucket.name === BUCKET)) {
		const { error } = await client.storage.createBucket(BUCKET, { public: true });
		if (error) throw error;
		console.log(`Bucket "${BUCKET}" creado (publico).`);
	}

	for (const file of files) {
		const objectPath = `biblioteca/${file.slug}.m4a`;
		const { error } = await client.storage.from(BUCKET).upload(objectPath, readFileSync(file.path), {
			contentType: 'audio/mp4',
			upsert: true,
		});
		if (error) throw new Error(`No se pudo subir ${objectPath}: ${error.message}`);
		console.log(`Subido ${BUCKET}/${objectPath} -> ${client.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl}`);
	}
}

// ---- Main ---------------------------------------------------------------------

mkdirSync(outDir, { recursive: true });
const workDir = join(outDir, '.work');
mkdirSync(workDir, { recursive: true });

try {
	const files = await generate(workDir);
	console.log(`Biblioteca generada en ${outDir} (licencia: ${LICENSE})`);
	for (const file of files) {
		console.log(`  ${file.slug.padEnd(13)} ${file.kind.padEnd(7)} ${file.seconds.toFixed(2).padStart(6)} s  media ${file.mean} dB  pico ${file.max} dB  ${file.name}`);
	}
	if (upload) await uploadAll(files);
	else console.log('Sin --upload: no se subio nada a Supabase.');
} finally {
	rmSync(workDir, { recursive: true, force: true });
}
