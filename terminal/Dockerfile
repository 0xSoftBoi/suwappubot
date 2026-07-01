# Build stage
FROM public.ecr.aws/docker/library/node:26-slim AS builder
RUN npm install -g bun

WORKDIR /app

# Copy design-tokens dependency first (referenced as file:../packages/design-tokens)
COPY packages/design-tokens/ /packages/design-tokens/

# Copy package files with adjusted path for design-tokens
COPY terminal/package.json terminal/bun.lock* ./
RUN sed -i 's|file:../packages/design-tokens|file:/packages/design-tokens|' package.json

# Install dependencies
RUN bun install --no-frozen-lockfile

# Copy source files
COPY terminal/ .

# Set production API URL
ARG VITE_API_URL=https://api.suwappu.bot
ARG VITE_WC_PROJECT_ID
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WC_PROJECT_ID=$VITE_WC_PROJECT_ID

# Build the app
RUN bun run build

# Production stage - nginx to serve static files
FROM public.ecr.aws/nginx/nginx:alpine

# As a TEMPLATE: the nginx image entrypoint runs envsubst over /etc/nginx/templates/*.template
# at startup, substituting only real env vars (e.g. $PORT) — nginx's own $uri /
# $binary_remote_addr are left untouched since they aren't env vars.
COPY terminal/nginx.conf /etc/nginx/templates/default.conf.template

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
