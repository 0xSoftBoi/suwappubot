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

## Not built yet (candidates)

MCP tools (`near_resolve_asset`, `near_swap_quote`), OpenAPI inclusion, SDK
client methods, and Arbiter payouts into an OutLayer wallet. Verified live
against OutLayer: **not yet** — only in-process route behaviour was exercised
(no `wk_` key was minted).
