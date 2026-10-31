# Stickman

Herramienta interna para producir videos cortos de marketing hipotecario a partir de un tema:

```
tema -> guion (LLM) -> escenas -> voz (TTS) -> video MP4 con subtitulos
```

Cada video pasa por una **aprobacion humana obligatoria** antes de poder publicarse. No es
un detalle de flujo: el contenido es marketing financiero regulado, y nada sale sin que una
persona lo revise.

## Estructura

| Carpeta | Que es |
|---|---|
| `apps/web` | Frontend Next.js y rutas de API. Se despliega en Vercel. |
| `apps/render-worker` | Node separado que genera los MP4. En produccion corre como Cloud Run Job (una ejecucion por video). |
| `packages/shared-types` | Tipos compartidos por el frontend y las rutas de API. |
| `supabase/migrations` | Esquema de la base de datos. |

Los dos servicios se comunican **solo por HTTP**, no comparten codigo. El worker define sus
propios tipos en vez de importar `shared-types`; si añades un valor a un enum
(`SceneAction`, `CharacterType`...) hay que copiarlo en ambos lados o falla en ejecucion,
no al compilar.

## Arrancar en local

```bash
npm install
npm run dev
```

Levanta el frontend y el worker juntos y abre en <http://localhost:3000>. Ctrl+C baja los dos.

`npm run dev` lee `.env.local` de la raiz **y** de `apps/web`. Next solo lee el segundo por su
cuenta y el worker solo ve lo que el lanzador le pasa, asi que se cargan ambos para que una
variable no quede correctamente escrita en el archivo equivocado sin hacer nada.

Sin Supabase configurado la app funciona igual, con almacenamiento en memoria: se pierde al
reiniciar.

## Variables de entorno

| Variable | Para que |
|---|---|
| `SUPABASE_URL` | Proyecto de Supabase. |
| `SUPABASE_SECRET_KEY` o `SUPABASE_SERVICE_ROLE_KEY` | Acceso de servidor. **Nunca** como `NEXT_PUBLIC_*`. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Cliente del navegador. |
| `RENDER_WORKER_URL` | URL del worker. En produccion no se acepta `localhost`. |
| `LLM_API_KEY` | Generacion de guion y escenas. Sin ella hay un generador de respaldo. |
| `FAL_KEY` | *Opcional.* Activa el video generado por IA (ver abajo). |
| `DEMO_USER_PASSWORD` | Usuario demo de Supabase. Si falta, se omite su creacion. |

Supabase emite claves `sb_publishable_...` y `sb_secret_...`. No existen otros formatos: un
valor tipo `sb_anon_...` o `sb_service_role_...` es un marcador de posicion, y como la variable
*existe*, el codigo lo usa y Supabase responde `Invalid API key`.

## Como se genera un video

El worker dibuja **cada fotograma** con un contexto grafico 2D y se los pasa a ffmpeg como
pixeles crudos; ffmpeg solo codifica. Eso permite personajes articulados con angulos reales
en las articulaciones, caras, parpadeo y objetos ilustrados.

La narracion se sintetiza localmente con sherpa-onnx (voz en español, sin clave y sin costo
por video). Como la sintesis ocurre en el worker, tenemos la onda de audio, y de ahi sale el
movimiento de la boca: sigue el volumen real de la voz. Una escena **se alarga** si su
narracion no cabe en la duracion pedida, para no cortar la frase a medias.

El modelo de voz pesa ~67MB y se descarga una vez por contenedor a `.voice-cache`. El worker
lo precarga al arrancar para que el primer render no espere.

### Video generado por IA (opcional)

