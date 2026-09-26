# Suwappu Documentation Content Model

Suwappu documentation should help a reader complete one job at a time. Do not turn every
page into a product overview, architecture document, API reference, and runbook at once.

This content model exists to keep the docs useful as the monorepo grows.

## Core rules

1. **One primary job per page.** State what the reader will do or understand near the top.
2. **Lead with the task, not the repository.** Organize around user/developer/operator goals.
3. **Use the least-privilege example first.** Read-only → quote → simulate → prepare → execute.
4. **Put risk next to the action.** Custody, allowance, signing, and managed-execution warnings
   belong beside the relevant step, not only in a security appendix.
5. **Do not duplicate dynamic truth.** Link generated/runtime sources for counts, tool catalogs,
   package versions, deployment state, and environment requirements.
6. **Label maturity.** Production, hosted, source-only, shadow, experimental, plan, and research
   are different claims. Use [Product Status](product-status.md).
7. **Prefer a runnable example over a feature list.** A developer should reach a first useful
   result before reading architecture detail.
8. **Keep public docs separate from institutional knowledge.** Public integration docs explain
   what builders need; ADRs, decisions, incident reports, and migration history explain why the
   repository looks the way it does.

## Page types

### Quickstart

**Use when:** a reader already understands the product category and wants a first success fast.

**Required structure:**

1. Who this is for / what they will accomplish.
2. Prerequisites.
3. Minimal procedural steps.
4. One visible success condition.
5. Risk note beside any privileged step.
6. Two or three next links.

**Do not include:** full architecture, exhaustive feature lists, long troubleshooting, or every
client variation. Link those out.

Target: one focused workflow that can reasonably be completed in about five minutes.

### How-to guide

**Use when:** the reader has a specific goal such as “fund HyperLiquid from another chain” or
“rotate an API key.”

**Required structure:**

- Goal and assumptions.
- Prerequisites.
- Ordered procedure.
- Verification/success condition.
- Failure/rollback path where money or production state is involved.
- Related reference links.

### Reference

**Use when:** the reader needs facts while actively building or operating.

Examples: endpoint semantics, environment variables, status/maturity matrices, supported
capabilities, schemas, error codes.

**Rules:**

- Prefer tables and concise lists.
- Link generated truth rather than manually copying values that drift.
- State whether the reference is generated, discovered at runtime, or hand-maintained.
- Avoid tutorial prose.

### Concept / explanation

**Use when:** the reader needs to understand why the system works a certain way.

Examples: custody boundaries, route selection, execution evidence, auth model.

**Structure:** conclusion first → model/diagram → invariants → tradeoffs → links to procedures and
reference.

### Runbook

**Use when:** an operator must change or recover production safely.

**Required structure:**

- Trigger / when to use it.
- Preconditions and access required.
- Exact steps.
- Verification after each risky transition.
- Rollback / kill path.
- Escalation or ownership.
- Never include secret values.

### Troubleshooting

**Use when:** the reader has an observed failure or symptom.

Organize by **symptom → likely causes → checks → resolution**, not by source-code directory.
Include the exact error text when stable and searchable.

### Plan / research

**Use when:** preserving forward-looking work or point-in-time evidence.

The top of the page must make clear that it is **not current behavior**. Link the eventual
implementation/ADR/PR when the work ships.

## Money-moving documentation contract

Any public or internal page that instructs a reader to prepare, sign, submit, or cause a
fund-moving action should answer these questions near the action:

| Question | Required answer |
|---|---|
| What authority level is this? | Discover / Quote / Simulate / Prepare / Managed Execute |
| Who controls the key/signature? | Caller, wallet provider, or managed service |
| Can this step move funds by itself? | Explicit Yes / No |
| What should be simulated or checked first? | Concrete preflight checks |
| What limits/policy should gate it? | Application/user policy, not tool metadata |
| What proves success? | Transaction/status/settlement evidence |
| What is the failure/rollback path? | Retry, cancel, timeout, compensating action, or escalation |

Do not rely on a method name to communicate these semantics.

## Examples contract

A code example should be:

- **Minimal** — only imports/fields needed for the task.
- **Runnable** — no phantom methods or unpublished-version assumptions.
- **Safe by default** — read-only or simulation first when possible.
- **Version-aware** — call out source-vs-registry boundaries.
- **Secret-safe** — environment variables/placeholders only.
- **Verifiable** — tell the reader what successful output/state looks like.

If an example cannot be made reliably copy/pasteable, explain why and link to the authoritative
reference instead of inventing pseudo-code that looks executable.

## Dynamic facts and sources of truth

| Fact | Prefer |
|---|---|
| Chain/router counts | `showcase/src/data/stats.generated.json` |
| Agent chain support | runtime discovery / `GET /v1/agent/chains` |
| MCP catalog | MCP runtime discovery |
| Environment requirements | `.env.schema` + `capabilities.yaml` |
| Published package version | package registry |
| Source package version | package `package.json` |
| Production services/source branch | Railway environment configuration |
| Production health | Railway + monitoring |
| Maturity | `docs/product-status.md` |
| Architecture decisions | `ARCHITECTURE.md` + ADRs |

## Review checklist

Before merging a documentation change:

- [ ] The page has one clear primary job.
- [ ] The audience and expected outcome are obvious near the top.
- [ ] Dynamic facts point to a source of truth instead of creating another copy.
- [ ] Maturity/status is not overstated.
- [ ] Money-moving steps state custody and authority explicitly.
- [ ] Examples use the lowest privilege that still demonstrates the task.
- [ ] Source-only APIs/packages are not written as if they are already published.
- [ ] Plans/research are labeled as non-authoritative.
- [ ] Links and generated-doc contracts pass `./scripts/verify.sh docs`.
- [ ] The page links to the next useful action instead of duplicating the next page.

## Where each kind of knowledge belongs

- User/developer first success → `docs/quickstart.md`
- API/client semantics → `docs/agent-clients.md`, API reference
- Product maturity → `docs/product-status.md`
- User feature workflows → `docs/features/`
- Architecture explanation → `docs/architecture/`, root `ARCHITECTURE.md`
- Durable architecture choices → `docs/adr/`
- Operational procedures → `docs/deployment/`, `docs/incidents/`, runbooks
- Smaller lessons/decisions → `docs/DECISIONS.md`
- Forward-looking work → `docs/plans/`
- Point-in-time evidence → `docs/research/`

The goal is not more documentation. The goal is **less ambiguity per page**.
