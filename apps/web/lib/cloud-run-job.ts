import { createSign } from 'node:crypto';

// Starts one execution of the render job on Google Cloud Run Jobs. It replaces
// the always-on HTTP worker when RENDER_BACKEND=cloud-run-job: a job costs
// nothing while idle, which the free tier needs.
//
// Google's auth library is not used on purpose: all this needs is one RS256
// signature and one token exchange, which Node's crypto already does, and the
// library would add a dependency (and its transitive tree) for that.

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_JOB = 'stickman-render';
const REQUEST_TIMEOUT_MS = 15_000;

// Renewed this long before Google says it expires, so a token never dies
// between being read from the cache and reaching run.googleapis.com.
const TOKEN_REFRESH_MARGIN_S = 300;

// Cloud Run caps the size of a container override; the whole job spec has to
// fit in the run request. Well under that limit, and far above a normal
// render (8 scenes of short lines plus a few URLs is a few kB).
export const MAX_JOB_PAYLOAD_CHARS = 30_000;

export type ServiceAccountKey = {
    client_email: string;
    private_key: string;
};

export type CloudRunJobConfig = {
    projectId: string;
    region: string;
    job: string;
    key: ServiceAccountKey;
};

export type RunJobResult =
    | { ok: true; execution: string | null }
    | { ok: false; status: number | null; detail: string };

// Reads the job settings from the environment. Returns the names of whatever
// is missing or unreadable instead of throwing, so the caller decides how loud
// to be about it (a clear 500 in production).
export function readCloudRunJobConfig(env: NodeJS.ProcessEnv = process.env): CloudRunJobConfig | { missing: string[] } {
    const projectId = env.GCP_PROJECT_ID?.trim() ?? '';
    const region = env.GCP_REGION?.trim() ?? '';
    const job = env.CLOUD_RUN_JOB?.trim() || DEFAULT_JOB;
    const rawKey = env.GCP_SA_KEY_B64?.trim() ?? '';

    const missing: string[] = [];
    if (!projectId) missing.push('GCP_PROJECT_ID');
    if (!region) missing.push('GCP_REGION');
    const key = rawKey ? parseServiceAccountKey(rawKey) : null;
    if (!key) missing.push('GCP_SA_KEY_B64');

    if (missing.length || !key) return { missing };
    return { projectId, region, job, key };
}

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

type CachedToken = { email: string; token: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

// Only for tests: forget the cached token.
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
        throw new CloudRunJobError(response.status, `token: ${describeGoogleError(body)}`);
    }

    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    cachedToken = { email: key.client_email, token: body.access_token, expiresAt: now + expiresIn };
    return body.access_token;
}

export class CloudRunJobError extends Error {
    constructor(readonly status: number | null, readonly detail: string) {
        super(detail);
        this.name = 'CloudRunJobError';
    }
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

// The render job reads its whole input from one environment variable: Cloud
// Run Jobs take no request body, but they do take per-execution env overrides.
export function encodeJobPayload(payload: unknown): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export function buildRunJobRequest(config: Pick<CloudRunJobConfig, 'projectId' | 'region' | 'job'>, encodedPayload: string) {
    const path = [
        'projects', encodeURIComponent(config.projectId),
        'locations', encodeURIComponent(config.region),
        'jobs', encodeURIComponent(config.job),
    ].join('/');
    return {
        url: `https://run.googleapis.com/v2/${path}:run`,
        body: {
            overrides: {
                containerOverrides: [{ env: [{ name: 'RENDER_JOB_B64', value: encodedPayload }] }],
                taskCount: 1,
            },
        },
    };
}

// Starts the execution and returns as soon as Google accepts it. The run call
// answers with a long-running operation; the render itself reports progress
// on the video row, so the operation is not polled.
export async function runCloudRunJob(config: CloudRunJobConfig, encodedPayload: string, fetchImpl: typeof fetch = fetch): Promise<RunJobResult> {
    let token: string;
    try {
        token = await getAccessToken(config.key, fetchImpl);
    } catch (error) {
        if (error instanceof CloudRunJobError) return { ok: false, status: error.status, detail: error.detail };
        return { ok: false, status: null, detail: `token: ${error instanceof Error ? error.message : String(error)}` };
    }

    const request = buildRunJobRequest(config, encodedPayload);
    let response: Response;
    try {
        response = await fetchImpl(request.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(request.body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        return { ok: false, status: null, detail: `run: ${error instanceof Error ? error.message : String(error)}` };
    }

    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
        // A revoked or rotated key shows up here as 401: drop the token so the
        // next click signs a fresh one instead of reusing the dead one.
        if (response.status === 401) resetTokenCache();
        return { ok: false, status: response.status, detail: `run: ${describeGoogleError(body)}` };
    }
    return { ok: true, execution: typeof body.name === 'string' ? body.name : null };
}
