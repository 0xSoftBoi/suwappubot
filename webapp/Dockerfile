# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace config
COPY package.json package-lock.json* ./

# Copy shared package
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src/
COPY packages/shared/tsconfig.json packages/shared/

# Copy webapp package files
COPY webapp/package.json webapp/

# Install dependencies (workspace-aware)
RUN npm install --workspace=webapp --include-workspace-root

# Copy webapp source files
COPY webapp/ webapp/

# Set production API URL
ARG VITE_API_URL=https://api.suwappu.bot
ENV VITE_API_URL=$VITE_API_URL

ARG VITE_TURNKEY_ORG_ID
ENV VITE_TURNKEY_ORG_ID=$VITE_TURNKEY_ORG_ID

ARG VITE_TURNKEY_RP_ID
ENV VITE_TURNKEY_RP_ID=$VITE_TURNKEY_RP_ID

ARG VITE_TURNKEY_PROXY_URL
ENV VITE_TURNKEY_PROXY_URL=$VITE_TURNKEY_PROXY_URL

# Build the app (skip type check for faster builds)
RUN cd webapp && npx vite build

# Production stage - nginx to serve static files
FROM nginx:alpine

# Copy custom nginx config
COPY webapp/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from builder
COPY --from=builder /app/webapp/dist /usr/share/nginx/html

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
