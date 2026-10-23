// Lists what ELEVENLABS_VOICE_ID can be set to: the account's own voices and
// the Spanish voices of ElevenLabs' public library, with a preview link for
// each so a person picks one by listening, not by name.
//
//   npm run elevenlabs:voces                 (voces en espanol)
//   npm run elevenlabs:voces -- --mujer      (solo femeninas; --hombre igual)
//
// Read-only: listing costs no characters. The key is read from .env.local
// (put there with `npm run set:ai-key -- elevenlabs`) and is never printed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://api.elevenlabs.io';

// Same env loading as heygen-catalogo.mjs: later files win, the repo root last.
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

async function get(path, key) {
	const response = await fetch(new URL(path, API_BASE), { headers: { 'xi-api-key': key, accept: 'application/json' } });
	if (response.status === 401 || response.status === 403) throw new Error(`ElevenLabs rechazo la clave (HTTP ${response.status}).`);
	if (!response.ok) throw new Error(`ElevenLabs respondio ${response.status} en ${path}.`);
	return response.json();
}

function line(voice) {
	const labels = voice.labels ?? {};
	const traits = [voice.gender ?? labels.gender, voice.age ?? labels.age, voice.accent ?? labels.accent, voice.use_case ?? labels.use_case ?? labels['use case']]
		.filter(Boolean).join(', ');
	return `  ${voice.voice_id}  ${voice.name}${traits ? `  (${traits})` : ''}\n      escuchar: ${voice.preview_url ?? 'sin muestra'}`;
}

loadEnv();
const key = process.env.ELEVENLABS_API_KEY?.trim();
if (!key) {
	console.error('Falta ELEVENLABS_API_KEY. Instalala con: npm run set:ai-key -- elevenlabs');
	process.exitCode = 1;
} else {
	const gender = process.argv.includes('--mujer') ? 'female' : process.argv.includes('--hombre') ? 'male' : null;
	try {
		const own = await get('/v1/voices', key);
		const mine = (own.voices ?? []).filter((voice) => !gender || (voice.labels?.gender ?? '') === gender);
		console.log(`\nVoces de tu cuenta (${mine.length}):`);
		for (const voice of mine) console.log(line(voice));

		const params = new URLSearchParams({ language: 'es', page_size: '40', sort: 'usage_character_count_1y' });
		if (gender) params.set('gender', gender);
		const library = await get(`/v1/shared-voices?${params}`, key);
		const shared = library.voices ?? [];
		console.log(`\nBiblioteca publica en espanol (${shared.length}, las mas usadas primero):`);
		for (const voice of shared) console.log(line(voice));

		console.log('\nPara usar una: pon su id en ELEVENLABS_VOICE_ID (en .env.local y en Railway).');
		console.log('Las voces de la biblioteca solo funcionan por API con un plan pago.');
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
