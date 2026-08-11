# Suwappu Membership on Robinhood Chain — subscriptions as NFTs

**The pivot:** the NFT is not a collectible with a perk bolted on. The NFT **is the
subscription.** Mint free → you hold Suwappu FREE on-chain. Pay in USDG → your token
becomes PRO / PREMIUM / ENTERPRISE for the time you bought. The bot reads your tier
from the chain. Position Cards (the 10k collection) stay the collectible layer on top.

## Why Robinhood Chain makes this work (all verified against official docs)

| Surface | What it gives us | Source |
|---|---|---|
| **Robinhood Wallet** (self-custody app) | Supports Robinhood Chain natively + WalletConnect — users mint and manage membership from the wallet Robinhood already put in their pocket | robinhood.com/support: Robinhood Wallet, Connect to dapps |
| **ERC-4337, first-class** | EntryPoints v0.6/0.7/0.8 deployed (`0x5FF137D4…2789`, `0x00000000717…a032`, `0x4337084D…F108`), Safe 4337 module, Alchemy Gas Manager + ZeroDev/Privy/Dynamic paymasters, bundler at `robinhood-mainnet.g.alchemy.com/v2/{key}` | docs.robinhood.com/chain/account-abstraction |
| **Gas sponsorship** | The FREE mint is genuinely free — we sponsor gas via a Gas Manager policy scoped to `mintFree()` only. No "free mint plus $0.30 of gas" friction | same |
| **Robinhood Connect** | Onramp inside our webapp: users fund the paid mint from their Robinhood balance without leaving the flow | robinhood.com newsroom: Introducing Robinhood Connect |
| **USDG anchor** | Tier prices are exact: $9.99 = 9.99 USDG (6dp). No ETH price oracle, no drift from the Stripe/x402 pricing | repo: docs/plans/robinhood-chain-native.md (USDG `0x5fc5360D…d168` canonical, 338.7M supply) |
| **Chainlink feeds** | Already integrated for Position Cards; membership needs no oracle at all | prior commit |

## The contract: `SuwappuMembership.sol`

ERC-721, **one token per wallet, soulbound** (a subscription is an account attribute —
transferable memberships become a resale market and a shared-account vector). Modeled
on ERC-5643 (renewable subscription NFTs): `expiresAt`, renewals, `SubscriptionUpdate`
events.

- `mintFree()` — one per wallet, tier FREE, no expiry. This is the "everyone gets
  Suwappu free" mint, and the target of the gas-sponsorship policy.
- `subscribe(tier, periods)` — pays `price[tier] × periods` in USDG (transferFrom →
  treasury), sets/extends expiry in 30-day periods. Auto-mints the token if the wallet
  has none. Prices on-chain match the app: 9.99 / 29.99 / 99.99 USDG per period.
- **Tier switch converts remaining time by price ratio** (remaining × oldPrice ÷
  newPrice), so an upgrade never burns value and a "downgrade-to-stretch-time" is
  value-neutral, not an exploit.
- Expired paid tier ⇒ reads as FREE. No cancellations, no refunds on-chain; stop
  renewing and it lapses. (Ops can comp time via `grantTime`, bounded per call.)
- `tierOf(address)` is the single view the bot consumes: `(tier, expiresAt)`, already
  expiry-collapsed.

## Bot integration — tier resolution (MONEY-PATH)

`x402_service.get_tier` is today's single source of tier truth (DB `Subscription` row,
expiry → FREE). It becomes: **max(DB tier, on-chain membership tier)** —

- `membership_service.get_onchain_tier(user_id)`: resolves the user's EVM wallet,
  `eth_call → tierOf(address)`, 300s TTL cache, hard-fail to `None`.
- **Fail-open to the DB tier**: any RPC/config/parse error means the user keeps
  whatever the DB says. On-chain can only ever *raise* a user's tier, never lower it,
  and an outage can never strip a paying subscriber mid-swap.
