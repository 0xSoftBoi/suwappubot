# Build stage
FROM public.ecr.aws/docker/library/node:20-slim AS builder
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
ENV VITE_API_URL=$VITE_API_URL

# Build the app
RUN bun run build

# Production stage - nginx to serve static files
FROM public.ecr.aws/nginx/nginx:alpine

# Copy custom nginx config
COPY terminal/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from builder
COPY --from=builder /app/dist /usr/share/nginx/html
RUN chmod -R 755 /usr/share/nginx/html

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
