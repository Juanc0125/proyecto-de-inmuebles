// Sets one AI-provider key end to end: prompts for it without echoing, refuses
// an obviously wrong one, proves it actually answers before touching disk, and
// only then writes it to .env.local and to whichever platform actually
// consumes it (Vercel for groq/openrouter, Railway for fal).
//
// Two keys have already been lost in this project by being pasted into a chat
// window. This script exists so that never has to happen again: the value only
// ever travels from the operator's terminal, through a hidden prompt, into a
// child process's stdin - never through an argument, a log line, or a file
// this script does not own.
//
//   npm run set:ai-key -- groq
//   npm run set:ai-key -- openrouter
//   npm run set:ai-key -- fal      (goes to Railway, not Vercel - see below)
//   npm run set:ai-key -- heygen   (Railway too: the worker calls HeyGen)
//   npm run set:ai-key -- elevenlabs (Railway: the narration voice)
//   npm run set:ai-key -- gemini / mistral (Vercel, like groq)
//   npm run set:ai-key            (asks which provider)
//
// With --from-local it takes the key already in .env.local instead of asking,
// which is the case of "it works on my machine and Vercel still does not".
//
// groq and openrouter feed apps/web, so their key is pushed to Vercel. fal
// feeds apps/render-worker/ai-video.ts, which runs on Railway, not Vercel -
// pushing FAL_KEY to Vercel would leave the actual consumer unset. So fal is
// pushed to Railway instead, through the Railway CLI.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const MODELS = JSON.parse(readFileSync(join(root, 'apps', 'web', 'lib', 'ai-models.json'), 'utf8'));
const ENV_FILE = join(root, '.env.local');

// Same tool-calling probe scripts/check-ai.mjs uses: a key that returns 200
// but never calls the tool is still a working key, just an unhelpful reply
// pattern, so this shape (not just "did the HTTP call succeed") is what tells
// a live key apart from a dead one.
const TOOL = {
    type: 'function',
    function: {
        name: 'crear_video',
        description: 'Crea un video con un tema y una plataforma.',
        parameters: {
            type: 'object',
            properties: {
                tema: { type: 'string' },
                plataforma: { type: 'string', enum: ['reels', 'tiktok', 'shorts'] },
            },
            required: ['tema', 'plataforma'],
        },
    },
};

const PROVIDERS = {
    gemini: {
        // Google AI Studio key (free tier). No prefix check: the live probe
        // below is what tells a good key apart, not its shape.
        envVar: 'GEMINI_API_KEY',
        prefix: '',
        url: process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        model: process.env.GEMINI_MODEL || MODELS.gemini.model,
        headers: (key) => ({ Authorization: `Bearer ${key}` }),
        extra: { reasoning_effort: 'low' },
    },
    mistral: {
        envVar: 'MISTRAL_API_KEY',
        prefix: '',
        url: process.env.MISTRAL_API_URL || 'https://api.mistral.ai/v1/chat/completions',
        model: process.env.MISTRAL_MODEL || MODELS.mistral.model,
        headers: (key) => ({ Authorization: `Bearer ${key}` }),
    },
    elevenlabs: {
        // The narration voice (apps/render-worker/voice.ts), so Railway only.
        envVar: 'ELEVENLABS_API_KEY',
        prefix: '',
        probe: probeElevenlabs,
        probeLabel: 'api.elevenlabs.io',
        railway: true,
    },
    groq: {
        envVar: 'GROQ_API_KEY',
        prefix: 'gsk_',
        url: process.env.GROQ_API_URL ?? 'https://api.groq.com/openai/v1/chat/completions',
        model: process.env.GROQ_MODEL || MODELS.groq.model,
        headers: (key) => ({ Authorization: `Bearer ${key}` }),
    },
    openrouter: {
        envVar: 'OPENROUTER_API_KEY',
        prefix: 'sk-or-v1-',
        url: process.env.OPENROUTER_API_URL ?? 'https://openrouter.ai/api/v1/chat/completions',
        model: process.env.OPENROUTER_MODEL || MODELS.openrouter.model,
        headers: (key) => ({ Authorization: `Bearer ${key}`, 'X-Title': 'Stickman Video Studio' }),
        alternates: MODELS.openrouter.alternates,
        extra: { reasoning: { effort: 'low' } },
    },
    fal: {
        envVar: 'FAL_KEY',
        // fal keys have no fixed public prefix (unlike gsk_ or sk-or-v1-), so
        // this intentionally matches every string and leaves validation to
        // the live probe below.
        prefix: '',
        // fal has no chat-completions API, so the generic probe() below does
        // not apply - this replaces it entirely (see the dispatch in run()).
        probe: probeFal,
        probeLabel: 'fal.run',
        railway: true,
    },
    heygen: {
        // HeyGen's API wallet key - not the web subscription, whose credits
        // the API cannot use. Two consumers: the worker's videos
        // (apps/render-worker/heygen.ts, on Railway) and the assistant's voice
        // (apps/web/app/api/speak, on Vercel), so it goes to both.
        envVar: 'HEYGEN_API_KEY',
        prefix: '',
        probe: probeHeygen,
        probeLabel: 'api.heygen.com',
        railway: true,
        alsoVercel: true,
    },
};

