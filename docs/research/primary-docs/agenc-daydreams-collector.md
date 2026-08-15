# Primary sources — AgenC, Daydreams, Collector Group

Read from Anchor program source, committed IDLs, Ethereum Magicians threads, and repo READMEs.

---

## AgenC

**Sources read:** agenc.ag/docs, agenc.tech/, docs.agenc.tech/docs/, raw READMEs for tetsuo-ai/AgenC, /agenc-protocol, /agenc-plugin-kit, plus the agenc-protocol repo structure. Solscan fetch failed (403).

### Program ID — confirmed and consistent

`HJsZ53Zb27b8QMRbQpuDngE44AdwCGxvEZr61Zmxw1xK`

Declared in `programs/agenc-coordination/src/lib.rs`, consistent across all four properties.

### ⚠️ The project contradicts itself on both headline stats

| Source | Mainnet date | Instruction count |
|---|---|---|
| agenc.tech (marketing) | **June 11 2026** | **99** |
| agenc.ag (live marketplace) | not stated | **96** |
| agenc.ag/docs | **2026-07-22** ("revision-5 cutover") | **101** |
| docs.agenc.tech | staged | **98** |
| GitHub agenc-protocol README | **2026-07-22** | **101** |

The "live since June 11 2026 with 99 instructions" claim I reported earlier matches **only the marketing site**, and is contradicted by the closer-to-source properties (docs and GitHub) at 101 instructions and a July 22 cutover. Most plausible reading: June 11 was the original mainnet genesis deploy and July 22 a "revision-5" upgrade that grew the surface — but nothing says so, and **four different numbers (96/98/99/101) appear across four surfaces with no versioning note reconciling them.** Treat the marketing figures as unverified.

Resolving this needs an on-chain deploy-slot lookup on the program ID above; Solscan 403'd in this pass.

### Escrow and settlement design — money path

- **Program-owned escrow:** funds lock the moment the task-creation tx lands; "no marketplace operator can redirect it."
- **Normal release path:** creator accept/reject after worker submission — i.e. **the task creator, not the worker or an oracle, controls release.** That is a meaningful asymmetry: workers depend on creator good faith by default.
- **Non-delivery:** "Unclaimed tasks cancel for a full refund."
- **Disputes:** "Disputes via single-resolver model with stake slashing" plus "symmetric completion bonds posted by both parties." A **single named resolver** adjudicates — a centralization point. Docs treat this as a fallback; creator accept/reject is the default.
- **Pause safety:** "Settlement paths — submit, accept, reject, cancel — always stay open" during protocol pauses, "enforced at the code level."
- **Fees:** 500 bps (5%), with a "4-leg settlement split" across protocol/operator/referrer/worker, a "worker floor," and per-leg/combined basis-point caps, all locked at task creation.
- **Moderation:** "The program refuses to publish unmoderated specs — enforced in code, not policy text" — a fail-closed gate.

This is a genuinely detailed escrow design, more so than anything else in the cohort.

### Is the repo real source?

Yes. `agenc-protocol` contains `programs/agenc-coordination/` (Anchor/Rust), a **committed IDL** at `artifacts/anchor/idl/agenc_coordination.json`, and `tests-integration/` (litesvm Node tests against the compiled `.so`). The on-chain logic is public.

But `agenc-core` is confirmed private — per the plugin-kit README, "the actual runtime host implementation resides separately in `agenc-core`." **The worker/host orchestration runtime is closed source.**

**Test/audit claims are self-reported only:** "524 production Rust tests, 408 integration tests... 657 SDK tests, 1,444 npm workspace tests," a claimed OtterSec-verified reproducible build, and an internal adversarial audit (19 findings, all closed). None independently verified — the OtterSec badge and audit report were not fetched.

### Verdict

The most serious engineering in the cohort: a real named program, consistent program ID, committed IDL, and a detailed escrow/dispute design. Undercut by its own properties disagreeing on both headline stats and by audit claims resting entirely on self-report.

---

## Daydreams — and the two ERCs

**Sources read:** github.com/daydreamsai/daydreams, /taskmarket-contracts, **ethereum-magicians.org/t/erc-8195-task-market-protocol/27935 (fetched live)**. `ethereum/ERCs` raw paths for erc-8194.md and erc-8195.md both **404**. dreams.fun **does not resolve**.

### ⚠️ The core repo is declared obsolete by its own maintainers

> "This agent framework is no longer the core focus as features are already obsolete."

