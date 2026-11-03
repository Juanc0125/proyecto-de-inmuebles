// Next.js 16 renamed the middleware.js convention to proxy.js (same runtime,
// same file position at the app root); see node_modules/next/dist/docs/01-app
// /03-api-reference/03-file-conventions/proxy.md. This is that file.
//
// Runs before every request: refreshes the session cookie and turns "no
// session" into a 401 for the API calls that spend money or commit the
// client. Everything else is open to anyone with the URL.
import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseProxyClient } from './lib/supabase-server';
import { LOGIN_REQUIRED, SIGN_IN_REQUIRED_ERROR } from './lib/sign-in-required';

// Open studio. Since 13-oct-2026 nothing below is enforced unless
// REQUIRE_LOGIN=true (see LOGIN_REQUIRED in lib/sign-in-required.ts): the
// owner wants free entry, approvals included. With it on: anyone can browse, write and edit drafts
// without signing in; what costs money or commits the client still needs a
// session: rendering (the worker, and HeyGen when it is configured, bill per
// second), any approval transition (RF-012: the approver must be a known
// person), deleting videos, sounds or brand templates, uploading files to
// Storage, and the paid TTS - the per-video one and the assistant's HeyGen
// voice (/api/speak; visitors hear the browser's free voice instead). Accounts
// are still created by the operator in the
// Supabase dashboard; there is no signup route.
//
// The approval and render actions share PATCH /api/videos/[id] with the
// script edit, and only the body tells them apart - a proxy cannot read the
// body without consuming it, so that one check lives in the route itself
// (see requireSession in lib/sign-in-required.ts). Everything else is decided
// here by method and path.
const PROTECTED_ROUTES: Array<{ method: string; pattern: RegExp }> = [
    { method: 'POST', pattern: /^\/api\/videos\/[^/]+\/tts$/ },
    { method: 'POST', pattern: /^\/api\/speak$/ },
    { method: 'POST', pattern: /^\/api\/videos\/[^/]+\/logo$/ },
    { method: 'DELETE', pattern: /^\/api\/videos\/[^/]+$/ },
    { method: 'POST', pattern: /^\/api\/sounds(\/upload-url)?$/ },
    { method: 'DELETE', pattern: /^\/api\/sounds\/[^/]+$/ },
    { method: 'DELETE', pattern: /^\/api\/brand-templates\/[^/]+$/ },
    // Both write a logo_url that the render worker later downloads. The routes
    // restrict it to this project's logo bucket; the session keeps anonymous
    // visitors from planting templates at all.
    { method: 'POST', pattern: /^\/api\/brand-templates$/ },
    { method: 'POST', pattern: /^\/api\/videos\/[^/]+\/brand-template$/ },
    // The AI workbench and per-scene image regeneration spend the free-tier
    // image quota and upload into the public scene-images bucket.
    { method: 'POST', pattern: /^\/api\/videos\/[^/]+\/workbench$/ },
    { method: 'POST', pattern: /^\/api\/videos\/[^/]+\/scenes\/[^/]+\/image$/ },
];

function needsSession(method: string, pathname: string): boolean {
    return PROTECTED_ROUTES.some((route) => route.method === method && route.pattern.test(pathname));
}

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const client = createSupabaseProxyClient(request);
    const guarded = LOGIN_REQUIRED && needsSession(request.method, pathname);

    // No Supabase configuration means no way to check anyone's identity:
    // the open parts keep working, the guarded ones fail closed.
    if (!client) {
        if (!guarded) return NextResponse.next();
        console.error('Supabase no esta configurado: no se puede verificar la sesion.');
        return NextResponse.json({ error: 'El servicio de autenticacion no esta disponible.' }, { status: 401 });
    }

    // getUser() runs for every request, not only the guarded ones, so a
    // signed-in session keeps getting its cookie refreshed while browsing.
    const { supabase, getResponse } = client;
    const { data: { user } } = await supabase.auth.getUser();

    if (guarded && !user) {
        return NextResponse.json({ error: SIGN_IN_REQUIRED_ERROR }, { status: 401 });
    }

    // Carries any refreshed session cookie the getUser() call above wrote.
    return getResponse();
}

export const config = {
    matcher: [
        // Everything except Next's own static/image pipeline and the static
        // files under public/ (icons, the manifest, the service worker,
        // svgs, generated audio). Redirecting those to /login would not be a
        // security hole - only signed-in requests carry the cookie that lets
        // real pages through anyway - but it does break the service worker
        // registration and the icons on the signed-out /login page itself.
        '/((?!_next/static|_next/image|favicon\\.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp3|wav)$).*)',
    ],
};
