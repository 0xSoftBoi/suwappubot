# Suwappu Developer Infrastructure Parity Scorecard — 2026-08

**Status:** normative internal acceptance rubric backed by point-in-time external research  
**Baseline:** `infra/developer-platform-parity` / PR #881  
**Verified:** 2026-08-21  
**Parent program:** #872  

> This is **not** an industry certification and the weights are not claimed to be a universal standard.
> They are Suwappu's risk-weighted acceptance criteria for an execution infrastructure product that can
> move funds. Points are awarded for shipped, inspectable behavior — not roadmaps, prose, or vendor logos.

## Why a scorecard

"Parity with Stripe/Cloudflare/0x/Plaid" is otherwise too easy to move around subjectively. The benchmark
should fail for a concrete reason and become green for a concrete reason.

The rubric uses the **intersection** of independently recurring infrastructure properties:

- **Stripe / Plaid / Circle / Fireblocks:** isolated testing, retry safety, idempotency, reconciliation.
- **Cloudflare / Supabase / 0x:** API compatibility, permissions, deprecation, migration and change lifecycle.
- **Twilio / Alchemy:** request correlation, debugging, webhook delivery evidence and recovery.
- **Privy / Turnkey:** explicit authorization boundaries, programmable policy and shared responsibility.
- **IETF HTTP API standards:** interoperable problem details and lifecycle signaling where a standard exists.

Primary evidence is recorded in:

- [Developer infrastructure parity benchmark](infrastructure-parity-2026-08.md)
- [Financial API parity benchmark](infrastructure-parity-financial-apis-2026-08.md)

## Acceptance rule

Suwappu may call the **developer platform** parity-complete only when all three are true:

1. **Score >= 85/100**.
2. Every **P0 category is >= 80%** of its available points.
3. There is **no unresolved safety blocker** that can cause an integration to execute production value while
   reasonably believing it is read-only, simulated, sandboxed, idempotently retried, or policy-blocked.

A high aggregate score cannot compensate for an unsafe sandbox, ambiguous managed execution, or duplicate-money
risk.

## Scoring rules

- Full points require **implementation + contract + automated evidence** where automation is reasonable.
- Documentation without runtime/CI enforcement earns at most partial credit.
- A source file existing does not prove deployment or package publication.
- A service named `dev`, `sandbox`, or `prod` does not prove environment semantics.
- Third-party security claims do not transfer to Suwappu unless the scope explicitly covers Suwappu.
- For dynamic capability counts, runtime/generated discovery outranks prose.
- Unknown or unverified behavior scores zero rather than receiving optimistic credit.

## Baseline: 55 / 100

| Dimension | Weight | Baseline | State | Blocking work |
|---|---:|---:|---|---|
| Contract / source-of-truth discipline | 12 | **8** | Partial | #873 |
| API versioning / lifecycle / deprecation | 10 | **5** | Partial | #875 |
| Sandbox / deterministic failure testing | 12 | **1** | **Gap** | #874 |
| Idempotency / unknown-outcome reconciliation | 12 | **7** | Partial/strong | #880 |
| Auth / policy / least privilege | 10 | **8** | Strong/partial | #882 |
| Errors / request debugging / remediation | 10 | **5** | Partial | #877 |
| Webhooks / event delivery recovery | 10 | **5** | Partial | #878 |
| SDK lifecycle / compatibility / conformance | 8 | **6** | Partial/strong | #876 |
| Reliability / status / incident evidence | 8 | **4** | Partial | #879 |
| Security evidence / shared responsibility | 8 | **6** | Partial | #872 |
| **Total** | **100** | **55** | **Not parity** | |

This baseline includes changes already on PR #881. It deliberately does not count unfinished P0 policies as if they
were runtime guarantees.

---

## 1. Contract / source-of-truth discipline — 8 / 12

**Benchmark:** Cloudflare, Supabase and Stripe treat schema/reference metadata as a maintained product contract;
0x also requires explicit API-version identity.

| Check | Pts | Current evidence | Score |
|---|---:|---|---:|
| Runtime capability discovery exists | 3 | `GET /v1/agent/chains`, MCP runtime discovery, Agent Card | 3 |
| Public topology metrics are generated | 2 | `showcase/src/data/stats.generated.json` | 2 |
| OpenAPI request-schema drift is CI checked | 2 | Zod -> OpenAPI request-schema check; PR #881 adds developer-contract check to `openapi:check` | 2 |
| Machine docs derive route/capability inventory from canonical registries | 3 | `llms.txt`/`llms-full.txt` still partly hand-maintained | 0 |
| Compatibility metadata has one machine-readable authority | 2 | `api-ts/developer-contract.json` now exists and is CI checked, but checked-in OpenAPI prose still contains stale `7+ chains` copy | 1 |