Con `FAL_KEY` configurada, cada escena se genera con un modelo de texto-a-video de
[fal.ai](https://fal.ai) en vez de dibujarse, y encima se le ponen los subtitulos y la voz
propios. Se configura con:

- `AI_VIDEO_MODEL` — por defecto `fal-ai/ltx-2.3/text-to-video`.
- `AI_VIDEO_STYLE` — la descripcion de estilo visual que se añade al prompt.
- `AI_VIDEO_RESOLUTION`, `AI_VIDEO_TIMEOUT_MS`.

**Cuesta dinero por segundo generado**, y cada "Regenerar" vuelve a cobrar. Es tolerante a
fallos: sin clave, o si una escena falla o agota el tiempo, esa escena se dibuja. Un render
siempre produce un video.

`GET /health` informa que motor esta activo en `video_engine`.

## El render es asincrono

`POST /render` responde **202 al instante** y procesa en segundo plano. Generar una escena con
IA tarda minutos, mucho mas de lo que aguanta una peticion HTTP.

El worker reporta el avance escribiendo `render_status`, `render_progress` y `render_error`
en la fila del video. El estado vive en la base de datos, asi que sobrevive a un reinicio del
worker, y la interfaz lo sigue con el mismo endpoint que ya usa para listar videos.

## Estados de aprobacion

`borrador` -> `pendiente_aprobacion` -> `aprobado` -> `publicado`

Solo se puede generar el MP4 desde `aprobado`, y publicar requiere que el video exista.

## Endpoints del worker

- `GET /health` — estado, almacenamiento y motor de video.
- `POST /render` — encola un render, responde 202.
- `GET /renders/<archivo>.mp4` — sirve el MP4 cuando no hay Supabase Storage.

## Almacenamiento de los MP4

Con `SUPABASE_URL` y la clave de servidor configuradas, cada MP4 se sube al bucket indicado en
`SUPABASE_RENDERS_BUCKET` (por defecto `renders`, debe existir y ser publico) y se borra del
disco local. Sin eso, los archivos quedan en `apps/render-worker/renders` y **no sobreviven un
redespliegue** del contenedor.

## Instalar como aplicacion

La app declara un manifiesto y un service worker, asi que Chrome y Edge ofrecen **Instalar**.
Queda con icono propio y ventana propia. El service worker cachea solo el armazon: el estudio
muestra estado en vivo y una cache obsoleta podria mostrar como "renderizando" un video ya
terminado.

## Verificar antes de desplegar

```bash
npm run verify   # lint + typecheck + build de los dos workspaces
```

Corre tambien en CI (`.github/workflows/verify.yml`) en cada push a `master`.

Ademas, tras desplegar: crea un video corto (motor canvas, no cuesta), apruebalo, generalo y
confirma que el MP4 se reproduce y que aparece la ejecucion:

```bash
gcloud run jobs executions list --job stickman-render --region us-central1 --limit 5
```

## Despliegue

**Vercel** — importa el repositorio con la **raiz** como Root Directory. El `vercel.json` de la
raiz instala el workspace y compila `apps/web` incluyendo `packages/shared-types`. Para lanzar
renders necesita `RENDER_BACKEND=cloud-run-job`, `GCP_PROJECT_ID`, `GCP_REGION`,
`CLOUD_RUN_JOB` y `GCP_SA_KEY_B64` (la llave JSON del despachador, en base64).

**Render worker: Google Cloud Run Job** (Railway ya no se usa). Cada video es una ejecucion del
job `stickman-render` (`us-central1`, 2 vCPU, 4 GiB, 30 min, sin reintentos), que lee el pedido
de `RENDER_JOB_B64`, renderiza, sube el MP4 a Supabase y termina. Sin ejecuciones no cuesta.

1. Una vez, en [Google Cloud Shell](https://shell.cloud.google.com): `bash scripts/gcp-setup.sh <PROJECT_ID>`.
   Es idempotente. Crea el repositorio de imagenes, las cuentas de servicio con permisos minimos,
   Workload Identity Federation para GitHub, los secretos (se escriben ocultos), el job y una
   alerta de presupuesto, e imprime los comandos `gh variable set` y `vercel env add` exactos.
2. Cada push a `master` que toque `apps/render-worker/**` corre
   `.github/workflows/deploy-render-worker.yml`: construye `apps/render-worker/Dockerfile`, lo
   sube a Artifact Registry y cambia solo la imagen del job. Las variables y secretos del job
   los gestiona el script, no el workflow. GitHub autentica sin llave (WIF); variables del
   repositorio: `GCP_PROJECT_ID`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`.

**Supabase** — aplica el esquema con:

```bash
npx supabase link --project-ref <REF>
npx supabase db push
```

## Mapa del codigo

`graphify-out/GRAPH_REPORT.md` tiene un analisis de que modulos estan mas conectados. Para
regenerarlo hace falta [graphify](https://github.com/Graphify-Labs/graphify); los artefactos
grandes (`graph.html`, `graph.json`) no se versionan.
