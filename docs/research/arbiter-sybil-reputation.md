# Sybil-resistant, verification-weighted reputation for Arbiter attestations (2026-11-05)

Status: research + reference implementation (`near/arbiter-reputation/`). Not deployed, not on-chain. Papers were read as **abstracts only** (arXiv API / Consensus); NEAR claims are from the cited doc pages, with gaps marked.

## The problem

Our own roadmap (`ARBITER.md` Tier 2) planned an "Agent Résumé" built from on-chain `arbiter_attestation` logs: pass rate, jobs served. Read as a count, that signal is farmable. A Sybil attacker is buyer and worker at once:

- Fake attestation cost on the current contract ≈ **0.0165 NEAR**: storage deposit kept on a pass (**0.0082 NEAR, measured** on `arb2` escrows #0-#2), resolve fee (~0.0041 NEAR, per the contract comment; OutLayer's fee page not re-read), gas (~0.004, estimated). The escrow principal is paid to the attacker's own worker, so it recycles.
- Merge-by-a-different-account is satisfied by any attacker holding two GitHub accounts.
- **The live contract already shows the shape:** the only attested delivery on `arb2` is `suwappu-arbiter.testnet` -> `worker.suwappu-arbiter.testnet`, two accounts of one operator (`near/arbiter-reputation/extract.py`, public view calls only).

This is not hypothetical for NEAR agent markets: Agent Market's own docs say reputation is operator-held (0-100 score, 365-day window), Sybil defence is off-chain ("one GitHub or X account verifies one owner", self-dealing jobs excluded from "Proven"), and verification marks "do not say how good the work is" (docs.market.near.ai/buyers/reviews-and-reputation.md). A2A+x402 hiring needs only a wallet (docs.market.near.ai/faq.md), so hirer-side identity is weak. No portable, operator-independent reputation exists in the docs I read.

## What the literature says (abstract-level)

- **Anduin** (arXiv 2611.05586, 2026-11-03): rates providers from on-chain payment histories as a buyer-provider bipartite graph; 66M agentic transactions / $6.1M / 16 chains over 157 days; max-flow and two relaxed ratings; manipulating costs 20% of buyers' spend, ~23x harder than collaborative filtering. Did not read the body, so the exact algorithms and evaluation are not reproduced here.
- **AgentReputation** (arXiv 2605.00073): agents game evaluation procedures; competence does not transfer across task types; verification rigor varies. Proposes verification regimes tied to reputation metadata and context-conditioned reputation cards; lists "methods for quantifying verification strength" as future work. That is the hook for weighting edges by verification regime.
- **Gaming the Judge** (arXiv 2601.14691) and **OpenComputer** (arXiv 2605.19769): LLM judges are susceptible to manipulated reasoning; programmatic state verifiers align better with humans. Supports Arbiter's deterministic-only rubrics.
- **Town Crier** (CCS 2016), **DECO** (CCS 2020), **MUSCLE** (2019), **Ivy Oracle** (2025): the authenticated-data-feed line. Town Crier is the TEE-scrapes-HTTPS design Arbiter instantiates. DECO removes the TEE by proving TLS provenance. MUSCLE targets multi-source retrieval. Ivy Oracle adds authenticated timestamps and a source-trust model.
- **TEE.Fail / Battering RAM / WireTap** (2025, news-level sources only, no paper read): physical-interposer attacks reported to forge SGX/TDX attestations or extract keys; vendors call physical attacks out of scope.
- **Optimistic TEE-Rollups** (arXiv 2512.20176) and **decentrally attested TEEs** (arXiv 2511.22317): provisional finality + fraud proofs + spot-checks; decentralised attestation. Relevant to the trust-model items below, not built here.

## Method

Nodes are NEAR accounts. An attested escrow (Paid + pass) is an undirected edge buyer--worker with capacity `strength(rubric) * min(amount, 10 NEAR)`. A worker's rating = **max-flow from a trusted seed set to that worker**. Bound: the flow entering any region is at most the capacity of the edges crossing into it, so a wash island only receives what honest parties genuinely paid or earned. Same family as Advogato / SybilLimit and, per its abstract, Anduin's max-flow rating; **this is my own implementation from the idea, not a reproduction of Anduin**.

Policy parameters, not derived facts: `STRENGTH` per rubric (1.0 for both enclave-fetched rubrics; a witnessed or LLM-judged rubric would be < 1), `EDGE_CAP`, and the seed set.

## Result (`near/arbiter-reputation/sim.py`, output in `sim_output.txt`)

Synthetic honest market: 300 buyers, 120 providers, 10 trusted seeds, preferential attachment, lognormal amounts; 15 random graphs, medians. Attacker: unlimited fresh accounts, 0.0165 NEAR per fake attestation, escrow principal recycled; against the flow rule it spends its budget as a **real** payment to the best-connected honest provider (split into capped escrows) and wash-trades 1000-NEAR escrows to the target.

| Rule | Cost to reach top decile | Budget 0.5 NEAR reaches |
|---|---|---|
| attestation count | 0.31 NEAR (19 fakes) | 98th percentile |
| attested volume | 0.017 NEAR (one recycled 1000-NEAR escrow) | 100th |
| **max-flow from seeds** | **>= 22.9 NEAR of real payment** | 13th |

- Pure island, 500 wash attestations of 1000 NEAR, zero real bridge: **rating 0.000**.
- Across all trials the rating never exceeded the real bridge payment (bound held).
- Ratio: ~1,350x the volume rule, ~73x the count rule, for the same percentile.
- **Price of the rule:** ~10% of honest providers score 0 (no path from the seeds). It rates the connected core, not newcomers.
- Real data check: `rate.py` over the live `arb2` edges gives the worker 0.0919 NEAR with the operator as seed and exactly 0 with no seeds. The rule never invents trust.

## What this does NOT show

- Honest-graph parameters are assumed. Nothing here measures a real agent market.
- Earn-then-farm: an attacker who really earns R from trusted buyers can hold rating up to R across many Sybil targets, each individually. Cost is real work, not zero, but it is not per-target.
- Seed choice is a trust root. Candidates (unverified as workable): buyers with World ID-bound humans (Suwappu has the claim flow), known orgs. Whoever picks seeds holds power.
- Collusion among real seeds/providers is out of scope. Arbiter proves "done as specified", not quality.
- The cost per fake attestation is an estimate (gas, OutLayer fee).

## NEAR-docs findings that bound the larger design (not built)

Read from primary docs by research agents, spot gaps marked:

- **Contract-side TDX verification exists** (`shade-attestation`, dcap-qvl: TCB UpToDate, report_data binding, PPID, MRTD/RTMR0-3, RTMR3 replay) and OutLayer registers workers the same way (`register_worker`, docs: app.outlayer.ai/docs/tee-attestation). But the Shade Agent Framework is deprecated as standalone tooling (docs.near.org/ai/shade-agents/concepts/terminology), `shade-agent-js` is archived with a critical-vulnerability warning, `shade-attestation` is described as unaudited, and OutLayer's callback delivers only the output JSON, not the quote. So our escrow cannot independently verify quotes today. The trust anchor stays OutLayer's registered worker key and its single-key governance (repo statement).
- **OutLayer attests** a Task Hash over wasm_hash, input_hash, output_hash (plus task fields); `outlayer-verify` checks it off-chain and still calls OutLayer's API. Docs disagree on whether caller/payment are also bound.
- **Yield/resume**: 200-block timeout, a late resume fails at protocol level (docs.near.org/smart-contracts/anatomy/yield-resume). It does not remove our `reset_stuck` double-callback hazard; a contract-level state guard is still required (reviewer finding, unfixed).
- **Egress**: guests only get `wasi:http` through an allowlist; private-IP filtering, redirects and DNS pinning are undocumented. The DNS-SSRF finding on `http_json_v1` therefore depends on OutLayer.
- **Agent Market**: custodial ledger, buyer-released, resolver "reads the brief, the thread, and the deliverable" with no stated evidence integrity or resolver accountability; job board and ledger returned 401 without credentials (I did not create an account), so third-party analysis of it needs an account.
- No NEAR-native escrow/dispute primitive was found; `intents.near` verifies signed intents only, and Intents has no testnet.

## Next steps

1. Decide the seed policy (who is a trust root) and the strength table. Policy decisions, not engineering.
2. Add `buyer`/`amount`/`rubric` to the attestation log line (today it carries `id worker verdict evidence_hash arbiter rubric`) so a rating can be recomputed from logs alone without `get_escrow` per id; the view calls work now but are O(N).
3. Replace the synthetic market with real Agent Market reputation data only if an account/export is available; otherwise treat the result as a property of the scoring rules.
4. Separate from reputation: the callback-state guard and the already-true-condition fix from the v3 review remain open.
