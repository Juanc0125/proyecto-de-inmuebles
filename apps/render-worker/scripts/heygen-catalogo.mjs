// Lists what HEYGEN_AVATAR_ID and HEYGEN_VOICE_ID can be set to: HeyGen's
// public avatars and its Spanish voices, with a preview link for each so a
// person picks them by looking and listening, not by name.
//
//   npm run heygen:catalogo                 (avatares y voces en espanol)
//   npm run heygen:catalogo -- --mujer      (solo voces femeninas; --hombre igual)
//
// Read-only: listing costs nothing and never touches the API wallet. The key
// is read from .env.local (put there with `npm run set:ai-key -- heygen`) and
// is never printed.
//
// Voices that HeyGen serves through its ElevenLabs engine are listed apart and
// not recommended: the narration already calls ElevenLabs directly when it is
// configured (elevenlabs.ts), and a second, indirect path through HeyGen would
// bill the same voice twice and from two places.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://api.heygen.com';

// Same env loading as scripts/sound-library.mjs: later files win, the repo
// root last.
function loadEnv() {
	const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
	for (const file of [join(root, 'apps', 'render-worker', '.env.local'), join(root, 'apps', 'web', '.env.local'), join(root, '.env.local')]) {
		let text;
		try { text = readFileSync(file, 'utf8'); } catch { continue; }
		for (const line of text.split('\n')) {
			const match = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
			const value = match?.[2].trim().replace(/^["']|["']$/g, '').trim();
			if (match && value) process.env[match[1]] = value;
		}
	}
}

async function listAll(path, key, maxPages = 5) {
	const items = [];
	let token = null;
	for (let page = 0; page < maxPages; page += 1) {
		const url = new URL(path, API_BASE);
		if (token) url.searchParams.set('token', token);
		const response = await fetch(url, { headers: { 'x-api-key': key, accept: 'application/json' } });
		if (!response.ok) {
			throw new Error(response.status === 401 || response.status === 403
				? `HeyGen rechazo la clave (HTTP ${response.status}). ¿Es la de la API de video y no la de LiveAvatar?`
				: `HeyGen respondio HTTP ${response.status} en ${url.pathname}.`);
		}
		const body = await response.json();
		const data = body.data ?? body;
		const list = Array.isArray(data) ? data : data.results ?? data.items ?? data.voices ?? data.looks ?? [];
		items.push(...list);
		token = body.next_token ?? data.next_token ?? body.token ?? data.token ?? null;
		if (!token || list.length === 0) break;
	}
	return items;
}

loadEnv();
const key = process.env.HEYGEN_API_KEY;
if (!key) {
	console.error('No hay HEYGEN_API_KEY en .env.local. Instalala con: npm run set:ai-key -- heygen');
	process.exit(1);
}

const gender = process.argv.includes('--mujer') ? 'female' : process.argv.includes('--hombre') ? 'male' : null;

try {
	const voices = await listAll(`/v3/voices?type=public&language=Spanish&limit=100${gender ? `&gender=${gender}` : ''}`, key);
	// The listing has no gender filter, so with --mujer/--hombre more pages
	// are read and filtered here.
	const allLooks = await listAll('/v3/avatars/looks?ownership=public&limit=50', key, gender ? 10 : 2);
	const looks = gender ? allLooks.filter((look) => String(look.gender ?? '').toLowerCase() === gender) : allLooks;
	const own = await listAll('/v3/avatars/looks?ownership=private&limit=50', key, 1).catch(() => []);

	const isEleven = (voice) => String(voice.engine ?? voice.engines ?? '').toLowerCase().includes('elevenlabs');
	const usable = voices.filter((voice) => !isEleven(voice));
	const eleven = voices.filter(isEleven);

	console.log(`\nVOCES EN ESPANOL (${usable.length}) -> HEYGEN_VOICE_ID`);
	for (const voice of usable.slice(0, 40)) {
		console.log(`  ${voice.voice_id}  ${voice.name ?? ''} (${voice.gender ?? '?'})  ${voice.preview_audio_url ?? ''}`);
	}
	if (eleven.length) console.log(`  (+${eleven.length} voces del motor ElevenLabs omitidas a proposito)`);

	const show = (look) => console.log(`  ${look.id}  ${look.name ?? ''} (${look.gender ?? '?'})  ${look.preview_video_url ?? look.preview_image_url ?? ''}`);
	if (own.length) {
		console.log(`\nTUS AVATARES (${own.length}) -> HEYGEN_AVATAR_ID`);
		own.slice(0, 20).forEach(show);
	}
	console.log(`\nAVATARES PUBLICOS (${looks.length}, primeros 40) -> HEYGEN_AVATAR_ID`);
	looks.slice(0, 40).forEach(show);
	console.log('\nAbre los enlaces para ver y oir cada uno. Luego pon los dos ids en .env.local y en Railway (servicio stickman-video-app).');
} catch (error) {
	console.error(error.message);
	process.exit(1);
}