// Railway service that runs apps/render-worker (from `railway status` against
// the linked project). Not a secret, just a target name - update it here if
// the service is ever renamed in the Railway dashboard.
const RAILWAY_SERVICE = 'stickman-video-app';

// Marks a Ctrl+C so the caller can tell "the operator cancelled" apart from
// "something actually broke".
class Cancelled extends Error {}

// One readline interface for the whole interactive part of the script (at
// most two questions: which provider, then the key). Two separate interfaces
// created back to back on the same stdin can each only see the input that
// arrives after they are created - a line typed (or piped) ahead of time can
// land in the first interface's internal buffer and be lost when it closes
// before the second interface is created to read it. Reusing one interface
// for every question, and closing it only once, is the pattern readline
// itself is designed around.
function createSession() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    // readline puts a TTY into raw mode to read keystrokes and re-echoes them
    // itself through _writeToOutput; muting that method (after it has already
    // written the prompt text once) is what hides typed input without
    // disabling the prompt. Off by default so the plain provider question
    // (ask, below) still echoes normally; askHidden turns it on per call.
    rl._writeToOutput = (chunk) => {
        if (!muted) rl.output.write(chunk);
    };

    function question(promptText, { hidden } = {}) {
        return new Promise((resolve, reject) => {
            // Belt and suspenders: if the input stream ends without a line
            // ever being submitted (stdin closed, terminal disconnected),
            // 'close' fires without the question callback ever running.
            // Without this, nothing keeps the event loop alive and the
            // process exits silently with status 0 having asked a question
            // nobody answered - indistinguishable from success.
            const onClose = () => reject(new Cancelled());
            const onSigint = () => {
                muted = false;
                rl.removeListener('close', onClose);
                process.stdout.write('\n');
                reject(new Cancelled());
            };
            rl.once('SIGINT', onSigint);
            rl.once('close', onClose);
            rl.question(promptText, (answer) => {
                muted = false;
                rl.removeListener('SIGINT', onSigint);
                rl.removeListener('close', onClose);
                if (hidden) process.stdout.write('\n');
                resolve(answer);
            });
            if (hidden) muted = true;
        });
    }

    return {
        ask: (promptText) => question(promptText),
        askHidden: (promptText) => question(promptText, { hidden: true }),
        close: () => rl.close(),
    };
}

async function pickProvider(session) {
    while (true) {
        const names = Object.keys(PROVIDERS);
        const answer = (await session.ask(`Proveedor (${names.join('/')}): `)).trim().toLowerCase();
        if (PROVIDERS[answer]) return answer;
        console.log(`Escribe uno de: ${names.join(', ')}.`);
    }
}

// fal has no chat-completions endpoint, so it cannot use probeGenerico below.
// What it does have is a queue status lookup that is free to call (unlike
// submitting an actual generation job, which is billed) and still tells a
// live key apart from a dead one perfectly well: a status check for a request
// id that cannot possibly exist returns 404 once auth succeeds, or 401/403
// before auth is even considered. Anything else is reported as-is rather than
// guessed at, since only those three shapes have been confirmed against fal's
// real behavior.
async function probeFal(key) {
    // Deliberately NOT https://queue.fal.run/fal-ai/ltx-2.3/text-to-video/requests/.../status
    // (the model id apps/render-worker/ai-video.ts submits jobs to, in full).
    // Verified against fal.run directly (both with no Authorization header and
    // with a garbage one, so no real key was needed to see this): the queue's
    // status/result routes only recognize the first two path segments
    // (owner/model) as the app id - a status GET against the full submission
    // path, sub-path included, returns 405 Method Not Allowed unconditionally,
    // before auth is even checked. Dropping the sub-path restores the
    // documented 401/404 behavior below. Auth on fal is account-scoped, not
    // per-model, so this base path is exactly as good a probe as the full one
    // would have been, had it worked.
    const url = 'https://queue.fal.run/fal-ai/ltx-2.3/requests/00000000-0000-0000-0000-000000000000/status';
    let response;
    try {
        response = await fetch(url, {
            headers: { Authorization: `Key ${key}` },
            signal: AbortSignal.timeout(40000),
        });
    } catch (error) {
        return { estado: 'FALLA', detalle: `sin respuesta: ${error.message}` };
    }

    if (response.status === 401 || response.status === 403) {
        return { estado: 'FALLA', detalle: `HTTP ${response.status}: fal.run rechazo la clave` };
    }
    if (response.status === 404) {
        return { estado: 'OK', detalle: 'HTTP 404: fal.run autentico la clave (el request de prueba no existe, como se espera)' };
    }

    const text = await response.text().catch(() => '');
    return {
        estado: 'FALLA',
        detalle: `respuesta inesperada de fal.run, ni 401/403 ni 404 - no se asume nada: HTTP ${response.status} ${text.slice(0, 120)}`.trim(),
    };
}

