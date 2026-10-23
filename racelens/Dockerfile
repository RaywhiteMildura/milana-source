# RaceLens – container image for hosted deployments (Fly.io, Render, any Docker host).
#
# Multi-stage: the first stage installs everything and builds the web app and
# the server; the final image carries only the built files and the production
# dependencies. The app runs as the unprivileged "node" user.
#
#   docker build -t racelens .
#   docker run -p 4850:4850 -v racelens_data:/data -e RACELENS_PASSWORD=choose-one racelens
#
# The image sets RACELENS_ALLOWED_HOSTS=*, which marks the server as hosted: without
# RACELENS_PASSWORD it stops at once with "Refusing to start" (add -e RACELENS_ALLOW_OPEN=1
# only on a private network you trust). Add -e RACELENS_PUBLIC_URL=https://your.address so
# Settings shows the phone address, and -e RACELENS_TRUST_PROXY=1 only when a reverse proxy
# (one that sets X-Forwarded-For) is the only way in - Fly.io and Render are detected by themselves.
#
# See docs/DEPLOY.md for the step-by-step guides.

# ---- build stage -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Dev dependencies are needed here (vite, typescript); they are pruned below.
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

# ---- runtime stage -----------------------------------------------------------
FROM node:22-alpine
# su-exec lets the entrypoint start as root (to take ownership of a freshly
# mounted volume) and then drop to the "node" user before the app runs.
RUN apk add --no-cache su-exec
ENV NODE_ENV=production \
    RACELENS_HOST=0.0.0.0 \
    RACELENS_PORT=4850 \
    RACELENS_ALLOWED_HOSTS=* \
    RACELENS_DATA_DIR=/data \
    RACELENS_QR=0
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The bundled sample meeting, so RACELENS_MODE=demo also works inside the container.
COPY --from=build /app/fixtures/demo ./fixtures/demo
# Entrypoint: hosting platforms mount the data volume owned by root, which a
# non-root process could not write to. When the container starts as root the
# entrypoint hands the data dir to "node" and drops privileges; when it is
# started as a non-root user already (docker run --user node) it just runs.
RUN printf '%s\n' \
      '#!/bin/sh' \
      'set -e' \
      'DIR="${RACELENS_DATA_DIR:-/data}"' \
      'mkdir -p "$DIR" 2>/dev/null || true' \
      'if [ "$(id -u)" = "0" ]; then' \
      '  chown -R node:node "$DIR" 2>/dev/null || true' \
      '  exec su-exec node "$@"' \
      'fi' \
      'exec "$@"' \
      > /app/docker-entrypoint.sh \
    && chmod 755 /app/docker-entrypoint.sh \
    && mkdir -p /data \
    && chown -R node:node /app /data
VOLUME /data
EXPOSE 4850
# Alpine has no curl; Node 22's built-in fetch does the job. /api/health is public (no login needed).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.RACELENS_PORT || 4850) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/server/index.js"]