**Exit:** #873. No static Agent chain totals in hand-written machine docs; OpenAPI/llms/package compatibility facts are
generated or mechanically validated from canonical registries.

## 2. API versioning / lifecycle / deprecation — 5 / 10

**Benchmark:** 0x uses an explicit API major and published sunset migrations. Cloudflare publishes deprecation +
end-of-life dates and replacements. RFC 9745 defines the `Deprecation` response header and deprecation link
relation; RFC 8594 defines `Sunset`.

External standards:

- https://www.rfc-editor.org/rfc/rfc9745.html
- https://www.rfc-editor.org/rfc/rfc8594.html

| Check | Pts | Current evidence | Score |
|---|---:|---|---:|
| REST compatibility major is explicit | 2 | `/v1`; `developer-contract.json` defines `compatibilityMajor: v1` | 2 |
| OpenAPI revision is distinct from package semver | 2 | PR #881 developer contract + generator consume separate OpenAPI revision | 2 |
| Lifecycle states / notice / migration policy are published | 2 | `docs/api-lifecycle.md`; policy only, not fully enforced | 1 |
| Deprecated resources emit machine-readable lifecycle signals | 2 | no production `Deprecation` / `Sunset` enforcement yet | 0 |
| CI requires lifecycle + migration metadata before removal | 2 | not shipped yet | 0 |

**Exit:** #875.

## 3. Sandbox / deterministic failure testing — 1 / 12

**Benchmark:** Stripe test/sandbox environments avoid real transactions. Plaid's Sandbox goes further: fake data,
manual failure/state transitions, simulated transfers, test webhooks and virtual clocks.

Reference:

- https://docs.stripe.com/testing-use-cases
- https://plaid.com/docs/api/sandbox/
- https://plaid.com/docs/transfer/testing-transfers/

| Check | Pts | Current evidence | Score |
|---|---:|---|---:|
| Non-production origin is discoverable | 1 | OpenAPI currently advertises `devapi.suwappu.bot` | 1 |
| Credentials/data are proven isolated from production | 4 | unverified | 0 |
| Test flow cannot touch production value | 3 | unverified | 0 |
| Deterministic failure/state injection exists | 2 | not a public contract | 0 |
| Test webhook/time-driven workflow tooling exists | 2 | production webhook test exists, but not a sandbox/time simulation contract | 0 |

**Exit:** #874. Until proven otherwise, `devapi` is **not** scored as a safe customer sandbox.

## 4. Idempotency / unknown-outcome reconciliation — 7 / 12

**Benchmark:** Stripe applies idempotency broadly to retriable writes; Circle and Fireblocks make duplicate-safe
financial writes a formal protocol behavior. Fireblocks also recommends durable transaction identifiers.

Reference:

- https://docs.stripe.com/api/idempotent_requests
- https://developers.circle.com/api-reference/idempotent-requests
- https://developers.fireblocks.com/reference/api-idempotency

| Check | Pts | Current evidence | Score |
|---|---:|---|---:|
| Managed swap accepts durable client idempotency identity | 4 | `/v1/agent/swap/execute` validates `Idempotency-Key`, scopes it per agent and fingerprints economic terms | 4 |
| Unknown network/timeout outcome is treated as unknown, not safe-to-repeat | 2 | managed execute explicitly distinguishes unknown internal/onchain outcomes | 2 |
| Another financial write demonstrates durable dedupe | 1 | billing top-up is idempotent on on-chain `txHash` | 1 |
| Every money-moving/state-creating public write is classified | 3 | not complete | 0 |
| SDK retries preserve caller idempotency identity and reconcile unknown outcomes | 2 | policy exists; platform-wide conformance not yet proven | 0 |

**Exit:** #880.

## 5. Auth / policy / least privilege — 8 / 10

**Benchmark:** Supabase and Cloudflare expose endpoint permission requirements. Privy/Turnkey treat signing and
transaction authorization as programmable policy, with explicit human/quorum boundaries.

| Check | Pts | Current evidence | Score |
|---|---:|---|---:|
| Distinct read/prepare/managed-execute authority is explicit | 2 | Discover -> Quote -> Simulate -> Prepare -> Managed Execute | 2 |
| Managed execution has policy gates / kill switches | 2 | shared policy gate, spending caps, contract restrictions, kill switches | 2 |
| Human approval is single-use and race-aware | 2 | approval re-quote, revalidation, reserve/finalize semantics | 2 |
| Scope denial is structured/remediable | 2 | PR #881: `INSUFFICIENT_SCOPE`, `required_scope`, docs URL | 2 |
| Endpoint -> auth mode -> required scope is generated into public contract | 2 | not yet | 0 |

