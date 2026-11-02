// End-to-end check of the whole studio against a running app: it creates a
// video, writes the script, splits it into scenes, edits one, brands it, walks
// the approval gate, renders asynchronously until a real MP4 lands in Supabase,
// publishes, duplicates, exercises the narrative templates, the brand templates,
// the batch route and the assistant, and finally deletes everything it made.
//
// It needs the app already running - `npm run dev` puts the web app on 3000 and
// the render worker on 8080 - and it talks to the real Supabase project, so it
// cleans up every record it creates. The render is a real render: allow a few
// minutes.
//
//   npm run e2e
//   E2E_WEB_URL=https://staging.example E2E_WORKER_URL=https://worker.example node scripts/e2e.mjs
//
// Exits non-zero when any check fails, so CI can gate on it.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const withoutTrailingSlash = (url) => url.replace(/\/+$/, '');

// The suite needs the account password, and it lives in .env.local like every
// other secret. Same precedence scripts/dev.mjs uses: apps/web first, the repo
// root last so the root wins.

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const archivo of [join(raiz, 'apps', 'web', '.env.local'), join(raiz, '.env.local')]) {
    let texto;
    try { texto = readFileSync(archivo, 'utf8'); } catch { continue; }
    for (const linea of texto.split('\n')) {
        const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && m[2].trim()) process.env[m[1]] = m[2].trim();
    }
}

const S = withoutTrailingSlash(process.env.E2E_WEB_URL ?? 'http://localhost:3000');
const W = withoutTrailingSlash(process.env.E2E_WORKER_URL ?? 'http://localhost:8080');

// The downloaded MP4 is proof the render is real, not a repo artifact: it goes
// to the system temp directory so a green run leaves the working tree clean.
const mp4Path = join(tmpdir(), 'stickman-qa.mp4');

const results = [];

function record(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'OK  ' : 'FALLA'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// The studio requires a session now, so the suite signs in like a person and
// carries the cookie on every later call.
// A jar keyed by name, not one flat string: Supabase rotates its auth cookie
// and sets it in chunks, so replacing the whole header with whatever the last
// response happened to send drops the rest of the session.
const cookieJar = new Map();
const cookieHeader = () => [...cookieJar].map(([k, v]) => `${k}=${v}`).join('; ');

async function api(path, options = {}, base = S) {
    const response = await fetch(base + path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(cookieJar.size && base === S ? { cookie: cookieHeader() } : {}),
            ...(options.headers ?? {}),
        },
    });
    for (const bruta of response.headers.getSetCookie?.() ?? []) {
        const [par] = bruta.split(';');
        const corte = par.indexOf('=');
        if (corte > 0) cookieJar.set(par.slice(0, corte).trim(), par.slice(corte + 1).trim());
    }
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let videoId = null;

// Every video the suite creates is tracked here and deleted in the final
// `finally`, so a check that throws halfway never leaves test data behind in
// the shared Supabase project.
const createdIds = new Set();
const track = (id) => { if (id) createdIds.add(id); return id; };
async function removeVideo(id) {
    if (!id) return null;
    const res = await api(`/api/videos/${id}`, { method: 'DELETE' });
    if (res.status === 204 || res.status === 404) createdIds.delete(id);
    return res;
}
// Same for brand templates.
const createdTemplateIds = new Set();
async function removeTemplate(id) {
    if (!id) return null;
    const res = await api(`/api/brand-templates/${id}`, { method: 'DELETE' });
    if (res.status === 204 || res.status === 404) createdTemplateIds.delete(id);
    return res;
}

console.log(`web=${S}  worker=${W}\n`);

// Credentials come from the environment, never from this file: the suite
// signs in with the same account a person uses.
const E2E_EMAIL = process.env.E2E_EMAIL ?? 'demo@stickman.local';
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? process.env.DEMO_USER_PASSWORD ?? '';


const entrada = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: E2E_EMAIL, password: E2E_PASSWORD }) });
record('iniciar sesion', entrada.status === 200 && cookieJar.size > 0,
    entrada.status === 200 ? `sesion abierta como ${E2E_EMAIL}` : `HTTP ${entrada.status} - revisa E2E_PASSWORD o DEMO_USER_PASSWORD`);

