---
name: desplegar
description: Sube Stickman a producción y comprueba que siguió funcionando - push a master, espera el despliegue de Vercel, y verifica contra producción que la autenticación sigue cerrada, que la sonda de salud responde y que el job de render de Cloud Run quedó con la imagen nueva. Úsala siempre que alguien pida desplegar, publicar, subir a producción, hacer push a master, "mándalo a prod", o preguntar si un cambio ya está arriba, en este repositorio. También cuando haga falta confirmar que el commit que está vivo en producción es el que se cree.
---

# Desplegar y comprobar

Un push a `master` dispara un despliegue de Vercel por sí solo. Lo que no se
hace solo es comprobar que lo desplegado sigue siendo correcto. El estudio está
abierto a cualquiera desde el 12-oct, y desde el 13-oct tampoco pide sesión para
generar, aprobar, borrar ni subir archivos (decisión del dueño). La sesión
vuelve con `REQUIRE_LOGIN=true` en Vercel: hay que encenderla antes de cargar
saldo en HeyGen, porque sin ella cualquiera con la URL gasta ese saldo.

## Antes de empujar

**La puerta de calidad va primero.** Corre la skill `verificar` — o confirma que
alguien acaba de correrla sobre exactamente este estado del repositorio. Un
push sin `npm run verify` ni suite end-to-end no es un despliegue, es una
apuesta.

Comprueba también que el árbol esté limpio y que el grafo no haya quedado
desactualizado con documentos o imágenes pendientes:

```
git status --short
node plugin/skills/verificar/scripts/grafo-pendiente.mjs
```

## Empujar

```
git log --oneline origin/master..HEAD    # qué vas a subir, míralo antes
git push origin master
```

Guarda el sha del commit que quedó arriba: lo vas a necesitar para saber si lo
que verificaste es lo que se desplegó.

## Esperar el despliegue

Vercel tarda del orden de medio minuto a un par de minutos. No des por hecho
que terminó porque la URL responde: la URL responde con el despliegue
**anterior** hasta que el nuevo esté listo.

La forma fiable es preguntar por el despliegue y comparar el sha:

```
vercel list project-bftvz --scope juanc0125s-projects
```

Con el MCP de Vercel, `list_deployments` sobre el proyecto devuelve
`meta.githubCommitSha` y `state`. Busca `state: READY` y que el sha sea el tuyo.
Eso es lo que distingue "la app responde" de "mi cambio está vivo".

## Comprobar producción

Tres comprobaciones contra Vercel, y las tres importan:

```
curl -s -o /dev/null -w "%{http_code}
" https://project-bftvz.vercel.app/
curl -s -o /dev/null -w "%{http_code}
" -X PATCH -H "Content-Type: application/json"   -d '{"action":"render"}' https://project-bftvz.vercel.app/api/videos/00000000-0000-0000-0000-000000000000
curl -s https://project-bftvz.vercel.app/api/health
```

Lo que debe salir:

| Comprobación | Esperado | Por qué importa |
|---|---|---|
| `/` sin sesión | **200** | el estudio está abierto, como se decidió |
| generar (`PATCH` con `action: render`) sin sesión | **404** (o **401** con `REQUIRE_LOGIN=true`) | llega a la ruta y no halla el id falso; con login, se corta antes |
| `/api/health` | **200** `{"ok":true,"db":"ok"}` | la base responde de verdad |

Con `REQUIRE_LOGIN=true`, cualquier cosa distinta de 401 en el `PATCH` de
generar quiere decir que la acción pasó sin sesión: es gasto abierto a
cualquiera, no un detalle. Sin login, un 202 o un 500 tampoco son aceptables.

`/api/health` devuelve 503 si la base no contesta.

El render ya no tiene `/health`: es un job, no un servidor (ver abajo).

## Si tocaste `vercel.json`

Que el archivo esté commiteado no significa que Vercel lo haya aplicado.
Confírmalo del lado de Vercel:

