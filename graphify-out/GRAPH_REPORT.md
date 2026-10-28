# Graph Report - stickman-video-app  (2026-10-28)

## Corpus Check
- 128 files · ~110,924 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: (none) 3, .example 2, .ico 1)

## Summary
- 1085 nodes · 2016 edges · 94 communities (62 shown, 32 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 39 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9c7dbc61`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- api.ts
- sound-panel.tsx
- copilot.ts
- Verificar: la puerta de calidad
- web/package.json
- drawing.ts
- index.ts
- scripts
- assistant.ts
- compilerOptions
- Agente lider de Stickman
- ref_node_fs
- video-studio.tsx
- Los dos servicios se comunican solo por HTTP y no comparten codigo
- apps/web/app/components
- Migraciones append-only
- set-ai-key.mjs
- brand-templates.ts
- video-persistence.ts
- make-backdrop.mjs
- Variables de entorno del proyecto
- graphify-out (grafo, reporte y cache)
- compilerOptions
- e2e.mjs
- ai-video.ts
- react
- heygen.ts
- [sceneId]/route.ts
- dev.mjs
- Render asincrono: POST /render responde 202 y procesa en segundo plano
- tsconfig.check.json
- 20260910000000_initial_schema.sql
- schema.sql
- scenes/route.ts
- sign-in-required.ts
- elevenlabs.ts
- Stickman PWA Icon 192
- web/vercel.json
- public.brand_templates
- vercel.json
- next
- create-next-app Boilerplate README
- npm run verify (lint + typecheck + build)
- Next.js Agent Rules Block
- postcss.config.mjs
- .mcp.json
- 20260917000000_properties.sql
- public.scenes
- public.videos
- public.videos
- public.videos
- public.videos
- render-worker/package.json
- voice.ts
- video-list.tsx
- getSupabaseClient
- scene-panel.tsx
- Desplegar y comprobar
- layout.tsx
- assistant.tsx
- grafo-pendiente.mjs
- plugin.json
- batch/route.ts
- dependencies
- frontend-agent.md
- graphify-agent.md
- SceneRow
- tts/route.ts
- devops-agent.md
- qa-agent.md
- render-worker-agent.md
- Sin Supabase la app funciona con almacenamiento en memoria
- App shell de web (layout.tsx, page.tsx, globals.css, manifest.ts)
- apps/web/lib
- Configuracion de build y despliegue (package.json, workflows, vercel.json, .mcp.json)
- scripts/check-ai.mjs (que proveedor de lenguaje responde)
- Hoy ningun proveedor de lenguaje responde; el copiloto cae al modo basico por palabras clave
- npm run dev (web en 3000 y worker en 8080)
- packages/shared-types
- scripts/e2e.mjs y la suite de pruebas
- Instalacion como aplicacion (manifiesto y service worker que cachea solo el armazon)
- supabase/migrations (esquema de la base de datos)
- Platform
- scripts
- constants.ts
- videos/[id]/route.ts
- templates.ts
- speak/route.ts

## God Nodes (most connected - your core abstractions)
1. `getSupabaseClient()` - 24 edges
2. `render()` - 24 edges
3. `next` - 23 edges
4. `getVideo()` - 22 edges
5. `getTemplate()` - 20 edges
6. `generateWithFallback()` - 18 edges
7. `Assistant()` - 18 edges
8. `VideoRecord` - 17 edges
9. `toVideoRecord()` - 17 edges
10. `readText()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `What is already there` --references--> `generateWithFallback()`  [INFERRED]
  plugin/agents/backend-agent.md → apps/web/lib/ai-provider.ts
- `Before you finish` --references--> `drawSceneFrame()`  [INFERRED]
  plugin/agents/render-worker-agent.md → apps/render-worker/drawing.ts
- `Before you finish` --references--> `createFrameCanvas()`  [INFERRED]
  plugin/agents/render-worker-agent.md → apps/render-worker/drawing.ts
- `toVideoRecord()` --calls--> `getTemplate()`  [EXTRACTED]
  apps/web/lib/video-persistence.ts → packages/shared-types/templates.ts
- `VideoList()` --calls--> `getTemplate()`  [EXTRACTED]
  apps/web/app/components/video-list.tsx → packages/shared-types/templates.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Stickman PWA Icon Set (192 / 512 / maskable / apple-touch)** — apps_web_public_icons_icon_192_stickman_icon, apps_web_public_icons_icon_512_stickman_icon, apps_web_public_icons_icon_maskable_512_stickman_icon, apps_web_public_icons_apple_touch_icon_stickman_icon [INFERRED 0.95]

## Communities (94 total, 32 thin omitted)

### Community 0 - "api.ts"
Cohesion: 0.18
Nodes (21): applyBrandTemplate(), BatchCreateResult, BrandingPatch, deleteBrandTemplate(), fetchSession(), JSON_HEADERS, request(), requestSoundUpload() (+13 more)

### Community 1 - "sound-panel.tsx"
Cohesion: 0.11
Nodes (21): deleteSound(), fetchVideos(), registerSound(), setVideoMusic(), uploadSoundFile(), BusinessSounds(), handleDelete(), handleFileChange() (+13 more)

### Community 2 - "copilot.ts"
Cohesion: 0.06
Nodes (80): POST(), apps_web_app_api_videos_id_music_route, apps_web_app_api_videos_id_music_route_patch, isCopilotConfigured(), abrirVideo(), ACTIONS, aplicarBranding(), aplicarMarca() (+72 more)

### Community 3 - "Verificar: la puerta de calidad"
Cohesion: 0.17
Nodes (11): 1. Liberar los puertos, 2. Borrar la salida del build anterior, 3. Verificar, 4. Revisar que el `.gitignore` no se haya ensuciado, 5. Levantar el entorno para la suite, 6. Comprobar que la suite no va a gastar dinero, 7. La suite end-to-end, 8. Retroalimentar el grafo (+3 more)

### Community 4 - "web/package.json"
Cohesion: 0.05
Nodes (38): eslintConfig, dependencies, next, react, react-dom, @supabase/supabase-js, devDependencies, autoprefixer (+30 more)

### Community 5 - "drawing.ts"
Cohesion: 0.08
Nodes (47): CAMERA_PROFILES, cameraFor(), CameraProfile, clamp(), drawBackground(), drawFigure(), drawHand(), drawHead() (+39 more)

### Community 6 - "index.ts"
Cohesion: 0.08
Nodes (41): Exact, CharacterType, SceneAction, ScenePropType, elevenlabsMissingConfig(), elevenlabsVoiceLabel(), heygenMissingConfig(), isHeygenEnabled() (+33 more)

### Community 7 - "scripts"
Cohesion: 0.08
Nodes (25): dependencies, next, react, react-dom, name, private, scripts, build (+17 more)

### Community 8 - "assistant.ts"
Cohesion: 0.11
Nodes (24): POST(), ABOUT_APPROVAL, ACTION_WORDS, AssistantAction, AssistantContext, AssistantReply, BrandPatch, CHARACTER_WORDS (+16 more)

### Community 9 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 10 - "Agente lider de Stickman"
Cohesion: 0.12
Nodes (18): Politica de delegacion por dominio, Delegacion en orden cuando hay dependencias (backend fija el contrato, frontend lo consume), Trampa EPERM: apps/web/.next tomado por el dev server u OneDrive, Agente lider de Stickman, Sin asesoria financiera personalizada ni tasas inventadas, No inventar funcionalidad fuera de la tabla de requerimientos, Alcances de archivo sin solape entre agentes, npm run verify (lint + build de ambos workspaces) (+10 more)

### Community 11 - "ref_node_fs"
Cohesion: 0.12
Nodes (11): key, nextConfig, rootEnvPath, ref_node_fs, ref_node_path, ref_node_process, ref_node_url, MODELS (+3 more)

### Community 12 - "video-studio.tsx"
Cohesion: 0.21
Nodes (7): logout(), SIGN_IN_REQUIRED_EVENT, RevealRequest, VideoStudio(), handleCreated(), handleLogout(), selectVideo()

### Community 13 - "Los dos servicios se comunican solo por HTTP y no comparten codigo"
Cohesion: 0.50
Nodes (4): apps/render-worker, apps/web/app/api (rutas de API), Deuda: el render worker redeclara los tipos del dominio en vez de importar shared-types, Los dos servicios se comunican solo por HTTP y no comparten codigo

### Community 16 - "set-ai-key.mjs"
Cohesion: 0.14
Nodes (19): ref_node_readline, Cancelled, createSession(), question(), ENV_FILE, envFileIsIgnored(), lastLine(), main() (+11 more)

### Community 17 - "brand-templates.ts"
Cohesion: 0.21
Nodes (15): coerceBranding(), CreateBody, GET(), LOGO_POSITIONS, POST(), createBrandTemplate(), DatabaseRow, listBrandTemplates() (+7 more)

### Community 18 - "video-persistence.ts"
Cohesion: 0.17
Nodes (20): globalStore, transitions, videos, DatabaseRow, markStalledRenders(), nullableString(), readFromSupabase(), SceneInput (+12 more)

### Community 19 - "make-backdrop.mjs"
Cohesion: 0.18
Nodes (10): @napi-rs/canvas, base, blooms, buffer, canvas, ctx, image, OUT (+2 more)

### Community 20 - "Variables de entorno del proyecto"
Cohesion: 0.67
Nodes (3): Ninguna clave en un archivo versionado, Variables de entorno del proyecto, Formatos validos de clave de Supabase (sb_publishable_ y sb_secret_)

### Community 22 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, allowSyntheticDefaultImports, esModuleInterop, module, moduleResolution, outDir, skipLibCheck, strict (+2 more)

### Community 23 - "e2e.mjs"
Cohesion: 0.12
Nodes (14): ref_node_os, api(), cookieHeader(), cookieJar, createdIds, createdTemplateIds, fail, mp4Path (+6 more)

### Community 24 - "ai-video.ts"
Cohesion: 0.18
Nodes (12): ACTION_VERBS, aiVideoModel(), buildScenePrompt(), CHARACTER_SUBJECTS, extractVideoUrl(), FAL_KEY, falFetch(), generateSceneVideo() (+4 more)

### Community 25 - "react"
Cohesion: 0.18
Nodes (11): login(), saveScript(), LoginForm(), handleSubmit(), ScriptPanel(), handleSave(), ScriptPanelProps, PATHS (+3 more)

### Community 26 - "heygen.ts"
Cohesion: 0.18
Nodes (15): API_KEY, AVATAR_ID, AvatarClip, AvatarScene, ENGINE, heygenError(), heygenFetch(), sleep() (+7 more)

### Community 27 - "[sceneId]/route.ts"
Cohesion: 0.18
Nodes (18): ACTIONS, buildRegenerateSystemPrompt(), CHARACTERS, coerceAction(), coerceCharacter(), coerceDescription(), coerceProp(), DELETE() (+10 more)

### Community 28 - "dev.mjs"
Cohesion: 0.18
Nodes (9): ref_node_child_process, children, envFiles, loaded, repoRoot, shutdown(), start(), args (+1 more)

### Community 30 - "tsconfig.check.json"
Cohesion: 0.33
Nodes (5): compilerOptions, noEmit, extends, include, ./tsconfig.json

### Community 31 - "20260910000000_initial_schema.sql"
Cohesion: 0.53
Nodes (5): public.scenes, public.videos, scenes_video_id_order_idx, auth.users, videos_user_id_created_at_idx

### Community 32 - "schema.sql"
Cohesion: 0.53
Nodes (5): public.scenes, public.videos, scenes_video_id_order_idx, auth.users, videos_user_id_created_at_idx

### Community 33 - "scenes/route.ts"
Cohesion: 0.05
Nodes (52): ACTIONS, buildScenesFromAiJson(), buildSentenceFallback(), buildSystemPrompt(), CHARACTERS, coerceAction(), coerceCharacter(), coerceDescription() (+44 more)

### Community 34 - "sign-in-required.ts"
Cohesion: 0.25
Nodes (9): LOGIN_REQUIRED, SIGN_IN_REQUIRED_ERROR, apps_web_lib_supabase_server, apps_web_lib_supabase_server_createsupabaseproxyclient, apps_web_lib_supabase_server_createsupabaserouteclient, config, needsSession(), PROTECTED_ROUTES (+1 more)

### Community 35 - "elevenlabs.ts"
Cohesion: 0.14
Nodes (18): Alignment, API_KEY, CACHE_DIR, CachedSpeech, cachePath(), decodePcm(), elevenlabsSpeak(), ElevenlabsSpeech (+10 more)

### Community 36 - "Stickman PWA Icon 192"
Cohesion: 0.50
Nodes (4): Stickman Apple Touch Icon, Stickman PWA Icon 192, Stickman PWA Icon 512, Stickman Maskable Icon 512

### Community 37 - "web/vercel.json"
Cohesion: 0.50
Nodes (3): buildCommand, framework, installCommand

### Community 38 - "public.brand_templates"
Cohesion: 0.67
Nodes (3): brand_templates_user_id_idx, public.brand_templates, auth.users

### Community 39 - "vercel.json"
Cohesion: 0.40
Nodes (4): buildCommand, crons, framework, installCommand

### Community 40 - "next"
Cohesion: 0.22
Nodes (5): DELETE(), RouteContext, EXTENSIONS, deleteBrandTemplate(), next

### Community 57 - "render-worker/package.json"
Cohesion: 0.12
Nodes (16): devDependencies, tsx, @types/node, @types/tar-stream, typescript, name, private, version (+8 more)

### Community 58 - "voice.ts"
Cohesion: 0.18
Nodes (13): clampIndex(), downloadModel(), ensureVoiceModel(), estimateWordTimings(), exists(), getTts(), mouthEnvelope(), speak() (+5 more)

### Community 59 - "video-list.tsx"
Cohesion: 0.16
Nodes (17): BatchCreateFailure, BatchCreateWarning, BatchWarningCause, createVideo(), createVideosBatch(), deleteVideo(), BatchSummary, CreateMode (+9 more)

### Community 60 - "getSupabaseClient"
Cohesion: 0.19
Nodes (16): POST(), RouteContext, BrandingPatchBody, LOGO_POSITIONS, PATCH(), RouteContext, MIME_CONTENT_TYPES, MIME_EXTENSIONS (+8 more)

### Community 61 - "scene-panel.tsx"
Cohesion: 0.13
Nodes (19): fetchBrandTemplates(), fetchSounds(), generateScenes(), generateVoice(), ScenePatch, VideoRecord, AssistantProps, BrandingPanelProps (+11 more)

### Community 62 - "Desplegar y comprobar"
Cohesion: 0.22
Nodes (8): Antes de empujar, Comprobar producción, Desplegar y comprobar, El worker de Railway es aparte, Empujar, Esperar el despliegue, Qué reportar, Si tocaste `vercel.json`

### Community 63 - "layout.tsx"
Cohesion: 0.20
Nodes (6): apps_web_app_globals, display, metadata, mono, sans, viewport

### Community 64 - "assistant.tsx"
Cohesion: 0.06
Nodes (55): parseJsonSafe(), Assistant(), bargeIn(), beginListening(), maybeResumeListening(), onSpeechEnd(), onSpeechStart(), say() (+47 more)

### Community 65 - "grafo-pendiente.mjs"
Cohesion: 0.22
Nodes (7): etiquetas, INDEXADAS, manifest, manifestPath, pendientes, raiz, total

### Community 66 - "plugin.json"
Cohesion: 0.25
Nodes (7): author, name, description, keywords, name, $schema, version

### Community 67 - "batch/route.ts"
Cohesion: 0.15
Nodes (16): BatchFailure, BatchWarning, BatchWarningCause, buildWarning(), planScenes(), PLATFORMS, POST(), GET() (+8 more)

### Community 68 - "dependencies"
Cohesion: 0.22
Nodes (9): dependencies, dejavu-fonts-ttf, ffmpeg-static, fluent-ffmpeg, @napi-rs/canvas, sherpa-onnx, @supabase/supabase-js, tar-stream (+1 more)

### Community 69 - "frontend-agent.md"
Cohesion: 0.25
Nodes (7): Antes de escribir algo nuevo, Before you finish, Git, Rules, Style, What is already there, Your files

### Community 70 - "graphify-agent.md"
Cohesion: 0.25
Nodes (7): Git, Preparing the output for commit, Report, Running it, What to look for in GRAPH_REPORT.md, Whether a run is needed at all — measure it, do not guess, Your files

### Community 71 - "SceneRow"
Cohesion: 0.29
Nodes (12): deleteScene(), regenerateScene(), updateScene(), SceneRow(), applyPatch(), handleActionChange(), handleCharacterChange(), handleDelete() (+4 more)

### Community 72 - "tts/route.ts"
Cohesion: 0.31
Nodes (6): POST(), RouteContext, supabase, synthesizeSpeech(), updateScene(), @supabase/supabase-js

### Community 73 - "devops-agent.md"
Cohesion: 0.33
Nodes (5): Before you finish, Git, Rules, What must keep working, Your files

### Community 74 - "qa-agent.md"
Cohesion: 0.33
Nodes (5): Git, How to report, Rules, What to run, Your files

### Community 75 - "render-worker-agent.md"
Cohesion: 0.25
Nodes (7): createFrameCanvas(), Antes de escribir algo nuevo, Before you finish, Git, How it works, Rules, Style

### Community 88 - "Platform"
Cohesion: 0.40
Nodes (5): PLATFORMS, POST(), RouteContext, duplicateForPlatform(), Platform

### Community 89 - "scripts"
Cohesion: 0.25
Nodes (8): scripts, build, check:types, dev, elevenlabs:voces, heygen:catalogo, sounds:library, start

### Community 90 - "constants.ts"
Cohesion: 0.14
Nodes (18): duplicateVideo(), StatusAction, transitionStatus(), FONT_OPTIONS, LOGO_POSITION_OPTIONS, PLATFORM_LABELS, PLATFORM_OPTIONS, PROP_OPTIONS (+10 more)

### Community 91 - "videos/[id]/route.ts"
Cohesion: 0.36
Nodes (7): DELETE(), PATCH(), RouteContext, canTransition(), deleteVideo(), patchInSupabase(), updateVideoStatus()

### Community 92 - "templates.ts"
Cohesion: 0.43
Nodes (6): BrandTemplate, TemplateBeat, TemplateDefinition, CharacterType, SceneAction, ScenePropType

### Community 93 - "speak/route.ts"
Cohesion: 0.50
Nodes (4): API_KEY, POST(), silent(), VOICE_ID

## Knowledge Gaps
- **415 isolated node(s):** `1. Liberar los puertos`, `2. Borrar la salida del build anterior`, `3. Verificar`, `4. Revisar que el `.gitignore` no se haya ensuciado`, `5. Levantar el entorno para la suite` (+410 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 499 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **32 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `next` to `assistant.tsx`, `scenes/route.ts`, `copilot.ts`, `batch/route.ts`, `sign-in-required.ts`, `scripts`, `assistant.ts`, `[sceneId]/route.ts`, `tts/route.ts`, `ref_node_fs`, `brand-templates.ts`, `Platform`, `videos/[id]/route.ts`, `getSupabaseClient`, `speak/route.ts`, `layout.tsx`?**
  _High betweenness centrality (0.109) - this node is a cross-community bridge._
- **Why does `Platform` connect `Platform` to `api.ts`, `copilot.ts`, `batch/route.ts`, `index.ts`, `assistant.ts`, `video-persistence.ts`, `constants.ts`, `video-list.tsx`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `@supabase/supabase-js` connect `tts/route.ts` to `render-worker/package.json`, `index.ts`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **What connects `1. Liberar los puertos`, `2. Borrar la salida del build anterior`, `3. Verificar` to the rest of the system?**
  _415 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `sound-panel.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.11067193675889328 - nodes in this community are weakly interconnected._
- **Should `copilot.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0635350797952424 - nodes in this community are weakly interconnected._
- **Should `web/package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._