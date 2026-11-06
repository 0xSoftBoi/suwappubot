# NEAR support

Suwappu's NEAR surface has three layers:

| Layer | What | Where |
|---|---|---|
| Cross-chain routing | NEAR Intents 1-Click as a bridge provider (deposit-address model) | `bot/services/bridge/near_intents.py` |
| Agent custody | OutLayer TEE wallet — read-only wrapper at `/v1/near/*` | `api-ts/src/routes/near.ts`, `api-ts/src/services/near/` |
| Trust layer | Arbiter escrow + attested work verdicts (NEAR testnet) | `near/`, `/hackathon/arbiter`, `/arbiter` |

Spec for the custody layer: https://skills.outlayer.ai/agent-custody/SKILL.md

## `/v1/near/*` (public, read-only)

| Route | Auth | Purpose |
|---|---|---|
| `GET /status` | none | networks, hosts, capabilities, limits |
| `GET /assets[?chain=]` | none | curated defuse-asset registry |
| `GET /assets/resolve?token=&chain=` | none | symbol/id → exactly one asset; `409 ambiguous` with candidates otherwise |
| `GET /amount?token=&human=\|atomic=` | none | decimal ↔ atomic (wNEAR is 24 decimals) |
| `GET /tokens`, `/address`, `/balance` | `Bearer wk_…` | pass-through reads on the caller's OutLayer wallet (`?network=testnet` supported; `balance?source=intents` for the swap balance) |
| `POST /swap/quote` | `Bearer wk_…` | NEAR Intents quote; each side must resolve unambiguously; mainnet only |

## Deliberate limits

- **No execution proxy.** Swap/transfer/withdraw/register are not proxied. The
  agent calls `api.outlayer.ai` directly with its own `wk_` key, so Suwappu is
  never in the custody or signing path. The `wk_` is forwarded for one request,
  never stored or logged.
- **Symbols are not identities.** "USDC" is ~17 assets across chains; the
  resolver refuses to default. Always select by `defuseAssetId`.
- **Quotes are estimates.** Realized fill = `result.amount_out` at
  `status == "success"` from OutLayer `/intents/swap`. Never record qty/PnL
  from a quote.
- **Testnet has no Intents solvers** — quotes return 503 there.
- The registry is a curated subset from OutLayer's token-reference; the live
  catalog (`GET /tokens`) is authoritative.

## Agent surfaces

- **MCP** (`/mcp`): `near_resolve_asset`, `near_convert_amount` — free, public
  read tools (no Bearer needed), pure functions of the registry.
- **SDK** (`@suwappu/sdk`): `nearAssets`, `nearResolveAsset` (ambiguity returned,
  not thrown), `nearAmount`, `nearBalance(walletKey)`, `nearSwapQuote(walletKey)`.

## Verification status

- Type-check (`api-ts`) clean; `mcp.test.ts` + `x402.test.ts` pass (44);
  `check:mcp` exits 0; routes exercised in-process.
- **Not verified live against OutLayer.** Minting even a testnet wallet was
  not authorized in the session, so `/tokens`, `/address`, `/balance` and
  `/swap/quote` pass-through are code-complete only. To verify: register on
  `https://testnet-api.outlayer.ai/register`, then
  `curl -H "Authorization: Bearer wk_…" localhost:PORT/v1/near/address?network=testnet`.
- MCP tools were not called through the full `/mcp` route in isolation.
- SDK type-check could not run standalone (package lacks `@types/node`).

## Not built yet (candidates)

OpenAPI inclusion, Python-bot `/near`, Arbiter payouts into an OutLayer wallet
(needs a design decision: payee = hex implicit account vs bound `alice.near`),
OutLayer account-binding and payment-check flows.
