# Solver / Filler Strategy — Internalize First, Solve Cross-Chain Second

**Status:** Research / strategy · **Date:** 2026-06-25 · **Owner:** TBD
**Part of:** [`flywheel-strategy.md`](./flywheel-strategy.md) — this is the concrete build-out
of leg ① (execution) + the ★ solver/filler play in §2.5.

The question: should Suwappu become a **solver/filler** to monetize execution quality? The
research answer is sharper than "yes": **your edge is *owning the flow*, not *winning
auctions*. Internalize your own users' swaps first (PFOF-style); treat external solving as a
narrow inventory-utilization add-on — never the core bet.**

> **TL;DR**
> - **Generic external solving on majors is a trap.** UniswapX is **>90% SCP + Wintermute**;
>   CoW is **~50% Barter** (it just bought a rival's codebase). Single-chain atomic solving
>   is a capital + latency arms race you lose to pro market makers.
> - **The permissionless venues exist** — UniswapX non-exclusive filling (no KYC/stake/
>   allowlist), Across relayers (no bond), ERC-7683 to span them with one bot — but margins
>   on USDC majors are already **inside ~5 bps** and compressing.
> - **The real play is internalization:** fill *your own bot users'* swaps from inventory
>   *before* routing to external DEXs. You capture the spread you currently pay away, against
>   **your own non-toxic retail flow** (exactly what MMs covet), with **zero CAC and no
>   auction competition** — and your **perps desk hedges the inventory.** This is leg ① of the
>   flywheel made concrete, and it deposits more order-flow data into the core (§0).

---

## 1. The venues, by barrier and fit

| Venue | Permissionless? | Scope | Who dominates | Fit for us |
|---|---|---|---|---|
| **UniswapX — non-exclusive filler** | **Yes** — no KYC, no stake, no allowlist; deploy a callback contract + poll the order feed | Same-chain + ERC-7683 cross-chain | **SCP + Wintermute >90%**; ~85% PMM inventory | Entry point for *external* flow, but majors are saturated |
| UniswapX — mainnet quoter | No (Labs-vetted) | Exclusive RFQ windows | — | Skip |
| **Across — relayer** | **Yes** — permissionless, no bond/KYC | **Cross-chain by design** | 15+ relayers, **no single dominant** (speed race) | **Best external fit** — our multi-chain inventory *is* the edge |
| **CoW — solver** | **No** — bonding pool ($500k + 1.5M COW, or vouched w/ 15% fee + 25% reward lock) + KYC | Mostly same-chain | **Barter ~50%** | Skip — gated + dominated |
| **1inch Fusion** | **KYC/KYB-gated**; stake gate *removed* (1IP-89 → Resolver NFT after due diligence) | Same-chain | ~10 incumbents (opening up) | Later; Fusion+ cross-chain needs pre-positioned inventory on every chain |

**ERC-7683** (co-authored by Uniswap Labs + Across) is the unlock for external flow: a single
7683 solver extends across **UniswapX, Across, CoW, and Eco** from one bot. Build the filler
once, point it at multiple intent sources.

---

## 2. The competitive reality (why generic solving is a trap)

- **Atomic single-chain solving is winner-take-most and MM-dominated.** Pro market makers
  (SCP, Wintermute, Barter) win because they price off **cross-venue inventory + low-latency
  feeds** and **hedge on Binance/OTC in real time**. Solving is "running a market-making
  desk," not "a bot." A small team will not out-execute them on majors.
- **Cross-chain is *less* saturated but compressing.** Across has 15+ relayers and "no single
  solver dominates" — it's a **speed/latency race** (first relayer fronts liquidity). USDC
  routes already clear **inside ~5 bps all-in**. The durable edge is **exotic chain pairs +
  long-tail tokens** (where 7-chain coverage matters), **not** USDC↔USDC on Base/Arb/OP.
- **Capital is the binding constraint.** Illustrative model: **$20M inventory across 10
  chains at 5% cost of capital ≈ $1M/yr funding** → at ~4 bps net you need **~$25B/yr gross
  volume just to break even on capital.** A serious external solver needs single-digit-to-
  low-tens-of-millions pre-positioned per chain.
- **Adverse selection is the killer.** In open auctions you win the fills that **move against
  you** — the flow MMs *declined*. External intent flow is toxic by selection.

> The honest read: external generic solving is a **leveraged, capital-intensive MM operation
> with tail risk** (bridge/oracle failure, rebalancing drag, latency loss), not a fee-skim
> side business.

---

## 3. The real play — internalize your own flow

**Fill your own bot users' swaps from your own inventory, before routing to external DEXs.**
This inverts every disadvantage above:

| External solving | Internalizing your own flow |
|---|---|
| Win toxic flow MMs declined | Your **own non-toxic retail flow** — the exact flow MMs pay for |
| Compete in auctions vs SCP/Barter | **No competition** — it's your order book |
| Pay to acquire flow | **Zero CAC** — you already have the users |
| Need a CEX hedging desk | **Your perps desk hedges the inventory** |
| Pre-position capital to win bids | Deploy capital only against flow you already see |

**This is the PFOF/internalization leg of the flywheel** (`flywheel-strategy.md` §1 ①), made
concrete — and it's the strongest, most defensible loop because **every internalized fill
deposits proprietary execution data into the core** (§0). You're not renting an edge; you're
compounding one you already own.

### How it works (build sketch)
A thin **internalization layer in front of the existing swap router**:

```
 user swap intent (bot/webapp)
        │
        ▼
 ┌──────────────────────────────┐
 │ Suwappu internalization layer│  quote from own inventory (RFQ)
 │  ── new, in front of router ─┤
 └───────┬──────────────┬───────┘
         │ we beat best  │ we don't
         ▼ external route ▼
   fill from OWN        pass through to
   inventory →          external DEX route
   capture spread       (today's behavior)
         │
         ▼
   net inventory delta → hedge on perps desk
```

1. On each user swap, get the external best route (existing aggregator logic) **and** an
   internal quote from Suwappu inventory.
2. **Only internalize when we match or beat the external price** (best-execution gate — see
   risk note). Otherwise pass through unchanged.
3. Capture the spread between the user's price and our true sourcing cost.
4. Net the resulting inventory exposure; **hedge residual on the existing perps desk.**
5. Log every fill into the execution-data core (feeds routing/signals/agents).

> ⚠️ **Best-execution & conflict-of-interest (the Robinhood PFOF lesson).** Acting as
> counterparty to your own users is exactly the arrangement regulators scrutinized in
> equities PFOF. Keep it clean and defensible: **only internalize when you match-or-beat the
> independently-computed best external route**, log the counterfactual for every fill, and
> disclose that Suwappu may act as principal. Non-custodial (user signs from their own
> wallet) keeps it permissionless software; the *price guarantee* is what keeps it honest.

### Why it's permissionless
No gatekeeper: it's your own capital being a liquidity source to your own users' non-custodial
swaps. No bond, no allowlist, no KYC-to-operate. (Standard sanctions/ToS obligations from the
permissionless lens still apply — `flywheel-strategy.md` §2.5.)

---

## 4. External solving — a narrow add-on, later

Once internalization is proven and you're sitting on idle multi-chain inventory between fills,
**use that same inventory to relay external cross-chain flow** — but only where your edge is
real:

- **Venue:** Across relayer (permissionless) + an **ERC-7683 filler** to also see UniswapX /
  Eco cross-chain orders from the same bot.
- **Routes:** exotic chain pairs + long-tail tokens only. **Never USDC↔USDC majors** (sub-5bps
  latency war you lose to Barter/Wintermute).
- **Framing:** inventory *utilization*, not a standalone desk. It earns yield on capital you're
  already holding for internalization.
- **Defer:** 1inch Fusion+ (KYC + pre-positioned inventory on every chain) until the operation
  is proven and capitalized.

---

## 5. Capital, infra, risk

- **Infra (modest):** order-feed poller, internal quoting/pricing engine, on-chain settlement
  bot, dedicated RPCs per chain, gas floats, monitoring. **~$2–10k/mo fixed**; engineering is
  the real cost. (Same stack serves internalization *and* external 7683 filling.)
- **Capital:** internalization scales *with your own flow* — start small (low-six-figures of
  inventory on your busiest chains), grow with volume. You don't need the $10M+ a competitive
  external solver needs, because you're not bidding for external volume.
- **Risks:** inventory/rebalancing drag (hedge via perps; rebalance on a schedule), price-feed
  accuracy (a bad internal quote = you eat the loss), best-execution discipline (above), and —
  for the external add-on — bridge/oracle settlement risk and finality risk.

---

## 6. Recommended sequence

1. **Build the internalization layer** in front of the existing router; best-execution-gated,
   non-custodial, perps-hedged. *(this is the build; everything else is later)*
2. **Instrument it into the execution-data core** — log every fill + counterfactual.
3. **Add an ERC-7683 / Across relayer** that reuses the same inventory for external cross-chain
   long-tail flow once internalization runs clean.
4. **Defer / skip:** CoW solver (bonded + dominated), 1inch Fusion+ (KYC + heavy capital),
   generic UniswapX filling on majors (lose to SCP/Wintermute).

**Bottom line:** the solver question resolves to a flywheel question. Suwappu's edge is
**owning the flow**, not winning auctions — so internalize that flow first (capturing spread
you already pay away, hedged on infra you already run, against the cleanest flow in the
market), and only then lend the idle inventory to external cross-chain relaying.

---

### Sources
- UniswapX fillers: [filler overview](https://developers.uniswap.org/contracts/uniswapx/fillers/filleroverview) ·
  [create a filler](https://docs.uniswap.org/contracts/uniswapx/fillers/mainnet/createfiller) ·
  [ERC-7683 cross-chain intents](https://blog.uniswap.org/uniswap-labs-and-across-propose-standard-for-cross-chain-intents)
- CoW solvers: [bonding pools](https://docs.cow.fi/cow-protocol/reference/core/auctions/bonding-pools) ·
  [onboarding](https://docs.cow.fi/cow-protocol/tutorials/solvers/onboard) ·
  [CIP-44 reduced bond](https://forum.cow.fi/t/cip-44-reduced-bonding-requirements/2424) ·
  [Barter buys rival (Blockworks)](https://blockworks.co/news/barter-buys-rival-solver-codebase)
- Across relayers: [running a relayer](https://docs.across.to/relayers/running-a-relayer) ·
  [fees](https://docs.across.to/user-docs/how-across-works/fees) ·
  [Paradigm: Across Prime](https://www.paradigm.xyz/2025/05/across-prime)
- 1inch Fusion: [resolver requirements 1IP-89](https://gov.1inch.network/t/1rc-update-to-resolver-access-requirements-for-fusion-order-flow/836) ·
  [Fusion+ explainer](https://help.1inch.com/en/articles/9842591)
- Economics / competition: [solver market structure (arXiv 2503.00738)](https://arxiv.org/html/2503.00738v1) ·
  [CoW solver dashboard (Dune)](https://dune.com/cowprotocol/solver-info) ·
  [LI.FI: solvers all the way down](https://li.fi/knowledge-hub/with-intents-its-solvers-all-the-way-down)

*Caveats (from research): some figures (>90% UniswapX concentration, the $20M/$25B capital
model, "inside 5 bps") are secondary-source estimates — confirm on Dune/on-chain before
committing capital. 1IP-89's on-chain effective date and exact Across minimum-capital are
unverified. The qualitative conclusion — MM-dominated atomic solving, cross-chain less
saturated but compressing, internalize-your-own-flow as the real edge — is well-supported.*
