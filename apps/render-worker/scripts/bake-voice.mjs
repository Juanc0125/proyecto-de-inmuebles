// Image build step (see Dockerfile): downloads the Piper voice model into
// VOICE_CACHE_DIR and narrates one sentence with it. Run at build time so a
// Cloud Run Job execution never pays the ~67MB download, and so a broken model
// or a broken sherpa-onnx install fails the BUILD instead of shipping an image
// whose every video comes out mute (speak() degrades to silence by design).
//
//   VOICE_CACHE_DIR=/opt/voice-cache node scripts/bake-voice.mjs
//
// Needs `npm run build` first: it uses the same dist/voice.js the worker runs.
import { createRequire } from 'node:module';

// ElevenLabs answers first in speak() when configured, and reads its key when
// the module loads, so it is cleared before the require: this must test Piper.
delete process.env.ELEVENLABS_API_KEY;
const require = createRequire(import.meta.url);
const { ensureVoiceModel, speak, voiceModelName } = require('../dist/voice.js');

if (!process.env.VOICE_CACHE_DIR) {
	console.error('Define VOICE_CACHE_DIR: es donde queda el modelo dentro de la imagen.');
	process.exit(1);
}
const directory = await ensureVoiceModel();
if (!directory) {
	console.error(`No se pudo descargar el modelo de voz ${voiceModelName()}.`);
	process.exit(1);
}

const speech = await speak('Prueba de voz para el video.');
if (!speech || speech.durationSeconds < 0.5) {
	console.error(`El modelo de voz ${voiceModelName()} no produjo audio.`);
	process.exit(1);
}

console.log(`Modelo de voz ${voiceModelName()} listo en ${directory} (${speech.durationSeconds.toFixed(2)} s de prueba).`);
// sherpa-onnx's runtime keeps the event loop alive; the check is done.
process.exit(0);
