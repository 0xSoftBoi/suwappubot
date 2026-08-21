# Build context is the monorepo root (same as webapp/ and terminal/), not
# showcase/. showcase depends on @suwappu/design-tokens via `file:../packages/
# design-tokens`, which is unreachable from a showcase-rooted context.
#
# The image mirrors the repo layout — /app/showcase next to /app/packages — so
# that relative spec resolves as written. Keeping the layout (rather than
# rewriting the path) is what lets this use --frozen-lockfile exactly like CI
# does: a rewritten path puts package.json out of sync with bun.lock, which
# forces a loose install here and lets lockfile drift ship undetected. It did
# once already.
FROM public.ecr.aws/docker/library/node:26-alpine AS deps
WORKDIR /app/showcase
# Pinned to match .github/workflows/test.yml. An unpinned `bun` resolved to a
# different version than the one that wrote bun.lock, and the frozen check is
# only meaningful when both ends agree.
RUN npm install -g bun@1.3.14
COPY packages/design-tokens/ /app/packages/design-tokens/
COPY showcase/package.json showcase/bun.lock ./
RUN bun install --frozen-lockfile

FROM public.ecr.aws/docker/library/node:26-alpine AS builder
WORKDIR /app/showcase
RUN npm install -g bun@1.3.14
# bun links `file:` deps, so the target has to exist in this stage too or the
# copied node_modules carries a dangling reference.
COPY packages/design-tokens/ /app/packages/design-tokens/
COPY --from=deps /app/showcase/node_modules ./node_modules
COPY showcase/ .
RUN mkdir -p public && bun run build

FROM public.ecr.aws/docker/library/node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/showcase/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/showcase/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/showcase/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
