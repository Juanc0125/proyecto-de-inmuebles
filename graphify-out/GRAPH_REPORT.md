# Graph Report - stickman-video-app  (2026-11-02)

## Corpus Check
- 163 files · ~145,146 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 9 file(s) not represented in the graph (top: (none) 5, .example 2, .ico 1)

## Summary
- 1277 nodes · 2459 edges · 105 communities (71 shown, 34 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 45 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e24c5edc`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- branding-panel.tsx
- api.ts
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
- video.ts
- video-persistence.ts
- make-backdrop.mjs
- Variables de entorno del proyecto
- graphify-out (grafo, reporte y cache)
- compilerOptions
- e2e.mjs
- ai-video.ts
- section-icon.tsx
- heygen.ts
- next
- dev.mjs
- Render asincrono: POST /render responde 202 y procesa en segundo plano
- tsconfig.check.json
- 20260910000000_initial_schema.sql
- schema.sql
- ai-provider.ts
- sign-in-required.ts
- elevenlabs.ts
- Stickman PWA Icon 192
- web/vercel.json
- public.brand_templates
- vercel.json
- speak/route.ts
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
- create-video-form.tsx
- gcp-setup.sh
- VideoRecord
- Desplegar y comprobar
- layout.tsx
- assistant.tsx
- grafo-pendiente.mjs
- plugin.json
- render.ts
- run-job.ts
- frontend-agent.md
- graphify-agent.md
- VideoStudio
- public.videos
- devops-agent.md
- qa-agent.md
- bake-voice.mjs
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
- status-panel.tsx
- dashboard-view.tsx
- workbench-panel.tsx
- brand-templates.ts
- [sceneId]/route.ts
- video-workspace.tsx
- readText
- batch/route.ts
- runCopilot
- getSupabaseClient
- video-poster.tsx
- requireVideo
- backend-agent.md
- Platform
- getTemplate
- run

## God Nodes (most connected - your core abstractions)
1. `VideoRecord` - 33 edges
2. `render()` - 29 edges
3. `getSupabaseClient()` - 24 edges
4. `VideoStudio()` - 23 edges
5. `next` - 23 edges
6. `getVideo()` - 22 edges
7. `getTemplate()` - 20 edges
8. `generateWithFallback()` - 18 edges
9. `react` - 18 edges
10. `toVideoRecord()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `What is already there` --references--> `generateWithFallback()`  [INFERRED]
  plugin/agents/backend-agent.md → apps/web/lib/ai-provider.ts
- `Before you finish` --references--> `createFrameCanvas()`  [INFERRED]
  plugin/agents/render-worker-agent.md → apps/render-worker/drawing.ts
- `Before you finish` --references--> `drawSceneFrame()`  [INFERRED]
  plugin/agents/render-worker-agent.md → apps/render-worker/drawing.ts
- `attentionItems()` --calls--> `isRenderStalled()`  [EXTRACTED]
  apps/web/app/components/dashboard-view.tsx → packages/shared-types/video.ts
- `buildSentenceFallback()` --calls--> `getTemplate()`  [EXTRACTED]
  apps/web/app/api/videos/[id]/scenes/route.ts → packages/shared-types/templates.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Stickman PWA Icon Set (192 / 512 / maskable / apple-touch)** — apps_web_public_icons_icon_192_stickman_icon, apps_web_public_icons_icon_512_stickman_icon, apps_web_public_icons_icon_maskable_512_stickman_icon, apps_web_public_icons_apple_touch_icon_stickman_icon [INFERRED 0.95]

## Communities (105 total, 34 thin omitted)

### Community 0 - "branding-panel.tsx"
Cohesion: 0.19
Nodes (18): applyBrandTemplate(), BrandingPatch, deleteBrandTemplate(), saveBrandTemplate(), updateBranding(), uploadLogo(), BrandingPanel(), handleApplyTemplate() (+10 more)

### Community 1 - "api.ts"
Cohesion: 0.09
Nodes (28): ApiError, BatchCreateResult, deleteSound(), fetchSession(), fetchVideos(), JSON_HEADERS, registerSound(), request() (+20 more)

### Community 2 - "copilot.ts"
Cohesion: 0.08
Nodes (32): apps_web_app_api_videos_id_music_route, apps_web_app_api_videos_id_music_route_patch, abrirVideo(), ACTIONS, BatchWarning, BatchWarningCause, buildContext(), buildPromptContext() (+24 more)

### Community 3 - "Verificar: la puerta de calidad"
Cohesion: 0.17
Nodes (11): 1. Liberar los puertos, 2. Borrar la salida del build anterior, 3. Verificar, 4. Revisar que el `.gitignore` no se haya ensuciado, 5. Levantar el entorno para la suite, 6. Comprobar que la suite no va a gastar dinero, 7. La suite end-to-end, 8. Retroalimentar el grafo (+3 more)

### Community 4 - "web/package.json"
Cohesion: 0.05
Nodes (38): eslintConfig, dependencies, next, react, react-dom, @supabase/supabase-js, devDependencies, autoprefixer (+30 more)

### Community 5 - "drawing.ts"
Cohesion: 0.06
Nodes (58): Exact, CAMERA_PROFILES, cameraFor(), CameraProfile, CharacterType, clamp(), createFrameCanvas(), drawBackground() (+50 more)

### Community 6 - "index.ts"
Cohesion: 0.17
Nodes (15): activeRenders, hashToken(), hasValidBearerToken(), readJson(), renderAuthStatus(), sendJson(), server, Branding (+7 more)

### Community 7 - "scripts"
Cohesion: 0.08
Nodes (25): dependencies, next, react, react-dom, name, private, scripts, build (+17 more)

### Community 8 - "assistant.ts"
Cohesion: 0.10
Nodes (26): POST(), generateWithFallback(), ABOUT_APPROVAL, ACTION_WORDS, AssistantAction, AssistantContext, AssistantReply, BrandPatch (+18 more)

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
Cohesion: 0.08
Nodes (30): apps_web_app_components_app_sidebar, apps_web_app_components_app_topbar, apps_web_app_components_approval_board, apps_web_app_components_brand_view, Command, CommandPalette(), PaletteActions, SECTION_ICONS (+22 more)

### Community 13 - "Los dos servicios se comunican solo por HTTP y no comparten codigo"
Cohesion: 0.50
Nodes (4): apps/render-worker, apps/web/app/api (rutas de API), Deuda: el render worker redeclara los tipos del dominio en vez de importar shared-types, Los dos servicios se comunican solo por HTTP y no comparten codigo

### Community 16 - "set-ai-key.mjs"
Cohesion: 0.14
Nodes (19): ref_node_readline, Cancelled, createSession(), question(), ENV_FILE, envFileIsIgnored(), lastLine(), main() (+11 more)

### Community 17 - "video.ts"
Cohesion: 0.14
Nodes (23): ACTIONS, buildScenesFromAiJson(), buildSentenceFallback(), buildSystemPrompt(), CHARACTERS, coerceAction(), coerceCharacter(), coerceDescription() (+15 more)

### Community 18 - "video-persistence.ts"
Cohesion: 0.14
Nodes (28): DELETE(), PATCH(), RouteContext, canTransition(), globalStore, transitions, videos, DatabaseRow (+20 more)

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
Cohesion: 0.14
Nodes (17): ACTION_VERBS, aiVideoModel(), buildScenePrompt(), CHARACTER_SUBJECTS, extractVideoUrl(), FAL_KEY, falFetch(), generateSceneVideo() (+9 more)

### Community 25 - "section-icon.tsx"
Cohesion: 0.24
Nodes (8): saveScript(), ScriptPanel(), handleSave(), ScriptPanelProps, Icon(), IconProps, PATHS, SectionIcon()

### Community 26 - "heygen.ts"
Cohesion: 0.18
Nodes (15): API_KEY, AVATAR_ID, AvatarClip, AvatarScene, ENGINE, heygenError(), heygenFetch(), sleep() (+7 more)

### Community 27 - "next"
Cohesion: 0.13
Nodes (16): EXTENSIONS, POST(), RouteContext, BrandingPatchBody, LOGO_POSITIONS, PATCH(), RouteContext, MIME_CONTENT_TYPES (+8 more)

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

### Community 33 - "ai-provider.ts"
Cohesion: 0.09
Nodes (28): AiProvider, configuredProviders(), generateAiText(), GeneratedResponse, apps_web_lib_ai_models, ChatMessage, CompletionResponse, EXHAUSTED (+20 more)

### Community 34 - "sign-in-required.ts"
Cohesion: 0.25
Nodes (9): LOGIN_REQUIRED, SIGN_IN_REQUIRED_ERROR, apps_web_lib_supabase_server, apps_web_lib_supabase_server_createsupabaseproxyclient, apps_web_lib_supabase_server_createsupabaserouteclient, config, needsSession(), PROTECTED_ROUTES (+1 more)

### Community 35 - "elevenlabs.ts"
Cohesion: 0.21
Nodes (13): Alignment, API_KEY, CACHE_DIR, CachedSpeech, cachePath(), decodePcm(), elevenlabsSpeak(), ElevenlabsSpeech (+5 more)

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

### Community 40 - "speak/route.ts"
Cohesion: 0.19
Nodes (14): POST(), silent(), speakWithHeyGen(), Alignment, DEFAULT_ASSISTANT_MODEL, DEFAULT_ASSISTANT_VOICE_ID, ElevenlabsSpeech, ElevenlabsTtsConfig (+6 more)

### Community 57 - "render-worker/package.json"
Cohesion: 0.06
Nodes (35): dependencies, dejavu-fonts-ttf, ffmpeg-static, fluent-ffmpeg, @napi-rs/canvas, sherpa-onnx, @supabase/supabase-js, tar-stream (+27 more)

### Community 58 - "voice.ts"
Cohesion: 0.18
Nodes (13): clampIndex(), downloadModel(), ensureVoiceModel(), estimateWordTimings(), exists(), getTts(), mouthEnvelope(), speak() (+5 more)

### Community 59 - "create-video-form.tsx"
Cohesion: 0.11
Nodes (27): BatchCreateFailure, BatchCreateWarning, BatchWarningCause, createVideo(), createVideosBatch(), deleteVideo(), BatchSummary, CreateMode (+19 more)

### Community 60 - "gcp-setup.sh"
Cohesion: 0.35
Nodes (10): ask_yn(), die(), ensure_sa(), ok(), put_secret(), say(), secret_exists(), SECRET_SET (+2 more)

### Community 61 - "VideoRecord"
Cohesion: 0.13
Nodes (20): generateScenes(), generateVoice(), ScenePatch, VideoRecord, CommandPaletteProps, ACTION_OPTIONS, CHARACTER_OPTIONS, CreateVideoFormProps (+12 more)

### Community 62 - "Desplegar y comprobar"
Cohesion: 0.22
Nodes (8): Antes de empujar, Comprobar producción, Desplegar y comprobar, El worker de Railway es aparte, Empujar, Esperar el despliegue, Qué reportar, Si tocaste `vercel.json`

### Community 63 - "layout.tsx"
Cohesion: 0.25
Nodes (6): apps_web_app_globals, display, metadata, mono, sans, viewport

### Community 64 - "assistant.tsx"
Cohesion: 0.05
Nodes (59): login(), parseJsonSafe(), Assistant(), bargeIn(), beginListening(), maybeResumeListening(), onSpeechEnd(), onSpeechStart() (+51 more)

### Community 65 - "grafo-pendiente.mjs"
Cohesion: 0.22
Nodes (7): etiquetas, INDEXADAS, manifest, manifestPath, pendientes, raiz, total

### Community 66 - "plugin.json"
Cohesion: 0.25
Nodes (7): author, name, description, keywords, name, $schema, version

### Community 67 - "render.ts"
Cohesion: 0.12
Nodes (29): applyLogoOverlayOrFallback(), CLIP_AUDIO_ARGS, decodeSceneAudio(), decodeToPcm(), DEFAULT_BRANDING, discardFiles(), ENCODER_THREADS, FFMPEG_TIMEOUT_MS (+21 more)

### Community 68 - "run-job.ts"
Cohesion: 0.15
Nodes (23): Dsn, errorReportingStatus(), flushErrorReports(), pendingReports, reportError(), sendReport(), stackFrames(), isUuid() (+15 more)

### Community 69 - "frontend-agent.md"
Cohesion: 0.25
Nodes (7): Antes de escribir algo nuevo, Before you finish, Git, Rules, Style, What is already there, Your files

### Community 70 - "graphify-agent.md"
Cohesion: 0.25
Nodes (7): Git, Preparing the output for commit, Report, Running it, What to look for in GRAPH_REPORT.md, Whether a run is needed at all — measure it, do not guess, Your files

### Community 71 - "VideoStudio"
Cohesion: 0.08
Nodes (26): deleteScene(), fetchBrandTemplates(), fetchSounds(), logout(), regenerateScene(), regenerateSceneImage(), updateScene(), SceneRow() (+18 more)

### Community 73 - "devops-agent.md"
Cohesion: 0.33
Nodes (5): Before you finish, Git, Rules, What must keep working, Your files

### Community 74 - "qa-agent.md"
Cohesion: 0.33
Nodes (5): Git, How to report, Rules, What to run, Your files

### Community 75 - "bake-voice.mjs"
Cohesion: 0.25
Nodes (7): apps_render_worker_dist_voice, { ensureVoiceModel, speak, voiceModelName }, require, c_dev_stickman_video_app_apps_render_worker_dist_voice_ensurevoicemodel, c_dev_stickman_video_app_apps_render_worker_dist_voice_speak, c_dev_stickman_video_app_apps_render_worker_dist_voice_voicemodelname, ref_node_module

### Community 89 - "status-panel.tsx"
Cohesion: 0.25
Nodes (10): duplicateVideo(), StatusAction, transitionStatus(), PLATFORM_LABELS, PLATFORM_OPTIONS, StatusPanel(), handleDuplicate(), runAction() (+2 more)

### Community 90 - "dashboard-view.tsx"
Cohesion: 0.18
Nodes (14): PROP_OPTIONS, STATUS_BADGE_CLASSES, STATUS_DOT_CLASSES, STATUS_LABELS, attentionItems(), DashboardView(), Severity, SEVERITY_CLASSES (+6 more)

### Community 91 - "workbench-panel.tsx"
Cohesion: 0.14
Nodes (21): startWorkbench(), currentStep(), formatSpan(), MODEL_FAMILIES, PROVIDER_LABEL, ROLE_LABEL, sortedSteps(), WORKBENCH_ROLES (+13 more)

### Community 92 - "brand-templates.ts"
Cohesion: 0.16
Nodes (18): DELETE(), RouteContext, coerceBranding(), CreateBody, GET(), LOGO_POSITIONS, POST(), createBrandTemplate() (+10 more)

### Community 93 - "[sceneId]/route.ts"
Cohesion: 0.18
Nodes (18): ACTIONS, buildRegenerateSystemPrompt(), CHARACTERS, coerceAction(), coerceCharacter(), coerceDescription(), coerceProp(), DELETE() (+10 more)

### Community 94 - "video-workspace.tsx"
Cohesion: 0.14
Nodes (16): updateVisualStyle(), apps_web_app_components_constants_template_text, apps_web_app_components_export_panel, apps_web_app_components_studio_utils_formatclock, apps_web_app_components_studio_utils_scenesseconds, JUMPS, jumpTo(), VideoWorkspace() (+8 more)

### Community 95 - "readText"
Cohesion: 0.26
Nodes (18): aplicarBranding(), callRoute(), duplicarVideo(), editarEscena(), findByName(), jsonInit(), matchOption(), parseJsonObject() (+10 more)

### Community 96 - "batch/route.ts"
Cohesion: 0.16
Nodes (15): BatchFailure, BatchWarning, BatchWarningCause, buildWarning(), planScenes(), PLATFORMS, POST(), GET() (+7 more)

### Community 97 - "runCopilot"
Cohesion: 0.26
Nodes (11): POST(), isCopilotConfigured(), borrarVideo(), confirmsDelete(), CopilotTurn, deleteQuestion(), executeTool(), normalise() (+3 more)

### Community 98 - "getSupabaseClient"
Cohesion: 0.31
Nodes (8): POST(), RouteContext, getSupabaseClient(), supabase, synthesizeSpeech(), createInSupabase(), ensureDemoUser(), updateScene()

### Community 99 - "video-poster.tsx"
Cohesion: 0.20
Nodes (7): apps_web_app_components_studio_utils_sortedscenes, brandFont(), FONT_STACKS, LOGO_CORNER, VideoPoster(), play(), VideoPosterProps

### Community 100 - "requireVideo"
Cohesion: 0.31
Nodes (11): aplicarMarca(), borrarEscena(), descargarVideo(), describeBranding(), describeScenes(), estadoProyecto(), generarEscenas(), generarVoz() (+3 more)

### Community 101 - "backend-agent.md"
Cohesion: 0.25
Nodes (7): Antes de escribir algo nuevo, Before you finish, Git, Rules, Style, What is already there, Your files

### Community 102 - "Platform"
Cohesion: 0.40
Nodes (5): PLATFORMS, POST(), RouteContext, duplicateForPlatform(), Platform

### Community 103 - "getTemplate"
Cohesion: 0.47
Nodes (6): callBatchRoute(), coerceDuration(), coercePlatform(), generarGuion(), generarVarios(), getTemplate()

### Community 104 - "run"
Cohesion: 1.00
Nodes (3): PaletteBody(), handleKeyDown(), run()

## Knowledge Gaps
- **448 isolated node(s):** `JSON_HEADERS`, `BatchCreateResult`, `SoundUploadTicket`, `PaletteActions`, `SECTION_ICONS` (+443 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 574 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **34 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `next` to `batch/route.ts`, `runCopilot`, `getSupabaseClient`, `assistant.tsx`, `sign-in-required.ts`, `Platform`, `scripts`, `assistant.ts`, `speak/route.ts`, `ref_node_fs`, `video.ts`, `video-persistence.ts`, `brand-templates.ts`, `[sceneId]/route.ts`, `layout.tsx`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Why does `Platform` connect `Platform` to `batch/route.ts`, `api.ts`, `copilot.ts`, `drawing.ts`, `assistant.ts`, `video.ts`, `video-persistence.ts`, `status-panel.tsx`, `dashboard-view.tsx`, `create-video-form.tsx`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `@supabase/supabase-js` connect `render-worker/package.json` to `getSupabaseClient`, `render.ts`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `VideoStudio()` (e.g. with `goTo()` and `openWorkbench()`) actually correct?**
  _`VideoStudio()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `JSON_HEADERS`, `BatchCreateResult`, `SoundUploadTicket` to the rest of the system?**
  _448 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `api.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0928030303030303 - nodes in this community are weakly interconnected._
- **Should `copilot.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08143939393939394 - nodes in this community are weakly interconnected._