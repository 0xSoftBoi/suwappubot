# MCP transaction-authorization checklist

Maps the SoK: Security of Autonomous LLM Agents in Agentic Commerce
(arXiv 2604.15367) transaction-authorization controls onto the actual code
that implements (or doesn't implement) them for the Suwappu MCP server's
money-path tool, `execute_swap` (`api-ts/src/routes/mcp.ts`).

**Ground truth is the code below, not this document or any design doc.**
Re-verify by reading the cited `file:line` before relying on a row. Last
verified: 2026-08-31, against the current branch.

**Scope note**: `execute_swap` (MCP) only *prepares an unsigned transaction*
for the caller to sign and broadcast client-side — it never holds keys or
broadcasts. `POST /v1/agent/swap/execute` (REST, `api-ts/src/routes/agent.ts`)
is the custodial sibling that signs+broadcasts via the internal Turnkey/Python
pipeline. Both call the *same* policy gate
(`enforcePolicyGateForFreshQuote`), so rows below note where the two paths'
guarantees diverge.

## 1. Spend limits

| Control | Status | Location |
|---|---|---|
| Per-trade USD value computed and passed to policy | Implemented | `api-ts/src/routes/agent.ts:1113-1146` (`enforcePolicyGateForFreshQuote`, EVM branch) builds `policyIntent.valueUsd` from `evmQuoteUsdValue(evmQuote.fromAmountUsd)`; refuses (400) rather than silently skipping the cap if the quote has no USD value (`agent.ts:1115-1132`). |
| Daily cap (`dailyCapUsd`) | Implemented | `api-ts/src/services/PolicyService.ts:364`, `407-414`, `528-533` — sums prior `allow` decisions from `policyDecisions` in the trailing 24h window and blocks if the new trade would exceed the org/agent's `dailyCapUsd`. |
| Session cap (`sessionCapUsd`) | Implemented | `api-ts/src/services/PolicyService.ts:365`, `415-423`, `534-539` — same mechanism, trailing-hour window. |
| Contract/chain allowlist | Implemented | `api-ts/src/routes/agent.ts:1141-1144` passes `contractAddress: evmQuote.transactionRequest?.to` into `policyIntent` so an operator's `allowedContracts` rule can match the actual router the trade would call. |
| Solana per-trade USD value | **NOT IMPLEMENTED** | `api-ts/src/routes/agent.ts:1108-1111` hard-codes `valueUsd: 0` for Solana quotes ("Solana quote carries no USD value... USD-based caps are skipped"). Daily/session caps are silently inert for Solana swaps through MCP `execute_swap`. |
| Cap accounting is a build-time proxy, not confirmed on-chain execution | **Caveat, not a gap** | `api-ts/src/services/PolicyService.ts:347-351` — caps count *allowed policy decisions* (i.e., "we let this unsigned tx be built"), not confirmed broadcasts. Because MCP `execute_swap` never learns whether the caller actually signed/submitted the returned transaction, a caller that requests-but-never-submits still consumes cap headroom. Documented behavior, not silently wrong, but worth knowing before treating the cap as a hard ceiling on realized spend. |

## 2. Replay / idempotency protection

| Control | Status | Location |
|---|---|---|
| Idempotency-Key on the custodial (signing) path | Implemented | `api-ts/src/routes/agent.ts:2528-2534` (format validation), `2690-2713` (key derivation binds a SHA-256 fingerprint of the trade's economic terms, not `quote_id`, so a retried request can't replay against a stale/mismatched quote). This governs `POST /v1/agent/swap/execute` only. |
| Idempotency-Key on MCP `execute_swap` | **NOT IMPLEMENTED (by design, but underspecified)** | `api-ts/src/routes/mcp.ts:903-906` and `:963`: `idempotency_key` is accepted and echoed back verbatim, with no server-side dedup — the comment explains this is deliberate because the tool only returns an unsigned tx for client-side signing, so there is nothing here to dedupe *on this server*. True, but it means replay protection for the actual broadcast is entirely delegated to whatever RPC/wallet the caller submits through, with zero enforcement or visibility from Suwappu's side. |
| Quote reuse / re-preparation | **Partial — quotes are not single-use** | `api-ts/src/lib/quoteCache.ts:29,55` (`getCachedQuote`) never deletes the cached quote on read; `deleteCachedQuote` (`quoteCache.ts:59`) exists but is only called from the unrelated webapp/public flows (`api-ts/src/routes/swap.ts:635`, `api-ts/src/routes/publicSwap.ts:784`), never from `mcp.ts` or the agent REST routes. Net effect: within the 60s TTL (`AGENT_QUOTE_TTL = 60_000`, `quoteCache.ts:25`), an agent can call `execute_swap` on the same `quote_id` repeatedly, each call re-running `enforcePolicyGateForFreshQuote` and writing a fresh `allow` decision row (`agent.ts:1148-1177`) — so repeated preparation against one quote can inflate daily/session cap consumption for a single economic intent. Not exploitable for double-spend (nothing is broadcast here), but it does erode the accuracy of the cap accounting noted above. |
| Cross-agent quote hijacking | Implemented | `api-ts/src/routes/mcp.ts:912-916` — rejects with a generic "expired or not found" message (not a distinguishable 403) if `cached.agentId !== agent.id`, so existence of another agent's quote can't be probed. Mirrored on the REST path at `agent.ts:2603-2609`. |
| Approval single-use consumption | Implemented (custodial path only) | `api-ts/src/routes/agent.ts:2568-2586` — `finalizeConsume(approval_id)` is called and checked for a race loss (409) BEFORE the internal sign+broadcast call, closing a TOCTOU where two concurrent resubmits could both broadcast. MCP `execute_swap` has no approval-resubmit path of its own (see §5). |

## 3. Session / agent-bound intent

| Control | Status | Location |
|---|---|---|
| Agent identity bound into every policy decision | Implemented | `api-ts/src/routes/agent.ts:124-126` (`agentIdentifierOf`) is the single source of truth used to stamp `policyIntent.agentId` (`agent.ts:1104,1135`), `policyDecisions.agentId`, and `approvalRequests.agentId` — an approval or cap consumption can never be attributed to the wrong agent. |
| Managed-wallet ownership gate (EVM) | Implemented | `api-ts/src/routes/agent.ts:111-115` (`checkEvmWalletOwnership`) — used for portfolio/positions reads; **not** called directly inside MCP `handleExecuteSwap` (`mcp.ts:902-966`), because `wallet_address` there is the *signer* the caller names for an unsigned tx built from their own already-agent-scoped quote, not a read of someone else's wallet. Ownership is instead enforced indirectly via the quote-hijack check in §2 (the quote itself is agent-scoped) plus `enforcePolicyGateForFreshQuote`'s wallet-address plumbing (`mcp.ts:934`). |
| Solana wallet reads on managed-wallet surfaces | Implemented (explicit unsupported, not silent bypass) | `api-ts/src/routes/mcp.ts:394-415` (`guardWalletOwnership`) — returns a clear "unsupported" error for Solana addresses on portfolio/positions reads rather than falling through to the EVM ownership check (which would misleadingly reject every Solana address). Does not apply to `execute_swap` itself, which is chain-agnostic by design (quote already carries the chain). |
| Org context carried through the gate | Implemented | `api-ts/src/routes/mcp.ts:931` passes `agent.organizationId ?? null` into `enforcePolicyGateForFreshQuote`; `agent.ts:1097` explicitly does NOT short-circuit on a missing org (a documented past bug — org-less per-agent policy rows and kill switches must still be evaluated). |
| Bearer-auth binding of the whole `tools/call` | Implemented | `api-ts/src/routes/mcp.ts:1449-1467` — every non-public tool call requires `agentBearerAuth()` before `agent` is set; `execute_swap` is never in `PUBLIC_READ_TOOLS` (`mcp.ts:75`), so it always requires an authenticated agent. |

## 4. Quote freshness / TTL

| Control | Status | Location |
|---|---|---|
| Quote TTL enforced server-side | Implemented | `api-ts/src/lib/quoteCache.ts:25` (`AGENT_QUOTE_TTL = 60_000`) backs the `TTLCache` at `quoteCache.ts:29`; an expired quote simply isn't returned by `getCachedQuote` (`quoteCache.ts:55`), which both `mcp.ts:911` and `agent.ts:2603` treat identically to "not found." |
| TTL communicated to the caller | Implemented | `mcp.ts` quote responses include `expires_in_seconds: 60` for both EVM (`:668`) and Solana (`:569`) quotes, so a well-behaved client knows not to sit on a `quote_id`. |
| Re-quote-at-execution-time (price hasn't moved) | **Partial** | `execute_swap` (MCP) builds the transaction straight from the *cached* quote (`mcp.ts:918`) — it does not re-fetch a fresh quote from the upstream aggregator at call time, only re-runs the *policy* gate. Price/liquidity staleness within the 60s window is bounded by the TTL but not independently re-verified against a live price. The approval-resubmit path on the REST side is stricter: `resolveApprovalResubmit` re-quotes fresh before honoring an approval (`agent.ts:1329-1330,1434`) specifically because the original quote is long expired by the time a human approves — MCP `execute_swap` has no equivalent resubmit flow (see §5). |
| Liquidity-weighted (multi-pool) staleness check | **NOT IMPLEMENTED** | Tracked separately in `docs/research/academic-improvements-2026-08.md` shortlist item 2 (Track 1 #7, arXiv 2606.03548) — out of scope for this checklist's Item A/B, noted here so it isn't lost. |

## 5. Human-in-the-loop threshold

| Control | Status | Location |
|---|---|---|
| Policy can force a `require_approval` decision | Implemented | `api-ts/src/services/PolicyService.ts` returns `decision: 'require_approval'` when a matching policy rule says so; `api-ts/src/routes/agent.ts:1168-1179` branches on it inside `enforcePolicyGateForFreshQuote`. |
| MCP `execute_swap` honors `require_approval` | Implemented | `mcp.ts:928-936` calls the shared gate; a non-null `Response` (block OR require_approval) is converted to an MCP `isError` envelope via `policyGateResponseToMcpEnvelope` (`mcp.ts:890-900`) and returned instead of a signable transaction. |
| Solana trades requiring approval | **NOT IMPLEMENTED — hard blocked, not queued** | `api-ts/src/routes/agent.ts:1183-1201` — a Solana trade that would otherwise be deferred to a human is instead outright blocked (403) with an explicit "Solana approvals are not yet supported" message, because there's no USD pricing at this layer to write a cap-safe approval record. This is a fail-closed gap, not a fail-open one, but a human reviewer has no path to approve a Solana trade above threshold today. |
| A human can actually record a decision | Implemented (REST-only; not exposed via MCP) | `api-ts/src/routes/agent.ts:4359` (`POST /v1/agent/approvals/:id/approve`), gated to JWT/owner auth only — `agent.ts:457-461` explicitly comments "agent keys must never self-approve" — plus step-up auth (`requireProofOfPossession()`, `:461`), `rateLimit()` (`:509`), and `ipRateLimit(30)` (`:519`) to blunt approval-endpoint brute force. |
| MCP-side resubmission after approval | **NOT IMPLEMENTED** | There is no `tools/call` equivalent of `resolveApprovalResubmit` (`agent.ts:1329` onward, used by the REST custodial path). An MCP caller whose `execute_swap` call returns `require_approval` has no MCP tool to poll or resubmit through — the hint text returned by the gate (`agent.ts:1286`, "Poll `GET /v1/agent/approvals/:id`...") points at a REST-only endpoint, not something reachable purely over MCP `tools/call`. An MCP-only client is functionally stuck once approval is required, until it (or its operator) drops to REST. |

## Summary of open gaps (ranked)

1. **Solana has no USD-priced spend caps or approval path** — both are hard-coded around ($0 valueUsd; approvals blocked outright). Highest-impact gap since Solana is a first-class supported chain.
2. **MCP `execute_swap` has no resubmission path after `require_approval`** — an MCP-only agent cannot complete a human-approved trade without a REST/JWT-authenticated caller acting on its behalf.
3. **Quotes are not single-use** — repeated `execute_swap` calls against one `quote_id` each write a fresh policy `allow` decision, inflating cap accounting for what is economically one intent (bounded by the 60s TTL, but not eliminated).
4. **No independent re-quote/staleness check at `execute_swap` time** on the MCP path — it trusts the cached quote for the full TTL window rather than re-verifying price just before building the transaction.
