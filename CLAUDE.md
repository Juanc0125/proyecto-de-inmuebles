# Stickman — instrucciones para el agente líder

Herramienta interna de un negocio de crédito hipotecario: convierte un tema en un video vertical corto (guion → escenas → narración → MP4). Monorepo de npm workspaces: `apps/web` (Next.js 16, Vercel), `apps/render-worker` (Node/TS, Google Cloud Run Job; Railway ya no se usa), `packages/shared-types`.

Trabaja en español con el usuario. El código y los comentarios van en inglés; todo lo que lee una persona en pantalla, en español.

## Cómo repartir el trabajo

Ante un pedido nuevo, identifica a qué dominio pertenece y delega con la herramienta Task:

| Dominio | Agente | Dueño de |
|---|---|---|
| API, persistencia, guion/escenas, TTS, branding, proveedor de IA, copiloto | `backend-agent` | `apps/web/app/api/**`, `apps/web/lib/**`, `packages/shared-types/**` |
| Interfaz, formulario, escenas editables, marca, preview, panel del copiloto | `frontend-agent` | `apps/web/app/components/**`, `layout.tsx`, `page.tsx`, `globals.css` |
| ffmpeg, personajes, voz, subtítulos, MP4 | `render-worker-agent` | `apps/render-worker/**` |
| Build, CI, Vercel/Cloud Run, variables de entorno, MCP | `devops-agent` | `package.json`, `.github/workflows/**`, `vercel.json`, `.mcp.json` |
| Build completo, suite end-to-end, navegador real | `qa-agent` | `scripts/e2e.mjs` y las pruebas |
| Grafo de conocimiento y deriva estructural | `graphify-agent` | `graphify-out/**` |

Reglas:

- **Un solo dominio** → delega directo a ese agente.
- **Varios dominios sin dependencias** → lánzalos **en paralelo, en una sola tanda** (varias llamadas a Task en el mismo mensaje).
- **Con dependencias** → en orden, y pásale a cada agente **solo su parte**, no el pedido completo. El caso típico: backend define el endpoint y el contrato, frontend lo consume. Si necesitas paralelizarlos igual, fija tú el contrato por escrito y dáselo a los dos.
- Los alcances de archivos **no se solapan a propósito**. Dos agentes editando el mismo archivo a la vez se pisan. Si un pedido obliga a cruzar la frontera, parte el trabajo, no el archivo.
- Un subagente arranca sin contexto: dale los hechos que necesita (rutas, contratos, restricciones), no un resumen de la conversación.

## Dónde viven los agentes y las skills

En `plugin/`, empaquetados como un plugin de Claude Code llamado `stickman`:
`plugin/agents/` (los seis de la tabla) y `plugin/skills/` (`verificar` y
`desplegar`). Es una sola fuente: **no los dupliques en `.claude/`**, porque
entonces quedan definidos dos veces y nadie sabe cuál manda.

`.claude/settings.json` lo deja habilitado y está versionado, pero el
*marketplace* se registra por máquina. En un clon nuevo hace falta una vez:

```
claude plugin marketplace add <ruta-del-repo>
claude plugin install stickman@stickman-video-app --scope project
```

El alcance `project` importa: con `user` las skills se ofrecerían también en los
demás proyectos de esta máquina —`urquijos-traders`, por ejemplo— donde
`verificar` no significa nada.

Para comprobar qué quedó registrado y cuántos tokens cuesta:
`claude plugin details stickman`.

## Antes de cada commit a master

1. **`qa-agent`** corre `npm run verify` y la suite end-to-end. Si falla, **no hay push**: corrige y vuelve a llamarlo.
2. **`graphify-agent`** actualiza el grafo, después del visto bueno de QA y antes del push, cuando la tanda movió, creó o borró archivos. Cambios triviales no lo justifican.
3. Un commit por agente o módulo, nunca uno gigante.

## Al cerrar cada tanda

Dale al usuario un resumen corto: qué hizo cada agente, y **toda decisión de diseño que alguno haya tomado sin que estuviera especificada**, para que él la revise. Si `graphify-agent` reportó algo raro (un nodo god nuevo, acoplamiento fuera de lo esperado), va en ese resumen.

## Reglas del proyecto que ningún agente puede saltarse

