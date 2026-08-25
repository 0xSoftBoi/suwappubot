# Deposit architecture: how the leading venues do it, and what we actually ship

Prompted by "you can't toggle chains when you deposit". The toggle is a symptom.
Underneath it are three problems, in ascending order of severity.

---

## Part 0 — The finding that outranks the UX question

**MONEY-PATH. Needs a human decision before any deposit UI ships.**

`api/routes/terminal.py:2156` returns, in its own words, *"the omnibus deposit
addresses"*:

```py
evm = hot_wallet_service.get_deposit_wallet("evm")     # first active deposit hot wallet
sol = hot_wallet_service.get_deposit_wallet("solana")  # ...system-wide, not per-user
```

`hot_wallet.py:812` confirms it — `.filter(is_deposit_wallet == True, is_active == True).first()`.
**Every signed-in user is shown the same address.** `bot/handlers/custodial.py:229`
shows the identical address behind six chain buttons in Telegram.

Now the part that matters. I traced every call site that credits a custodial
balance (`operation="add"`):

| Caller | What it credits |
|---|---|
| `withdraw_reconciler.py:202`, `custodial.py:819/843/866`, `terminal.py:2365/2372/2383/2398` | refund/undo of a **failed withdrawal** |
| `onchain_rewards_service.py:422` | rewards |
| `referral_service.py:777/890` | referrals |
| `giftcard.py:114/388` | gift-card redemption |

**Not one credits an inbound on-chain transfer.** `get_deposit_wallet` is only
ever used to *display* an address, for p2p escrow, and for withdrawals. There is
no deposit watcher, no sweeper crediting users, no admin credit command.

Why this cannot be patched with a tag: EVM has no memo/destination-tag field.
Fireblocks' guidance is explicit — memo/tag attribution exists on Stellar and
Ripple; **for EVM you must use a dedicated address per user**. An omnibus EVM
address with no memo is, by construction, unattributable from chain data alone.

So today the deposit screen asks users to send funds to a shared hot wallet with
no automated path to crediting them. Either there is an ops process I cannot see
in the code, or user deposits are landing unattributed. **This needs answering
before we make the screen nicer** — a better deposit UI drives more volume into
that path.

Note: `.claude/skills/goal/SKILL.md:48` lists Terminal deposit/withdraw as
working and worth porting to the webapp, so this is not a tracked gap.

---

## Part 1 — The three production models

### A. Deposit-address model — Polymarket
Bridge addresses issued **per chain family** (`evm`, `svm`, `btc`, `tron`) and
**per user**, requested by calling the deposit endpoint with the user's
Polymarket wallet address. One EVM address spans Ethereum/Arbitrum/Base/Optimism;
assets auto-convert to pUSD on Polygon. Per-asset minimums published via
`/supported-assets`; below-minimum deposits are not processed. Wrong-network
protection is explicitly absent — docs warn of "irrecoverable loss" and point to
a separate recovery tool. Above ~$50k from non-Polygon chains they route you to
deBridge/Across/Portal instead.

Two lessons: the unit of choice is the **address family**, never the individual
chain; and the address is **per user**, which is what makes crediting possible.

### B. Route-the-funds model — dYdX v4, Hyperliquid
No deposit-address screen for a connected wallet at all. dYdX v4 shipped
one-click onboarding via Squid (Axelar + CCTP + IBC), now Skip Go, whose API
exposes supported chains/tokens so the client renders a **real** source picker.
Hyperliquid's canonical route is USDC on Arbitrum; Across (22+ chains), deBridge,
Eco Routes (15 chains) and CCTP exist to abstract the source chain away entirely.

Lesson: for a wallet the user controls, "deposit" is a **transfer form** —
source chain + token + amount → one signature — not a receive address.

### C. Unified account balance — GMX
GMX Account holds one balance across chains: fund once, trade anywhere, no manual
bridging. Opening a position draws margin from **either** the connected wallet or
the GMX Account, chosen in the UI.

Lesson: venue balance and wallet balance coexist as fundable sources; the user
picks per action.

---

## Part 2 — Cross-cutting rules these venues share

1. **Auto-detect network from the connected wallet's chainId.** Defaulting to
   Ethereum is a documented footgun ($5–25 gas, usually the wrong chain).
