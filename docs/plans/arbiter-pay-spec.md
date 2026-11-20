# Arbiter Pay — spec (draft v0, 2026-11-05)

Pay-on-delivery for agent API calls: an agent pays for a call only if the response passes an objective predicate. Follows from `docs/plans/arbiter-improve-or-pivot.md`. **Draft: sections marked DECISION need an owner call before build.**

## Problem

Agents pay x402/API providers per call and get paid-for 500s, empty bodies, schema-violating JSON, and timeouts. Today a failed call costs the agent anyway. Existing x402 refund/escrow projects use timeouts or quality scores; none found use a deterministic, attested verdict.

## Scope (v0)

`POST /v1/agent/pay-if-delivered` + MCP tool `pay_if_delivered`:

```
{ url, method?, headers?, body?, max_usd, predicate, timeout_ms?, idempotency_key }
```

Predicates (objective only, closed set, no LLM judging):

| id | passes when |
|---|---|
| `http_ok` | status in 2xx |
| `json_schema` | body parses and validates against supplied JSON Schema (size/depth capped) |
| `non_empty` | body length >= N, or JSON path exists and is non-null |
| `latency_lt` | response time < N ms |
| `hash_eq` | sha256(body) equals supplied hash (for content-addressed deliverables) |

Predicates compose with AND only. Verdict: `{verdict: pass|fail, reason, evidence_hash, predicate_id, ts}`.

## Settlement model — DECISION 1

The repo already has a refund primitive on the prepaid ledger: `refundChargedCall` / `creditBack` (`api-ts/src/middleware/x402Payment.ts:562`), used on failure paths in `routes/agent.ts` and `mcp.ts`. It deliberately never refunds an on-chain `settled` payment.

- **Option A (recommended for v0): credit-ledger hold.** Charge `max_usd` as credits up front (hold), run the call, settle: pass keeps the charge for the upstream cost + fee, fail credits back in full. No NEAR and no new custody. Reuses the metering and audit path. Does NOT need the NEAR escrow contract.
- **Option B: NEAR escrow.** Current `arbiter-contract` is NEAR-denominated and tied to the `github_pr_v1` rubric constants; x402 pays USDC on EVM. Using it means a bridge or new contract — weeks, not days. Defer.

DECISION 1: ship A, keep B as the on-chain/trust-minimized later tier.

## The trust problem (the real design risk) — DECISION 2

The Arbiter's advantage is that the enclave fetches the evidence itself. That works only if the enclave can re-fetch the resource:

- **Mode 1 — enclave-fetched (attested).** For idempotent, free-to-GET resources (public APIs, content-addressed files, status endpoints, on-chain reads), the enclave performs the fetch and runs the predicate. Same trust model as `github_pr_v1`. Cannot verify a *paid* x402 response, because the enclave would have to pay again.
- **Mode 2 — proxy-witnessed (NOT attested).** For paid upstream calls, Suwappu makes the paid request, hashes the body, and evaluates the predicate in api-ts. The verdict rests on Suwappu's honesty, not hardware. Must be labelled `witnessed`, never `attested`, in the API, the audit entry and the docs.

Consequence: the headline "TEE-attested verdict" applies only to Mode 1. For the paid-x402 case, the product is "Suwappu guarantees refund on objective failure", a service guarantee, not a cryptographic one. Public copy must say so.

DECISION 2: v0 ships Mode 2 for paid calls + Mode 1 for free/idempotent resources. Mode 2 who-pays-upstream is DECISION 3.

## Who pays the upstream — DECISION 3

Mode 2 needs someone to pay the x402 provider.
- **3a. Suwappu pays from a treasury wallet, agent pre-funds credits.** Simple UX. Suwappu fronts USDC and carries loss if the hold is under-collateralized. MONEY-PATH. Needs per-agent caps, `max_usd` hard ceiling, and the policy gate.
- **3b. Agent signs the x402 payment; Suwappu relays and refunds credits on fail.** Agent pays twice-ish. Rejected.

Recommendation: 3a with a low global cap and per-agent cap (start $1/call, $20/day) until a real counterparty exists.

## Integration points (verified in repo)

- Metering/refund: `api-ts/src/middleware/x402Payment.ts` (`chargeAgentForCall`, `refundChargedCall`, `creditBack`).
- On-chain payment verify: `api-ts/src/lib/x402Verify.ts` → Python `/internal/x402/verify`.
- Routes: `api-ts/src/routes/agent.ts` (swap-execute refund guard is the pattern to copy), `routes/mcp.ts`.
- Enclave rubric template: `near/arbiter-github/src/main.rs` (fetch via `wasi_http_client`, 2 MiB body cap, non-pass never releases). New Mode 1 module = `arbiter-http` rubric `http_predicate_v1`, same I/O shape.
- Audit: write one audit-chain entry per verdict (hash chain already exists in the control plane).

## Safety rules (MONEY-PATH)

1. Never conflate `api_credits` (USD) and `agent_credits` (0.001-credit units) — convert once, at one function.
2. Idempotency key required; a replay returns the stored verdict, never a second charge or second refund.
3. Refund only if the charge was a ledger `ok`, never on `settled` on-chain payments (matches existing guard).
4. SSRF: block private/loopback/link-local/metadata IPs, redirects re-validated, DNS rebinding pinned, size and time caps.
5. Predicate set is closed; JSON Schema is size/depth-limited (ReDoS, `$ref` fetching disabled).
6. A provider that deliberately returns a body that passes the predicate but is useless is out of scope; document it.
7. Abuse: an agent can create a predicate that always fails to farm refunds on calls it benefited from (e.g. `latency_lt: 1`). Mitigation: fee on fail (e.g. keep 10% or a flat min), per-agent fail-rate cap, predicate sanity floor.
8. Review gate: `money-path-reviewer` before any prod flag-on.

## Build order (maps to the 2-week slice)

1. D1-2: this spec locked (DECISIONS 1-3 answered); read `chargeAgentForCall`/`creditBack` end to end.
2. D3-5: api-ts predicate engine (pure functions) + route behind a feature flag, Mode 2 first (no WASM dependency).
3. D6-8: `arbiter-http` WASM (Mode 1), pinned hash, reuses fetch code.
4. D9-10: MCP tool + audit-chain entry + policy gate hook.
5. D11-12: real end-to-end against 2-3 live x402 endpoints, one pass and one fail+refund; public refund log.
6. D13-14: outreach. Kill criterion: no integration or paid verification by week 4 → fall back to the prediction-market resolver.

## Open questions

- Is `agent_credits` hold-then-settle expressible with the current `creditBack`, or do we need a real two-phase (hold/capture) table? (needs a read of `chargeAgentForCall` + schema; if a table is needed, hand to `db-migrate`, both ORMs.)
- Does the Python x402 path (`bot/`/`api/`) need the same tool, or is api-ts the only agent surface for this? (scoping gotcha: check both stacks.)
- Fee schedule: flat per-verdict fee vs bps on held amount.
- Verdict signing: Mode 2 verdicts signed with which key? Reuse the audit-chain signer, do not mint a new key.
