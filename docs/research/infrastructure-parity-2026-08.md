# Developer Infrastructure Parity Benchmark — 2026-08

**Status:** point-in-time competitive research and implementation gap analysis  
**Verified:** 2026-08-21  
**Scope:** developer platform, API/SDK contract, operational trust, money-moving safety, and agent-native integration.  
**Not scope:** feature-count marketing or unsupported claims about competitor commercial performance.

## Why this benchmark exists

A polished README is not infrastructure parity. The relevant benchmark is whether a developer or risk team can answer, from public artifacts and machine-readable contracts:

1. What is the first safe request I can make?
2. Which interface and version am I integrating against?
3. Which capabilities are live, experimental, deprecated, or scheduled for removal?
4. What can move funds, and what remains read-only or unsigned?
5. What auth scope, rate limit, retry, and idempotency behavior applies?
6. How do I test without risking production funds?
7. How do I debug a failed request and correlate it with provider logs?
8. How will I learn about breaking changes before they break me?
9. Which SDK versions are supported and how are they generated/tested against the API contract?
10. What operational/security evidence can I independently inspect?

Parity means meeting those properties with Suwappu-native implementations. It does **not** mean copying every dashboard feature from every peer.

## Benchmark set

The peer set intentionally mixes general developer infrastructure with crypto-native money-moving infrastructure.

| Peer | Why it is in the benchmark | Verified public evidence |
|---|---|---|
| **Stripe** | API lifecycle, test/live separation, idempotency, SDK/reference quality, developer tooling | https://docs.stripe.com/api · https://docs.stripe.com/changelog · https://docs.stripe.com/upgrades |
| **Cloudflare** | generated API/SDK surface, permission documentation, contextual errors, deprecations, changelog/RSS | https://developers.cloudflare.com/fundamentals/api/ · https://developers.cloudflare.com/fundamentals/api/reference/deprecations/ · https://developers.cloudflare.com/fundamentals/reference/sdk-ecosystem-support-policy/ · https://developers.cloudflare.com/changelog/ |
| **Supabase** | endpoint-level scopes/permissions, rate-limit contract, OpenAPI, breaking-change timelines | https://supabase.com/docs/reference/api/usage · https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes · https://supabase.com/changelog?types=breaking-change |
| **Vercel** | task-oriented onboarding, rollout/rollback and operational developer workflow | https://vercel.com/docs · https://vercel.com/docs/getting-started-with-vercel |
| **Temporal** | concepts/quickstart/developer-guide/deploy/reference separation and durable operational semantics | https://docs.temporal.io/ |
| **Alchemy** | one-key onboarding, request explorer, webhooks, multi-chain capability discovery, throughput guidance | https://www.alchemy.com/docs/get-started · https://www.alchemy.com/docs/alchemy-request-logs · https://www.alchemy.com/docs/reference/notify-api-quickstart · https://www.alchemy.com/docs/reference/throughput |
| **0x** | money-path quickstart, allowance safety, API lifecycle/sunset policy, executable quote/transaction contract | https://docs.0x.org/docs/introduction/quickstart/swap-tokens-with-0x-swap-api · https://docs.0x.org/docs/upgrading/overview · https://docs.0x.org/cross-chain/cross-chain-api/guides/get-started |
| **LI.FI** | cross-chain API/SDK integration choices, read-only vs transactional boundaries, live capability discovery | https://docs.li.fi/ |
| **Privy** | programmable wallet policy, idempotent transaction semantics, quorum approvals, production security posture | https://www.privy.io/security · https://www.privy.io/keys · https://www.privy.io/organization-wallets |
| **Turnkey** | shared-responsibility security model, policy-controlled signing, verifiable/reproducible enclave infrastructure | https://www.turnkey.com/what-is-turnkey · https://www.turnkey.com/security-by-turnkey · https://www.turnkey.com/blog/digital-asset-security-secure-verifiable-reproducible |

## What the leaders actually do

### 1. They make the dangerous transition explicit

0x does not teach a swap as one opaque `swap()` call. Its EVM quickstart walks through **indicative price → allowance → firm quote → submit** and warns integrators not to approve the wrong spender. Its cross-chain guide continues through settlement-status monitoring.