// The studio is open to visitors. Whether rendering, approving and deleting
// also need a session depends on REQUIRE_LOGIN (see lib/sign-in-required.ts),
// so the suite is told which to expect with E2E_REQUIRE_LOGIN=true. The
// guarded calls target a made-up id: with login required they stop at 401,
// without it they reach the route and find nothing (404) - anything else
// means the guard is not doing what the setting says.
const visitante = await fetch(`${S}/api/videos`);
record('un visitante puede leer sin sesion', visitante.status === 200, `HTTP ${visitante.status}`);
const ID_FALSO = '00000000-0000-0000-0000-000000000000';
const ESPERADO = process.env.E2E_REQUIRE_LOGIN === 'true' ? 401 : 404;
const renderSinSesion = await fetch(`${S}/api/videos/${ID_FALSO}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'render' }) });
const aprobarSinSesion = await fetch(`${S}/api/videos/${ID_FALSO}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) });
const borrarSinSesion = await fetch(`${S}/api/videos/${ID_FALSO}`, { method: 'DELETE' });
record(ESPERADO === 401 ? 'sin sesion no se genera, aprueba ni borra' : 'sin login, generar/aprobar/borrar llegan a la ruta',
    renderSinSesion.status === ESPERADO && aprobarSinSesion.status === ESPERADO && borrarSinSesion.status === ESPERADO,
    `render ${renderSinSesion.status}, aprobar ${aprobarSinSesion.status}, borrar ${borrarSinSesion.status} (esperado ${ESPERADO})`);

