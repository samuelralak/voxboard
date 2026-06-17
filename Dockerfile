# syntax=docker/dockerfile:1
# Voxboard web (apps/web) — multi-stage standalone build for Fly.io.
# Build context MUST be the monorepo ROOT (`fly deploy` from the root) so the root lockfile + every
# workspace package.json + the packages/protocol TS source are present. @voxboard/protocol is consumed
# as TS source via transpilePackages, so it is compiled into apps/web's build output.
ARG NODE_VERSION=24-slim

# --- base -------------------------------------------------------------------
# NODE_ENV is intentionally NOT set to production here. It is set ONLY in the runner stage, so that the
# `npm ci` in deps installs the build toolchain (devDependencies) that `next build` needs. (Next forces
# production mode during the build itself regardless of NODE_ENV.)
FROM node:${NODE_VERSION} AS base
WORKDIR /app

# --- deps: install ALL workspaces from the root lockfile --------------------
# Copy manifests FIRST so this layer caches until a package.json/lockfile change. ALL workspace
# package.jsons are required — `npm ci` validates the whole lockfile against the declared workspaces.
# This installs devDependencies too (the build toolchain: tailwindcss, @tailwindcss/postcss, typescript,
# needed to RUN `next build`). They are BUILD-time only: the runner stage discards node_modules entirely
# and ships just the standalone trace, so none reach the runtime image. NODE_ENV is left unset here on
# purpose — setting it to "production" would make `npm ci` omit devDeps and break the CSS/TS compile.
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/indexer/package.json apps/indexer/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# --- build: copy source, build apps/web -------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* are INLINED at `next build` and cannot change without a rebuild. Empty for v1 (indexer
# deferred -> apps/web/lib/indexer.ts no-ops). Passed via fly.toml [build.args] / `fly deploy --build-arg`.
ARG NEXT_PUBLIC_INDEXER_URL=""
ENV NEXT_PUBLIC_INDEXER_URL=${NEXT_PUBLIC_INDEXER_URL}
# The attestation service base URL the board create/edit hook posts to (empty = attestation off).
ARG NEXT_PUBLIC_ATTESTATION_URL=""
ENV NEXT_PUBLIC_ATTESTATION_URL=${NEXT_PUBLIC_ATTESTATION_URL}
# Requires output:'standalone' + outputFileTracingRoot=repo root in next.config.ts.
RUN npm run build -w web

# --- runner: minimal standalone image, no node_modules install --------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
# The standalone server.js reads PORT + HOSTNAME. On Fly the app MUST bind 0.0.0.0 (not localhost) and
# internal_port in fly.toml MUST equal PORT.
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# outputFileTracingRoot = repo root, so the standalone tree mirrors the monorepo: server.js lives at
# apps/web/server.js (verified locally). standalone does NOT include static/public — copy them explicitly.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