```
vercel crons ls --project project-bftvz --scope juanc0125s-projects
```

**Pasa `--project` y `--scope` explícitamente en vez de correr `vercel link`.**
Esa CLI es la principal sospechosa de añadirle `.vercel` y `.env*` al
`.gitignore` sin que nadie lo pida, y `crons ls` con los dos parámetros no lo
reproduce.

Los crons de Vercel **solo corren en despliegues de producción**, nunca en
previews. Para probar uno sin esperar a su horario: `vercel crons run`.

## El render es un Cloud Run Job, aparte de Vercel

**Railway ya no se usa** (el periodo de prueba venció y el worker quedó caído
desde el 14-oct-2026). El render corre como **Cloud Run Job** `stickman-render`
en `us-central1`, proyecto de Google Cloud del dueño: cada video es **una
ejecución** que arranca, renderiza, sube el MP4 a Supabase y termina. Vercel la
lanza con `RENDER_BACKEND=cloud-run-job` y el pedido va en la variable
`RENDER_JOB_B64` de esa ejecución. Sin ejecuciones no hay costo.

El push a `master` que toca `apps/render-worker/**` dispara
`.github/workflows/deploy-render-worker.yml`: construye la imagen, la sube a
Artifact Registry (`us-central1-docker.pkg.dev/<PROYECTO>/stickman/render-worker`)
y apunta el job a ella **por digest**. Es independiente del despliegue de
Vercel: compruébalo por separado.

```
gh run list --workflow deploy-render-worker.yml --limit 3
gcloud run jobs describe stickman-render --region us-central1   --format="value(metadata.labels.commit-sha)"
```

El `commit-sha` del job tiene que ser tu sha (si tu commit no tocó el worker,
será el último que sí lo tocó; es correcto). Ojo: `jobs describe` **sin**
`--format` imprime las variables del job; no lo pegues en un issue ni en un log
público.

Y la prueba real, que es la única que dice que renderiza:

1. En el estudio, un video corto con motor canvas (sin HeyGen ni fal: no cuesta
   nada), apruébalo y genera.
2. ```
   gcloud run jobs executions list --job stickman-render --region us-central1 --limit 5
   ```
   Debe aparecer una ejecución nueva y terminar con `1/1` completada. El
   avance se ve en la fila del video (`render_status`, `render_progress`).
3. Si falla: `gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="stickman-render"' --limit 50 --freshness 1h`.
   Un `Memory limit exceeded` es el equivalente del `Killed` de Railway.

Lo que vive solo en el job (variables y referencias a Secret Manager) lo pone
`scripts/gcp-setup.sh`, no el workflow: un despliegue cambia la imagen y nada
más. Para cambiar una clave se vuelve a correr ese script en Cloud Shell.
`FAL_KEY` no está puesta a propósito, porque encenderla hace que cada render
cueste dólares; el script pregunta y por defecto la deja vacía.

**Costo.** El job vive en la capa gratuita de Cloud Run (2 vCPU, 4 GiB, máximo
30 min, sin reintentos: un render que falla no se cobra dos veces). Artifact
Registry guarda solo las 2 imágenes más nuevas (capa gratuita: 0,5 GB). Hay una
alerta de presupuesto `stickman-render-budget` (1 USD por defecto) que **solo
avisa por correo, no corta el gasto**. Si llega el correo, mira
`gcloud run jobs executions list` antes que nada: un bucle de ejecuciones es
lo único que aquí puede gastar en serio.

## Qué reportar

El sha que quedó vivo en producción (Vercel y, si el commit tocó el worker,
el `commit-sha` del job), el resultado de las tres comprobaciones y el de la
ejecución de prueba. Si alguna no da lo esperado, dilo con el código que salió en vez
de redondear a "todo bien" — y si la que falló es la del 401 al generar, trátalo como
urgente.
