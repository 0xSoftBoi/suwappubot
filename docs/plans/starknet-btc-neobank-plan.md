# Starknet + Bitcoin Neobank — Implementation Plan

> Researched 2026-06-10. All contract addresses below were verified on-chain via
> `starknet_getClassHashAt` against Starknet mainnet RPC unless marked otherwise.
> Companion research: GOAT Network (chain 2345) is a separate, ~1-day, swap-only EVM
> integration and is intentionally out of scope here.

## Product goal

A Bitcoin neobank inside Suwappu: user deposits native BTC (L1 or Lightning) → it lands
on Starknet as WBTC/strkBTC → earns BTC-denominated yield (Endur liquid staking backed by
Starknet's live BTC-staking program, or Vesu lending) → withdrawable back to native BTC in
~30s (Garden) or instantly to Lightning (Atomiq). Gas is invisible (AVNU paymaster).
Plus general Starknet swaps via AVNU with our integrator fee.

## Key architecture decisions (from research)

| Decision | Choice | Why |
|---|---|---|
| Swap routing | AVNU REST API (`starknet.api.avnu.fi`), no SDK from Python | Verified live; `fee.integratorFeesBps` field confirmed in v3 quote response; pattern proven in czbag/starknet (203★) |
| Account class | **Argent v0.4.0**, class hash `0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f` | RESOLVED 2026-06-10: OZ is NOT on the AVNU paymaster whitelist — Argent v0.4.0 is, implements SNIP-9 v2, deploys guardian-less with calldata `[0, owner_pubkey, 0]` (StarknetSigner type, pubkey, Option::None guardian). v0.5.0 not yet whitelisted. What embedded-wallet providers (Dynamic, Chipi) use. Verify post-deploy: `supports_interface(0x1d1144bb...9872)` → true |
| Fee token | STRK (protocol level), but **users never need it** | Since v0.14.0 ALL txs are v3/STRK. **No funder wallet needed**: SNIP-29 `deploy_and_invoke` lets the paymaster sponsor account deployment + first action in one call (verified in starknet.js paymaster source + types-js SNIP-29 defs). Keep a small STRK ops wallet only as paymaster-outage fallback |
| Paymaster | AVNU managed endpoint `https://starknet.paymaster.avnu.fi`, hand-rolled JSON-RPC | Exactly 4 methods: `paymaster_isAvailable`, `paymaster_getSupportedTokens`, `paymaster_buildTransaction`, `paymaster_executeTransaction`. starknet.py has SNIP-9 signing but NO SNIP-29 client. Do NOT self-host (AGPLv3). Always fall back to self-paid STRK gas |
| BTC bridge | Atomiq REST (`mainnet.swaps-api.atomiq.exchange`, no auth, Apache-2.0) primary; Garden secondary | Atomiq verified live (curl), supports `BITCOIN-BTC` + `LIGHTNING-BTC` → Starknet WBTC/strkBTC; all repos updated June 2026. Garden for 30s L1 BTC payouts |
| BTC yield | Endur LSTs (xWBTC/xstrkBTC) primary; Vesu Genesis vWBTC secondary | Endur = Starknet BTC staking (100M STRK incentives); Vesu = ERC-4626 `deposit()`, identical shape to our Aave /save |
| Wallet keys | Existing `kms_aesgcm_v2` envelope encryption | Directly portable; better than any public reference found |
| RPC | **Alchemy primary** (`https://starknet-mainnet.g.alchemy.com/v2/$KEY`, wss same host, spec v0_9, 30M CU/mo free), **Lava fallback** (`https://rpc.starknet.lava.build`, no key, verified live spec 0.8.1; WS at `/ws/rpc/v0_8`) | **BlastAPI AND free-rpc.nethermind.io are dead** (NXDOMAIN). Infura partial starknet_* — avoid. Empirically test `starknet_subscribeTransactionStatus` over Alchemy WS in P1; fall back to polling `wait_for_tx` if WS flaky |
| Balances | Token whitelist + parallel `starknet_call` balanceOf (free reads, asyncio.gather) | No Multicall3 equivalent; explorer APIs not production-grade |

## Verified addresses (Starknet mainnet)

```python
# bot/config/starknet_addresses.py — all on-chain verified 2026-06-10
AVNU_EXCHANGE   = "0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f"
STAKING_L2      = "0x00ca1702e64c81d9a07b86bd2c540188d92a2c73cf5cc0e508d949015e7e84a7"

ETH      = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
STRK     = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
USDC     = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8"  # native Circle
USDT     = "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8"
WBTC     = "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac"
STRKBTC  = "0x0787150e306e6eae6e3f79dea881770e8bbff2c1b8eb490f969669ee945b3135"  # 2 sources + on-chain
TBTC     = "0x04daa17763b286d1e59b97c283c0b8c949994c361e426a28f743c67bdfe9a32f"
SOLVBTC  = "0x0593e034dda23eea82d2ba9a30960ed42cf4a01502cc2351dc9b9881f9931a68"

# Endur LSTs (same class hash family; xstrkBTC single-sourced — re-verify on Voyager)
XSTRK    = "0x028d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a"
XWBTC    = "0x06a567e68c805323525fe1649adb80b03cddf92c23d2629a6779f54192dffc13"
XSTRKBTC = "0x047751b3532fABCa89B0f2E35cA1cB45e5A7b11d5e3D3663dfA1F4406b45FD88"

# Vesu Genesis pool vTokens (V1 singleton, from vesuxyz/changelog pools_sn_mainnet.json)
VESU_SINGLETON = "0x02545b2e5d519fc230e9cd781046d3a64e092114f07e44771e0d719d148725ef"
V_WBTC_GENESIS = "0x06b0ef784eb49c85f4d9447f30d7f7212be65ce1e553c18d516c87131e81dbd6"
V_USDC_GENESIS = "0x01610abab2ff987cdfb5e73cccbf7069cbb1a02bbfa5ee31d97cc30e29d89090"

# Vesu V2 (Re7-curated) vTokens — retrieved on-chain via PoolFactory.v_token_for_asset(pool, asset)
# (discovery: PoolFactory 0x3760f...88c0 is the sole vToken registry; pools themselves expose none)
V_USDC_RE7_CORE   = "0x060e91c92fdad9e7245b9bb4e143b880e4e9354d0b95c5c2d33dc347dded3bf0"  # "Vesu USD Coin Re7 USDC Core"
V_WBTC_RE7_XBTC   = "0x0131cc09160f144ec5880a0bc1a0633999030fa6a546388b5d0667cb171a52a0"  # "Vesu Wrapped BTC Re7 xBTC"
V_STRKBTC_RE7_XBTC = "0x04269987e8971bc613be4f8161e04a4d2652f5e6ade9aa3f2820b1fc3f7ef848"
# vTokens are full ERC-4626/SNIP-22 and the recommended surface (deposit() wraps modify_position).
# Note: vTokens are PER-POOL instances — same asset has different vTokens in different pools.

ARGENT_V040_CLASS_HASH = "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f"
# constructor calldata: [0, owner_pubkey, 0]  (signer_type=Starknet, pubkey, guardian=None)
# Note: 0x01a736d... (previously considered) is Argent v0.3.0; OZ classes are NOT AVNU-whitelisted.
```

Gotchas baked into these:
- **Atomiq's "USDC" is the legacy bridged variant (`0x033068f...`), not native Circle USDC.** When receiving from Atomiq, treat its USDC as a distinct token or route deposits to WBTC/strkBTC only.
- **Do NOT integrate LBTC** — governance is removing it from staking reward eligibility (June 2026).
- **zkLend is dead, Ekubo direct is skipped** (its Starknet pools are fine and reachable through AVNU).

## Phases

### Phase 1 — Starknet core: wallets + swaps (~3 days)

New `ChainType.STARKNET` in `bot/config/chains.py` (chain_id `"SN_MAIN"`), then audit every
`chain_type == ChainType.EVM` branch (~15–20 sites in wallet.py, swap_engine.py, gas_tracker.py,
tx_poller.py, rpc_manager.py) so Starknet never falls into an EVM path.

**Files:**
- `bot/config/chains.py`, `bot/config/tokens.py`, `bot/config/starknet_addresses.py` (new), `bot/config/settings.py` (`STARKNET_RPC_URL`, `STARKNET_RPC_FALLBACKS`, `AVNU_PAYMASTER_API_KEY`, `STARKNET_FUNDER_PRIVATE_KEY_ENC`, `AVNU_INTEGRATOR_FEE_BPS`, `AVNU_FEE_RECIPIENT`)
- `bot/services/starknet/client.py` (new) — FullNodeClient pool with failover (Alchemy → Chainstack → Nethermind/Lava), WS subscription helper
- `bot/services/wallet.py` — `create_starknet_wallet` (KeyPair.generate → `compute_address(salt, ARGENT_V040_CLASS_HASH, [0, pubkey, 0], 0)` → store encrypted via kms_aesgcm_v2, status=undeployed), `import_starknet_wallet`, balances via parallel `balanceOf` calls. **Lazy deployment via paymaster**: first outgoing action uses SNIP-29 `deploy_and_invoke` (sponsored) — no STRK seeding. Receiving tokens pre-deployment is safe; sending requires deployment — handled transparently by the deploy_and_invoke path
- `bot/services/starknet/ops_wallet.py` (new, fallback only) — small STRK-funded ops account with local nonce counter + asyncio.Lock, used ONLY when the paymaster is down (self-paid deploys/gas). Sequencer allows 200 pending nonces, 5-min TTL — reconcile on startup
- `bot/services/avnu_api.py` (new, modeled on jupiter_api.py) — `GET /swap/v2/quotes` + `POST /swap/v2/build` with `integratorFees`/`integratorFeeRecipient`/`integratorName=Suwappu`; convert calldata hex→int for starknet.py; execute approve+swap in ONE multicall via `execute_v3` (exact-amount approvals only, never infinite)
- `bot/services/swap_engine.py` — `_is_starknet_swap()` routing + guards excluding Starknet from all EVM aggregator paths
- `bot/services/tx_poller.py` — Starknet branch: WS `subscribe_transaction_status`, credit UI at PRE_CONFIRMED (~0.5s), final at ACCEPTED_ON_L2 (~4s); REVERTED still consumes nonce + fee
- `requirements.txt` — `starknet-py>=0.30` (check pin conflicts with web3/eth-account)
- Fees: `auto_estimate=True` (1.5× bounds); on INSUFFICIENT_RESOURCES_FOR_VALIDATE raise l2_gas; non-zero tip for time-sensitive txs

**Verify:** real mainnet wallet created, deployed, ETH→USDC swap via AVNU with fee landing
at our recipient address (check on Voyager). CI green ≠ done — live swap required.

### Phase 2 — Gasless UX: AVNU paymaster (~1 day)

- `bot/services/starknet/paymaster.py` (new) — hand-rolled SNIP-29 JSON-RPC client (httpx).
  RESOLVED API contract (verified from starknet.js `paymaster/rpc.ts` + starknet-io/types-js snip-29 defs):
  - `paymaster_isAvailable` → bool (health gate before every paymaster path)
  - `paymaster_getSupportedTokens` → accepted gas tokens
  - `paymaster_buildTransaction` — request `{transaction: {type: "invoke"|"deploy"|"deploy_and_invoke",
    invoke?: {user_address, calls}, deployment?: {address, class_hash, salt, calldata, version: 1}},
    parameters: {version: "0x1", fee_mode: {mode: "sponsored"}|{mode: "default", gas_token},
    time_bounds?}}` → returns SNIP-9/SNIP-12 typed_data to sign + fee estimate.
    **Pure `deploy` requires NO user signature**; `deploy_and_invoke` = deploy + first action in one sponsored call.
  - `paymaster_executeTransaction` — `{transaction: {type, invoke?: {user_address, typed_data, signature},
    deployment?}, parameters}` → `{tracking_id, transaction_hash}`.
  Sign typed_data with the user's account key; `execute_before` ≤ 5 min; persist SNIP-9 nonces (replay guard).
  Header `x-paymaster-api-key` (sponsored mode only; gas-token mode needs no key).
  Test on Sepolia paymaster first (free unlimited credits).
- **Always fall back to self-paid STRK gas (ops wallet) when `paymaster_isAvailable` is false or calls error.**
- Account class risk RESOLVED: Argent v0.4.0 is AVNU-whitelisted and SNIP-9 v2 (see decisions table).
- Apply for Propulsion gas credits (up to $1M) + portal.avnu.fi API key.

### Phase 3 — BTC rails: Atomiq + Garden (~2 days)

- `bot/services/atomiq_api.py` (new) — REST client: `getSupportedTokens` (verified live),
  `getSwapQuote`, `createSwap`, status polling. Deposit flow: user picks BTC L1 or Lightning →
  bot creates swap → shows BTC address/LN invoice → on settle, WBTC/strkBTC lands in user's
  Starknet wallet. Withdraw flow: reverse, payout to user's BTC address or LN invoice.
  Lightning-in is API-supported but less battle-tested — gate behind small per-tx limit initially.
- `bot/services/garden_api.py` (new, optional fallback) — L1 BTC payouts in ~30s; REST per
  docs.garden.finance (repos less active than Atomiq; some unlicensed — don't copy code).
- Handlers: extend `/save` or new `/btc` flow: deposit → land → auto-stake prompt.

### Phase 4 — BTC yield: Endur + Vesu (~2 days)

- `bot/services/endur_api.py` (new) — `Contract.from_address(XWBTC)` auto-ABI →
  approve+`deposit(assets, receiver)` multicall → user holds xWBTC (auto-compounding STRK
  rewards from the official BTC staking program, 25% of staking power, 100M STRK pool).
  Read live exchange-rate/APY from contract — never hardcode APY (the "893%" figure was an
  incentive spike). 21-day unbond on exits via staking path; Endur matches deposits/withdrawals
  to soften this — surface the worst case in UX.
- `bot/services/vesu_api.py` (new) — ERC-4626 `deposit()` on Genesis vWBTC/vUSDC (addresses
  above). Reuses our Aave /save UX shape. Re7 V2 pool vTokens aren't in the changelog JSON —
  query PoolFactory `0x3760f...88c0` if/when we want them.
- `/save btc` end-to-end: BTC in (Atomiq) → swap if needed (AVNU) → deposit (Endur/Vesu) →
  digest shows BTC-denominated balance + accrued yield → withdraw to native BTC/LN.

### Phase 5 — Surfaces + ship (~1–2 days)

- `api-ts/src/config/chains.ts` + `packages/shared` types: Starknet entries (no
  broadcastEvmTransaction path — Python owns Starknet signing initially).
- Webapp: token list picks up Starknet from API; add chain icon.
- Token security: GoPlus has no Starknet — restrict to whitelist (verified tokens above +
  AVNU's curated registry) initially.
- Grants: Starknet Seed Grant ($25k STRK) + Propulsion application with the working MVP.
- Ship per repo rules: black, parse-check, `/ship`, then **functional verification** — real
  deposit of real sats end-to-end before calling anything live.

## Security & ops invariants

1. Exact-amount approvals, approve+action in one multicall, zero residual allowances.
2. SNIP-12 Rev 1 typed data everywhere; never sign without chainId + account address.
3. Ops fallback wallet: local nonce manager, alert if STRK balance low; primary path is
   paymaster-sponsored (incl. deploy_and_invoke) so this is outage insurance only.
4. Credit irreversible actions only at ACCEPTED_ON_L2; L1 bridge withdrawals at ACCEPTED_ON_L1 (~2h).
5. Sequencer outages happen (Jan 2026, ~2h) — queue + retry, never double-send.
6. Per-tx caps on Atomiq Lightning deposits until battle-tested.

## Effort summary

~8–10 engineer-days total: P1 3d, P2 1d, P3 2d, P4 2d, P5 1–2d. P1+P2 ship value alone
(Starknet swaps with fee revenue + gasless UX); P3+P4 deliver the neobank.

## Open items

- [x] Account class: RESOLVED — Argent v0.4.0 `0x036078...927f`, AVNU-whitelisted, SNIP-9 v2, guardian-less calldata `[0, pubkey, 0]` (2026-06-10)
- [x] xstrkBTC: VERIFIED on-chain — `name()` returns "Endur xstrkBTC"; ERC-4626 `deposit(assets, receiver)` + `deposit_with_referral` confirmed from class ABI (2026-06-10)
- [x] Paymaster API: RESOLVED — 4 methods documented above; sponsored `deploy_and_invoke` removes the funder-wallet requirement (2026-06-10)
- [x] starknet-py deps: httpx/aiohttp/pydantic/cryptography in requirements.txt are compatible; local pip resolves 0.28.1 (0.30 likely needs newer Python than local) — pin `starknet-py>=0.28.1` and confirm resolution inside the Docker image (Python 3.12) during P1
- [x] AVNU endpoint: RESOLVED — both `/swap/v2/quotes` and `/swap/v3/quotes` are live; **target v3** (richer
  `fee` object). Live curl with `integratorFees=0x32&integratorFeeRecipient=...&integratorName=Suwappu`
  returned `integratorFeesBps: 0x32` + computed fee → our fee params work as GET query params on the
  quote call. Confirm the execute path (v3 `quoteId` → build/execute) on Sepolia in P1 (2026-06-10)
- [x] Vesu Re7 V2 vTokens: RESOLVED — discovered via `PoolFactory.v_token_for_asset(pool, asset)`;
  addresses retrieved on-chain and added above. Use Re7 xBTC pool for WBTC/strkBTC savings (2026-06-10)
- [x] RPC: RESOLVED — Alchemy primary + Lava fallback (verified live, spec 0.8.1);
  Nethermind free endpoint is dead. Test WS subscription empirically in P1 (2026-06-10)
- [~] starknet-py pin: local machine is Python 3.9 (below starknet-py's >=3.10 floor) which explains
  pip resolving 0.28.1; prod image is Python 3.12 → expect 0.30.x. Docker unavailable locally —
  **verify resolution in CI/Railway build as the first P1 commit** (`starknet-py>=0.28.1`)
- [ ] portal.avnu.fi API key + Propulsion application (user action)
- [ ] Alchemy account/API key for Starknet (user action or P1 setup)