They now recommend developers use a separate "Pi agent harness." The team has pivoted to "Agentic Commerce." Their X bio:
> "Daydreams is an AI product lab with a thesis on agentic commerce, that led us to create TASKMARKET... We've shipped a stack of agentic products. Agent frameworks. USDC inference routers. A popular x402 payment facilitator... A V1 of a task market primitive on Base."

**Dreams Router does exist** as a `packages/` component — "a universal AI gateway... multiple LLM providers (OpenAI, Anthropic, Google, Groq, xAI) through a single API with built-in x402 payment support for pay-per-use USDC micropayments." Shape confirmed; implementation depth not opened directly.

### ERC-8195 "Task Market Protocol" — read directly on Ethereum Magicians

**Author: beau. Posted March 10 2026. Status: Draft.**

Specifies a standardized on-chain task-coordination interface with **five procurement modes — Bounty, Claim, Pitch, Benchmark, Auction** — explicitly "actor-agnostic" (humans, AI agents, and IoT devices treated identically via ERC-8004 identity). Standardizes deterministic task IDs via monotonic nonces and deliverable anchoring via content hashing. Depends on ERC-8194 for "keyless authorization."

**The community response was substantive peer review, not indifference** — this is the most interesting finding here:
- KBryan (Mar 17) — positive but critical, pushed for explicit ERC-8001 coordination-layer integration, flagged gaps in machine-readable coordination terms.
- KBryan (Mar 18) — approved the revision, citing "canonical per-mode payload schemas."
- 0xlamps (Apr 8) — concrete objections on multi-winner bounty payouts, contradictory multiple-submission handling, and the hard PGTR dependency.

The author incorporated the feedback across revisions (native ranked payouts, fixed the deliverable-write contradiction, made authentication mechanism-agnostic). Real engaged review — neither rubber-stamped nor ignored.

**ERC-8194 (PGTR, Payment-Gated Transaction Relay): UNVERIFIED.** Neither its raw ERC markdown (404) nor a separate Magicians thread could be fetched. Described second-hand as letting "agents authorise on-chain action through payment receipts rather than private keys," using an EIP-3009 `transferWithAuthorization` USDC receipt as authorization proof. Consistent phrasing across snippets suggests it traces to a real abstract, but **it was not read directly and should not be quoted as primary.**

**taskmarket-contracts** is a real Solidity implementation — Diamond proxy pattern (EIP-2535), contracts in `src/`, tests in `test/`, Slither/Solhint/forge-snapshot CI. No production deployment address surfaced.

### Verdict

Both ERCs are real, live **Draft** proposals with a named author, genuine forum engagement, and a matching Solidity reference implementation — specified and partially implemented, not a bullet point. Neither is near standardization. The headline finding is that the flagship agent framework is **self-declared obsolete**; the team's real bet has moved to task markets on Base.

---

## Collector Group — cannot be verified

**Searched:** pump.fun direct token/coin lookups; Colosseum agent-hackathon project directory and name search; multiple phrasings of "Collector Group" + pump/hackathon/Colosseum; direct fetch of launchoncollector.com (http and https) and via r.jina.ai; @pumpspotlight timeline for "Collector"; site:x.com for "launch on collector"/"launchoncollector". web.archive.org was **unavailable to the tooling** in both passes.

**Result: no entity named "Collector Group" has any primary-source footprint.** No site, doc, GitHub repo, token contract, announcement, or Colosseum listing.

The one adjacent real thing is **"Launch on Collector"** at launchoncollector.com — a Pump.fun token-launcher wrapper minting "graded, serialized collector cards" (art graded "GEM MT 10," numbered #001/#002 as the ticker, 50% of creator fees routed to the uploader). It surfaces only through **search-engine cached metadata**; the live site returns a Vercel `DEPLOYMENT_NOT_FOUND` error on direct fetch, confirmed through the proxy. No X account, repo, Colosseum submission, or pump.fun coin page was found for it either.

**Verdict:** unconfirmed after two independent research passes. The adjacent lead is itself a dead deployment with no team, social, or repo footprint — so it does not establish that "Collector Group" exists as a project, team, or token. Of twelve winners, this one cannot be shown to exist.

---

## Batch verdict

| | Real code? | Docs consistent? | Flagship claim |
|---|---|---|---|
| AgenC | ✔ Anchor program + IDL | ✖ 4 conflicting instruction counts | ~ escrow design is real; audits self-reported |
| Daydreams | ✔ Solidity + ERC drafts | ✔ | ✖ core framework self-declared obsolete |
| Collector Group | ✖ nothing found | n/a | ✖ existence unverifiable |