try {
    // 1. health
    const health = await api('/health', {}, W);
    record('worker /health', health.status === 200 && health.body?.ok === true,
        `storage=${health.body?.storage} engine=${health.body?.video_engine}`);

    // Step 8 runs a real render. If the worker has FAL_KEY set it generates
    // every scene through fal.ai, which bills per second of video - a full
    // suite run would quietly cost real money, and it reruns often. The
    // worker's own /health is the only honest source here: this process's
    // environment says nothing about how the worker was started.
    const engine = health.body?.video_engine;
    if (engine && engine !== 'canvas' && process.env.E2E_ALLOW_PAID_RENDER !== '1') {
        console.error(
            `\nABORTADO antes de crear nada: el worker esta usando "${engine}", no canvas.\n`
            + 'La suite hace un render de verdad, asi que esto generaria video pagado en fal.\n\n'
            + 'Elige una:\n'
            + '  - Levanta el worker sin FAL_KEY (asi renderiza con canvas y no cuesta nada).\n'
            + '  - Si de verdad quieres pagar esta corrida: E2E_ALLOW_PAID_RENDER=1 npm run e2e\n',
        );
        process.exitCode = 1;
        process.exit();
    }

    const list = await api('/api/videos');
    record('GET /api/videos', list.status === 200 && Array.isArray(list.body?.videos),
        `${list.body?.videos?.length} videos`);

    // 2. create. POST /api/videos takes camelCase targetDurationSeconds (the
    // batch route takes snake_case); an unknown key is silently ignored and
    // the video falls back to 30 s, so the stored value is asserted too.
    const created = await api('/api/videos', {
        method: 'POST',
        body: JSON.stringify({ topic: 'QA end to end', platform: 'reels', targetDurationSeconds: 12 }),
    });
    videoId = track(created.body?.video?.id);
    record('crear video', created.status === 201 && !!videoId && created.body?.video?.target_duration_seconds === 12,
        `duracion=${created.body?.video?.target_duration_seconds}s, `
        + (created.body?.video?.script ? `guion de ${created.body.video.script.length} chars` : 'sin guion'));

    // Target duration is capped at 180 s.
    const tooLong = await api('/api/videos', {
        method: 'POST',
        body: JSON.stringify({ topic: 'QA duracion excesiva', platform: 'reels', targetDurationSeconds: 500 }),
    });
    track(tooLong.body?.video?.id);
    record('duracion objetivo de 500 s se rechaza', tooLong.status === 400, `HTTP ${tooLong.status}`);
    await removeVideo(tooLong.body?.video?.id);

    // 3. scenes
    const scenes = await api(`/api/videos/${videoId}/scenes`, { method: 'POST' });
    const sceneList = scenes.body?.video?.scenes ?? [];
    record('generar escenas', scenes.status === 200 && sceneList.length > 0, `${sceneList.length} escenas`);

    // 4. edit a scene
    const first = [...sceneList].sort((a, b) => a.order - b.order)[0];
    const edited = await api(`/api/videos/${videoId}/scenes/${first.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ character: 'broker', action: 'caminar', prop: 'casa' }),
    });
    const e1 = edited.body?.video?.scenes?.find((s) => s.id === first.id);
    record('editar escena', edited.status === 200 && e1?.action === 'caminar' && e1?.prop === 'casa',
        `${e1?.character}/${e1?.action}/${e1?.prop}`);

    // Scene durations are clamped to 2-10 s; a manual edit outside that range
    // must be refused, and the stored scene must keep its old duration.
    const longScene = await api(`/api/videos/${videoId}/scenes/${first.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ duration_seconds: 50 }),
    });
    const afterLong = (await api('/api/videos')).body?.videos?.find((x) => x.id === videoId)?.scenes?.find((sc) => sc.id === first.id);
    record('duracion de escena 50 s se rechaza', longScene.status === 400 && afterLong?.duration_seconds === first.duration_seconds,
        `HTTP ${longScene.status}, guardada=${afterLong?.duration_seconds} (antes ${first.duration_seconds})`);

    // 4b. sounds (RF-010). Background music was removed from the product:
    // only per-scene sound effects remain. The catalog must list effects only,
    // a music upload must be refused before anything is stored, the music
    // route must be gone and a video must no longer carry a music field.
    const sounds = await api('/api/sounds');
    const soundList = Array.isArray(sounds.body?.sonidos) ? sounds.body.sonidos : [];
    const notEffects = soundList.filter((s) => s.kind !== 'efecto');
    record('catalogo de sonidos solo trae efectos', sounds.status === 200 && soundList.length > 0 && notEffects.length === 0,
        `HTTP ${sounds.status}, ${soundList.length} sonidos, ${notEffects.length} que no son efecto`);

    const musicUpload = await api('/api/sounds', {
        method: 'POST',
        body: JSON.stringify({ name: 'QA musica', kind: 'musica', path: 'subidos/qa-no-existe.mp3', licencia: 'QA' }),
    });
    if (musicUpload.status === 201 && musicUpload.body?.sonido?.id) {
        await api(`/api/sounds/${encodeURIComponent(musicUpload.body.sonido.id)}`, { method: 'DELETE' });
    }
    record('subir musica se rechaza', musicUpload.status === 400, `HTTP ${musicUpload.status} ${musicUpload.body?.error ?? ''}`);

    const musicRoute = await api(`/api/videos/${videoId}/music`, { method: 'PATCH', body: JSON.stringify({ music_id: 'biblioteca:calma' }) });
    const storedVideo = (await api('/api/videos')).body?.videos?.find((x) => x.id === videoId);
    record('la ruta de musica ya no existe', (musicRoute.status === 404 || musicRoute.status === 405)
        && !!storedVideo && !('music_id' in storedVideo),
        `PATCH /music HTTP ${musicRoute.status}, music_id en el video: ${storedVideo ? 'music_id' in storedVideo : 'video no encontrado'}`);

    // Sound effects stay: one can be put on a scene and taken off again, and
    // the stored scene is what gets asserted.
    const effectId = soundList.find((s) => s.kind === 'efecto')?.id;
    const withEffect = await api(`/api/videos/${videoId}/scenes/${first.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ sound_effect_id: effectId }),
    });
    const storedWith = (await api('/api/videos')).body?.videos?.find((x) => x.id === videoId)?.scenes?.find((sc) => sc.id === first.id);
    const withoutEffect = await api(`/api/videos/${videoId}/scenes/${first.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ sound_effect_id: null }),
    });
    const storedWithout = (await api('/api/videos')).body?.videos?.find((x) => x.id === videoId)?.scenes?.find((sc) => sc.id === first.id);
    record('efecto de sonido en una escena', !!effectId && withEffect.status === 200 && storedWith?.sound_effect_id === effectId
        && withoutEffect.status === 200 && storedWithout?.sound_effect_id === null,
        `poner ${withEffect.status} (${storedWith?.sound_effect_id}), quitar ${withoutEffect.status} (${storedWithout?.sound_effect_id})`);

    // 5. manual script edit
    const script = await api(`/api/videos/${videoId}`, {
        method: 'PATCH',
        body: JSON.stringify({ script: 'Guion editado a mano por la prueba automatica.' }),
    });
    record('editar guion', script.status === 200 && script.body?.video?.script?.includes('editado a mano'));

    // 6. branding, including the typeface that used to be ignored
    const branding = await api(`/api/videos/${videoId}/branding`, {
        method: 'PATCH',
        body: JSON.stringify({ font_family: 'serif', primary_color: '#1b2a3a' }),
    });
    record('branding (tipografia + color)', branding.status === 200
        && branding.body?.video?.branding?.font_family === 'serif'
        && branding.body?.video?.branding?.primary_color === '#1b2a3a');

    // 7. approval gate
    const submit = await api(`/api/videos/${videoId}`, { method: 'PATCH', body: JSON.stringify({ action: 'submit' }) });
    record('enviar a aprobacion', submit.body?.video?.status === 'pendiente_aprobacion');

    const earlyRender = await api(`/api/videos/${videoId}`, { method: 'PATCH', body: JSON.stringify({ action: 'render' }) });
    record('render bloqueado sin aprobar', earlyRender.status >= 400, `HTTP ${earlyRender.status}`);

    const approve = await api(`/api/videos/${videoId}`, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) });
    record('aprobar', approve.body?.video?.status === 'aprobado');

    // 8. async render with progress
    const started = Date.now();
    const render = await api(`/api/videos/${videoId}`, { method: 'PATCH', body: JSON.stringify({ action: 'render' }) });
    record('render devuelve al instante', render.status === 200 && Date.now() - started < 5000,
        `${Date.now() - started}ms, estado=${render.body?.video?.render_status}`);

    // The web claims the render slot atomically: a second click while the
    // first render runs must be refused, not sent to the worker again.
    const secondRender = await api(`/api/videos/${videoId}`, { method: 'PATCH', body: JSON.stringify({ action: 'render' }) });
    record('segundo render simultaneo da 409', secondRender.status === 409,
        `HTTP ${secondRender.status} ${secondRender.body?.error ?? ''}`);

    // A poll that comes back without the video (a transient 500, a list that
    // briefly misses it) is retried a few times before the suite gives up with
    // a clear message instead of a TypeError.
    let seenProgress = false, final = null, misses = 0, lastMiss = '';
    for (let i = 0; i < 160; i += 1) {
        await sleep(1000);
        const poll = await api('/api/videos');
        const v = Array.isArray(poll.body?.videos) ? poll.body.videos.find((x) => x.id === videoId) : undefined;
        if (!v) {
            misses += 1;
            lastMiss = `HTTP ${poll.status}, ${Array.isArray(poll.body?.videos) ? 'el video no aparece en la lista' : 'respuesta sin lista de videos'}`;
            if (misses >= 5) break;
            continue;
        }
        misses = 0;
        if (v.render_progress > 0 && v.render_progress < 100) seenProgress = true;
        if (v.render_status === 'listo' || v.render_status === 'error') { final = v; break; }
    }
    record('render termina', final?.render_status === 'listo',
        final ? `estado=${final.render_status} error=${final.render_error ?? 'ninguno'}`
            : misses >= 5 ? `el sondeo no encontro el video 5 veces seguidas (${lastMiss})` : 'no termino en 160 s');
    record('progreso intermedio visible', seenProgress);
    record('URL en Supabase', !!final?.video_url?.includes('supabase.co'), final?.video_url?.slice(0, 60));

    // 9. the file itself
    if (final?.video_url) {
        const head = await fetch(final.video_url);
        const buf = Buffer.from(await head.arrayBuffer());
        writeFileSync(mp4Path, buf);
        record('MP4 descargable', head.ok && buf.length > 10000,
            `${head.status}, ${(buf.length / 1024).toFixed(0)} KB, ${head.headers.get('content-type')} -> ${mp4Path}`);
    }

    // 10. publish
    const publish = await api(`/api/videos/${videoId}`, { method: 'PATCH', body: JSON.stringify({ action: 'publish' }) });
    record('publicar', publish.body?.video?.status === 'publicado');

    // 11. reuse across platforms
    const dup = await api(`/api/videos/${videoId}/duplicate`, { method: 'POST', body: JSON.stringify({ platform: 'tiktok' }) });
    const dupId = track(dup.body?.video?.id);
    record('duplicar a otra plataforma', dup.status === 201 && dup.body?.video?.platform === 'tiktok'
        && dup.body?.video?.status === 'borrador', `escenas copiadas: ${dup.body?.video?.scenes?.length}`);
    await removeVideo(dupId);

    // 12. assistant
    const a1 = await api('/api/assistant', {
        method: 'POST',
        body: JSON.stringify({ message: 'crea un video sobre plazos del credito para shorts', context: { total: 1, porEstado: {}, seleccionado: null } }),
    });
    record('asistente entiende "crear"', a1.body?.action?.kind === 'crear' && a1.body?.action?.platform === 'shorts');

    const a2 = await api('/api/assistant', {
        method: 'POST',
        body: JSON.stringify({ message: 'aprueba y publica este video', context: { total: 1, porEstado: {}, seleccionado: null } }),
    });
    record('asistente RECHAZA aprobar', a2.body?.action?.kind === 'rechazado');

    const a3 = await api('/api/assistant', {
        method: 'POST',
        body: JSON.stringify({ message: 'en la escena 3 que la pareja hable con un banco', context: { total: 1, porEstado: {}, seleccionado: null } }),
    });
    record('asistente entiende editar escena',
        a3.body?.action?.kind === 'editar_escena' && a3.body?.action?.sceneNumber === 3 && a3.body?.action?.prop === 'banco');

    // 14. plantillas (RF-019)
    const tpl = await api('/api/videos', {
        method: 'POST',
        body: JSON.stringify({ topic: 'QA plantilla llamada', platform: 'reels', targetDurationSeconds: 12, template: 'llamada' }),
    });
    const tplId = track(tpl.body?.video?.id);
    record('crear con plantilla', tpl.status === 201 && tpl.body?.video?.template === 'llamada',
        `template=${tpl.body?.video?.template}`);

    if (tplId) {
        const tplScenes = await api(`/api/videos/${tplId}/scenes`, { method: 'POST' });
        const list2 = [...(tplScenes.body?.video?.scenes ?? [])].sort((a, b) => a.order - b.order);
        const first2 = list2[0];
        const last2 = list2[list2.length - 1];
        // The 'llamada' template has to put a phone call on screen. Which
        // character ends the story is the planner's business - and with a model
        // answering it stages it differently from the keyword fallback, which
        // is the point of having one.
        const conTelefono = list2.filter((s) => s.action === 'telefono' || s.prop === 'telefono').length;
        record('la plantilla monta las escenas', list2.length > 0 && conTelefono > 0,
            `${list2.length} escenas, ${conTelefono} con telefono; 1a=${first2?.character}/${first2?.action}/${first2?.prop}`);

        const dup2 = await api(`/api/videos/${tplId}/duplicate`, { method: 'POST', body: JSON.stringify({ platform: 'tiktok' }) });
        track(dup2.body?.video?.id);
        record('duplicar conserva la plantilla', dup2.body?.video?.template === 'llamada', `template=${dup2.body?.video?.template}`);
        await removeVideo(dup2.body?.video?.id);

        await removeVideo(tplId);
    }

    const bad = await api('/api/videos', {
        method: 'POST',
        body: JSON.stringify({ topic: 'QA plantilla invalida', platform: 'reels', targetDurationSeconds: 12, template: 'inventada' }),
    });
    record('plantilla desconocida cae en libre', bad.status === 201 && bad.body?.video?.template === 'libre',
        `template=${bad.body?.video?.template}`);
    await removeVideo(track(bad.body?.video?.id));

    const a4 = await api('/api/assistant', {
        method: 'POST',
        body: JSON.stringify({ message: 'crea un video sobre la cuota inicial en formato conversacion', context: { total: 1, porEstado: {}, seleccionado: null } }),
    });
    record('asistente entiende la plantilla',
        a4.body?.action?.kind === 'crear' && a4.body?.action?.template === 'conversacion',
        `template=${a4.body?.action?.template} tema="${a4.body?.action?.topic}"`);

    // 15. plantillas de marca (RF-028)
    const brandA = await api('/api/videos', {
        method: 'POST',
        body: JSON.stringify({ topic: 'QA marca origen', platform: 'reels', targetDurationSeconds: 12 }),
    });
    const brandB = await api('/api/videos', {
        method: 'POST',
        body: JSON.stringify({ topic: 'QA marca destino', platform: 'reels', targetDurationSeconds: 12 }),
    });
    const aId = track(brandA.body?.video?.id);
    const bId = track(brandB.body?.video?.id);

    // RF-012: an approval covers the content as it was. Editing an approved
    // video must send it back to 'borrador' - asserted on the stored record,
    // not only on the reply.
    await api(`/api/videos/${aId}`, { method: 'PATCH', body: JSON.stringify({ action: 'submit' }) });
    const approvedA = await api(`/api/videos/${aId}`, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) });
    const editedA = await api(`/api/videos/${aId}`, { method: 'PATCH', body: JSON.stringify({ script: 'Guion cambiado despues de aprobar.' }) });
    const storedA = (await api('/api/videos')).body?.videos?.find((x) => x.id === aId);
    record('editar un video aprobado lo devuelve a borrador', approvedA.body?.video?.status === 'aprobado'
        && editedA.status === 200 && editedA.body?.video?.status === 'borrador' && storedA?.status === 'borrador',
        `aprobado=${approvedA.body?.video?.status} respuesta=${editedA.body?.video?.status} guardado=${storedA?.status}`);

    await api(`/api/videos/${aId}/branding`, {
        method: 'PATCH',
        body: JSON.stringify({ primary_color: '#0a3d2f', secondary_color: '#f5c542', font_family: 'mono', logo_position: 'bottom-left' }),
    });

    const savedTpl = await api('/api/brand-templates', {
        method: 'POST',
        body: JSON.stringify({ name: 'QA marca del negocio', video_id: aId }),
    });
    const brandTplId = savedTpl.body?.template?.id;
    if (brandTplId) createdTemplateIds.add(brandTplId);
    record('guardar plantilla de marca', savedTpl.status === 201 && !!brandTplId
        && savedTpl.body?.template?.branding?.primary_color === '#0a3d2f',
        `${savedTpl.body?.template?.name} / ${savedTpl.body?.template?.branding?.font_family}`);

    const tplList = await api('/api/brand-templates');
    record('listar plantillas de marca', tplList.status === 200
        && (tplList.body?.templates ?? []).some((t) => t.id === brandTplId),
        `${tplList.body?.templates?.length} plantillas`);

    const applied = await api(`/api/videos/${bId}/brand-template`, {
        method: 'POST',
        body: JSON.stringify({ template_id: brandTplId }),
    });
    const ab = applied.body?.video?.branding;
    record('aplicar plantilla a otro video', applied.status === 200
        && ab?.primary_color === '#0a3d2f' && ab?.secondary_color === '#f5c542'
        && ab?.font_family === 'mono' && ab?.logo_position === 'bottom-left',
        `${ab?.primary_color}/${ab?.font_family}/${ab?.logo_position}`);

    const missingTpl = await api(`/api/videos/${bId}/brand-template`, {
        method: 'POST',
        body: JSON.stringify({ template_id: '00000000-0000-0000-0000-000000000000' }),
    });
    record('plantilla de marca inexistente da 404', missingTpl.status === 404, `HTTP ${missingTpl.status}`);

    const noName = await api('/api/brand-templates', { method: 'POST', body: JSON.stringify({ video_id: aId }) });
    record('plantilla de marca sin nombre se rechaza', noName.status === 400, `HTTP ${noName.status}`);

    const delTpl = await removeTemplate(brandTplId);
    const afterTpl = await api('/api/brand-templates');
    record('eliminar plantilla de marca', delTpl.status === 204
        && !(afterTpl.body?.templates ?? []).some((t) => t.id === brandTplId));

    await removeVideo(aId);
    await removeVideo(bId);

    // 16. lote de videos (RF-024). Two real topics plus a repeat and a blank,
    // which the route drops quietly. Warnings are fine here - the free model
    // tier may be saturated by now - but every topic must become a draft, and
    // RF-012 says none of them may come out approved or rendering.
    const batch = await api('/api/videos/batch', {
        method: 'POST',
        body: JSON.stringify({
            temas: ['QA lote refinanciar', 'QA lote primera vivienda', 'qa lote refinanciar', '  '],
            platform: 'tiktok',
            target_duration_seconds: 12,
            template: 'explicacion',
            con_escenas: true,
        }),
    });
    const creados = batch.body?.creados ?? [];
    creados.forEach((v) => track(v.id));
    try {
        record('lote crea un borrador por tema', batch.status === 200 && creados.length === 2
            && (batch.body?.fallidos ?? []).length === 0
            && creados.every((v) => v.platform === 'tiktok' && v.template === 'explicacion'),
            `creados=${creados.length} fallidos=${batch.body?.fallidos?.length} advertencias=${batch.body?.advertencias?.length}`);
        record('lote no aprueba ni renderiza (RF-012)', creados.length > 0
            && creados.every((v) => v.status === 'borrador' && v.render_status === 'inactivo' && !v.video_url),
            creados.map((v) => `${v.status}/${v.render_status}`).join(', '));

        const tooMany = await api('/api/videos/batch', {
            method: 'POST',
            body: JSON.stringify({ temas: Array.from({ length: 9 }, (_, i) => `QA tema ${i}`) }),
        });
        const noTopics = await api('/api/videos/batch', { method: 'POST', body: JSON.stringify({ temas: ['', ' '] }) });
        const badPlatform = await api('/api/videos/batch', {
            method: 'POST',
            body: JSON.stringify({ temas: ['QA tema'], platform: 'facebook' }),
        });
        record('lote rechaza entradas invalidas', tooMany.status === 400 && noTopics.status === 400 && badPlatform.status === 400,
            `9 temas=${tooMany.status} vacio=${noTopics.status} plataforma=${badPlatform.status}`);
    } finally {
        for (const v of creados) await removeVideo(v.id);
    }

    // 13. delete
    const del = await removeVideo(videoId);
    const after = await api('/api/videos');
    record('eliminar video', del.status === 204 && !after.body.videos.some((v) => v.id === videoId));
    videoId = null;
} catch (error) {
    record('EXCEPCION', false, error.message);
} finally {
    // Whatever a failed check left behind goes now.
    for (const id of [...createdTemplateIds]) await removeTemplate(id).catch(() => {});
    if (createdTemplateIds.size) console.log(`AVISO: no se pudieron borrar ${createdTemplateIds.size} plantillas de marca de prueba: ${[...createdTemplateIds].join(', ')}`);
    for (const id of [...createdIds]) await removeVideo(id).catch(() => {});
    if (createdIds.size) console.log(`AVISO: no se pudieron borrar ${createdIds.size} videos de prueba: ${[...createdIds].join(', ')}`);
}

const fail = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - fail.length}/${results.length} pruebas OK ===`);
if (fail.length) fail.forEach((f) => console.log(`  FALLA: ${f.name} — ${f.detail ?? ''}`));

// process.exit() while fetch sockets are still closing trips a libuv assertion
// on Windows; setting the code lets Node drain and exit on its own.
process.exitCode = fail.length > 0 ? 1 : 0;
