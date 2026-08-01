# Building on Suwappu — integration-surface readiness

An assessment of what a third-party developer or AI agent actually encounters when they try to
build on Suwappu, measured against what leading OSS platform/SDK projects do. Every claim here was
checked against the live npm registry, the GitHub Actions API, or the code — not inferred.

Audit date: 2026-08-01.

## What's already good

Two things are genuinely well done and shouldn't regress:

- **The onboarding funnel.** `POST /v1/agent/register` grants free starter credits and returns a
  copy-pasteable first call. That's the same test-mode-first shape Stripe and Supabase use, and it's
  the single biggest determinant of whether an evaluation gets past minute five.
- **Idempotency on the money path.** `/v1/agent/swap/execute` accepts and validates an
  `Idempotency-Key`, scoped per agent (`api-ts/src/routes/agent.ts`). Many projects this size don't
  have this, and retrofitting it is painful.

An OpenAPI spec is generated (`api-ts/scripts/gen-openapi.ts` → `api-ts/openapi-agent.json`), which
is the foundation for generated clients later.

## Blockers, in priority order

### 1. Releases never ship (#674)

`.github/workflows/publish-sdk.yml` triggers only on `v*` tags and **has never run** — 0 runs in the
Actions API, against a repo with one tag. Result:

| Package | README claims | npm serves | repo |
|---|---|---|---|
| `@suwappu/sdk` | 0.3.0 | 0.4.0 (2026-03-09) | 0.5.2 |
| `@suwappu/mcp-server` | 0.5.0 | **0.1.1 (2026-03-08)** | not on `main` |
| `@suwappu/openclaw` | 0.2.0 | 0.2.0 | 0.2.0 |

Nothing else on this list matters while this is true — SDK improvements simply never reach the
people building on us. The MCP server is the worst case: it's the flagship agent integration, the
quickstart tells people to install it, and npm has served a five-month-old build the whole time.

**Fix:** adopt [Changesets](https://github.com/changesets/changesets) (PR-gated version bumps, fits
a monorepo) with npm provenance publishing via OIDC. Avoid fully automatic semantic-release
pre-1.0 — accidental major bumps are a known failure mode for small teams.

### 2. License mismatch (#675)

Root `LICENSE` is Apache-2.0; all three published packages declare MIT. Ambiguity here stalls
enterprise legal review. Needs an explicit decision — align, or dual-license deliberately and say so.

### 3. No runnable examples

There is no `examples/` directory (the README linked one that never existed). Examples convert
better than reference docs because they are copy-paste-run rather than read-and-translate.

**Exemplar:** Temporal ships `samples-typescript` / `samples-python`, scaffoldable with
`npx @temporalio/create --sample <name>`, each sample CI-tested so it can't rot.

**Fix:** `packages/sdk/examples/` with 3–5 self-contained scripts — get a quote, execute a swap on
testnet, listen for a webhook, list chains — each with its own `package.json` and exercised in CI.
A broken example is worse than no example, so the CI wiring is the point, not a nicety.

### 4. No versioning or deprecation policy

`/v1/agent/*` exists, but nothing states what "v1" guarantees, how a breaking change is announced,
or how long an old surface keeps working.

**Exemplar:** Stripe pins each account to a dated version, allows per-request override via a
`Stripe-Version` header, and lets you diff responses across versions before committing to an
upgrade.

**Fix:** add a `Suwappu-Version` request header and `Sunset` / `Deprecation` response headers
*now*. These are cheap to add before there's a v2 and expensive to retrofit after third parties
depend on current behaviour.

### 5. No CHANGELOG

There's no way for an integrator to see what changed between versions or judge whether an upgrade is
safe. Falls out of the Changesets work in item 1.

## Worth doing, lower urgency

- **Typed SDK errors.** viem exports a `BaseError` hierarchy so callers narrow by type instead of
  string-matching messages. Define `SuwappuApiError` subclasses mirroring the existing `agent.ts`
  error codes (rate limit, insufficient balance, unsupported chain).
- **Spec/client drift check.** The SDK is hand-written with no CI link to the generated OpenAPI
  spec, so the two can diverge silently. A CI job that fails on divergence is enough; full
  multi-language codegen is premature until there's a second client to keep in sync.
- **MCP tool annotations.** `api-ts/src/routes/mcp.ts` has good descriptions and input schemas but
  no `readOnlyHint` / `destructiveHint` / `idempotentHint`, and no rate-limit or latency text in the
  descriptions. Anthropic's
  [tool-writing guidance](https://www.anthropic.com/engineering/writing-tools-for-agents) calls out
  both. Cheap, additive, and directly improves how well agents use the tools.

## Deliberately not recommended

- **Fully automated semantic-release on every merge** — overkill pre-1.0 and prone to accidental
  major bumps. Changesets' PR-gated model is the safer default.
- **Stainless-style multi-language codegen** — solves a problem we don't have until there are
  several clients to keep in sync.

## Sources

- Stripe API versioning — https://docs.stripe.com/sdks/versioning · https://docs.stripe.com/upgrades
- Stripe webhook signatures — https://docs.stripe.com/webhooks/signature
- Temporal samples — https://github.com/temporalio/samples-typescript
- viem error handling — https://www.viem.sh/docs/error-handling
- npm provenance / secure release — https://evilmartians.com/chronicles/the-secure-way-to-release-an-npm-package
- Anthropic, writing tools for agents — https://www.anthropic.com/engineering/writing-tools-for-agents
