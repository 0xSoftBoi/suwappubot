# Base with bun installed (from ECR Public to avoid Docker Hub rate limits)
FROM public.ecr.aws/docker/library/debian:bookworm-slim AS bun-base
# Install bun into /usr/local (world-accessible) rather than /root/.bun — the runtime
# stage runs as the non-root `bun` user, which cannot traverse /root (mode 700) and would
# otherwise hit "bun: Permission denied" at container start.
RUN apt-get update && apt-get install -y curl unzip ca-certificates && \
    export BUN_INSTALL=/usr/local && \
    curl -fsSL https://bun.sh/install | bash && \
    rm -rf /var/lib/apt/lists/*

# Build stage
FROM bun-base AS builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --ignore-scripts
COPY . .
RUN mkdir -p drizzle

# Production stage
FROM bun-base AS runner
WORKDIR /app

# Create bun user
RUN useradd -m -u 1000 bun

COPY --from=builder --chown=bun:bun /app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /app/src ./src
COPY --from=builder --chown=bun:bun /app/drizzle ./drizzle
COPY --from=builder --chown=bun:bun /app/drizzle.config.ts ./
COPY --from=builder --chown=bun:bun /app/package.json ./
COPY --from=builder --chown=bun:bun /app/start.sh ./
COPY --from=builder --chown=bun:bun /app/agent-card.json ./
COPY --from=builder --chown=bun:bun /app/openapi-agent.json ./
COPY --from=builder --chown=bun:bun /app/ai-catalog.json ./
RUN chmod +x start.sh

USER bun

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD bun -e "fetch('http://localhost:8000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["./start.sh"]
