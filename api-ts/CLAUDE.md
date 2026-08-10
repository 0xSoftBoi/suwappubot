# api-ts/ — TypeScript API rules

Scope: Hono routes (`src/routes/`), Effect-TS services, Drizzle ORM
(`src/db/schema/`), A2A/MCP agent surface.

- **Tooling is `bun` only**: `bun run dev|build|check|test`. Never bare `tsc`
  (hangs) or `npm`/`npx`. Type-check incrementally with `bun run check`.
- **Effect-TS discipline**: services use `Context.Tag` + `Layer` +
  `ManagedRuntime`. Never mix raw Promises into Effect pipelines — wrap with
  `Effect.tryPromise()`. Env config comes from `src/config/EnvService.ts`
  (Effect Layer), not `process.env` reads.
- **CI checks OpenAPI and MCP schema drift** — if you change a route or MCP
  tool, regenerate the specs or CI fails.
- **Drizzle schema changes** must mirror the Python runtime migration in
  `database/db.py:_ensure_schema()` (shared DB, ADR 0003). Follow `docs/development/migrations.md`.
- **Shared types** live in `packages/sdk/src/types.ts` (`@suwappu/sdk`) — changes ripple to webapp,
  mobile, and SDKs; check all three consumers.
- New endpoints: copy an existing route file as the template. Agent-facing changes should keep
  the agent card (`/.well-known/agent-card.json`) and registry listings
  consistent — `bash scripts/verify.sh agent`.
- This service is what `api.suwappu.bot` serves in prod.
