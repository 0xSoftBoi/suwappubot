# Build stage
FROM node:26-alpine AS builder

WORKDIR /app

# Copy design-tokens dependency first (referenced as file:../packages/design-tokens)
COPY packages/design-tokens/ /packages/design-tokens/

# Copy package files (context is monorepo root, so prefix with webapp/)
COPY webapp/package.json webapp/bun.lock* webapp/package-lock.json* ./
RUN sed -i 's|file:../packages/design-tokens|file:/packages/design-tokens|' package.json

# NOTE: intentionally `npm install`, not `npm ci`. The sed above rewrites the
# `file:` dep path in package.json, but package-lock.json's matching
# "resolved" entry still points at the original relative path — `npm ci`
# requires exact package.json/lockfile sync and fails with EUSAGE on that
# mismatch (verified locally). `npm install` tolerates the drift and
# re-resolves the local dep correctly. Terminal (bun) doesn't hit this
# because bun's lockfile resolution isn't as strict about `file:` deps.
RUN npm install

# Copy source files
COPY webapp/ .

# Build-time config — only real import.meta.env.VITE_* vars read by webapp/src
ARG VITE_API_URL=https://api.suwappu.bot
ARG VITE_TURNKEY_ORG_ID
ARG VITE_TURNKEY_PROXY_URL
ARG VITE_TURNKEY_RP_ID
ARG VITE_ALCHEMY_API_KEY
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_TURNKEY_ORG_ID=$VITE_TURNKEY_ORG_ID
ENV VITE_TURNKEY_PROXY_URL=$VITE_TURNKEY_PROXY_URL
ENV VITE_TURNKEY_RP_ID=$VITE_TURNKEY_RP_ID
ENV VITE_ALCHEMY_API_KEY=$VITE_ALCHEMY_API_KEY

# Build the app (skip type check for faster builds)
RUN npx vite build

# Production stage - nginx to serve static files
FROM public.ecr.aws/nginx/nginx:alpine

# As a TEMPLATE: the nginx image entrypoint runs envsubst over /etc/nginx/templates/*.template
# at startup, substituting only real env vars (e.g. $PORT) — nginx's own $uri /
# $binary_remote_addr are left untouched since they aren't env vars.
COPY webapp/nginx.conf /etc/nginx/templates/default.conf.template

# Default for local runs; Railway injects its own $PORT and overrides this.
ENV PORT=8080

# Copy built files from builder
COPY --from=builder /app/dist /usr/share/nginx/html
RUN chmod -R 755 /usr/share/nginx/html

EXPOSE 8080

# Health check must target the dynamic port (shell form so $PORT expands)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
