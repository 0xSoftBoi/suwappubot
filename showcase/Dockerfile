# Build context is the monorepo root (same as webapp/ and terminal/), not
# showcase/. showcase depends on @suwappu/design-tokens via `file:../packages/
# design-tokens`, which is unreachable from a showcase-rooted context.
FROM public.ecr.aws/docker/library/node:26-alpine AS deps
WORKDIR /app
RUN npm install -g bun

# Copy the design-tokens dependency to an absolute path and rewrite the
# relative spec to match — the `..` in the manifest has no meaning inside
# the image.
COPY packages/design-tokens/ /packages/design-tokens/
COPY showcase/package.json showcase/bun.lock ./
RUN sed -i 's|file:../packages/design-tokens|file:/packages/design-tokens|' package.json

# NOT --frozen-lockfile: the sed above puts package.json out of sync with
# bun.lock's recorded `file:` path, which a frozen install rejects. Same
# tradeoff terminal/Dockerfile makes.
RUN bun install --no-frozen-lockfile

FROM public.ecr.aws/docker/library/node:26-alpine AS builder
WORKDIR /app
RUN npm install -g bun
# bun symlinks `file:` deps, so the target has to exist in this stage too or
# the copied node_modules has a dangling link.
COPY packages/design-tokens/ /packages/design-tokens/
COPY --from=deps /app/node_modules ./node_modules
COPY showcase/ .
RUN mkdir -p public && bun run build

FROM public.ecr.aws/docker/library/node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