- **RF-012: la aprobación es humana.** Nada aprueba, publica ni renderiza solo. El copiloto prepara; la persona aprueba con un botón. Es marketing financiero regulado y esa puerta es el único control que hay.
- **Nada de asesoría financiera personalizada**, ni tasas inventadas, ni entidades con nombre.
- **Ninguna clave en un archivo versionado.** Van en `.env.local` (ignorado por git) o en el panel de Vercel / Secret Manager de Google Cloud (vía `scripts/gcp-setup.sh`). En el repo solo va el *nombre* de la variable que falta.
- **No inventes funcionalidad fuera de la tabla de requerimientos del cliente** (`Tabla_de_Requerimientos.xlsx`, en el Escritorio del usuario).
- **Las migraciones son append-only.** Nunca reescribas ni borres una ya aplicada.

## Trampas de esta máquina que cuestan tiempo

- `npm run verify` falla con `EPERM` mientras el servidor de desarrollo tiene tomado `apps/web/.next`, y OneDrive sincronizando la carpeta puede tomarlo igual. Detén el servidor, borra `apps/web/.next`, reintenta. **EPERM no es un error de código.**
- `npm run dev` levanta web (3000) y worker (8080) juntos. También está la configuración de arranque *Stickman* de Warp.
- **Antes de lanzar desde Warp, libera los puertos 3000 y 8080.** Next 16 rechaza una segunda instancia sobre el mismo directorio, y la pestaña de Warp muere sin decir nada: parece que el lanzamiento falló cuando lo que sobraba era el proceso anterior.
- El worker corre con `tsx` sin watch: un cambio en su código exige reiniciarlo.
- `npm run check:ai` dice qué proveedor de lenguaje responde de verdad, y si además sabe usar herramientas. **La cadena del copiloto es de modelos gratuitos, en el orden de `apps/web/lib/ai-models.json`: Gemini → Groq → Mistral → OpenRouter**, y uno sin clave se salta. Gemini y Mistral se agregaron el 23-oct-2026 sin clave todavía (`npm run set:ai-key -- gemini` / `-- mistral`, cuentas gratuitas en aistudio.google.com y console.mistral.ai); confírmalos con `check:ai` al ponerlas. El plan gratuito de Groq da ~7.000 tokens por minuto y cada turno del copiloto cuesta ~2.000, así que solo, a la tercera pregunta seguida, se satura; por eso existe la cadena. Los modelos gratuitos de OpenRouter desaparecen sin aviso — el principal anterior respondía 404 cuando se revisó — así que, si el copiloto empeora, `check:ai` primero. Los modelos que razonan gastan `max_tokens` pensando y vuelven vacíos: `ai-provider.ts` les manda razonamiento `low` y un mínimo de 1024. `npm run set:ai-key -- <proveedor>` instala una clave nueva sin que pase por pantalla ni por el chat. **La salida a esa saturación ya está elegida: `x-ai/grok-4.7` por OpenRouter**, que ya está integrado — es cambiar `openrouter.model` en `ai-models.json`, sin código. Cuesta USD 1,60 por millón de entrada y 4,80 de salida, unos $17 pesos por turno del copiloto. **Pero la cuenta de OpenRouter tiene que haber comprado créditos primero, y hay una trampa medida el 28 de septiembre de 2026: una cuenta sin créditos responde 402, y un 402 NO cae al siguiente modelo de la lista** — se cae la petición entera y se lleva por delante a los modelos gratuitos. Nombrar ahí un modelo de pago antes de tener saldo no degrada la cadena de respaldo: la rompe.
- **La narración es ElevenLabs cuando está configurado, y Piper local si no (decisión del dueño, 23-oct-2026).** `apps/render-worker/elevenlabs.ts`: se enciende con `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` en el job de Cloud Run, y `/health` dice `voice: elevenlabs ...` o por qué es `piper`. **Necesita plan pago (Starter o más):** en el gratuito `/v1/voices` responde 200 pero `/v1/text-to-speech` devuelve `402 paid_plan_required` (probado con clave real en septiembre), y el gratuito tampoco da licencia comercial. Por eso `npm run set:ai-key -- elevenlabs` mira el plan y rechaza una clave gratuita en vez de instalar algo que nunca narra. La voz se elige con `npm run elevenlabs:voces` (workspace del worker). Cobra por carácter; repetir la misma frase con la misma voz sale de una caché en disco y no cobra. Si ElevenLabs responde 401/402 (clave mala, sin caracteres, plan sin API) se apaga hasta reiniciar el worker, avisa a Sentry, y cada escena sigue con Piper: nunca sale un video mudo por su culpa. Además trae los tiempos de cada palabra, así que los subtítulos van sincronizados de verdad. Ventaja de memoria: si narra ElevenLabs, el WASM de Piper (215-260 MB fijos) nunca se carga. Las voces de HeyGen del motor ElevenLabs siguen sin usarse: la narración llama a ElevenLabs directo.
- **El job tiene 4 GiB (en Railway eran 1 GB) y el render llegaba a 0,81 GB, sin contar el disco, que en Cloud Run es memoria. Mide la memoria antes de añadirle nada.** Un fotograma de 1080x1920 son 8 MB; el motor de voz reserva 215-260 MB que **nunca** devuelve (WASM, sin `dispose`); ffmpeg cuesta ~145 MB con el preset actual y ~295 MB con uno mejor. Y la trampa que lo escondió: `process.memoryUsage()` solo ve Node, mientras que el matador del contenedor cuenta también a los hijos ffmpeg — mide el conjunto, no el proceso. Cuando se pasa, la ejecución del job termina por memoria (en Railway el log decía solo `Killed`) y el video puede quedarse congelado en su último porcentaje. `FFMPEG_PRESET` y `FFMPEG_CRF` son las dos palancas: la primera es memoria, la segunda es tamaño de archivo.
- El render worker redeclara los tipos del dominio en vez de importar `@shared-types`: importarlos movería el punto de entrada de `dist/` que arranca la imagen del job (`node dist/run-job.js`). La deriva ya no pasa en silencio: `apps/render-worker/checks/type-parity.ts` corre dentro de `check:types` (y por tanto de `verify`) y falla el día que un lado cambie sin el otro. Las uniones de escena (`CharacterType`, `SceneAction`, `ScenePropType`) viven **solo** en `drawing.ts`; `index.ts` las importa de ahí. No las vuelvas a declarar en otro archivo del worker: una copia que `type-parity.ts` no mira es justo el hueco que se cerró el 6 de octubre de 2026.
- **El estudio está abierto sin login (decisión del dueño, 12-oct-2026).** Cualquiera con la URL lee, crea y edita borradores. Generar, aprobar, borrar videos/sonidos/plantillas, subir archivos y la voz de pago siguen pidiendo sesión: la lista vive en `apps/web/proxy.ts` y la acción del `PATCH /api/videos/[id]` se revisa en la ruta (`lib/sign-in-required.ts`). Cualquier ruta nueva que gaste dinero o comprometa al cliente entra en esa lista.
- **Sentry está instalado y apagado hasta que haya DSN.** Web: `@sentry/nextjs` (`instrumentation.ts`, `instrumentation-client.ts`, `app/global-error.tsx`), solo errores, sin trazas ni grabación de sesión, y `lib/sentry-data-collection.ts` apaga cookies, cabeceras, cuerpos, variables locales y prompts de IA — son guiones de marketing regulado. Variables: `SENTRY_DSN` y `NEXT_PUBLIC_SENTRY_DSN` en Vercel; `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` solo si se quieren trazas legibles del navegador. **El worker NO usa el SDK**: `@sentry/node` cuesta ~54 MB medidos aunque se apague todo (OpenTelemetry entra con el import), y el worker vive en 1 GB. `apps/render-worker/error-reporting.ts` manda el error con un `fetch` al endpoint *envelope* — 0 MB. Se enciende con `SENTRY_DSN` en el job de Cloud Run; `/health` dice `error_reporting`. Un `Killed` por memoria nunca llega a Sentry: eso lo ve el monitor de uptime.
- **HeyGen es el motor principal de video cuando está configurado (decisión del dueño, 12-oct-2026, con saldo propio de la API).** `apps/render-worker/heygen.ts`: cada escena es un avatar real diciendo la narración; si una escena falla (sin saldo, tiempo, id malo) se narra y dibuja como antes. Se enciende solo con `HEYGEN_API_KEY` + `HEYGEN_AVATAR_ID` + `HEYGEN_VOICE_ID` en el job de Cloud Run; `/health` dice `heygen: configurado` o qué falta. La clave va con `npm run set:ai-key -- heygen`; los ids se eligen con `npm run heygen:catalogo` (en el workspace del worker). La suscripción web de HeyGen no sirve para la API, y LiveAvatar tampoco (es streaming en vivo, no MP4). Las voces de HeyGen del motor ElevenLabs no se usan. La misma voz habla en el asistente (`apps/web/app/api/speak`, detrás de sesión porque cobra por respuesta): necesita `HEYGEN_API_KEY` y `HEYGEN_VOICE_ID` también en Vercel; sin ellas, sin saldo o sin sesión, el asistente usa la voz del navegador.
- **Supabase: el proyecto `mlwpsqzhefrezezrkmpu` vive en la organización `stickman` (`cvgawfwyceyaiqectiec`)**, que es la que ve el plugin de Supabase autenticado en esta máquina. El conector de Supabase de claude.ai está en otra cuenta y por eso muestra una organización sin proyectos: no sirve para este repo. Ojo: el plugin **no es de solo lectura** (tiene `apply_migration` y `execute_sql`); el servidor de `.mcp.json` sí lo es (`read_only=true`), pero hay que aprobarlo una vez al abrir `claude` en el repo. Para consultar, usa solo herramientas de lectura.
- **Algo en el herramental le añade `.vercel` y `.env*` al final del `.gitignore`, sin que nadie lo pida.** Apareció dos veces en la tanda del 27 de septiembre de 2026. **No está identificado qué lo hace**: se le atribuyó a `npm run verify`, pero después se corrió `verify` dos veces —una con `apps/web/.next` borrado— y no se reprodujo; el sospechoso más probable es la CLI de Vercel (`vercel link`, `env pull`). Mira el `git status` antes de cada commit y revierte ese cambio (`git checkout -- .gitignore`): ese `.env*` sacaría del control de versiones a `apps/render-worker/.env.local.example` y `apps/web/.env.local.example`, que son justamente los archivos que documentan qué variables hacen falta. Se perdería en silencio.
- **El video con IA existe, funciona y está apagado en producción.** `apps/render-worker/ai-video.ts` genera cada escena con fal.ai cuando hay `FAL_KEY`; sin ella dibuja con canvas y no cuesta nada. Hay una clave válida en `.env.local`, pero **no está en el job de Cloud Run**, así que producción nunca ha llamado a fal. Encenderlo es una decisión de gasto, no técnica: fal cobra **por segundo de video**, del orden de USD 0,09 a 720p (unos USD 2,70 por un video de 30 s), y cada «regenerar escena» vuelve a cobrar. La variante Fast cuesta menos de la mitad y da más resolución. Esa cifra es de la familia LTX-2 en septiembre de 2026 y el modelo de por defecto es `ltx-2.3`: **confirma la tarifa en la página del modelo en fal antes de presupuestar**, que cambian precios y publican versiones nuevas seguido. Antes de encenderlo hace falta la aceptación escrita del cliente sobre RF-004: pasar de personajes dibujados a video fotorrealista es un cambio de naturaleza, no de calidad.
- **Las URLs de la cola de fal no son simétricas, y equivocarse no da error.** El POST de envío lleva el id completo del modelo con su variante (`fal-ai/ltx-2.3/text-to-video`); las consultas de estado y de resultado llevan **solo `owner/modelo`** (`fal-ai/ltx-2.3`). Con el sufijo, fal responde 405 y ni siquiera mira la clave. Esto ya estuvo roto: el envío se cobraba, el sondeo fallaba, `generateSceneVideo` caía a dibujar la escena y el video salía normal — se pagaba por material que se tiraba, sin una sola señal en pantalla. El comentario de `MODEL_BASE` en ese archivo explica por qué las dos rutas difieren; no las «unifiques».

