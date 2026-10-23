import MODELS from './ai-models.json';
import { generateAiText } from './ai';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    name?: string;
    // An assistant turn is replayed together with the calls it made: without
    // them the tool results that follow have no request to attach to and the
    // OpenAI-compatible APIs reject the conversation.
    tool_calls?: ToolCall[];
}

export interface ToolSchema { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCall { id: string; name: string; arguments: Record<string, unknown> }
export interface GenerationResult { text: string; toolCalls: ToolCall[]; provider: string }
export interface GenerateOptions { tools?: ToolSchema[]; maxTokens?: number; temperature?: number }

// Checked against console.groq.com/docs/models and console.groq.com/docs/tool-use
// on 2026-09-23: gpt-oss-120b is on the production tier (preview models can be
// withdrawn without notice) and is listed first for tool use.
const GROQ_DEFAULT_MODEL = MODELS.groq.model;

// Checked against the openrouter.ai/models catalogue on 2026-09-23: free on both
// prompt and completion, with `tools` among its supported parameters. Free
// endpoints are the ones that disappear first, hence OPENROUTER_MODEL.
const OPENROUTER_DEFAULT_MODEL = MODELS.openrouter.model;

const TIMEOUT_MS = 30000;

interface Provider {
    id: string;
    url: string;
    model: string;
    apiKey: string | undefined;
    headers: Record<string, string>;
    /** Only OpenRouter: extra models it may fall through to when the first is busy. */
    alternates?: string[];
    /** Provider-specific request fields, merged into the body. */
    extraBody?: Record<string, unknown>;
    /**
     * Reasoning models count their thinking against max_tokens. The copilot asks
     * for 600 and the voice assistant for 300, which such a model can spend
     * entirely on thinking and come back empty - measured on 2026-10-23.
     */
    minTokens?: number;
}

// Reasoning kept short: the copilot needs a tool call, not an essay, and
// "low" was enough for a complete one in every probe.
const REASONING_TOKEN_FLOOR = 1024;

type WireToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

type WireMessage = {
    role: ChatMessage['role'];
    content: string;
    tool_call_id?: string;
    name?: string;
    tool_calls?: WireToolCall[];
};

type CompletionResponse = {
    choices?: {
        message?: {
            content?: unknown;
            tool_calls?: { id?: unknown; function?: { name?: unknown; arguments?: unknown } }[];
        };
    }[];
    error?: { message?: unknown };
};

function providers(): Provider[] {
    // OpenRouter attributes traffic by these headers; the referer only goes out
    // when the deployment declares a public URL.
    const openRouterHeaders: Record<string, string> = { 'X-Title': 'Stickman Video Studio' };
    const siteUrl = process.env.OPENROUTER_SITE_URL;
    if (siteUrl) openRouterHeaders['HTTP-Referer'] = siteUrl;

    const byId: Record<string, Provider> = {
        gemini: {
            id: 'gemini',
            // Google's OpenAI-compatible endpoint (ai.google.dev/gemini-api/docs/openai),
            // tools and tool_choice "auto" included. Its free tier allows far more
            // tokens per minute than Groq's ~7,000, which is what made the copilot
            // fall back to keyword mode by the third question in a row.
            url: process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
            model: process.env.GEMINI_MODEL || MODELS.gemini.model,
            apiKey: process.env.GEMINI_API_KEY,
            headers: {},
            // Thinking cannot be switched off on Gemini 3; it can be kept short.
            extraBody: { reasoning_effort: 'low' },
            minTokens: REASONING_TOKEN_FLOOR,
        },
        groq: {
            id: 'groq',
            url: process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions',
            model: process.env.GROQ_MODEL || GROQ_DEFAULT_MODEL,
            apiKey: process.env.GROQ_API_KEY,
            headers: {},
        },
        mistral: {
            id: 'mistral',
            url: process.env.MISTRAL_API_URL || 'https://api.mistral.ai/v1/chat/completions',
            model: process.env.MISTRAL_MODEL || MODELS.mistral.model,
            apiKey: process.env.MISTRAL_API_KEY,
            headers: {},
        },
        openrouter: {
            id: 'openrouter',
            // OpenRouter walks this list when one is saturated, which is what
            // a 429 on a free model means. See ai-models.json for the probe.
            alternates: MODELS.openrouter.alternates,
            url: process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions',
            model: process.env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL,
            apiKey: process.env.OPENROUTER_API_KEY,
            headers: openRouterHeaders,
            extraBody: { reasoning: { effort: 'low' } },
            minTokens: REASONING_TOKEN_FLOOR,
        },
    };
    return MODELS.order.map((id) => byId[id]).filter((provider): provider is Provider => Boolean(provider));
}

function toWireMessage(message: ChatMessage): WireMessage {
    const wire: WireMessage = { role: message.role, content: message.content };
    if (message.tool_call_id) wire.tool_call_id = message.tool_call_id;
    if (message.name) wire.name = message.name;
    if (message.tool_calls?.length) {
        wire.tool_calls = message.tool_calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
        }));
    }
    return wire;
}

