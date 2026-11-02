import { createSign } from 'node:crypto';

// Service-account auth for Google APIs, shared by the Cloud Run render job and
// the assistant's Text-to-Speech voice. Both read the same GCP_SA_KEY_B64.
//
// Google's auth library is not used on purpose: all this needs is one RS256
// signature and one token exchange, which Node's crypto already does, and the
// library would add a dependency (and its transitive tree) for that.

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const REQUEST_TIMEOUT_MS = 15_000;

// Renewed this long before Google says it expires, so a token never dies
// between being read from the cache and reaching the API.
const TOKEN_REFRESH_MARGIN_S = 300;

export type ServiceAccountKey = {
    client_email: string;
    private_key: string;
};

// The key is the JSON file Google hands out, base64-encoded so it survives
// being pasted into a single-line environment variable. Only the two fields
// the signature needs are kept.
export function parseServiceAccountKey(base64: string): ServiceAccountKey | null {
    try {
        const parsed = JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as Record<string, unknown>;
        const email = parsed.client_email;
        const privateKey = parsed.private_key;
        if (typeof email !== 'string' || !email || typeof privateKey !== 'string' || !privateKey.includes('PRIVATE KEY')) return null;
        return { client_email: email, private_key: privateKey };
    } catch {
        return null;
    }
}

// GCP_SA_KEY_B64 from the environment, or null when it is absent or unreadable.
export function readServiceAccountKey(env: NodeJS.ProcessEnv = process.env): ServiceAccountKey | null {
    const raw = env.GCP_SA_KEY_B64?.trim() ?? '';
    return raw ? parseServiceAccountKey(raw) : null;
}

function base64Url(input: string | Buffer): string {
    return Buffer.from(input).toString('base64url');
}

// The JWT-bearer grant: a self-signed assertion that Google trades for an
// access token. Google rejects an assertion valid for more than an hour.
export function buildSignedJwt(key: ServiceAccountKey, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(JSON.stringify({
        iss: key.client_email,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: nowSeconds,
        exp: nowSeconds + 3600,
    }));
    const signingInput = `${header}.${claims}`;
    const signature = createSign('RSA-SHA256').update(signingInput).sign(key.private_key);
    return `${signingInput}.${base64Url(signature)}`;
}

export class GoogleAuthError extends Error {
    constructor(readonly status: number | null, readonly detail: string) {
        super(detail);
        this.name = 'GoogleAuthError';
    }
}

type CachedToken = { email: string; token: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

// Forget the cached token: for tests, and after an API answers 401 so the next
// call signs a fresh one instead of reusing a revoked one.
export function resetTokenCache(): void {
    cachedToken = null;
}

export async function getAccessToken(key: ServiceAccountKey, fetchImpl: typeof fetch = fetch): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && cachedToken.email === key.client_email && cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_S > now) {
        return cachedToken.token;
    }

    const response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: buildSignedJwt(key, now),
        }).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || typeof body.access_token !== 'string') {
        // error/error_description name the problem (invalid_grant, a deleted
        // key) without echoing anything secret back.
        throw new GoogleAuthError(response.status, `token: ${describeGoogleError(body)}`);
    }

    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    cachedToken = { email: key.client_email, token: body.access_token, expiresAt: now + expiresIn };
    return body.access_token;
}

// Pulls the readable part out of either error shape Google uses: the OAuth
// one ({ error, error_description }) and the API one ({ error: { code,
// status, message } }). Truncated so a log line stays a line.
export function describeGoogleError(body: unknown): string {
    if (!body || typeof body !== 'object') return 'sin detalle';
    const record = body as Record<string, unknown>;
    let text: string;
    if (record.error && typeof record.error === 'object') {
        const inner = record.error as Record<string, unknown>;
        text = [inner.code, inner.status, inner.message].filter((part) => part !== undefined && part !== '').join(' ');
    } else {
        text = [record.error, record.error_description].filter((part) => typeof part === 'string' && part).join(': ');
    }
    return (text || 'sin detalle').slice(0, 500);
}