## Producción: Vercel + Cloud Run Job (Railway ya no se usa)

El periodo de prueba de Railway venció y el worker quedó caído desde el
14-oct-2026. **El render corre ahora como Cloud Run Job** `stickman-render`
(`us-central1`, 2 vCPU, 4 GiB, 30 min máximo, sin reintentos), en la capa
gratuita de Google Cloud. Una ejecución = un render: Vercel la lanza con
`RENDER_BACKEND=cloud-run-job` y el pedido viaja en `RENDER_JOB_B64`. No hay
servidor encendido, así que en producción **no hay `/health` del worker** ni
`RENDER_WORKER_URL`; las menciones de `/health` en las notas de abajo valen para
el worker local (`npm run dev`).

- **Configuración única:** `scripts/gcp-setup.sh`, en Google Cloud Shell. Es
  idempotente: crea APIs, Artifact Registry `stickman` (guarda solo las 2
  imágenes más nuevas), las tres cuentas de servicio (runtime del job,
  despachador para Vercel con un rol propio que solo puede lanzar este job,
  desplegador para GitHub), Workload Identity Federation para
  `Juanc0125/proyecto-de-inmuebles` en `master`, los secretos y el job. Al final
  imprime los `gh variable set` y los `vercel env add` exactos. Para cambiar
  una clave del worker se vuelve a correr; las claves se escriben ocultas
  (`read -s`) y nunca pasan por argumentos ni por pantalla.
