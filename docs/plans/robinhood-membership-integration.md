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
- `subscribe(tier, periods, maxPricePerPeriod)` — pays `price[tier] × periods` in USDG (transferFrom →
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

## Third money-path review — blocked again; two blockers were holes my own fixes opened

| Finding | Fix |
|---|---|
| **BLOCKER** — `/import` creates `wallet_provider="watch"` rows from pasted text with no signature and no key, and the tier resolver read every EVM wallet. Anyone could paste a known ENTERPRISE holder's public address and inherit 0.1% fees: **$900 saved per $100k swap, unlimited accounts, $0 cost**. This defeated both the unique index and the EIP-191 proof — exclusivity was enforced on one table while the resolver read another. Introduced by the review-2 fix that told me to check *all* wallets | Only ownership-proved addresses count: `User.membership_address` (signature-proved) plus wallets whose provider is key-controlled (`local`/`turnkey`) and active. `watch` explicitly excluded |
| **BLOCKER** — `contract_errors` incremented on *every* exception, so `contract_errors == len(addresses)` was always true when nothing succeeded and the outage branch was **unreachable**. An RPC outage returned `None` and demoted an on-chain-only ENTERPRISE member to FREE: **$500 charged vs $50 owed** on a $50k swap, repeating every 15s for the whole outage. The docstring's "a timeout can never silently downgrade a paying subscriber" was false | Only non-transport failures count as contract errors, so the outage branch is reachable and stale-while-revalidate engages |
| **HIGH** — `subscribe()` pulled USDG then clamped silently at `MAX_TERM`, so a member at the cap could pay $239.76 for **zero days**, repeatedly. Truncation is arithmetically value-preserving but that value is *unrealizable* because every later conversion clamps too | Paid purchases revert (`TermCapReached`); `grantTime` may still clamp, and now scales value with seconds so the snapshot can't exceed `MAX_PRICE` |
| **HIGH** — `subscribe()` had no price bound. Subscription flows use unlimited approvals, so a reprice landing first could pull **$2.4M instead of $239.76** | `subscribe(tier, periods, maxPricePerPeriod)` reverts `PriceMoved` |
| **MED** — the binding challenge named the account but not the address, so a phished signature bound a victim's wallet **permanently** (exclusivity then locked the real owner out forever) | Challenge names the claimed address; added `/unbindwallet` |
| **MED** — unbounded executor queue: timed-out work still ran, minutes late, growing without bound | `BoundedSemaphore(8)` admission gate that fails open when saturated |
| MED (already fixed pre-review) | `invalidate()` losing to an in-flight lookup — closed by the generation counter |

Confirmed sound by this pass: value conservation across every subscribe/grantTime/setPrice sequence, the `_is_transport_error` classifier itself, `best_tier` monotonicity, lock single-flight, the `_MISS` sentinel, soulbound enforcement, CEI, `_mint` vs `_safeMint`, the migration, bindwallet transaction semantics, and that the `rpc_manager` change is chain-scoped.

## x402 integration — one payment rail, not two

x402 already settles USDG on chain 4663 via **EIP-3009**, with an EIP-712 domain
(`name="Global Dollar", version="1"`) recovered by brute-forcing the on-chain
`DOMAIN_SEPARATOR` because USDG's `version()` reverts. The membership was built on
`approve()` + `subscribe()` — a second, worse payment path on the same chain. It now
uses the rail x402 already proved.

**`subscribeWithAuthorization(tier, periods, maxPricePerPeriod, Authorization)`**

- **One signature, no `approve`, no gas for the payer.** Anyone — a relayer, an
  ERC-4337 paymaster, the x402 facilitator — submits it. That is what makes the
  Robinhood Wallet flow in this doc actually gasless rather than aspirationally so.
- **Credited to the signer, never `msg.sender`.** A relayer pays the gas and the
  signer gets the term, so front-running is pointless and there is nothing to steal.
- **Intent is bound into the EIP-3009 nonce.** EIP-3009 signs
  `(from, to, value, validAfter, validBefore, nonce)` — it has no field for *what the
  payment buys*. Unbound, a relayer holding a 99.99 USDG authorization could call this
  with `tier=PRO` and hand the payer ten months of PRO instead of the one month of
  ENTERPRISE they intended. The nonce is
  `keccak256(abi.encode("SUWAPPU_SUBSCRIPTION_V1", subscriber, tier, periods))`, so
  altering either field invalidates the signature. Replay is already prevented by
  EIP-3009's single-use nonces.
- **Price-bounded** (`maxPricePerPeriod`) like the regular path, since these payers
  are exactly the ones with standing authorizations.

**One constant, two stacks.** `bot/services/x402_service.py::X402_EIP712_DOMAINS`
mirrors `api-ts/src/config/x402Networks.ts`, and a test parses the TypeScript and
asserts they agree. A wrong domain does not fail loudly — it yields a signature that
recovers to the wrong address and silently fails settlement. The USDG *address* is read
from `x402_service.payment_tokens`, the same registry the payment verifier uses, so the
two can never point at different USDG deployments (there are two on 4663; one has
338.7M supply, the other 1.1k).

`membership_service.build_subscription_authorization()` returns the ready-to-sign
payload; its nonce is asserted byte-identical to `subscriptionNonce()` on real
bytecode, and a test signs that exact payload and settles it end-to-end.

**Still to do on the api-ts side:** the x402 middleware should waive the per-call 402
for a caller whose address holds a paid membership — the subscription *is* the payment,
and charging both is double-billing. Tier limits already flow through
(`get_tier` → `TIER_LIMITS.daily_api_calls`), so this is the remaining gap. Left
deliberately unshipped rather than half-done, since it needs the bun suite.

## Gas

Measured against the compiled bytecode on eth-tester before and after, not estimated.
`tests/test_gas_snapshot.py` pins ceilings so a structural regression trips the suite.

| Operation | Before | After | Delta |
|---|---:|---:|---:|
| `mintFree` | 123,353 | 101,636 | **−17.6%** |
| `subscribe` (first) | 195,544 | 169,847 | **−13.1%** |
| `subscribeWithAuthorization` | 204,122 | 178,446 | **−12.6%** |
| `subscribe` (tier change) | 68,923 | 64,474 | −6.5% |
| `subscribe` (renew) | 65,989 | 64,340 | −2.5% |
| deploy | 2,371,023 | 2,392,854 | +0.9% (one-time) |

What actually moved the numbers:

- **`Membership` packed into one storage slot.** `uint256 pricePaidPerPeriod` straddled
  a second slot; as `uint96` the struct is 8 + 64 + 96 = 168 bits. That removes a cold
  SSTORE (~20k) from a member's first paid subscription. uint96 holds 7.9e28 against a
  `MAX_PRICE` of 1e11 — seventeen orders of magnitude of headroom, and `setPrice`
  enforces the bound.
- **`pricePerPeriod` as `uint64[4]`** — one slot instead of four (uint64 max 1.8e19).
- **`treasury` + `totalSupply` share a slot**, so `subscribe` reads both in one SLOAD.
- **Dropped a redundant zero-write** in `_mintTo`: a fresh mapping slot is already zero
  and token ids are never reused.
- **Dropped a duplicate `SubscriptionUpdate`**: both subscribe paths mint then
  immediately credit, emitting it twice in one transaction.

Deploy costs ~22k more (SafeCast bounds-checking and packing masks) — a one-time cost
against a permanent per-transaction saving.

### Positions: measured, and mostly *not* worth it

Hoisting `totalSupply` out of the mint loop reads like an obvious win and is **worth
only −0.2%** (568,366 → 567,280 for a 10-card mint). The intuition that each loop
iteration paid ~2,900 gas for the counter is wrong: after the first write the slot is
warm and dirty, so each subsequent SSTORE is ~100 gas. Kept — it is strictly cheaper and
clearer — but it is not the lever.

Per-card cost (~56.7k at quantity 10) is dominated by two cold SSTOREs that a standard
ERC-721 cannot avoid: the owner slot inside `_safeMint` and the `Position` struct.
**ERC721A-style batch minting** — storing ownership once per batch and walking back on
`ownerOf` — is the real lever, worth roughly 20k per additional token in a batch.
Deliberately not done: it replaces the ownership bookkeeping of a contract that has
already been blocked by three money-path reviews, and that is not a trade worth making
for a mint-time saving on an L2. Revisit as a standalone change with its own review.

## /subscribe — the gasless path, wired

`build_subscription_authorization` had zero callers, so the EIP-3009 subscription
existed only in tests. It now has a surface.

**Flow** (two messages, mirroring `/bindwallet`):
1. `/subscribe pro 3` → the bot quotes the total in USDG and returns the exact EIP-712
   payload to sign.
2. `/subscribe <signature>` → the bot verifies and broadcasts.

**Why one signature and no gas.** USDG implements EIP-3009, so the user signs a transfer
authorization rather than sending `approve` + `subscribe`. `subscribeWithAuthorization`
credits the **signer**, never `msg.sender`, so the relayer that pays the gas cannot
redirect the subscription to itself — and front-running it just means someone else paid
for the user's transaction.

**What the user can influence: only the signature.** Tier, period count, USDG value, the
EIP-3009 nonce and the price bound all come from the payload the bot generated. Even if a
tampered payload reached the contract, the nonce commits to `(subscriber, tier, periods)`
and fails `IntentMismatch`.

**Guards**
- Signer must equal the user's bound `membership_address` — recovering *an* address only
  proves someone signed, not that this user did.
- The **quoted price is passed as `maxPricePerPeriod`**, so a reprice landing between
  quote and broadcast reverts rather than silently charging more. Verified on real
  bytecode: status 0, no funds moved, no term granted.
- Private chat only, rate limited, and quotes expire with the authorization's `validBefore`.
- The relayer is **off by default** and requires an explicitly funded key. When it is off
  the bot hands back broadcastable calldata, so a user is never left holding a signature
  nothing can use.

Proven end-to-end on a real EVM: the bot builds the payload, a wallet signs it, the bot
encodes the calldata, and a **relayer** broadcasts it — the payer ends up with the term
and the relayer holds no token.

### A regression my own test caught

The first version of `submit_subscription` used `asyncio.to_thread`, which is the shared
default executor that swap execution also uses — precisely the finding an earlier review
raised for the tier lookup. A hung broadcast would have starved the swap path. It now
runs on the feature's dedicated bounded executor with a timeout.
