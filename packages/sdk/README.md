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
await client.swap(quoteOrId);          // accepts a Quote or a quote id string
await client.getPortfolio(walletAddress, chain?);
await client.getPrices("ETH,USDC", chain?);
await client.listChains();
await client.listTokens(chain);
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

The package ships a `suwappu` binary:

```bash
export SUWAPPU_API_KEY=sk_...
suwappu prices ETH USDC SOL
suwappu portfolio --wallet 0xYourAddress --chain base
```

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
