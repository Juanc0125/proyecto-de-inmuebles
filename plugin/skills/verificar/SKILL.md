---
name: verificar
description: La puerta de calidad completa de Stickman antes de un commit o un push - libera los puertos, corre `npm run verify` (lint, tipos y los dos builds), corre la suite end-to-end sin gastar dinero en fal, y revisa si el grafo de conocimiento quedó desactualizado. Úsala siempre que alguien pida verificar, validar, probar, correr las pruebas, "está listo para subir", "pasa QA", o antes de cualquier commit o push a master en este repositorio, aunque no nombre la palabra verificar. También cuando un build falle con EPERM, porque casi nunca es un error de código.
---

# Verificar: la puerta de calidad

Esta secuencia se corrió muchas veces a mano y se hizo mal varias: builds que
fallaron con `EPERM` por un servidor de desarrollo olvidado, una suite que casi
gasta dólares reales en fal, un agente que dio el visto bueno sin haber corrido
el `next build`. Cada paso de aquí abajo existe porque algo salió mal sin él.

Corre todo desde la raíz del repositorio.

## 1. Liberar los puertos

```
powershell -File plugin/skills/verificar/scripts/liberar-puertos.ps1
```

El servidor de desarrollo mantiene tomado `apps/web/.next`, y `next build`
contra un directorio tomado falla con `EPERM`. **`EPERM` casi nunca es un error
de código**: es este. OneDrive sincronizando la carpeta produce lo mismo, que es
parte de por qué el repositorio debería vivir fuera de OneDrive.

El script mata también al proceso padre. Matar solo al que escucha no sirve:
`npm run dev` lo supervisa y lo vuelve a levantar en un segundo.

## 2. Borrar la salida del build anterior

```
rm -rf apps/web/.next
```

Barato, y evita que un artefacto viejo enmascare un fallo nuevo.

## 3. Verificar

```
npm run verify
```

Son cuatro cosas: `lint`, `check:types` del worker, y el build de `apps/web` y
del worker. **Mira el código de salida, no el último renglón.** Un agente de
esta casa reportó "verde" habiéndose saltado el `next build` porque el dev
server seguía arriba; el hueco solo se vio al preguntarle explícitamente.

Hay tres advertencias preexistentes de `window.location.href` en `api.ts`,
`login-form.tsx` y `video-studio.tsx`. No son tuyas y no bloquean.

## 4. Revisar que el `.gitignore` no se haya ensuciado

```
git status --short
```

Algo del herramental le añade `.vercel` y `.env*` al final del `.gitignore` sin
que nadie lo pida — no está identificado qué, y el sospechoso es la CLI de
Vercel (`vercel link`). Si aparece modificado:

```
git checkout -- .gitignore
```

Importa porque ese `.env*` sacaría del control de versiones a
`apps/render-worker/.env.local.example` y `apps/web/.env.local.example`, que son
justamente los archivos que documentan qué variables hacen falta. Se perdería en
silencio y nadie lo notaría hasta que alguien clonara el repo y no supiera qué
configurar.

## 5. Levantar el entorno para la suite

```
npm run dev
```

Espera a que respondan los dos: `http://localhost:3000/login` y
`http://localhost:8080/health`. El worker corre con `tsx` sin watch, así que
lleva el código que hubiera cuando se levantó.

## 6. Comprobar que la suite no va a gastar dinero

Mira qué motor reporta el worker:

```
curl -s http://localhost:8080/health
```

Si `video_engine` **no** es `canvas`, la suite haría un render real contra
fal.ai, que cobra por segundo de video — unos USD 2,70 por uno de 30 segundos.
La suite ya se niega a correr en ese caso y explica cómo seguir, pero conviene
saberlo antes de perder cinco minutos.

Para correrla gratis, levanta el entorno con **todas** las claves de pago
neutralizadas, no solo la de fal:

```
FAL_KEY=" " HEYGEN_API_KEY=" " ELEVENLABS_API_KEY=" " npm run dev
```

`process.loadEnvFile` no pisa una variable que ya viene definida, y el `.trim()`
del worker la deja vacía, así que dibuja con canvas. Las otras dos importan
igual: con `HEYGEN_API_KEY` cada escena sería un avatar de HeyGen (cobra por
video) y con `ELEVENLABS_API_KEY` la narración cobraría por carácter. Antes de
lanzar la suite, confirma en `/health` que `video_engine` dice `canvas` y que
ni `heygen` ni `voice` reportan un motor de pago.

## 7. La suite end-to-end

```
npm run e2e
```

Son 42 comprobaciones e incluyen un render de verdad con descarga del MP4, así
que tarda unos minutos. Recorre el flujo entero: guion, escenas, marca, la
puerta de aprobación, publicar, duplicar, plantillas, el lote y el copiloto.

Si el login falla con 401, el problema es de credenciales, no de código: la
suite entra con `E2E_EMAIL`/`E2E_PASSWORD` de `.env.local`, y cae al usuario
demo si no existen.

## 8. Retroalimentar el grafo

```
node plugin/skills/verificar/scripts/grafo-pendiente.mjs
```

El grafo de `graphify-out/` es lo que responde "¿esto ya existe?" antes de
escribir código nuevo. Si está desactualizado, responde con estructura vieja y
alguien construye por segunda vez algo que ya estaba — en este proyecto ya pasó,
con el worker redeclarando los tipos del dominio.

El script compara la fecha de cada archivo rastreado contra la última vez que el
grafo lo leyó, y deduce del propio manifiesto qué extensiones indexa, para no
dar falsas alarmas sobre cosas que graphify descarta a propósito.

Qué hacer con el resultado:

- **Solo código** → el enganche de post-commit lo reconstruye en el próximo
  commit. No hagas nada.
- **Documentos o imágenes** → el enganche **no** los cubre. Pásale la lista a
  `graphify-agent` para una corrida completa, antes del push.

## Cerrar

Deja el entorno como lo encontraste. Si detuviste el servidor de desarrollo para
el build, vuelve a levantarlo y confirma que 3000 y 8080 escuchan otra vez —
quien te pidió verificar probablemente lo estaba usando.

## Qué reportar

Di el resultado de cada paso, no un resumen optimista. En concreto: el código de
salida de `verify`, cuántas comprobaciones de la suite pasaron y cuántas
fallaron, si el `.gitignore` se ensució, y qué dijo el detector del grafo.

Si algo falla, **antes de arreglarlo determina si falla la prueba o falla el
código**. En este repositorio ya pasó dos veces que la prueba estaba mal y el
código bien: una comprobación afirmaba el reparto de respaldo y empezó a fallar
justamente porque la IA comenzó a funcionar.