- **Dónde vive cada variable del worker:** las claves (`SUPABASE_SERVICE_ROLE_KEY`,
  `HEYGEN_API_KEY`, `ELEVENLABS_API_KEY`, `FAL_KEY`) en Secret Manager,
  referenciadas desde el job; lo demás (`SUPABASE_URL`, ids de voz/avatar,
  `SENTRY_DSN`) como variable normal del job. Máximo 4 secretos con una versión
  activa cada uno: dentro de las 6 versiones gratuitas.
- **Despliegue:** `.github/workflows/deploy-render-worker.yml`, en cada push a
  `master` que toque `apps/render-worker/**` (o a mano). Construye
  `apps/render-worker/Dockerfile`, lo sube y cambia **solo la imagen** del job
  (por digest, con la etiqueta `commit-sha`). Las variables y secretos no los
  toca. Autentica por WIF: no hay ninguna clave de Google en GitHub. Si el job
  no existe, falla pidiendo correr el script en vez de crear uno sin secretos.
- **Comprobar:** `gcloud run jobs executions list --job stickman-render --region us-central1`
  tras generar un video canvas de prueba; detalle en la skill `desplegar`.
- **Repo público:** el workflow no imprime variables. `gcloud run jobs describe`
  sin `--format` sí las imprime: no lo pongas en el workflow ni pegues su salida.