// Identical request shape to scripts/check-ai.mjs's probe(): same tool, same
// prompt, same timeout. A second, slightly different version of this call
// would be one more place for the two to quietly disagree. Only used by
// providers that speak chat-completions (groq, openrouter); a provider with
// its own `probe` field (fal) bypasses this entirely - see the dispatch in run().
async function probeGenerico(provider, key) {
    let response;
    try {
        response = await fetch(provider.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...provider.headers(key) },
            body: JSON.stringify({
                model: provider.model,
                // Reasoning models spend part of this thinking; 120 left one empty.
                max_tokens: 1024,
                ...provider.extra,
                messages: [
                    { role: 'system', content: 'Eres un asistente que opera un estudio de video. Usa la herramienta cuando corresponda.' },
                    { role: 'user', content: 'crea un video sobre tasas fijas para tiktok' },
                ],
                tools: [TOOL],
                tool_choice: 'auto',
                ...(provider.alternates ? { models: [provider.model, ...provider.alternates] } : {}),
            }),
            signal: AbortSignal.timeout(40000),
        });
    } catch (error) {
        return { estado: 'FALLA', detalle: `sin respuesta: ${error.message}` };
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
        const error = body?.error ?? {};
        return { estado: 'FALLA', detalle: `HTTP ${response.status} ${error.code ?? error.type ?? ''} ${String(error.message ?? '').slice(0, 90)}`.trim() };
    }

    const message = body?.choices?.[0]?.message ?? {};
    const call = message.tool_calls?.[0];
    return call
        ? { estado: 'OK', detalle: `llamo a ${call.function?.name} con ${call.function?.arguments}` }
        : { estado: 'PARCIAL', detalle: `respondio texto pero no uso la herramienta: "${String(message.content ?? '').slice(0, 70)}"` };
}

function runCommand(command, args, options = {}) {
    // vercel and (on some setups) git are .cmd shims on Windows; without a
    // shell, spawn() can fail to find them even though they work from a prompt.
    const useShell = process.platform === 'win32';
    return spawnSync(useShell ? [command, ...args].join(' ') : command, useShell ? undefined : args, {
        cwd: root,
        shell: useShell,
        encoding: 'utf8',
        ...options,
    });
}

// .env.local is only safe to write to if git will actually refuse to track it -
// checking .gitignore by eye is exactly the kind of thing that can silently
// stop being true after an unrelated edit.
function envFileIsIgnored() {
    const result = runCommand('git', ['check-ignore', '-q', ENV_FILE]);
    return !result.error && result.status === 0;
}

function writeLocalEnv(name, value) {
    let content = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, 'm');
    if (pattern.test(content)) {
        content = content.replace(pattern, line);
    } else {
        if (content && !content.endsWith('\n')) content += '\n';
        content += `${line}\n`;
    }
    writeFileSync(ENV_FILE, content, 'utf8');
}

// Defensive only: Vercel is not expected to echo the value back, but nothing
// printed from a child process that just received a secret should be trusted
// blindly before it reaches the terminal.
function redact(text, secret) {
    return secret ? text.split(secret).join('[oculto]') : text;
}

function lastLine(text) {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    return lines.length ? lines[lines.length - 1] : 'sin detalle';
}