Privy and Turnkey likewise treat authorization and signing as policy-controlled infrastructure rather than an SDK convenience. This is the right comparison for Suwappu's Discover → Quote → Simulate → Prepare → Managed Execute ladder.

**Suwappu status:** strong. The authority ladder and prepare-vs-managed split are now explicit in the README, quickstart, Agent REST docs, MCP semantics, and `docs/product-status.md`.

### 2. The schema is a product, not an export artifact

Cloudflare's SDKs are generated from OpenAPI and have an explicit support lifecycle. Supabase's Management API reference exposes scopes, fine-grained permissions, response codes, rate limits, and deprecation state at endpoint level. 0x requires an explicit API-version header for v2 and publishes migration/sunset guidance.

**Suwappu status:** partial. OpenAPI 3.1 exists and request-schema drift is checked against Zod, but prose/examples remain hand-authored and several independent version/count claims can drift.

Verified repository examples on 2026-08-21:

- `showcase/src/data/stats.generated.json`: 45 platform chains / 18 Agent API chains / 21 chain-gated routers.
- `api-ts/openapi-agent.json`: description still says `7+ chains`; `info.version` is `0.5.0`.
- `api-ts/package.json`: `@suwappu/api-ts` is `0.4.0`.
- `packages/sdk/package.json`: source SDK is `0.6.0`.
- `packages/mcp-server/package.json`: source MCP bridge is `0.6.0`.
- `api-ts/src/app.ts` `llms.txt`: describes agent execution across `40+ chains` and separately hand-lists routes/chains/packages.
- The same `llms.txt` advertises `PyPI: suwappu` while the current repository product-status contract marks the Python SDK source-only.

Those versions can be intentionally independent, but the relationship is not currently defined as a public compatibility contract.

### 3. They separate environment lifecycle from package version

Stripe makes test/sandbox vs live credentials and objects explicit. Alchemy quickstarts commonly use devnets for transaction-bearing examples. 0x labels beta surfaces and gives lifecycle state. Cloudflare labels early access / active support / end of life.

**Suwappu status:** partial. The OpenAPI spec advertises production and `devapi.suwappu.bot` development servers, but there is no canonical public sandbox contract describing data persistence, fake vs real funds, supported chains/providers, reset behavior, quotas, or promotion-to-live workflow.

### 4. They publish change lifecycle before removal

Cloudflare publishes deprecation date, end-of-life date, replacement endpoints, migration guidance, and RSS. Supabase breaking-change posts include exact effective dates and affected integrations. 0x documented v1 lifecycle stages and a hard sunset date with migration guides.

**Suwappu status:** gap. A public changelog exists, but there is no normative API/SDK deprecation policy, minimum notice window, sunset metadata, migration-guide requirement, or deprecation signal in OpenAPI/HTTP responses.

### 5. They make debugging a first-class developer surface

Alchemy exposes request logs with filters by app/network/method/status/error/latency and an inspectable request/response view. Cloudflare is adding contextual `documentation_url` links to denied API calls so humans and agents can immediately find the required permission docs.

**Suwappu status:** partial. `X-Request-ID`, response timing, Sentry/OpenTelemetry hooks, structured agent error codes, and audit logs exist, but external developers do not have an Alchemy-style request explorer or request-ID lookup surface. Error envelopes do not consistently include a canonical documentation URL/remediation link.

### 6. They define rate-limit and retry behavior as protocol

Cloudflare documents standard rate-limit headers and SDK backoff behavior. Supabase documents per-scope limits, response headers, endpoint exceptions, and recommended exponential backoff. Alchemy documents throughput semantics and retry guidance.

**Suwappu status:** partial/strong. The Agent OpenAPI documents tier limits and `Retry-After` / `X-RateLimit-*` headers, and pricing exposes higher commercial limits. Remaining work is to make one generated limit table authoritative across OpenAPI, pricing, docs, runtime configuration, and SDK retry policy.

### 7. Money-moving APIs make idempotency non-optional

Stripe's API model popularized explicit idempotency for retried writes. Privy documents idempotent transaction behavior. Suwappu's current SDK docs already require a durable idempotency key for managed execution and tell callers to reconcile an unknown outcome before retrying.

