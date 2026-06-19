# @suwappu/openclaw

OpenClaw — the agent/MCP skill client for the [Suwappu](https://suwappu.bot)
cross-chain DeFi API. A zero-dependency TypeScript client built for autonomous
agents, covering swaps, Hyperliquid perps, Polymarket predictions, and Morpho
lending.

Built for unattended operation:

- **Typed errors** you can branch on — `SuwappuRateLimitError`, `SuwappuValidationError`,
  `SuwappuAuthError`, `SuwappuPaymentRequiredError`, … each carrying `status`,
  server `requestId`, and validation `fields`.
- **Automatic retries** with exponential backoff + jitter, honoring `Retry-After`.
  Safe by design: only idempotent (GET) requests retry on 5xx/network; a 429
  retries on any method (it was rejected before side effects).
- **Per-request timeouts** (default 30s) so an agent never hangs forever.
- **Observability hooks** (`onRequest`/`onResponse`/`onRetry`) and an
  `X-Suwappu-Client` identifier header.
- **Self-onboarding** — `register()` mints an API key with no prior auth.

The package also ships a [`SKILL.md`](./SKILL.md) for MCP / agent runtimes that
load skills by manifest, and a [`server.json`](./server.json) MCP-registry manifest.

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

The API key falls back to the `SUWAPPU_API_KEY` environment variable (and the
base URL to `SUWAPPU_BASE_URL`, defaulting to `https://api.suwappu.bot`). A
ready-made default client is also exported:

```ts
import { suwappu } from "@suwappu/openclaw"; // uses env vars
```

## Onboarding (no key yet)

```ts
import { register, createClient } from "@suwappu/openclaw";

const { apiKey } = await register({ name: "my-trading-agent" });
const suwappu = createClient({ apiKey }); // persist apiKey — it's shown once
```

## Handling failures

```ts
import { SuwappuRateLimitError, SuwappuValidationError } from "@suwappu/openclaw";

try {
  await suwappu.getQuote("ETH", "USDC", 1.0, "base");
} catch (err) {
  if (err instanceof SuwappuValidationError) console.error(err.fields);
  else if (err instanceof SuwappuRateLimitError) console.error("retry after", err.retryAfterMs);
  else throw err;
}
```

Retries and timeouts are configurable:

```ts
const suwappu = createClient({
  apiKey,
  timeoutMs: 15_000,
  maxRetries: 4,
  hooks: { onRetry: ({ status, delayMs }) => console.warn(`retrying after ${status} in ${delayMs}ms`) },
});
```

## Managed swaps (server-signed)

Beyond the non-custodial `executeSwap`, an agent with a managed wallet can have
the server sign and broadcast, then poll for the result:

```ts
const receipt = await suwappu.executeManagedSwap(quote.id, myManagedWallet);
const status = await suwappu.getSwapStatus(receipt.swapId);
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
| `register(params)` | `POST /v1/agent/register` |
| `getProfile()` | `GET /v1/agent/me` |
| `rotateKey()` | `POST /v1/agent/keys/rotate` |
| `getQuote(from, to, amount, chain)` | `POST /v1/agent/quote` |
| `executeSwap(quoteId, walletAddress)` | `POST /v1/agent/swap` |
| `executeManagedSwap(quoteId, walletAddress)` | `POST /v1/agent/swap/execute` |
| `getSwapStatus(swapId)` | `GET /v1/agent/swap/status/:id` |
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