**Exit:** #882.

## 6. Errors / request debugging / remediation — 5 / 10

**Benchmark:** Twilio exposes stable error codes, documentation links and a request inspector/replay workflow.
Alchemy exposes request logs/filtering. RFC 9457 defines interoperable Problem Details and recommends dereferenceable
problem-type URIs with human remediation documentation.

Reference:

- https://www.rfc-editor.org/rfc/rfc9457.html
- https://www.twilio.com/docs/usage/troubleshooting/debugging-your-application
- https://www.alchemy.com/docs/alchemy-request-logs

| Check | Pts | Current evidence | Score |
|---|---:|---|---:|
| Stable external request correlation ID | 2 | `X-Request-ID` | 2 |
| Stable machine error codes | 2 | Agent error-code contract | 2 |
| Error response links remediation docs | 1 | PR #881 adds `documentation_url` to canonical agent errors | 1 |
| Authorized request explorer / lookup by request ID | 3 | missing | 0 |
| Failed request replay/redrive where safe | 2 | missing | 0 |

**Target:** preserve backward compatibility while converging future error negotiation toward RFC 9457 semantics
(`type`, `title`, `status`, `detail`, `instance`) instead of inventing another incompatible envelope.

**Exit:** #877.

## 7. Webhooks / event delivery recovery — 5 / 10

**Benchmark:** Alchemy documents signatures, retries and delivery windows. Fireblocks explicitly documents duplicate
handling, non-guaranteed ordering, recovery and notification resend.

| Check | Pts | Current evidence | Score |
|---|---:|---|---:|
| Signed webhook delivery/test fixture | 2 | HMAC test webhook + timestamp + delivery ID | 2 |
| Test delivery endpoint exists | 1 | `/v1/agent/webhooks/test` | 1 |
| Delivery history exposes attempts/outcome | 2 | webhook event list includes attempts, last error, response status, timestamps | 2 |
| Retry/order/duplicate/replay-window semantics are canonical and tested | 3 | incomplete | 0 |
| Authorized redrive/resend tooling | 2 | missing | 0 |

**Exit:** #878.

## 8. SDK lifecycle / compatibility / conformance — 6 / 8

**Benchmark:** Cloudflare publishes SDK lifecycle/support stages and semver policy. Stripe keeps SDK/API versioning
explicit. A package release should state which API contract it supports rather than relying on README inference.

| Check | Pts | Current evidence | Score |
|---|---:|---|---:|
| Maintained published TypeScript SDK | 2 | `@suwappu/sdk`; source package 0.6.0 | 2 |
| Package embeds support/API-major metadata | 2 | PR #881 adds `suwappu.supportStage`, `compatibleApiMajors`, base path and policy URL | 2 |
| Release/clean-install contract is CI tested | 1 | `SDK package contract` CI job | 1 |
| MCP bridge declares hosted runtime as catalog authority | 1 | PR #881 package metadata + developer-contract check | 1 |
| Registry/source/API conformance + release/EOL workflow is end-to-end enforced | 2 | incomplete; Python remains source-only | 0 |

**Exit:** #876.

## 9. Reliability / status / incident evidence — 4 / 8

**Benchmark:** mature infrastructure exposes customer-facing component status and incident history. Reliability
numbers should be derived from retained external measurements rather than inferred from a green health endpoint.

| Check | Pts | Current evidence | Score |
|---|---:|---|---:|
| Live public production health surface | 2 | `/status` | 2 |
| Status page states monitoring blind spots rather than inheriting health | 1 | explicitly says MCP/A2A/bot/terminal are not independently probed | 1 |
| Incident/runbook process exists | 1 | repository incident/monitoring docs | 1 |
| Public component-level incident history | 2 | missing/incomplete | 0 |
| Externally measured, reproducible SLI/SLO history | 2 | missing | 0 |

**Exit:** #879.

## 10. Security evidence / shared responsibility — 6 / 8

**Benchmark:** Privy and Turnkey publish concrete security architecture and responsibility boundaries. Turnkey also
provides verifiable enclave evidence. The correct parity behavior is evidence, not inherited marketing claims.