**Suwappu status:** strong on the managed-swap path; incomplete as a platform-wide write contract. Every externally retriable money-moving endpoint should either support idempotency or explicitly document why it cannot.

### 8. Webhooks have a delivery contract, not just a callback URL

Alchemy documents HMAC verification, test delivery, ordering, automatic retries, and retry windows. Mature webhook providers also document duplicate delivery, replay handling, event identifiers, and signature rotation.

**Suwappu status:** partial. Signed swap-state webhooks and a test endpoint exist, but the public contract needs one canonical page for signature algorithm, exact signed bytes, timestamp/replay window, ordering guarantee, retry schedule, duplicate semantics, event IDs, retention, and key rotation.

### 9. SDK support is explicit

Cloudflare publishes lifecycle stages, support for the latest major, semver expectations, migration guidance, and pinning advice. Alchemy marks recommended SDK major versions and links migration guides. Stripe maintains version-aware SDK/API documentation across languages.

**Suwappu status:** gap/partial. TypeScript is published and source can be ahead; Python is source-only; the MCP bridge has its own registry/source boundary. There is no canonical SDK support matrix with runtime requirements, supported versions, release cadence, EOL policy, API compatibility range, or generated-contract conformance.

### 10. Security claims are independently inspectable

Privy publicly lists completed external audits and SOC 2 Type II status and publishes security architecture material. Turnkey goes further toward remote attestation, reproducible builds, and operation proofs. Both are explicit about programmable policy/approval controls.

**Suwappu status:** partial and correctly conservative. The public security page lists real controls and explicitly says SOC 2/public audit reports/trust portal are not yet complete. That honesty should remain. Parity requires accumulating the evidence, not changing the copy.

## Parity matrix

Legend: **Strong** = materially meets the benchmark property; **Partial** = capability exists but contract/evidence is incomplete; **Gap** = missing as a public/developer guarantee; **Ahead** = Suwappu has a meaningful capability most peers do not expose in the same way.

| Capability | Benchmark behavior | Suwappu 2026-08-21 | Priority |
|---|---|---|---|
| Task-oriented first success | one short successful request before internals | **Strong** | Maintain |
| Money-path authority boundaries | read/quote/simulate/sign/execute separated | **Strong** | Maintain |
| Machine-readable OpenAPI | schema + examples + stable generated contract | **Partial** | **P0** |
| API version lifecycle | explicit major version, migration, sunset policy | **Gap** | **P0** |
| Supported sandbox/test environment | documented non-production semantics | **Partial** | **P0** |
| Auth scopes/permissions | endpoint-level required scopes + least privilege | **Partial** | **P0/P1** |
| Rate-limit protocol | one authoritative limits table + headers + retry | **Partial/Strong** | P1 |
| Write idempotency | all retriable money writes state semantics | **Partial/Strong** | P1 |
| Webhook delivery contract | signatures + replay + retry + ordering + duplicates | **Partial** | P1 |
| Request debugging | request explorer / request-ID lookup | **Gap** | **P1** |
| Public status + incident history | health, incidents, historical reliability/SLO | **Partial** | P1 |
| Changelog/deprecations | structured breaking/deprecation feeds + dates | **Partial/Gap** | **P0** |
| SDK support lifecycle | supported versions, EOL, API compatibility, migrations | **Gap** | **P0** |
| Generated client conformance | SDK surface continuously checked from contract | **Partial** | P1 |
| Multi-language SDK distribution | maintained TS + Python + additional strategic SDKs | **Partial** | P2 |
| Examples / starters | runnable examples for common integration modes | **Partial** | P1 |
| Security shared responsibility | provider vs integrator responsibility explicit | **Gap** | **P0** |
| Public audit/trust evidence | audits/certs/attestations independently inspectable | **Gap, explicitly disclosed** | P1/P2 |
| Runtime capability discovery | chains/tools/resources discovered live | **Strong** | Maintain |
| Agent-native discovery | MCP + A2A + Agent Card + ARD + llms/OpenAPI | **Ahead** | Maintain |
| Research / maturity separation | shipped vs shadow/experimental labeled | **Strong/Ahead** | Maintain |

## P0 parity contract

These items should land before calling the developer platform parity-complete.

### P0.1 — One API lifecycle contract

