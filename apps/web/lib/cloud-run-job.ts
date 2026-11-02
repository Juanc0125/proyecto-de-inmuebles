import { GoogleAuthError, getAccessToken, parseServiceAccountKey, resetTokenCache, describeGoogleError, type ServiceAccountKey } from './google-auth';

// Starts one execution of the render job on Google Cloud Run Jobs. It replaces
// the always-on HTTP worker when RENDER_BACKEND=cloud-run-job: a job costs
// nothing while idle, which the free tier needs. The service-account auth
// lives in google-auth.ts, shared with the assistant's Text-to-Speech voice.

// Re-exported so existing imports of the auth helpers from here keep working.
export { TOKEN_URL, buildSignedJwt, describeGoogleError, getAccessToken, parseServiceAccountKey, resetTokenCache } from './google-auth';
export type { ServiceAccountKey } from './google-auth';

const DEFAULT_JOB = 'stickman-render';
const REQUEST_TIMEOUT_MS = 15_000;

// Cloud Run caps the size of a container override; the whole job spec has to
// fit in the run request. Well under that limit, and far above a normal
// render (8 scenes of short lines plus a few URLs is a few kB).
export const MAX_JOB_PAYLOAD_CHARS = 30_000;

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

export class CloudRunJobError extends Error {
    constructor(readonly status: number | null, readonly detail: string) {
        super(detail);
        this.name = 'CloudRunJobError';
    }
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
        if (error instanceof GoogleAuthError || error instanceof CloudRunJobError) return { ok: false, status: error.status, detail: error.detail };
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
