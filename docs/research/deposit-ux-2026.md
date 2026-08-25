# Deposit UX: how the leading venues actually do it (Aug 2026)

Research prompted by "you can't toggle chains when you deposit". The toggle is a
symptom; the deposit model underneath is the actual problem.

## 1. What we ship today

`terminal/src/components/wallet/WalletModal.tsx` has two deposit paths:

| Session | What the user gets |
|---|---|
| Custodial | 7 chain chips (6 EVM + Solana) over **one** omnibus EVM address + one Solana address. Switching between the 6 EVM chips changes the label and the warning text — the address and QR are byte-identical. |
| Connected wallet | No chips at all. A bare address, no QR, no network warning. On a Phantom/Solana session, **no address either** — that branch reads wagmi's `connectedAddress`, which is EVM-only. |

Both are wrong, but in different ways, and neither is fixed by adding a toggle.

## 2. The three patterns in production

### A. Deposit-address model — Polymarket
Bridge addresses are issued **per chain family, not per chain**: `evm`, `svm`,
`btc`, `tron`. One EVM address covers Ethereum / Arbitrum / Base / Optimism /
others; assets auto-convert to pUSD on Polygon. Per-asset minimums are published
via `/supported-assets` and deposits below them are not processed. Wrong-network
protection is explicitly *not* built in — the docs warn of "irrecoverable loss"
and there is a separate recovery tool. Above ~$50k from non-Polygon chains they
tell you to use deBridge/Across/Portal instead.

**Lesson:** the unit of choice is the *address family*, never the individual
chain. Polymarket does not render six chips over one EVM address — because that
choice does not exist.

### B. Route-the-funds model — dYdX v4, Hyperliquid
No deposit-address screen for a connected wallet. dYdX v4 integrated Squid
(Axelar + CCTP + IBC) for "deposit any token from any chain" in a single click;
current docs point at Skip Go, whose API exposes supported chains and tokens so
the client renders a real source picker. Hyperliquid's canonical route is USDC
on Arbitrum, and the ecosystem (Across 22+ chains, deBridge, LI.FI, Eco Routes
15 chains, CCTP) exists purely to abstract the source chain away from the trader.

**Lesson:** for a wallet the user controls, "deposit" is a **transfer form**
(source chain + token + amount → one signature), not a receive address.

### C. Unified account balance — GMX
GMX Account gives one balance across chains: deposit once, trade from anywhere
with no manual bridging. When opening a position, margin can be drawn from
**either** the connected wallet or the GMX Account, selected in the UI.

**Lesson:** the venue balance and the wallet balance coexist as fundable
sources; the user picks per action.

## 3. The cross-cutting rules

1. **Auto-detect the network from the connected wallet's chainId.** Defaulting
   to Ethereum is called out as a live footgun ($5–25 gas, wrong chain).
2. **Drive source selection off real balances.** Never offer a network where the
   user holds nothing — chain and token are chosen together.
3. **Never present one address under N chain labels.** If the address is the
   same, the choice is not real; state the accepted networks instead.
4. **Publish minimums and expected credit time before commit.**
5. **Prevent wrong-network by construction**, don't warn after the fact: only
   render families the connected wallet can actually control.
6. **Optimistic credit with a visible soft-hold** while finality settles.

## 4. What this means for Suwappu

We already own the hard part. `/webapp/bridge/routes|build|record` is live, with
route ranking by net value, trust-model and settlement copy (`custody.ts`), and a
`CustodyTimeline`. `BridgePanel` covers 8 chains × USDC/USDT.

Proposed model, per session type:

- **Connected wallet → funding flow, not an address.** Reuse the bridge rails:
  source chain + token from the user's actual balances, amount, ranked route,
  one signature, existing custody timeline for the wait. This is pattern B, and
  it is assembly of parts we already ship.
- **Custodial → chain-family address.** Collapse the 6 EVM chips into one "EVM
  networks" option that names what it accepts, plus Solana. This is pattern A,
  and it removes the dead toggle rather than making it look alive.
- **Keep both reachable.** Pattern C: a connected-wallet user may still want to
  fund the custodial balance; a custodial user may want to pull from their own
  wallet. One modal, source selector at the top.

## 5. Scope note

This is a redesign of the deposit modal, not a patch. The committed change on
`claude/connected-wallet-bug-jcdqr6` (3858e98) is the stopgap: it gives connected
wallets the existing picker and stops the Solana blank-address bug. It does not
implement any of the above.

## Sources

- Polymarket deposit docs — https://docs.polymarket.com/trading/bridge/deposit
- Polymarket bridge/agent skills — https://github.com/Polymarket/agent-skills/blob/main/bridge.md
- dYdX v4 + Squid one-click onboarding — https://www.axelar.network/blog/dydx-v4-bridge
- dYdX onboarding / Skip Go — https://docs.dydx.xyz/interaction/integration/integration-onboarding
- Squid UI cross-chain deposits to dYdX v4 — https://docs.dydx.community/dydx-chain-technical-docs/getting-started/user-guides/how-to-use-squid-ui-for-cross-chain-deposits-to-dydx-v4
- Across → Hyperliquid bridging — https://across.to/blog/hyperliquid-bridge
- deBridge → Hyperliquid — https://debridge.com/learn/guides/the-best-steps-on-how-to-bridge-to-hyperliquid/
- Eco Routes / Hyperliquid multi-chain deposits — https://eco.com/support/en/articles/15082532-hyperliquid-bridge-how-to-deposit-usdc-from-any-chain
- GMX trading overview (GMX Account, margin source) — https://docs.gmx.io/docs/trading/overview/
- GMX on Ethereum / unified balance — https://gmxio.substack.com/p/gmx-is-live-on-ethereum
- Wrong-network deposit UX failure modes — https://tech-insider.org/web3-product-design-lessons-crypto-platforms-2026/
- Crypto.com network-selection guidance — https://help.crypto.com/en/articles/5529369-how-to-choose-a-network-when-depositing-withdrawing-crypto
