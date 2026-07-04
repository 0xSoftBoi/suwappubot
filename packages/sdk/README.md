# @suwappu/sdk

TypeScript client for the [Suwappu](https://suwappu.bot) cross-chain DEX API — quotes, swaps, portfolios, prices, perps, prediction markets, and lending across 15+ chains.

## Install

```bash
bun add @suwappu/sdk
# or: npm install @suwappu/sdk
```

## Quickstart

```ts
import { Suwappu } from "@suwappu/sdk";

const client = new Suwappu({ apiKey: process.env.SUWAPPU_KEY });

// Quote + swap
const quote = await client.getQuote({
  from: "USDC",
  to: "ETH",
  chain: "base",
  amount: "1000",
});
const tx = await client.swap(quote);
console.log(tx.txHash, tx.status);
```

The API key falls back to the `SUWAPPU_API_KEY` environment variable if not
passed to the constructor. The base URL defaults to `https://api.suwappu.bot`
and can be overridden with `{ baseUrl }`.

## API surface

### Swap & market data

```ts
await client.getQuote({ from, to, chain, amount });
// Cross-chain: pass fromChain/toChain instead of chain, plus walletAddress
// to get executable transaction data back with the quote.
await client.getQuote({ from, to, fromChain, toChain, amount, walletAddress });

await client.swap(quoteOrId, walletAddress);  // accepts a Quote or a quote id string
await client.prepareSwap({ quoteId, walletAddress }); // raw POST /v1/agent/swap payload
await client.getSwapStatus(swapId);
await client.getPortfolio(walletAddress, chain?);
await client.getPrices("ETH,USDC", chain?);
await client.listChains();
await client.listTokens(chain, search?);
```

Suwappu is non-custodial: `swap()`/`prepareSwap()` return an **unsigned**
transaction (or a base64-serialized Solana transaction). The SDK never signs
or broadcasts — sign the result with your own wallet and submit it yourself.

### Agent account

```ts
const { id, name, apiKey } = await client.register({ name: "my-agent" }); // shown once
await client.me();
await client.getBilling(); // credits, tier, metering + topup/subscribe info
```

### Perps (Hyperliquid)

```ts
await client.perps.markets();
await client.perps.quote({ market: "ETH", side: "long", size: 0.5, leverage: 10 });
await client.perps.positions(address);
```

### Prediction markets (Polymarket)

```ts
const markets = await client.predict.list({ query: "election", limit: 20 });
await client.predict.market(id);
await client.predict.book(id);
await client.predict.price(id);
await client.predict.trades(id, 20);
await client.predict.order({ tokenId, price: "0.55", size: "10", side: "BUY" });
await client.predict.positions();
await client.predict.orders(status?);
```

### Lending (Morpho)

```ts
await client.lend.markets(chainId?);
await client.lend.market(id);
```

## CLI

The package ships a `suwappu` binary built for both humans and agents —
every command supports `-o json` for machine-parseable output (default is a
human-readable table); errors in `-o json` mode are structured JSON with a
stable `error.code` instead of free text.

### Install & auth

```bash
bun add -g @suwappu/sdk   # or: npm install -g @suwappu/sdk

# Option A: register a fresh agent key and save it
suwappu register --name my-agent --save

# Option B: already have a key — save it interactively (masked input,
# written to ~/.config/suwappu/config.json with 0600 perms)
suwappu auth
suwappu auth status   # masked key + live GET /v1/agent/me check
```

Auth resolves in this order (highest wins): `--api-key <key>` flag >
`SUWAPPU_API_KEY` env var > `~/.config/suwappu/config.json`. The API base URL
resolves the same way via `--base-url` / `SUWAPPU_API_URL`.

### Commands

```bash
suwappu chains                                   # list supported chains
suwappu tokens --chain base --search USD         # list/search tokens on a chain
suwappu prices ETH USDC SOL                      # token prices, 24h change
suwappu portfolio --wallet 0xYourAddress --chain base

suwappu quote --from-chain base --to-chain arbitrum \
  --from-token USDC --to-token ETH --amount 100

# Prints the unsigned transaction from POST /v1/agent/swap. This CLI never
# signs or broadcasts — sign the result with your own wallet.
suwappu swap --from-chain base --to-chain arbitrum \
  --from-token USDC --to-token ETH --amount 100 \
  --from-address 0xYourManagedWalletAddress

suwappu swap-status <swapId>                     # poll a managed swap
suwappu me                                        # agent profile
suwappu billing                                   # credits, tier, metering status

# Machine output for any command:
suwappu chains -o json
```

### Structured errors

With `-o json`, a failed command prints one JSON object on stdout and exits
non-zero — no output is written to stderr in JSON mode:

```json
{"success":false,"error":{"code":"rate_limited","message":"Rate limit exceeded. 30 requests per minute for free tier. Retry after 12s."}}
```

`error.code` is one of: `validation_error`, `unauthorized`,
`payment_required`, `forbidden`, `not_found`, `rate_limited`, `server_error`,
`external_service_error`, or a CLI-local code (e.g. `invalid_input`) for
failures that never reached the API.

## Error handling

Non-2xx responses throw a `SuwappuError` with `.status` and `.body`:

```ts
import { Suwappu, SuwappuError } from "@suwappu/sdk";

try {
  await client.getQuote({ from: "X", to: "Y", chain: "base", amount: "1" });
} catch (err) {
  if (err instanceof SuwappuError) console.error(err.status, err.body);
}
```
