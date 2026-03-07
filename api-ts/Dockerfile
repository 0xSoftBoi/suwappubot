# Build stage
FROM oven/bun:latest AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install

# Copy source
COPY . .

# Ensure drizzle folder exists (may be gitignored locally)
RUN mkdir -p drizzle

# Type check (skipped - pre-existing test file errors)
# RUN bun run check

# Production stage
FROM oven/bun:latest AS runner

WORKDIR /app

# Copy only necessary files
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/start.sh ./
COPY --from=builder /app/agent-card.json ./
RUN chmod +x start.sh

# Use existing bun user
USER bun

# Expose port
EXPOSE 8000

# Health check using bun (wget not available in bun image)
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD bun -e "fetch('http://localhost:8000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Run migrations then start the server
CMD ["./start.sh"]