// Reads one variable out of .env.local without the value passing through an
// argument or a log line.
function readLocalEnv(name) {
    if (!existsSync(ENV_FILE)) return '';
    const match = readFileSync(ENV_FILE, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    return match ? match[1].trim() : '';
}

// Listing one public voice is free and needs a valid key: 200 means the key
// authenticates, 401/403 means it does not. It never touches the wallet.
// The plan matters as much as the key: on the free plan /v1/voices answers 200
// while text-to-speech answers 402 paid_plan_required (measured with a real
// key), so a free-plan key would install cleanly and never narrate a word.
async function probeElevenlabs(key) {
    let response;
    try {
        response = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
            headers: { 'xi-api-key': key, accept: 'application/json' },
            signal: AbortSignal.timeout(40000),
        });
    } catch (error) {
        return { estado: 'FALLA', detalle: `sin respuesta: ${error.message}` };
    }
    if (response.status === 401 || response.status === 403) {
        return { estado: 'FALLA', detalle: `HTTP ${response.status}: ElevenLabs rechazo la clave` };
    }
    if (!response.ok) return { estado: 'FALLA', detalle: `respuesta inesperada de api.elevenlabs.io: HTTP ${response.status}` };
    const plan = await response.json().catch(() => ({}));
    const tier = String(plan.tier ?? 'desconocido');
    if (tier === 'free') {
        return { estado: 'FALLA', detalle: 'la cuenta esta en el plan gratuito: ahi la API de voz responde 402 y no da licencia comercial. Hace falta Starter o superior.' };
    }
    const left = Number(plan.character_limit) - Number(plan.character_count);
    return { estado: 'OK', detalle: `plan ${tier}${Number.isFinite(left) ? `, ${left} caracteres disponibles este ciclo` : ''}` };
}

async function probeHeygen(key) {
    let response;
    try {
        response = await fetch('https://api.heygen.com/v3/voices?limit=1', {
            headers: { 'x-api-key': key, accept: 'application/json' },
            signal: AbortSignal.timeout(40000),
        });
    } catch (error) {
        return { estado: 'FALLA', detalle: `sin respuesta: ${error.message}` };
    }
    if (response.ok) return { estado: 'OK', detalle: `HTTP ${response.status}: api.heygen.com autentico la clave` };
    if (response.status === 401 || response.status === 403) {
        return { estado: 'FALLA', detalle: `HTTP ${response.status}: HeyGen rechazo la clave (¿es la de la API y no la de LiveAvatar?)` };
    }
    return { estado: 'FALLA', detalle: `respuesta inesperada de api.heygen.com: HTTP ${response.status}` };
}

