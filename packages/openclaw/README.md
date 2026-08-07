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

> **Version check:** this page describes source `0.3.0`. Run
> `npm view @suwappu/openclaw version` before copying `simulateSwap` or
> idempotency examples from this page into a registry-installed client.

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

// Dry-run the quote before asking for a signable transaction
const simulation = await suwappu.simulateSwap(quote.id, "0xYourWallet");
if (!simulation.wouldExecute) throw new Error(simulation.warnings.join("; "));

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
const receipt = await suwappu.executeManagedSwap(quote.id, myManagedWallet, {
  idempotencyKey: "rebalance-2026-08-06-001",
});
const status = await suwappu.getSwapStatus(receipt.swapId);
```

If a timeout/network/5xx makes a managed execution outcome uncertain, reconcile
status/history first and reuse that same idempotency key instead of blindly
submitting another trade.

## Non-custodial swaps

`executeSwap` does **not** broadcast a transaction. It returns an unsigned EVM
transaction (or a base64 serialized Solana transaction) with `status: "ready"`.
You sign and submit it with your own wallet. `executeSwap` requires the address
that will sign the returned transaction. `getPortfolio` is intentionally narrower:
it only reads the calling agent's managed EVM wallet.

## API surface

| Method | Endpoint |
| --- | --- |
| `register(params)` | `POST /v1/agent/register` |
| `getProfile()` | `GET /v1/agent/me` |
| `rotateKey()` | `POST /v1/agent/keys/rotate` |
| `getQuote(from, to, amount, chain)` | `POST /v1/agent/quote` |
| `simulateSwap(quoteId, walletAddress?)` | `POST /v1/agent/swap/simulate` |
| `executeSwap(quoteId, walletAddress)` | `POST /v1/agent/swap` |
| `executeManagedSwap(quoteId, walletAddress)` | `POST /v1/agent/swap/execute` |
| `getSwapStatus(swapId)` | `GET /v1/agent/swap/status/:id` |
| `getPortfolio(walletAddress, chain?)` | `GET /v1/agent/portfolio` |
| `getPrices(symbols, chain?)` | `GET /v1/agent/prices` |
| `listChains()` | `GET /v1/agent/chains` |
| `listTokens(chain)` | `GET /v1/agent/tokens` |
| `perps.markets()` | `GET /v1/agent/perps/markets` (research) |
| `perps.quote(market, side, size, leverage)` | `POST /v1/agent/perps/quote` (indicative) |
| `perps.positions(address)` | `GET /v1/agent/perps/positions` (read-only) |
| `predict.markets(query?, limit?)` | `GET /v1/agent/predict/markets` |
| `predict.market(id)` | `GET /v1/agent/predict/market/:id` |
| `lend.markets(chainId?)` | `GET /v1/agent/lend/markets` (read-only) |
| `lend.market(id)` | `GET /v1/agent/lend/market/:id` (read-only) |

Every method mirrors a Suwappu agent API endpoint exactly — there are no
client-only features. OpenClaw's `predict.*` surface is intentionally read-only
even though the REST API has a separate prediction-order route. The current
Agent API has no perps open/close endpoint and no Morpho deposit/withdraw
endpoint; these methods are for research, monitoring, and product intelligence.
For perps markets, `maxLeverage` is the current Suwappu quote cap while
`venueMaxLeverage` is Hyperliquid's raw venue maximum; `fundingRate` is current
market context rather than accrued position funding P&L.

## Development

```bash
bun install
bun run typecheck   # tsc --noEmit
bun test            # run the unit tests (mocked fetch)
bun run build       # emit dist/ for publishing
```

## Publishing to the MCP Registry

[`server.json`](./server.json) is a manifest for the official
[MCP registry](https://registry.modelcontextprotocol.io) ([spec/schema](https://github.com/modelcontextprotocol/registry)).
It declares the `bot.suwappu/mcp` server under the domain-verified `bot.suwappu`
namespace (reverse-DNS for `suwappu.bot`), our remote endpoint
(`https://api.suwappu.bot/mcp`; discovery is public and most tools require bearer auth), and the `@suwappu/mcp-server`
npm package as an alternate stdio transport.

To (re-)publish after editing `server.json`:

1. **Install the publisher CLI** — see the
   [`mcp-publisher` install instructions](https://github.com/modelcontextprotocol/registry)
   in the registry repo (Go install or prebuilt binary).
2. **Prove domain ownership of `suwappu.bot`** (one-time, or whenever the
   verification key rotates): the registry issues a challenge that must be
   published as a DNS `TXT` record on `suwappu.bot` (e.g.
   `_mcp-registry-challenge.suwappu.bot` or similar — the exact record name
   comes from the CLI/registry response). **This step requires access to the
   `suwappu.bot` DNS zone and must be done by a human with registrar access**
   — an agent cannot complete it unattended.
3. **Authenticate**: `mcp-publisher login dns --domain bot.suwappu` (or the
   registry's current auth flow for domain namespaces) once the TXT record is
   live and has propagated.
4. **Publish**: `mcp-publisher publish ./server.json` from this directory.
5. **Verify**: `curl https://registry.modelcontextprotocol.io/v0/servers?search=suwappu`
   should return the `bot.suwappu/mcp` entry.

Bump `version` in `server.json` (and keep it in sync with the npm package
version) before re-publishing.

## License

MIT
