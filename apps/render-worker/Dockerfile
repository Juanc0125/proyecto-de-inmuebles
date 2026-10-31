# Render worker image for Google Cloud Run Jobs: one execution = one video.
# Build context is apps/render-worker (it has its own package-lock.json):
#
#   docker build -t render-worker apps/render-worker
#   docker run --rm -e RENDER_JOB_B64=<base64 job> render-worker
#
# The default command is the one-shot job (run-job.ts). The same image still
# runs the HTTP server with `node dist/index.js` (NODE_ENV=production here, so
# /render then requires RENDER_WORKER_TOKEN).

# ---- build: install, compile, fetch ffmpeg and bake the voice model ----
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts, then the one install script this worker needs, run by
# hand: newer npm releases can skip dependency install scripts unless they
# are allowed, and a skipped ffmpeg-static script fails silently (the package
# installs, the binary is just missing) and only shows up as a failed render.
# esbuild (tsx, dev only) is the only other package with a script and the
# build does not use it. @napi-rs/canvas ships its Linux binary as an
# optional dependency (no script); sherpa-onnx is WebAssembly.
RUN npm ci --ignore-scripts --no-audit --no-fund \
	&& node node_modules/ffmpeg-static/install.js \
	&& FFMPEG="$(node -p "require('ffmpeg-static')")" \
	&& "$FFMPEG" -hide_banner -encoders | grep -q libx264 \
	&& "$FFMPEG" -hide_banner -version | head -n 1 \
	&& node -e "require('@napi-rs/canvas').createCanvas(8, 8).getContext('2d')"

COPY tsconfig.json ./
COPY *.ts ./
COPY scripts/bake-voice.mjs ./scripts/
RUN npm run build

# Baked into the image so an execution never downloads ~67MB before its first
# scene; the script also narrates a test sentence, so a broken model fails
# the build instead of shipping silent videos.
ENV VOICE_CACHE_DIR=/opt/voice-cache
RUN node scripts/bake-voice.mjs

RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

# ---- runtime ----
FROM node:24-bookworm-slim
# ca-certificates: ffmpeg opens https inputs itself (narration, music, logo).
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
	VOICE_CACHE_DIR=/opt/voice-cache
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Owned by the runtime user: the ElevenLabs phrase cache writes under it.
COPY --from=build --chown=node:node /opt/voice-cache /opt/voice-cache

# renders/ is created under the working directory at run time; on Cloud Run
# it lives in memory, which is why render.ts deletes intermediates early.
RUN mkdir -p /app/renders && chown node:node /app /app/renders
USER node

CMD ["node", "dist/run-job.js"]
