export type AiProvider = 'openai' | 'anthropic';

type GeneratedResponse = { text: string; provider: AiProvider };

function configuredProviders(): AiProvider[] {
    const preferred = process.env.LLM_PROVIDER;
    if (preferred === 'anthropic') return ['anthropic', 'openai'];
    if (preferred === 'openai') return ['openai', 'anthropic'];
    return ['openai', 'anthropic'];
}

function providerKey(provider: AiProvider) {
    return provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
}

async function requestOpenAi(system: string, messages: { role: 'user' | 'assistant'; content: string }[], maxTokens: number): Promise<string> {
    const response = await fetch(process.env.LLM_API_URL ?? 'https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${providerKey('openai') ?? ''}` },
        body: JSON.stringify({ model: process.env.LLM_MODEL ?? 'gpt-4o-mini', temperature: 0.6, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] }),
        signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`OpenAI respondio con ${response.status}.`);
    const data = await response.json() as { choices?: { message?: { content?: unknown } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('OpenAI no devolvio contenido.');
    return text.trim();
}

async function requestAnthropic(system: string, messages: { role: 'user' | 'assistant'; content: string }[], maxTokens: number): Promise<string> {
    const response = await fetch(process.env.ANTHROPIC_API_URL ?? 'https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': providerKey('anthropic') ?? '', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', system, max_tokens: maxTokens, messages }),
        signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Claude respondio con ${response.status}.`);
    const data = await response.json() as { content?: { type?: string; text?: unknown }[] };
    const text = data.content?.find((block) => block.type === 'text')?.text;
    if (typeof text !== 'string' || !text.trim()) throw new Error('Claude no devolvio contenido.');
    return text.trim();
}

export async function generateAiText(system: string, messages: { role: 'user' | 'assistant'; content: string }[], maxTokens = 500): Promise<GeneratedResponse | null> {
    const providers = configuredProviders().filter((provider) => providerKey(provider));
    for (const provider of providers) {
        try {
            const text = provider === 'anthropic' ? await requestAnthropic(system, messages, maxTokens) : await requestOpenAi(system, messages, maxTokens);
            return { text, provider };
        } catch (error) {
            console.warn(`Fallo el proveedor ${provider}; se intentara el siguiente.`, error);
        }
    }
    return null;
}