| Check | Pts | Current evidence | Score |
|---|---:|---|---:|
| Shared-responsibility model | 2 | PR #881 `docs/security/shared-responsibility.md` | 2 |
| Responsible disclosure / security contact | 1 | `security.txt` + repository security policy | 1 |
| Automated code/dependency security evidence | 1 | CodeQL, dependency audit, SBOM/security automation | 1 |
| Explicit policy/key/custody controls | 2 | Turnkey-backed managed signing, policy gates, approval controls | 2 |
| Independent Suwappu-scoped audit/attestation/trust evidence | 2 | not claimed / not public yet | 0 |

**Guardrail:** do not award these last two points because an underlying provider has an audit or TEE. The evidence
must cover the relevant Suwappu boundary.

---

## P0 floor

The following dimensions are P0 for parity because failure can create silent integration breakage or monetary risk:

| P0 | Required score before parity | Current |
|---|---:|---:|
| Contract / source of truth | >= 10 / 12 | 8 / 12 |
| API lifecycle | >= 8 / 10 | 5 / 10 |
| Sandbox | >= 10 / 12 | 1 / 12 |
| Idempotency / reconciliation | >= 10 / 12 | 7 / 12 |
| Auth / policy | >= 8 / 10 | 8 / 10 |
| SDK lifecycle | >= 7 / 8 | 6 / 8 |
| Security responsibility/evidence | >= 7 / 8 | 6 / 8 |

The aggregate 85-point threshold is therefore secondary. **Sandbox is the largest blocker.**

## What would move the score fastest without gaming it

1. **#874 — real sandbox contract + isolation + deterministic failure injection**: up to +9 to +11 meaningful points.
2. **#873 — generated OpenAPI/llms/capability contract**: +3 to +4 points and removes a recurring truth-drift class.
3. **#880 — classify/idempotently protect every retriable money write**: +3 to +5 points with direct monetary-risk reduction.
4. **#875 — runtime deprecation/sunset/migration enforcement**: +3 to +5 points and makes future upgrades predictable.
5. **#877/#878 — request explorer + webhook redrive**: +4 to +7 points and materially lowers integration support burden.
6. **#879 — retained external reliability evidence**: +2 to +4 points, but only after enough measurement history exists.

## Score update protocol

When closing a parity issue:

1. Link the merged commit/PR.
2. Point to the runtime/CI test proving the property.
3. Update only the affected row(s), with a one-line reason for every point gained or lost.
4. Re-run the developer-contract, OpenAPI, package and security CI lanes.
5. If the change touches money movement, include duplicate/concurrency/timeout/unknown-outcome tests where relevant.
6. Never increase the score solely because a plan, policy, dashboard mockup, or unused implementation file was added.

## External evidence index

- Stripe idempotency: https://docs.stripe.com/api/idempotent_requests
- Stripe versioning: https://docs.stripe.com/api/versioning
- Stripe testing: https://docs.stripe.com/testing-use-cases
- Plaid Sandbox: https://plaid.com/docs/api/sandbox/
- Plaid transfer testing: https://plaid.com/docs/transfer/testing-transfers/
- Cloudflare deprecations: https://developers.cloudflare.com/fundamentals/api/reference/deprecations/
- Cloudflare SDK support policy: https://developers.cloudflare.com/fundamentals/reference/sdk-ecosystem-support-policy/
- Supabase breaking changes: https://supabase.com/changelog?types=breaking-change
- 0x upgrade guidance: https://docs.0x.org/docs/upgrading/overview
- Alchemy request logs: https://www.alchemy.com/docs/alchemy-request-logs
- Alchemy throughput: https://www.alchemy.com/docs/reference/throughput
- Circle idempotency: https://developers.circle.com/api-reference/idempotent-requests
- Fireblocks idempotency: https://developers.fireblocks.com/reference/api-idempotency
- Twilio debugger: https://www.twilio.com/docs/usage/troubleshooting/debugging-your-application
- Privy security/policies: https://www.privy.io/security
- Turnkey security/shared responsibility: https://www.turnkey.com/security-by-turnkey
- RFC 9457 Problem Details: https://www.rfc-editor.org/rfc/rfc9457.html
- RFC 9745 Deprecation: https://www.rfc-editor.org/rfc/rfc9745.html
- RFC 8594 Sunset: https://www.rfc-editor.org/rfc/rfc8594.html

## Non-goals

Parity does **not** require:

- copying every vendor dashboard page;
- matching every language SDK regardless of demand;
- claiming an SLA before measurement and commercial commitment exist;
- claiming certifications inherited from infrastructure providers;
- forcing REST/OpenAPI/SDK/MCP package version numbers to be numerically equal;
- replacing Suwappu's stronger agent-native discovery or execution-authority model with a peer's weaker abstraction.