2. **Drive source selection off real balances** — chain and token chosen
   together; never offer a network where the user holds nothing.
3. **Never present one address under N chain labels.** Same address ⇒ no real
   choice. State the accepted networks instead.
4. **Publish minimums and expected credit time before commit.**
5. **Prevent wrong-network by construction** — only render families the
   connected wallet can control — rather than warning after the fact.
6. **Optimistic credit with a visible soft-hold** while finality settles.

---

## Part 3 — What we already own (and don't expose)

The hard parts are built and none of it is reachable from the deposit modal:

| Service | What it does |
|---|---|
| `cctp_api.py` | Native USDC burn/attest/mint, zero bridge fee |
| `cctp_relayer.py` | **User signs only the source-chain burn**; relayer does the destination mint + gas-drop — exactly the dYdX/Hyperliquid abstraction |
| `across_api.py` | Intent-based bridging, ~0.04%, ~2 min |
| `hyperunit_api.py` | Native BTC/ETH/SOL → HyperCore via per-(asset,destination) deposit addresses — **already the per-user address pattern, done right** |
| `btc_bridge.py` | Lightning/BTC ↔ Starknet |
| `/webapp/bridge/routes\|build\|record` + `BridgePanel` | 8 chains × USDC/USDT, routes ranked by net value, trust-model + settlement copy, `CustodyTimeline` |

`hyperunit_api.py` is the proof we know how to do this: deterministic per-user,
per-asset deposit addresses with a watcher on the resulting mint.

---

## Part 4 — Recommended order of work

1. **Answer Part 0.** Either (a) there is an ops/manual crediting process — then
   document it and put expected credit time in the UI; or (b) there isn't — then
   the custodial deposit address must come down until per-user addresses exist.
2. **Per-user EVM/SVM deposit addresses + an inbound watcher**, following the
   `hyperunit_api` pattern already in the tree. This is the prerequisite for any
   honest custodial deposit UI.
3. **Connected wallet → funding flow, not an address** (pattern B). Assembly of
   `bridge/routes|build|record` + `cctp_relayer` + `CustodyTimeline`. No new
   backend.
4. **Custodial → one "EVM networks" entry + Solana** (pattern A), naming the
   accepted networks. Deletes the dead toggle instead of animating it.
5. **One modal, source selector on top** (pattern C): fund the venue balance from
   a connected wallet, or trade straight from the wallet.

`3858e98` on this branch is a stopgap: it fixes a real Solana blank-address bug
and a `def.label` crash, but it expands the chip model that steps 1–4 remove. It
should not ship as the answer.

---

## Sources

- Fireblocks, deposit attribution at scale — https://developers.fireblocks.com/docs/manage-deposits-at-scale
- Coinbase, destination tags & memos — https://help.coinbase.com/en/coinbase/trading-and-funding/sending-or-receiving-cryptocurrency/destination-tag-memo-faq
- Polymarket deposit docs — https://docs.polymarket.com/trading/bridge/deposit
- Polymarket bridge agent-skills — https://github.com/Polymarket/agent-skills/blob/main/bridge.md
- Polymarket relayer-deposits — https://github.com/Polymarket/relayer-deposits
- dYdX v4 + Squid one-click onboarding — https://www.axelar.network/blog/dydx-v4-bridge
- dYdX onboarding / Skip Go — https://docs.dydx.xyz/interaction/integration/integration-onboarding
- Squid UI cross-chain deposits to dYdX v4 — https://docs.dydx.community/dydx-chain-technical-docs/getting-started/user-guides/how-to-use-squid-ui-for-cross-chain-deposits-to-dydx-v4
- Across → Hyperliquid — https://across.to/blog/hyperliquid-bridge
- deBridge → Hyperliquid — https://debridge.com/learn/guides/the-best-steps-on-how-to-bridge-to-hyperliquid/
- Eco Routes, USDC from any chain — https://eco.com/support/en/articles/15082532-hyperliquid-bridge-how-to-deposit-usdc-from-any-chain
- GMX trading overview (GMX Account, margin source) — https://docs.gmx.io/docs/trading/overview/
- GMX on Ethereum, unified balance — https://gmxio.substack.com/p/gmx-is-live-on-ethereum
- Wrong-network deposit failure modes — https://tech-insider.org/web3-product-design-lessons-crypto-platforms-2026/
