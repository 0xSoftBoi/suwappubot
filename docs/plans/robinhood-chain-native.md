# Robinhood Chain — first-class native integration

## Verified network facts (all checked live, not from docs)

| Field | Mainnet | Testnet |
|---|---|---|
| Chain ID | **4663** (`eth_chainId` -> `0x1237`) | **46630** (`0xb626`) |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| WS | `wss://feed.mainnet.chain.robinhood.com` | `wss://feed.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |
| Native gas | ETH (18 dec) | ETH |

- Arbitrum Orbit / Nitro, EVM-equivalent. No Tempo-style custom tx type (0x76). Sponsorship = standard ERC-4337, not protocol-level.
- Mainnet live at block ~27.9M when verified (2026-08-04).
- Permissioned validator set (Offchain Labs + Alchemy only), 8-seat security council. Open to retail for on-chain interaction.
- FCFS tx ordering (not priority-fee) per secondary sources — UNVERIFIED, matters for MEV assumptions.

## LI.FI: already supported (the big unlock)

LI.FI lists chain 4663 natively, key `out`:
- diamond `0xB477751B76CF82d00a686A1232f5fCD772414Af3`
- permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- permit2Proxy `0x8eABB4E117fB70b346592e013855f6d825F50af1`
- multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11`
- `relayerSupported: false`

=> our existing LI.FI swap engine can route this chain with **no new execution path**. This is a config-surface job, not a new engine.

## Token reality: 178 tokens, and ~100 are TOKENIZED EQUITIES

Openly DEX-tradeable stock tokens on 4663 include:
AAPL, TSLA, NVDA, GOOGL, AMZN, MSFT, META, SPY, QQQ, GME, COIN, MSTR, PLTR,
NFLX, AMD, INTC, ORCL, AVGO, ASML, TSM, LLY, XOM, BA, F, RIVN, HOOD, SGOV, SLV, USO ...

**Product implication:** this makes stock/ETF exposure reachable through the ordinary swap path.
`bot/config/xstocks.py` already exists (xStocks went dark) — Robinhood Chain is the live replacement venue.

### Stablecoin anchor: USDG, NOT USDC
There is **no USDC** on this chain. Anchor is Paxos USDG (6 dec):
- USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- USDG (Paxos) `0x0A3B763d66c0e8c7555c986A3701E1DC1Bf3954F`
- also USDe, sUSDe, syrupUSDC/USDG, spUSDG, steakUSDG

Any code that assumes "USDC == the stablecoin" will break on this chain.

## Open risks
- Two USDG addresses listed; canonical one must be pinned before money-path use.
- Tokenized-equity issuance/redemption remains KYC-gated by Robinhood (EU/EEA brokerage product); open DEX *secondary* trading is what we can reach. Do not market as "buy real stock".
- Permissioned 2-validator set = liveness risk; treat RPC as less reliable than Base/Arbitrum.

---

## What shipped

### Chain (native, user-selectable)
- `bot/config/chains.py` — `CHAINS["robinhood"]` (4663, EVM, native ETH, `lifi_chain_id=4663`)
  plus `ROBINHOOD_TESTNET` (46630) kept OUT of `CHAINS`, mirroring the Tempo convention
  so testnets never reach pickers / balance scans / deposit-address generation.
- `bot/config/settings.py` — `robinhood_rpc_url`
- `api-ts/src/config/chains.ts` — RPC, native token, `CHAIN_ID_TO_KEY`, explorer
- `api-ts/src/services/TokenService.ts` — chain aliases (`robinhood`, `hood`),
  `COMMON_TOKENS[4663]`, `ROBINHOOD_TOKEN_DECIMALS`
- `webapp/src/lib/chains.ts` — display name / icon / explorer
- `.env.schema` — `ROBINHOOD_RPC_URL`

### Tokens
- `bot/config/tokens.py` — `TOKENS["USDG"]` (6dp) + `ROBINHOOD_EQUITIES` (35 tickers)
  with `get_robinhood_equity()` / `is_robinhood_equity()`.

### x402 (now multi-network)
Previously the 402 challenge advertised ONE network and hardcoded USDC's EIP-712
domain `{name:'USD Coin', version:'2'}` for every entry. That is wrong for any
non-USDC asset and would have produced an unsignable USDG payload.

- **new** `api-ts/src/config/x402Networks.ts` — payment-network registry; each entry
  carries its own verified EIP-712 domain, and a load-time assert rejects any asset
  that isn't 6dp (the credit->base-unit helper scales by 1e6).
- `api-ts/src/middleware/x402Payment.ts` — `accepts[]` is now one entry per enabled
  network. `accepts[0]` stays the env-configured network, so existing clients are
  unaffected.
- `api-ts/src/config/EnvService.ts` + `.env.schema` — `X402_EXTRA_NETWORKS`
  (comma separated, empty by default — enabling a payment rail stays deliberate).
- `bot/services/x402_service.py` — `payment_tokens["robinhood"]` so the internal
  Python verifier can settle these payments (CDP's hosted facilitator does not
  cover 4663).

#### USDG EIP-712 domain — how it was derived
`version()` REVERTS on the USDG contract, so it cannot be read. The domain was
recovered by brute-forcing candidates against the on-chain DOMAIN_SEPARATOR
`0x7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036`:
exact match at **name="Global Dollar", version="1"**, chainId 4663.
`authorizationState(address,bytes32)` responds => EIP-3009 present => x402
`exact` scheme is supported. Do not "fix" this by calling `version()`.

## Live verification (not just CI)

| Check | Result |
|---|---|
| `eth_chainId` mainnet / testnet | `0x1237` (4663) / `0xb626` (46630) |
| AAPL / TSLA / USDG `eth_getCode` + `symbol()` | all deployed, symbols match |
| USDG `decimals()` | 6 |
| USDG canonical pick | `0x5fc5…d168` = 338.7M supply vs `0x0A3B…954F` = 1.1k |
| Li.Fi same-chain 100 USDG -> AAPL | 0.3212 AAPL via `fly`, approval = Li.Fi diamond |
| Li.Fi cross-chain 100 USDC(Base) -> TSLA(4663) | 0.3057 TSLA via `across` |
| Li.Fi cross-chain 0.05 ETH(Base) -> USDG(4663) | 93.36 USDG via `across` |

Tests: `tests/test_robinhood_chain.py` (21 pass),
`api-ts/src/__tests__/x402Networks.test.ts` (10 pass).
Regression: api-ts full suite 352 pass / 0 fail; `test_tempo.py` +
`test_x402_replay.py` + `test_token_gates.py` 46 pass.

## Deliberately NOT done (needs a decision)

- **No `/robinhood` bot command.** Tempo has `/tempo grant|revoke|status` because it
  needs on-chain session keys for its gasless fee-payer flow. Robinhood Chain is a
  plain Orbit chain with standard ERC-4337 — there is no equivalent authority primitive to
  grant, so a command would be ceremony with nothing behind it. Revisit if we adopt
  4337 paymaster sponsorship here.
- **Not enabled in prod.** `X402_EXTRA_NETWORKS` is empty by default. Set it to
  `robinhood` to start accepting USDG.
- **Tokenized equities are registered but not surfaced in any UI.** Deliberate: see
  the compliance note above — they must never be presented as "buying stock".