- **Costo:** alerta de presupuesto de 1 USD (`stickman-render-budget`). Solo
  avisa por correo, no corta. La capa gratuita de Cloud Run da del orden de
  cientos de renders canvas al mes; lo que de verdad cuesta sigue siendo HeyGen,
  ElevenLabs y fal, que cobran en sus propias cuentas.
- **El sistema de archivos del job vive en memoria** y cuenta contra los 4 GiB:
  el modelo de Piper y la caché de voz que se descarguen en cada ejecución
  ocupan RAM, y cada ejecución arranca sin la caché de la anterior.

## El grafo de conocimiento: consultarlo antes de escribir

El repo tiene un grafo en `graphify-out/` con 770 nodos y 1507 aristas: quien llama a quien, que vive en cada modulo y que se parece a que. Esta versionado para que no haya que reconstruirlo.

**Existe para que no se construya dos veces lo mismo.** Antes de crear una funcion, un helper o un endpoint, pregunta si ya existe:

```
npm run graph -- query "donde se valida el personaje de una escena?"
npm run graph -- path "copilot" "video-persistence"
npm run graph -- explain "generateWithFallback"
```

Devuelven un subgrafo acotado, casi siempre mas pequeno que un `grep` y bastante mas util: `grep` encuentra el nombre, el grafo encuentra la relacion. Este proyecto ya tuvo esa duplicacion — el worker redeclarando los tipos del dominio — y costo caro.

`npm run graph -- ...` resuelve donde esta instalado graphify; **no esta en el PATH**, asi que un `graphify` pelado falla.

Una advertencia al consultarlo: el codigo esta en ingles y la documentacion en espanol, asi que una pregunta en espanol trae sobre todo nodos de documentacion. Para buscar codigo, pregunta con el vocabulario del codigo (`coerceCharacter`, `updateBranding`, `drawSceneFrame`).

Se mantiene solo: un enganche de post-commit reconstruye el grafo con cada commit (solo AST, sin costo de modelo). Los documentos y las imagenes no los cubre el enganche; para esos, `graphify-agent` hace una corrida completa. `GRAPH_REPORT.md` se lee cuando hace falta la vista de arquitectura, no para una pregunta puntual.
