# Build stage
FROM oven/bun:latest AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install

# Copy source
COPY . .

# Type check
RUN bun run check

# Production stage
FROM oven/bun:latest AS runner

WORKDIR /app

# Copy only necessary files
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

# Use existing bun user
USER bun

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

# Start the server
CMD ["bun", "run", "src/index.ts"]
