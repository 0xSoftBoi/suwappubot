# @suwappu/openclaw

OpenClaw — the agent/MCP skill client for the [Suwappu](https://suwappu.bot)
cross-chain DeFi API. A pure-HTTP TypeScript client (no runtime dependencies)
covering swaps, Hyperliquid perps, Polymarket predictions, and Morpho lending.

The package also ships a [`SKILL.md`](./SKILL.md) for MCP / agent runtimes that
load skills by manifest.

## Install

```bash
bun add @suwappu/openclaw
# or: npm install @suwappu/openclaw
```

## Quickstart

```ts
import { createClient } from "@suwappu/openclaw";

const suwappu = createClient({ apiKey: process.env.SUWAPPU_API_KEY });

// Quote a swap
const quote = await suwappu.getQuote("ETH", "USDC", 1.0, "arbitrum");

// Build the UNSIGNED transaction (Suwappu is non-custodial — it never broadcasts)
const result = await suwappu.executeSwap(quote.id, "0xYourWallet");
// result.status === "ready"; sign result.transaction with your own wallet.
```

The API key falls back to the `SUWAPPU_API_KEY` environment variable, and the
base URL defaults to `https://api.suwappu.bot`. A ready-made default client is
also exported:

```ts
import { suwappu } from "@suwappu/openclaw"; // uses env vars
```

## Non-custodial swaps

`executeSwap` does **not** broadcast a transaction. It returns an unsigned EVM
transaction (or a base64 serialized Solana transaction) with `status: "ready"`.
You sign and submit it with your own wallet. `executeSwap` and `getPortfolio`
both require a `wallet_address`; for EVM swaps it must be your managed wallet
(ownership is enforced server-side).

## API surface

| Method | Endpoint |
| --- | --- |
| `getQuote(from, to, amount, chain)` | `POST /v1/agent/quote` |
| `executeSwap(quoteId, walletAddress)` | `POST /v1/agent/swap` |
| `getPortfolio(walletAddress, chain?)` | `GET /v1/agent/portfolio` |
| `getPrices(symbols, chain?)` | `GET /v1/agent/prices` |
| `listChains()` | `GET /v1/agent/chains` |
| `listTokens(chain)` | `GET /v1/agent/tokens` |
| `perps.markets()` | `GET /v1/agent/perps/markets` |
| `perps.quote(market, side, size, leverage)` | `POST /v1/agent/perps/quote` |
| `perps.positions(address)` | `GET /v1/agent/perps/positions` |
| `predict.markets(query?, limit?)` | `GET /v1/agent/predict/markets` |
| `predict.market(id)` | `GET /v1/agent/predict/market/:id` |
| `lend.markets(chainId?)` | `GET /v1/agent/lend/markets` |
| `lend.market(id)` | `GET /v1/agent/lend/market/:id` |

Every method mirrors a Suwappu agent API endpoint exactly — there are no
client-only features.

## Development

```bash
bun install
bun run typecheck   # tsc --noEmit
bun test            # run the unit tests (mocked fetch)
bun run build       # emit dist/ for publishing
```

## License

MIT
