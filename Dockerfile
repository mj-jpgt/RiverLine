# RiverLine SDD — production container image.
# See docs/deploy/self-host.md for the full self-host handoff doc this
# image is built for.
#
# NOTE on `output: 'standalone'`: Next.js's standalone output mode would
# produce a much smaller final image (a pruned node_modules + a tiny
# server.js, no need to `pnpm install` in the runner stage at all). It
# requires one line in next.config.ts (`output: 'standalone'`) — but
# next.config.ts is owned by another concurrent workstream this wave and is
# off-limits here (see docs/deploy/self-host.md → "Documented follow-up:
# next.config.ts `output: 'standalone'`" for the exact diff and the
# corresponding Dockerfile changes it would enable). This image instead runs
# the plain `next start` path against a full production `node_modules` —
# it works today, is a bit larger, and is a one-line config change plus a
# small Dockerfile edit away from the smaller standalone image.
#
# Three stages: deps (install everything needed to build) -> build (next
# build, incl. the Serwist service-worker build via next.config.ts) ->
# runner (slim, prod-only deps, non-root user, next start).

########################################
# Stage 1: deps — full install (prod + dev) for building
########################################
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# python3/make/g++: some transitive deps (e.g. sharp) ship native addons
# with postinstall builds; bookworm-slim doesn't include a toolchain by
# default. Kept out of the final runner stage entirely.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

########################################
# Stage 2: build — compile the Next.js app (production build)
########################################
FROM deps AS build
WORKDIR /app

ENV NODE_ENV=production

COPY . .
# .dockerignore already strips test/, docs/, data/, uploads/, backups/, etc.
# out of the build context, so this COPY only brings in what next build
# actually needs.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && pnpm build

########################################
# Stage 3: runner — slim runtime image, non-root, prod deps only
########################################
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root runtime user (AGENTS.md / build spec §7 security posture).
RUN groupadd --gid 1001 riverline && \
    useradd --uid 1001 --gid riverline --shell /bin/bash --create-home riverline

# Full node_modules from the deps stage — deliberately NOT pruned to
# prod-only. Verified by a real failed run: `next start` loads
# next.config.ts (a TypeScript file) at BOOT, not just at build time, and
# transpiling it needs the `typescript` package present — which is a
# devDependency. `pnpm prune --prod` removed it, so the container tried to
# self-install typescript at runtime as the non-root `riverline` user and
# hit a pnpm store-ownership mismatch against the store the root-run build
# stage created (`ERR_PNPM_UNEXPECTED_STORE`) — a genuine boot failure, not
# a hypothetical. Shipping the full node_modules (including devDependencies
# like typescript) avoids the whole class of problem; the tradeoff is a
# larger image, in the same spirit as the non-standalone `next start` path
# this Dockerfile already documents above. `output: 'standalone'` (the
# documented follow-up) prunes this automatically and correctly, because it
# ships a pre-transpiled next.config as part of its own build output.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./package.json

# Everything `next start` needs at runtime: the compiled build output, the
# static/public assets (including the Serwist service worker emitted to
# public/sw.js during `pnpm build`), next.config.ts (read at boot), and the
# app/src source trees (next start's non-standalone server resolves some
# runtime pieces — e.g. instrumentation, route metadata — against the
# project directory, not purely .next/server).
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/app ./app
COPY --from=build /app/src ./src

# Migration machinery (scripts/db/migrate.mjs + migrations/*.sql), run by
# docker-entrypoint.sh on container boot, before `next start`.
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts/db ./scripts/db
COPY --from=build /app/scripts/ops ./scripts/ops
COPY --from=build /app/schema ./schema

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Uploaded photo / letter storage (docs/deploy/self-host.md — filesystem
# storage under UPLOADS_ROOT = process.cwd()/uploads; mounted as a named
# volume in docker-compose.prod.yml). Created and owned by the runtime user
# up front so a fresh bind/volume mount doesn't start out root-owned.
RUN mkdir -p /app/uploads && chown -R riverline:riverline /app

USER riverline

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node_modules/.bin/next", "start"]
