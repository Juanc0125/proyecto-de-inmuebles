// The one message every guarded action answers with when nobody is signed in.
// The studio is open to anyone; only rendering, approving, deleting and
// uploading can be put behind a session - see proxy.ts for the full list and why.
import { NextResponse } from 'next/server';
import { createSupabaseRouteClient } from './supabase-server';

export const SIGN_IN_REQUIRED_ERROR = 'Inicia sesión para generar, aprobar, borrar o subir archivos.';

/**
 * Off by default since 13-oct-2026: the owner asked for free entry, approvals
 * included, while there is no paid engine switched on. RF-012 does not depend
 * on it - an approval is still a person pressing the button. Set
 * REQUIRE_LOGIN=true in Vercel to put the guarded actions back behind a
 * session, which is the first thing to do once HeyGen has a balance, since
 * every render and every spoken reply then costs money.
 */
export const LOGIN_REQUIRED = process.env.REQUIRE_LOGIN === 'true';

/**
 * For the guarded actions the proxy cannot see - the ones told apart only by
 * the request body. Returns a 401 response to send back, or null when there
 * is a signed-in user or login is not required. Fails closed when login is
 * required and Supabase is not configured.
 */
export async function requireSession(): Promise<NextResponse | null> {
    if (!LOGIN_REQUIRED) return null;
    const supabase = await createSupabaseRouteClient();
    const user = supabase ? (await supabase.auth.getUser()).data.user : null;
    return user ? null : NextResponse.json({ error: SIGN_IN_REQUIRED_ERROR }, { status: 401 });
}
