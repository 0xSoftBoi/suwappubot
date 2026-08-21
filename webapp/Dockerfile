# Build stage
# Node 22 is the verified LTS for this lockfile and avoids build drift from
# floating install/runtime behavior on newer builders.
FROM node:22-alpine AS builder

# Mirror the monorepo layout so package.json's file:../packages/design-tokens
# and package-lock.json's relative resolution remain identical. This lets us
# use npm ci without rewriting package metadata inside the image.
WORKDIR /app/webapp

# Copy design-tokens dependency at the relative path the lockfile expects.
COPY packages/design-tokens/ /app/packages/design-tokens/

# Copy package files (context is monorepo root, so prefix with webapp/)
COPY webapp/package.json webapp/bun.lock* webapp/package-lock.json* ./

# Deterministic install straight from the committed lockfile.
RUN npm ci

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
COPY --from=builder /app/webapp/dist /usr/share/nginx/html
RUN chmod -R 755 /usr/share/nginx/html

EXPOSE 8080

# Health check must target the dynamic port (shell form so $PORT expands)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

CMD ["nginx", "-g", "daemon off;"]