- Existing Stripe/x402 flows keep working unchanged — this is an *additional* way to
  hold a tier, not a migration. The `max()` rule makes the two systems composable.

Because tier → `TIER_FEE_RATES` → every quote, this diff goes through
`money-path-reviewer` before merge.

## The user journey

1. **Telegram**: `/cards` (or webapp) → "Claim your free Suwappu membership" →
   WalletConnect QR → **Robinhood Wallet** approves a sponsored `mintFree()` userOp.
   Zero gas, zero funds needed. User now *holds* Suwappu FREE.
2. **Upgrade**: pick PRO/PREMIUM/ENTERPRISE in the Mini App → needs USDG →
   **Robinhood Connect** tops up from their Robinhood balance in-flow → `approve` +
   `subscribe()` from Robinhood Wallet.
3. **Use**: the bot reads the chain. Fees, swap limits, feature gates — all keyed off
   the same `get_tier` they already flow through.
4. **Flex**: membership + Position Cards sit in the same wallet; Positions grants the
   flat 40 bps discount, membership sets the tier rate. Both visible in Robinhood
   Wallet's collectibles tab.

## What stays honest

- The membership token pays nothing, yields nothing, and is not resellable
  (soulbound) — it is a service subscription receipt, deliberately shaped so it
  cannot read as an investment product.
- Free-mint allowlist: none needed — it's unlimited, one per wallet. The phased
  Merkle allowlist stays where it belongs: the 10k Position Cards drop.
- Sybil note: FREE tier per wallet is already the default for everyone, so farming
  free mints earns nothing; paid tiers cost real USDG.

## Open items (need product/ops decisions)

1. **Alchemy Gas Manager policy** — needs the org's Alchemy account; scope: sponsor
   `mintFree()` only, per-address once. (Repo already uses Alchemy: `alchemy_client.py`.)
2. **Robinhood Connect partner onboarding** — Connect requires an application ID;
   newsroom describes the product, partner docs are gated.
3. **Treasury address** for USDG subscription revenue (multisig recommended).
4. Whether Stripe/x402 pricing should surface a small discount for paying on-chain
   (no processor fees) — pricing decision, not taken here.

## Money-path review (Opus) — verdict and remediation

The initial wiring was reviewed adversarially and **blocked**. Every finding was fixed
and the exploit paths are now reproduced as failing-then-fixed tests:

| Finding | Fix |
|---|---|
| **BLOCKER** — Robinhood Wallet purchases were unreachable (self-custody addresses never appear in the bot's Wallet table; a user could pay 99.99 USDG and keep FREE-tier fees) | `/bindwallet`: EIP-191 signature-proved binding → `users.membership_address` (additive runtime migration). Challenge embeds telegram id + 128-bit single-use nonce, 10-min expiry; possession of the key is the only way to bind. Bound address is checked first |
| **HIGH** — sync `eth_call` blocked the event loop on every quote | Off-thread via `asyncio.to_thread` under a hard 1.5s budget, single-flighted per user; a hung RPC costs the budget once, then fails open (tested with a 5s-hang stub) |
| **HIGH** — `grantTime` overwrote paid time (comping 7d PRO destroyed 300d of ENTERPRISE) | `grantTime` routes through the same `_creditTime` conversion as `subscribe` — proven on a real EVM |
| **HIGH** — `setPrice` revalued outstanding time; a reprice was front-runnable into ~$2,400 of ENTERPRISE for ~$340 | `pricePaidPerPeriod` snapshot per token: conversions value remaining time at the price it was *bought* at. The exact front-run scenario is an EVM test and now yields ~72 days, not 720 |
| MED — wallet selection was Postgres-heap-order nondeterministic | Bound address first, then all EVM wallets `ORDER BY id` (≤5), max tier across them |
| MED — failures cached 300s; `invalidate()` dead code | Failure TTL 15s, success 300s; `invalidate()` wired into `/bindwallet`; RPC failures reported to `rpc_manager`'s circuit breaker |
| MED — unbounded cache | Swept past 5,000 entries |
| LOW ×4 | CEI (payment before mint — a broke wallet gets no token, tested), `nonReentrant` on `grantTime`, `SafeCast.toUint64`, `renounceOwnership` disabled, dead code removed |
| **Verification gap** — zero executable contract tests, forge unavailable | `tests/test_membership_evm.py`: 9 behaviour tests deploying the real bytecode on eth-tester/py-evm — value-neutral round-trips, both HIGH exploits reproduced dead, soulbound/one-per-wallet/bounds |

## Second money-path review — also blocked, also fixed

The remediation was re-reviewed adversarially. It found the conversion arithmetic
sound (it could not break the value invariant) but caught a term-confiscation hole
and four bugs in the Python layer the first pass had "fixed":

| Finding | Fix |
|---|---|
| **BLOCKER** — `membership_address` had no uniqueness. A signature proves key possession, *not identity*: a reseller could sign the inert challenge for N accounts, so one $99.99 ENTERPRISE NFT gave unlimited accounts 0.1% fees (~$90k/mo of diverted fees at 100 accounts × $100k volume) — reintroducing the exact shared-account vector soulbinding exists to prevent | Pre-write exclusivity check **plus** a unique index on `users.membership_address`, addresses stored lowercased so the index actually collides. Migration dedups any legacy rows (keeps lowest id). Verified: duplicate insert raises `IntegrityError` |
| **HIGH** — `grantTime` conserved dollars but destroyed *term*: comping 7d of ENTERPRISE onto 720d of PRO cut the member to 79 days, unconsented | A grant that would shorten the term now reverts (`GrantWouldShrinkTerm`). Same-tier goodwill still extends |
| **HIGH** — RPC health attributed to a weighted-*random* endpoint pick, not the one that ran the call, tripping breakers on healthy endpoints and evicting the chain-wide web3 cache | Attribute to `contract.w3.provider.endpoint_uri` |
| **HIGH** — 6 serial `eth_call`s under one 1.5s budget; a timeout discarded everything, silently charging a paying ENTERPRISE holder 1% instead of 0.1% ($500 vs $50 on a $50k swap) | Short-circuit on ENTERPRISE, skip failing addresses instead of aborting, and **stale-while-revalidate**: a previously observed paid tier survives an outage for an hour |
| **HIGH** — `wait_for` cancels the await, not the thread; abandoned lookups pinned up to 18s of shared default-executor workers that swap execution also uses | Dedicated bounded `ThreadPoolExecutor(max_workers=2)` — exhaustion is contained to this feature |
| **MED** — `setPrice` had no floor: a one-block `setPrice(PRO, 1)` converted 720d of ENTERPRISE into ~2 billion years, with no claw-back | `MIN_PRICE`/`MAX_PRICE` bounds **and** a `MAX_TERM = 3650 days` horizon in the credit path |
| **MED** — `_safeMint` would lock out any ERC-4337 smart account without `onERC721Received` — the exact wallet class this targets | `_mint` (soulbound, so no stuck-token risk) |
| **MED** — one unknown tier index discarded an already-found paid tier | `continue` instead of abort |
| **MED** — no rate limit / rebind cooldown on `/bindwallet`; challenge echoed in group chats | Rate limited, private-chat only |
| **MED** — the DB read sat outside the timeout budget | Both legs share one deadline |
| **MED** — artifacts were a hand-committed blob with no build script, so tests could pass against stale bytecode | `scripts/build_contract_test_artifacts.js` + a test asserting the committed source hashes match |
| **LOW** ×4 | Locks no longer swept while held; `invalidate()` clears them; `db_user` None-checked; group-chat guard |

Confirmed still sound by the second pass: the value invariant (no sequence mints
value), the reprice front-run staying dead, fail-open on every path, soulbound
enforcement, reentrancy/CEI, and server-derived identity in the binding flow.
