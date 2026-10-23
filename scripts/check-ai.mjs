// Answers one question: which language model, if any, will actually answer.
//
// The studio degrades silently when a provider is out of credit - it falls back
// to keyword matching and keeps replying - so "the assistant sounds stupid" and
// "the key is dead" look identical from the outside. This calls every provider
// for real, with tools, and prints what came back.
//
//   node scripts/check-ai.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The same file lib/ai-provider.ts imports, so this can never report on a model
// the app does not actually use.
const MODELS = JSON.parse(readFileSync(join(root, 'apps', 'web', 'lib', 'ai-models.json'), 'utf8'));

// Same precedence scripts/dev.mjs uses when it starts the app: apps/web first,
// the repo root last so it wins. Checking with the other order would report a
// key the running app never reads.
for (const file of [join(root, 'apps', 'web', '.env.local'), join(root, '.env.local')]) {
    let text;
    try {
        text = readFileSync(file, 'utf8');
    } catch {
        continue;
    }
    for (const line of text.split('\n')) {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match && match[2].trim()) process.env[match[1]] = match[2].trim();
    }
}

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

// Same order and defaults as apps/web/lib/ai-provider.ts, both read from
// ai-models.json. `extra` mirrors the request fields the app sends.
const BY_ID = {
    gemini: {
        id: 'gemini',
        key: 'GEMINI_API_KEY',
        url: process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        model: process.env.GEMINI_MODEL || MODELS.gemini.model,
        headers: () => ({ Authorization: `Bearer ${process.env.GEMINI_API_KEY}` }),
        extra: { reasoning_effort: 'low' },
    },
    groq: {
        id: 'groq',
        key: 'GROQ_API_KEY',
        url: process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions',
        model: process.env.GROQ_MODEL || MODELS.groq.model,
        headers: () => ({ Authorization: `Bearer ${process.env.GROQ_API_KEY}` }),
    },
    mistral: {
        id: 'mistral',
        key: 'MISTRAL_API_KEY',
        url: process.env.MISTRAL_API_URL || 'https://api.mistral.ai/v1/chat/completions',
        model: process.env.MISTRAL_MODEL || MODELS.mistral.model,
        headers: () => ({ Authorization: `Bearer ${process.env.MISTRAL_API_KEY}` }),
    },
    openrouter: {
        id: 'openrouter',
        key: 'OPENROUTER_API_KEY',
        url: process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions',
        model: process.env.OPENROUTER_MODEL || MODELS.openrouter.model,
        headers: () => ({ Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'X-Title': 'Stickman Video Studio' }),
        alternates: MODELS.openrouter.alternates,
        extra: { reasoning: { effort: 'low' } },
    },
};

const PROVIDERS = [
    ...MODELS.order.map((id) => BY_ID[id]).filter(Boolean),
    {
        id: 'openai/anthropic (heredado)',
        key: 'LLM_API_KEY',
        url: process.env.LLM_API_URL ?? 'https://api.openai.com/v1/chat/completions',
        model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
        headers: () => ({ Authorization: `Bearer ${process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY}` }),
    },
];

async function probe(provider) {
    const key = process.env[provider.key];
    if (!key) return { estado: 'sin clave', detalle: `falta ${provider.key}` };

    let response;
    try {
        response = await fetch(provider.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...provider.headers() },
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

    // Tool calling is the whole point: a model that only talks cannot drive the
    // studio, so it is reported as a partial pass rather than a pass.
    const message = body?.choices?.[0]?.message ?? {};
    const call = message.tool_calls?.[0];
    // OpenRouter falls through its models array on a 404 or 429, so a dead
    // primary still comes back 200 - answered by an alternate. Reporting the
    // configured name hid exactly that on 2026-10-06: the primary had stopped
    // being free and a slow alternate was serving every turn.
    const served = typeof body?.model === 'string' && body.model !== provider.model
        ? ` (respondio el respaldo ${body.model}, NO el principal)`
        : '';
    return call
        ? { estado: served ? 'RESPALDO' : 'OK', detalle: `llamo a ${call.function?.name} con ${call.function?.arguments}${served}` }
        : { estado: 'PARCIAL', detalle: `respondio texto pero no uso la herramienta: "${String(message.content ?? '').slice(0, 70)}"${served}` };
}

let alguno = false;
for (const provider of PROVIDERS) {
    const { estado, detalle } = await probe(provider);
    if (estado === 'OK' || estado === 'RESPALDO') alguno = true;
    console.log(`${estado.padEnd(9)} ${provider.id} (${provider.model})\n          ${detalle}\n`);
}

console.log(alguno
    ? 'Hay al menos un proveedor con tool calling: el copiloto puede razonar de verdad.'
    : 'Ningun proveedor responde. El copiloto seguira en modo basico (palabras clave).');
// exitCode rather than exit(): killing the process while undici is still
// closing its sockets trips an assertion in libuv on Windows.
process.exitCode = alguno ? 0 : 1;