- Define `/v1` as the Agent REST compatibility major.
- Define what OpenAPI `info.version` means and stop conflating it with package semver.
- Document SDK semver independently and publish an API↔SDK compatibility matrix.
- Require a new API major for incompatible REST changes unless a documented migration window applies.
- Add machine-readable lifecycle metadata to the OpenAPI document.

### P0.2 — Remove machine-readable truth drift

- Generate Agent API chain facts from the same runtime registry used by `GET /v1/agent/chains`.
- Generate/validate `llms.txt` and `llms-full.txt` against OpenAPI + MCP registries instead of manually enumerating endpoints.
- Remove unsupported package-registry claims (for example Python/PyPI until a release actually exists).
- Make CI fail on stale counts, invalid links, unknown endpoints, package/version contradictions, and missing lifecycle metadata.

### P0.3 — Public sandbox contract

Document whether `devapi.suwappu.bot` is a supported customer sandbox. If yes, define:

- credentials and isolation from production;
- supported chains/providers and whether they are testnets, simulations, or mocks;
- funds/value semantics;
- data retention/reset behavior;
- rate limits and feature differences;
- webhook behavior;
- path to production.

If it is internal-only, remove it from public OpenAPI `servers` and provide a supported sandbox instead.

### P0.4 — Deprecation and change policy

- lifecycle states: experimental/beta/GA/deprecated/sunset;
- minimum notice target for breaking GA changes;
- exact deprecation and EOL dates;
- replacement and migration guide required before sunset;
- OpenAPI `deprecated: true` and docs badges;
- changelog categories and RSS/Atom feed;
- SDK deprecation annotations where applicable.

### P0.5 — SDK support policy

For each SDK/package publish:

- registry + current stable version;
- source version;
- runtime requirements;
- supported API major(s);
- support stage and EOL rule;
- upgrade/migration guide requirement;
- registry/source drift policy;
- reproducible/provenance-enabled release workflow.

### P0.6 — Shared responsibility model

Publish a security responsibility table for:

- API key storage/rotation;
- self-custody signing;
- managed wallet authority;
- policy configuration;
- agent prompt/tool authorization;
- webhook verification;
- destination/amount controls;
- incident response;
- compliance and legal obligations.

This must not imply certifications or audit scope that Suwappu has not earned.

## P1 product parity

After the contract layer is correct:

1. **Developer request explorer** keyed by `X-Request-ID`, endpoint, status, latency, chain and error code.
2. **Contextual error remediation**: stable `error_code`, `requestId`, `documentation_url`, and structured `hint` where safe.
3. **Webhook reliability contract** plus delivery explorer/redrive tooling.
4. **Historical status + incidents** with component-level uptime and postmortem links; only publish SLO/SLA numbers backed by measurement.
5. **Generated SDK conformance** from OpenAPI, or contract tests proving manual SDKs stay compatible.
6. **Starter projects** for self-custody app, managed agent, MCP client, and webhook consumer.
7. **Capability matrix endpoint** that exposes per-chain/per-feature transactional support instead of forcing clients to infer it from a platform total.

## P2 enterprise parity

- independent external security review/audit publication;
- SOC 2 program completion and trust center only when evidence exists;
- signed/reproducible release attestations for SDKs and deploy artifacts;
- stronger TEE/managed-signing attestation evidence where technically available from underlying providers;
- maintained strategic SDKs beyond TypeScript/Python only where user demand justifies support cost;
- enterprise audit-log export/retention guarantees and SIEM integrations.

## What Suwappu should *not* copy

- Do not hide custody behind a friendly `swap()` abstraction.
- Do not advertise a sandbox that can accidentally hit production value.
- Do not claim every one of 21 routers competes on every route.
- Do not turn source-version numbers into an API compatibility promise.
- Do not manufacture an SLA, SOC 2 status, external audit, or TEE assurance claim before evidence exists.
- Do not build ten SDKs that cannot be maintained; contract correctness beats language count.

## Exit criteria for “top-infrastructure parity”

We can credibly use that phrase when all P0 items are enforced in code/CI and the P1 developer-debugging/reliability surfaces are either shipped or explicitly scoped with tracked issues. Agent-native discovery is already a differentiator; the work is to bring the surrounding lifecycle and trust discipline up to the same level.
