# syntax=docker/dockerfile:1
# Voxboard attestation signer (apps/attestation) — bundled single-file deploy for Fly.io.
# Build context MUST be the monorepo ROOT so the root lockfile + every workspace package.json + the
# packages/protocol TS source are present (the service depends on the @voxboard/protocol workspace, which
# is consumed as TS source and bundled by esbuild). Deploy with:
#   fly deploy --config apps/attestation/fly.toml --dockerfile apps/attestation/Dockerfile   (run from repo root)
ARG NODE_VERSION=24-slim

FROM node:${NODE_VERSION} AS base
WORKDIR /app

# --- deps: install ALL workspaces (incl esbuild) from the root lockfile -----
# Copy manifests first so this layer caches until a package.json/lockfile change. ALL workspace
# package.jsons are required: `npm ci` validates the whole lockfile against the declared workspaces.
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/indexer/package.json apps/indexer/package.json
COPY apps/attestation/package.json apps/attestation/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# --- build: bundle the service + protocol source into ONE file --------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run bundle -w @voxboard/attestation

# --- runner: just node + the bundle, NO node_modules ------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
# Node 24 ships a global WebSocket (nostr-tools SimplePool uses it). The server binds 0.0.0.0:$PORT.
ENV PORT=8080
COPY --from=build --chown=node:node /app/apps/attestation/dist/server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