async function run() {
    const args = process.argv.slice(2).filter((arg) => arg !== '--from-local');
    const desdeLocal = process.argv.includes('--from-local');
    const rawArg = args[0];
    const providerArg = (rawArg ?? '').toLowerCase();

    if (rawArg && !PROVIDERS[providerArg]) {
        console.error(`Proveedor desconocido: "${rawArg}". Usa "groq", "openrouter", "fal" o "heygen".`);
        process.exitCode = 1;
        return;
    }

    let providerName;
    let key;
    if (desdeLocal) {
        // No terminal at all in this mode: the value is already on disk, and
        // opening a prompt just to close it would eat a line of stdin.
        providerName = providerArg || 'groq';
        key = readLocalEnv(PROVIDERS[providerName].envVar);
        if (!key) {
            console.error(`No hay ${PROVIDERS[providerName].envVar} con valor en .env.local. Corre el comando sin --from-local para pegarla.`);
            process.exitCode = 1;
            return;
        }
        console.log(`Tomando ${PROVIDERS[providerName].envVar} de .env.local.`);
    } else {
        const session = createSession();
        try {
            providerName = providerArg || (await pickProvider(session));
            key = (await session.askHidden(`Pega la clave de ${providerName} (no se mostrara en pantalla): `)).trim();
        } finally {
            session.close();
        }
    }
    const provider = PROVIDERS[providerName];

    if (!key) {
        console.error('No se ingreso ninguna clave. No se guardo nada.');
        process.exitCode = 1;
        return;
    }

    // Reject before doing anything else with it: no network call, no disk write.
    if (!key.startsWith(provider.prefix)) {
        console.error(`Esa clave no empieza con "${provider.prefix}", que es el prefijo esperado para ${providerName}. No se guardo nada.`);
        process.exitCode = 1;
        return;
    }

    console.log(`Probando la clave contra ${provider.probeLabel ?? provider.url} ...`);
    const test = provider.probe ? await provider.probe(key) : await probeGenerico(provider, key);
    if (test.estado === 'FALLA') {
        console.error(`La clave no funciono: ${test.detalle}`);
        console.error('No se guardo nada.');
        process.exitCode = 1;
        return;
    }
    console.log(`Clave valida (${test.estado}): ${test.detalle}`);

    if (!envFileIsIgnored()) {
        console.error('No se pudo confirmar que .env.local esta ignorado por git. Por seguridad no se escribio la clave en ningun lado.');
        process.exitCode = 1;
        return;
    }
    writeLocalEnv(provider.envVar, key);
    console.log(`Guardada en .env.local (raiz del repo) como ${provider.envVar}.`);

    if (provider.railway) {
        // FAL_KEY and HEYGEN_API_KEY feed apps/render-worker, which deploys to
        // Railway - pushing them to Vercel would leave the consumer unset.
        const who = runCommand('railway', ['whoami']);
        if (who.status !== 0) {
            console.log('');
            console.log('Railway CLI no disponible: no esta instalada o no hay sesion iniciada. Se omite el envio a Railway.');
            console.log('La clave ya quedo en .env.local. Para activarla en el worker desplegado, agregala a mano:');
            console.log(`  1. Panel de Railway -> servicio "${RAILWAY_SERVICE}" (apps/render-worker).`);
            console.log('  2. Pestana "Variables" -> "New Variable".');
            console.log(`  3. Nombre "${provider.envVar}", valor: la clave que acabas de pegar aqui.`);
            console.log('  4. Guarda y redespliega el servicio para que tome efecto.');
            console.log('  (O corre "railway login" y vuelve a ejecutar este comando para que este script lo haga por ti.)');
        } else {
            // --stdin keeps the value out of argv, same reason vercel gets it
            // through `input` above instead of as a literal env=value arg.
            const set = runCommand('railway', ['variable', 'set', provider.envVar, '--stdin', '--service', RAILWAY_SERVICE], { input: `${key}\n` });
            if (set.status === 0) {
                console.log(`Railway (${RAILWAY_SERVICE}): ${provider.envVar} guardada. Railway redespliega el servicio automaticamente al cambiar una variable.`);
            } else {
                const text = redact(`${set.stdout ?? ''}${set.stderr ?? ''}`, key);
                console.error(`Railway: no se pudo guardar ${provider.envVar}. ${lastLine(text)}`);
                console.error(`La clave ya quedo en .env.local. Agregala a mano en el panel de Railway (servicio "${RAILWAY_SERVICE}" -> Variables) y redespliega.`);
                process.exitCode = 1;
            }
        }

        console.log('');
        console.log('Pendiente para un humano:');
        console.log('- Confirma en el panel de Railway que la variable llego al servicio correcto y que el redeploy termino.');
        console.log('- Reinicia el servidor local del worker (npm run dev) para que recoja el nuevo valor de .env.local.');
        if (!provider.alsoVercel) return;
        console.log('');
    }

    const who = runCommand('vercel', ['whoami']);
    if (who.status !== 0) {
        console.log('');
        console.log('Vercel CLI no tiene sesion iniciada: se omite el envio a Vercel.');
        console.log('La clave ya quedo en .env.local. Ejecuta "vercel login" y vuelve a correr este comando para tambien guardarla ahi.');
    } else {
        let anyVercelFailure = false;
        for (const target of ['production', 'preview']) {
            // Vercel refuses to add a variable that already exists, so clear it
            // first. "not found" just means there was nothing to clear.
            const removed = runCommand('vercel', ['env', 'rm', provider.envVar, target, '--yes']);
            if (removed.status !== 0) {
                const text = `${removed.stdout ?? ''}${removed.stderr ?? ''}`;
                if (!/not found/i.test(text)) {
                    console.warn(`Aviso al limpiar ${provider.envVar} (${target}) en Vercel: ${lastLine(text)}`);
                }
            }

            const added = runCommand('vercel', ['env', 'add', provider.envVar, target], { input: `${key}\n` });
            if (added.status === 0) {
                console.log(`Vercel (${target}): ${provider.envVar} guardada.`);
            } else {
                anyVercelFailure = true;
                const text = redact(`${added.stdout ?? ''}${added.stderr ?? ''}`, key);
                console.error(`Vercel (${target}): no se pudo guardar ${provider.envVar}. ${lastLine(text)}`);
            }
        }
        if (anyVercelFailure) process.exitCode = 1;
    }

    console.log('');
    console.log('Pendiente para un humano:');
    console.log('- Vercel solo aplica variables nuevas a partir del proximo deploy: hace falta volver a desplegar.');
    console.log('- Reinicia el servidor de desarrollo local (npm run dev) para que recoja el nuevo valor de .env.local.');
}

async function main() {
    try {
        await run();
    } catch (error) {
        if (error instanceof Cancelled) {
            console.log('Cancelado. No se guardo nada.');
            process.exitCode = 130;
            return;
        }
        throw error;
    }
}

main().catch((error) => {
    console.error(`Error inesperado: ${error.message}`);
    process.exitCode = 1;
});
