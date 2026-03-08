---
paths:
  - "api-ts/**/*.ts"
  - "api-ts/**/*.tsx"
---

# TypeScript API Rules (Hono + Effect-TS)

- Use `bun` for all operations (never `tsc`, `npm`, `npx`)
- Type check: `cd api-ts && bun run check`
- Effect-TS: Use `Context.Tag` + `Layer` + `ManagedRuntime`. Don't mix raw Promises with Effect — use `Effect.tryPromise()`
- postgres.js: Set `ssl: 'require'` in client options, NOT as URL query param
- Error types: `ValidationError` → 400, `NotFoundError` → 404, `DatabaseError` → 500
- Auth: `telegramAuth()` for webapp routes, `agentAuth()` for agent routes
- Always use `runEffectEither` to execute Effect pipelines in Hono handlers
- Drizzle ORM for database queries — `eq`, `desc`, `in_` from `drizzle-orm`
- Schema validation with `@effect/schema`, not manual checks
- Settings: `api-ts/src/config/EnvService.ts` (Effect Layer)