function parseToolArguments(raw: unknown, toolName: string): Record<string, unknown> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
    if (typeof raw !== 'string' || !raw.trim()) return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
        // Models mangle or truncate their own JSON often enough that throwing
        // here would lose whole turns. The caller validates the arguments
        // anyway, so an empty object degrades into "ask again" instead.
        console.warn(`Argumentos ilegibles para la herramienta ${toolName}; se continua sin ellos.`);
    }
    return {};
}

function toToolCalls(choices: CompletionResponse['choices'], provider: Provider): ToolCall[] {
    const calls = choices?.[0]?.message?.tool_calls ?? [];
    return calls.flatMap((call) => {
        const name = call.function?.name;
        if (typeof name !== 'string' || !name) return [];
        // Some OpenAI-compatible backends omit the id; one is invented so the
        // caller can still send back a matching tool_call_id next turn.
        const id = typeof call.id === 'string' && call.id ? call.id : `${provider.id}-${crypto.randomUUID()}`;
        return [{ id, name, arguments: parseToolArguments(call.function?.arguments, name) }];
    });
}

/** Carries the status and the reset hint so the caller can tell a rate limit from a dead provider. */
class ProviderError extends Error {
    readonly status: number;
    readonly retryAfterSeconds: number | null;

    constructor(message: string, status: number, retryAfterSeconds: number | null) {
        super(message);
        this.status = status;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

// Providers report the wait in seconds ("7"), as a duration ("7.66s") or as a
// date. Anything unreadable becomes null, which the caller treats as "do not
// wait".
function secondsUntilRetry(headers: Headers): number | null {
    for (const name of ['retry-after', 'x-ratelimit-reset-tokens', 'x-ratelimit-reset-requests']) {
        const raw = headers.get(name);
        if (!raw) continue;
        const match = raw.trim().match(/^([\d.]+)\s*(ms|s|m)?$/i);
        if (match) {
            const value = Number(match[1]);
            if (!Number.isFinite(value)) continue;
            const unit = (match[2] ?? 's').toLowerCase();
            return unit === 'ms' ? value / 1000 : unit === 'm' ? value * 60 : value;
        }
        const date = Date.parse(raw);
        if (!Number.isNaN(date)) return Math.max(0, (date - Date.now()) / 1000);
    }
    return null;
}

async function requestCompletion(provider: Provider, system: string, messages: ChatMessage[], options: GenerateOptions): Promise<GenerationResult> {
    const body: Record<string, unknown> = {
        model: provider.model,
        ...(provider.alternates?.length ? { models: [provider.model, ...provider.alternates] } : {}),
        temperature: options.temperature ?? 0.6,
        max_tokens: Math.max(options.maxTokens ?? 1024, provider.minTokens ?? 0),
        messages: [{ role: 'system', content: system }, ...messages.map(toWireMessage)],
        ...provider.extraBody,
    };
    if (options.tools?.length) {
        body.tools = options.tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        }));
        body.tool_choice = 'auto';
    }

    const response = await fetch(provider.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey ?? ''}`, ...provider.headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new ProviderError(
            `${provider.id} respondio con ${response.status}.`,
            response.status,
            secondsUntilRetry(response.headers),
        );
    }

    // An empty or truncated body throws here, which is the same signal as a bad
    // status: try the next provider.
    const data = await response.json() as CompletionResponse;
    if (data.error) throw new Error(`${provider.id} devolvio un error: ${String(data.error.message ?? 'sin detalle')}.`);

    const content = data.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content.trim() : '';
    const toolCalls = toToolCalls(data.choices, provider);
    if (!text && toolCalls.length === 0) throw new Error(`${provider.id} no devolvio contenido.`);
    return { text, toolCalls, provider: provider.id };
}

// ai.ts speaks plain text over two roles only, so tool results are folded into
// the narrative and consecutive turns are merged: Claude rejects a conversation
// whose roles do not alternate, and rejects empty turns.
function toLegacyMessages(messages: ChatMessage[]): { role: 'user' | 'assistant'; content: string }[] {
    const flattened: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const message of messages) {
        const content = message.role === 'tool'
            ? `Resultado de ${message.name ?? 'la herramienta'}: ${message.content}`
            : message.content;
        if (!content.trim()) continue;
        const role = message.role === 'assistant' ? 'assistant' : 'user';
        const previous = flattened[flattened.length - 1];
        if (previous && previous.role === role) previous.content = `${previous.content}\n\n${content}`;
        else flattened.push({ role, content });
    }
    while (flattened.length > 0 && flattened[0].role === 'assistant') flattened.shift();
    return flattened;
}

async function requestLegacy(system: string, messages: ChatMessage[], options: GenerateOptions): Promise<GenerationResult | null> {
    const legacyMessages = toLegacyMessages(messages);
    if (legacyMessages.length === 0) return null;

    const result = await generateAiText(system, legacyMessages, options.maxTokens ?? 1024);
    if (!result) return null;
    if (options.tools?.length) console.warn('El ultimo recurso no admite herramientas; la respuesta llega solo como texto.');
    console.info(`Respondio el proveedor de respaldo ${result.provider}.`);
    return { text: result.text, toolCalls: [], provider: result.provider };
}

// The last-resort path counts as configured: hiding the copilot while ai.ts can
// still answer would turn a degraded feature into an absent one.
export function isCopilotConfigured(): boolean {
    return Boolean(
        process.env.GEMINI_API_KEY
        || process.env.GROQ_API_KEY
        || process.env.MISTRAL_API_KEY
        || process.env.OPENROUTER_API_KEY
        || process.env.LLM_API_KEY
        || process.env.OPENAI_API_KEY
        || process.env.ANTHROPIC_API_KEY,
    );
}

// A provider that answers "no credits remaining" will keep saying it until
// somebody pays, so it is written off for the life of the process instead of
// being tried - and waited on - once per message. Rate limits and outages are
// not written off: those pass on their own.
const EXHAUSTED = new Set<string>();

// A pause long enough to be worth taking rather than answering badly, and short
// enough that nobody thinks the studio has hung.
const MAX_RETRY_WAIT_SECONDS = 12;

function isExhausted(error: unknown): boolean {
    const text = error instanceof Error ? error.message : String(error);
    return /insufficient_quota|credit_balance_exhausted|no credits remaining|payment required|402/i.test(text);
}

export async function generateWithFallback(system: string, messages: ChatMessage[], options: GenerateOptions = {}): Promise<GenerationResult | null> {
    const lista = providers();
    for (const [indice, provider] of lista.entries()) {
        const remaining = lista.slice(indice + 1);
        if (!provider.apiKey) {
            console.info(`Sin clave configurada para ${provider.id}; se omite.`);
            continue;
        }
        if (EXHAUSTED.has(provider.id)) {
            console.info(`${provider.id} quedo sin saldo en esta sesion; se omite.`);
            continue;
        }
        try {
            const result = await requestCompletion(provider, system, messages, options);
            console.info(`Respondio ${provider.id} con el modelo ${provider.model}.`);
            return result;
        } catch (error) {
            if (isExhausted(error)) {
                // No credit is permanent until somebody pays; a rate limit is not,
                // and must never land in this set.
                EXHAUSTED.add(provider.id);
                console.warn(`${provider.id} no tiene saldo; no se volvera a intentar en esta sesion.`, error);
                continue;
            }

            const rateLimited = error instanceof ProviderError && error.status === 429;
            if (!rateLimited) {
                console.warn(`Fallo ${provider.id}; se intentara el siguiente proveedor.`, error);
                continue;
            }

            // Another provider answers sooner than this one will recover, so the
            // wait is only worth it when this is the last one standing.
            const espera = error.retryAfterSeconds;
            const hayOtro = remaining.some((other) => other.apiKey && !EXHAUSTED.has(other.id));
            if (hayOtro || espera === null || espera > MAX_RETRY_WAIT_SECONDS) {
                console.warn(`${provider.id} esta saturado (429, espera ${espera ?? 'desconocida'}s); se pasa al siguiente proveedor.`);
                continue;
            }

            console.info(`${provider.id} esta saturado; esperando ${espera.toFixed(1)}s y reintentando una vez.`);
            await new Promise((resolve) => setTimeout(resolve, espera * 1000 + 250));
            try {
                const result = await requestCompletion(provider, system, messages, options);
                console.info(`Respondio ${provider.id} tras esperar el limite de tasa.`);
                return result;
            } catch (retryError) {
                console.warn(`${provider.id} sigue saturado tras esperar; se continua sin el.`, retryError);
            }
        }
    }

    const legacy = await requestLegacy(system, messages, options);
    if (legacy) return legacy;
    console.warn('Ningun proveedor de lenguaje respondio; la funcion queda sin modelo.');
    return null;
}
