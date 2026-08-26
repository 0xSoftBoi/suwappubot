---
title: "The execution layer between intent and markets"
audience: general crypto/DeFi audience, stablecoin ecosystem, cross-chain builders, Stablecon DC attendees
status: draft
topic_status: production/hosted per docs/product-status.md (Terminal, Telegram, webapp = Production; Agent REST, Hosted MCP, A2A = Hosted)
---

## Sources (every number below is traceable)

- `showcase/src/data/stats.generated.json` — `platformChains: 45`, `agentApiChains: 18`, `routerCount: 21`, `mcpToolCount: 22` (regenerated via `bun run stats:generate`; per `docs/README.md` this is the source of truth over any hand-typed count)
- `showcase/src/app/page.tsx`, `showcase/messages/en.json` — positioning language ("execution layer between intent and markets")
- `docs/product-status.md` — the five-level execution authority ladder (Discover/Quote/Simulate/Prepare/Managed execute) and current interface mapping
- `docs/architecture/OVERVIEW.md` — execution flow (intent → auth/policy → route eligibility → parallel quote discovery → comparison → simulation → prepare/execute → receipt), and the explicit caveat that no route races all 21 integrations (chain-gated eligibility)

---

## A. Long-form (blog / Mirror)

**Title: We don't run a DEX. We run the layer that decides which DEX, bridge, or router should fill your intent.**

"Swap ETH for USDC" is not one operation — it's a search problem. Which of 21 routing integrations (0x, 1inch, Across, CCTP, CoW, Jupiter, KyberSwap, Li.Fi, LayerZero, Wormhole, and others) can even serve this pair, on this chain, right now, at what price, with what confirmation time, and what happens if one of them reverts mid-route? Suwappu's job is to answer that question every time, across a platform surface currently spanning 45 chains (18 for the agent-facing API), and then hand back either an unsigned transaction for you to sign yourself, or execute it under an explicit managed-execution grant — never blurring which one just happened.

We formalize that distinction as a five-level authority ladder, because "the bot executed my swap" means something very different depending on who held the keys: Level 0 is read-only discovery (chains, tokens, prices), Level 1 is a quote, Level 2 is simulation, Level 3 prepares an unsigned self-custody transaction, and Level 4 is server-side managed execution that can actually move funds. A tool or endpoint name is never allowed to imply a higher level than it actually grants — our own MCP `execute_swap` tool, despite the name, is Level 3, not Level 4, and that's documented, not a discovered surprise.

Underneath the ladder, the actual execution flow is: intent comes in, auth/wallet/policy checks run, route eligibility is computed (routing providers are chain-gated — no aggregator, ours included, serves every pair on every chain), eligible providers are queried in parallel for quotes, quotes get compared, a simulation/safety pass runs, and only then does the system either return unsigned transaction data or execute under explicit grant. Every step produces a receipt or status you can query afterward.

None of this requires you to trust a single router's liquidity or a single bridge's security model — the value of an execution layer is that when one provider is degraded, slow, or ineligible for a pair, the system routes around it instead of failing the intent. That's the pitch to a stablecoin issuer or treasury desk evaluating where their token needs to move: not "we're another DEX," but "we're the layer that decides which of the 21 already exist should move it, and proves what actually happened afterward."

## B. X/Twitter thread

1/ "Swap ETH for USDC" isn't one operation. It's a search problem: which of 21 routing integrations can even serve this pair, on this chain, right now, at what price? That search is Suwappu's actual job. 🧵

2/ Platform surface: 45 chains. Agent-facing API: 18 chains. 21 routing integrations (0x, 1inch, Across, CCTP, CoW, Jupiter, KyberSwap, Li.Fi, LayerZero, Wormhole, more). All three numbers are generated from live discovery, not hand-typed. (`stats.generated.json`)

3/ Execution flow: intent → auth/policy checks → route eligibility (chain-gated — no router serves every pair) → parallel quote discovery → comparison → simulation/safety pass → prepare unsigned tx OR managed execute → receipt.

4/ We separate "prepared" from "executed" on purpose, with a 5-level authority ladder: Discover → Quote → Simulate → Prepare (unsigned, you sign) → Managed execute (we sign, funds move). A tool name never implies a level it doesn't have.

5/ Case in point: our own MCP `execute_swap` tool, despite the name, is Level 3 — it prepares, it doesn't execute. Managed execution is a separate, explicit call. That distinction is documented, not a gotcha someone found later.

6/ "The execution layer between intent and markets" — not another DEX front end, the routing/decision layer that decides which of 21 already-existing venues should fill your intent, and proves what happened after.

## C. LinkedIn

**A swap is not one operation — it's a search across 21 routing integrations, and someone has to run that search honestly.**

When a user or an agent says "swap ETH for USDC," the real question is: which of the routing integrations we support — 0x, 1inch, Across, CCTP, CoW, Jupiter, KyberSwap, Li.Fi, LayerZero, Wormhole, and others, 21 in total — can actually serve this pair, on this chain, right now, at what price and confirmation time? Suwappu's execution flow answers that question every time: intent comes in, policy checks run, route eligibility is computed (providers are chain-gated, so no router serves every pair everywhere), eligible providers are queried in parallel, quotes are compared, a simulation pass runs, and only then does the system return an unsigned transaction or execute under an explicit grant.

We think the custody distinction matters enough to formalize: a five-level authority ladder from read-only discovery up to managed execution, documented so that a tool or API method name is never allowed to imply more authority than it actually has. Our own MCP execute_swap tool, for example, is Level 3 (prepares an unsigned transaction) despite the name — not Level 4 (moves funds) — and that's stated plainly in our docs rather than left for an integrator to discover the hard way.

The platform surface currently spans 45 chains (18 for the agent-facing API), with all of those numbers generated directly from live discovery rather than maintained by hand. For teams evaluating cross-chain execution infrastructure — including stablecoin issuers thinking about where their token needs to move — the pitch isn't "another DEX." It's the layer that decides which of the existing venues should fill an intent, and can prove what happened afterward.

## D. SEO title/description

- **Title:** Suwappu — The Execution Layer Between Intent and Markets
- **Description:** Suwappu routes swap intents across 21 routing integrations and 45 chains, with a formal 5-level execution authority ladder separating quote, prepare, and managed execution so custody is never ambiguous.

## What we deliberately did not claim

- Did not say "we support all 21 routers on every chain" — `docs/architecture/OVERVIEW.md` explicitly warns eligibility is chain-gated and no route should be documented as racing all 21.
- Did not use "7+ chains" (CLAUDE.md's shorthand) since the generated stats file is the documented source of truth and reports higher, more specific numbers (45 platform / 18 agent API) as of this writing.
- Did not claim managed execution (Level 4) is available on every surface — per `docs/product-status.md`, A2A has no fund-moving method today, and MCP `execute_swap` is Level 3, not 4.
- Did not name uptime, latency, or slippage benchmarks — none were found in the reviewed docs.
