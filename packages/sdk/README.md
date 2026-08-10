# @suwappu/sdk

TypeScript client for the [Suwappu](https://suwappu.bot) agent API: quotes, custody-aware swaps, portfolios, prices, perps, prediction markets, lending, and agent controls. Discover the current chain set with `listChains()` instead of hard-coding a count.

> **Version check:** this repository describes SDK source `0.6.0`. Run
> `npm view @suwappu/sdk version` before installing; if the registry is still
> behind `0.6.0`, newer methods on this page are not in that package yet. REST
> and the live OpenAPI contract remain the fallback compatibility surface.

## Install

```bash
bun add @suwappu/sdk
# or: npm install @suwappu/sdk
```

## Quickstart

Start with reads and quotes:

```ts
import { Suwappu } from "@suwappu/sdk";

const client = new Suwappu({ apiKey: process.env.SUWAPPU_API_KEY });

const quote = await client.getQuote({
  from: "USDC",
  to: "ETH",
  chain: "base",
  amount: "100",
});

console.log(quote.toAmount, quote.amountOutMin, quote.route);
console.log(await client.listChains());
```

The API key falls back to `SUWAPPU_API_KEY` when it is not passed to the
constructor. The base URL defaults to `https://api.suwappu.bot` and can be
overridden with `{ baseUrl }`.

## API surface

### Quotes, market data, and custody

```ts
await client.getQuote({ from, to, chain, amount });
await client.getQuote({
  from,
  to,
  fromChain,
  toChain,
  amount,
  walletAddress,
});

await client.getPortfolio(walletAddress, chain?);
await client.getPrices("ETH,USDC", chain?);
await client.listChains();
await client.listTokens(chain, search?);
```

A wallet-bound quote is useful when you intend to simulate or prepare that
specific route. The SDK has two deliberately separate transaction paths:

#### Self-custody: prepare, then sign yourself

```ts
const quote = await client.getQuote({
  from: "USDC",
  to: "ETH",
  chain: "base",
  amount: "100",
  walletAddress: "0xYourWallet",
});

const sim = await client.simulateSwap({
  quoteId: quote.id,
  walletAddress: "0xYourWallet",
});
if (!sim.wouldExecute) throw new Error(sim.warnings.join("; "));

const prepared = await client.prepareSwap({
  quoteId: quote.id,
  walletAddress: "0xYourWallet",
});
// prepared contains an unsigned transaction. Review it, sign with your own
// wallet, then submit it to the relevant chain RPC.
```

`prepareSwap()` calls `POST /v1/agent/swap`. It never signs or broadcasts
and it does not create a managed swap record.

#### Managed wallet: explicit server-side execution

```ts
const [wallet] = await client.agent.listWallets();
if (!wallet) throw new Error("Create a managed wallet first");

const quote = await client.getQuote({
  from: "USDC",
  to: "ETH",
  chain: "base",
  amount: "100",
  walletAddress: wallet.address,
});

const sim = await client.simulateSwap({
  quoteId: quote.id,
  walletAddress: wallet.address,
});
if (!sim.wouldExecute) throw new Error(sim.warnings.join("; "));

const execution = await client.executeManagedSwap(quote, {
  idempotencyKey: "rebalance-2026-08-06-001",
});
console.log(execution.swapId, execution.status, execution.txHash);
```

`executeManagedSwap()` calls `POST /v1/agent/swap/execute`, where the
authenticated agent's managed wallet is resolved server-side. Existing
`swap()` and `executeSwap()` methods remain backwards-compatible aliases for
this managed path; new code should prefer the explicit name.

Use a stable `idempotencyKey` for each intended managed trade. If a timeout,
network error, or 5xx leaves the on-chain outcome unknown, reconcile status or
history and retry with that same key instead of creating a fresh execution.

`getSwapStatus()` and `listSwaps()` inspect managed swap records:

```ts
await client.getSwapStatus(execution.swapId);
await client.listSwaps({ status: "completed", limit: 20 });
```

### Agent account

```ts
const { id, name, apiKey } = await client.register({ name: "my-agent" }); // shown once
await client.me();
await client.getBilling(); // credits, tier, metering + topup/subscribe info
```

### Wallets & swap safety

```ts
await client.agent.createWallet(); // idempotent — returns the existing one if any
await client.agent.listWallets();

// Dry-run before you commit. Surfaces reverts and gas while nothing is at stake.
const sim = await client.simulateSwap({ quoteId: quote.quote_id, walletAddress: "0x…" });
if (!sim.wouldExecute) throw new Error(sim.warnings.join("; "));

await client.listSwaps({ status: "completed", limit: 20 }); // this agent's history
```

### Agent control plane

Guardrails for agents that move real money: a human approves risky actions, every
action lands in a tamper-evident log, and one call halts everything.

```ts
// Approvals. Listing/deciding is an OWNER action — authenticate as the linked
// human (Mini App / owner JWT), not the agent API key. Only get() takes an agent key.
const pending = await owner.approvals.list({ status: "pending" });
await owner.approvals.approve(pending[0].id);
await owner.approvals.deny(pending[0].id);

// If the deployment sets APPROVAL_STEP_UP_REQUIRED=true, challenge first:
const { challenge } = await owner.approvals.stepUpChallenge(id);
await owner.approvals.approve(id, { stepUpChallenge: challenge });

// Audit chain. list() works with an agent or org key; verify() needs an ORG key
// (the chain is verified whole, so per-agent verification would leak other tenants).
await client.audit.list({ eventType: "swap.executed", since: "2026-01-01", limit: 100 });
await orgClient.audit.verify(); // { valid, count, firstBreakId }

// Kill switch — org API key required. Halts execution for the scope.
await orgClient.killswitch.set({ scope: "org", active: true, reason: "incident" });
await orgClient.killswitch.list();
```

To link an agent to a human owner, mint a code the owner redeems:

```ts
const { code, expiresAt } = await client.agent.linkCode(); // 409 if already linked
```

### Perps (Hyperliquid)

```ts
const perpMarkets = await client.perps.markets();
const eth = perpMarkets.find((market) => market.name === "ETH-USD");
// maxLeverage is the Suwappu quote cap; venueMaxLeverage is the raw venue max.
console.log(eth?.maxLeverage, eth?.venueMaxLeverage, eth?.markPrice, eth?.fundingRate);
await client.perps.quote({ market: "ETH-USD", side: "long", size: 0.5, leverage: 10 });
await client.perps.positions(address);
```

Perps `fundingRate` is the current raw Hyperliquid market rate, not accrued
position funding P&L. The Agent API does not expose perps execution.

### Prediction markets (Polymarket)

```ts
const markets = await client.predict.list({ query: "election", limit: 20 });
const market = await client.predict.market(id);
await client.predict.book(id);
await client.predict.price(id);
await client.predict.trades(id, 20);

// Trading is a separate authority boundary. Use an outcome token id, not
// market.id or market.conditionId. The current order route submits GTC limits.
const tokenId = market.tokens.find((token) => token.outcome === "Yes")?.tokenId;
if (tokenId) {
  await client.predict.order({ tokenId, price: "0.55", size: "10", side: "BUY" });
}
await client.predict.positions();
await client.predict.orders(status?);
```

### Lending (Morpho)

```ts
const markets = await client.lend.markets(8453);
const detail = await client.lend.market(markets[0].id, 8453);
```

`supplyApy`, `borrowApy`, and `utilization` are current percentages.
`totalSupplyUsd`, `totalBorrowUsd`, and `availableLiquidityUsd` are explicit
nullable USD values from Morpho; the older `totalSupply` / `totalBorrow` names
remain as deprecated aliases. `listed` is Morpho's interface listing status,
not a safety guarantee, and `warnings` contains active upstream market warning
types/levels. Market IDs are chain-scoped; detail defaults to Base (`8453`) if
the chain is omitted. Lending is read-only on the Agent API today.

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
  --from-address 0xYourWalletAddress

suwappu swap-status <swapId>                     # poll a managed /swap/execute record
suwappu me                                        # agent profile
suwappu billing                                   # credits, tier, metering status

# Machine output for any command:
suwappu chains -o json
```

### AI assistant

`suwappu ai` asks an LLM with Suwappu CLI context baked into its system
prompt (what the CLI does, and which commands exist). Pick one of three
backends and configure it once:

```bash
# 1. Router (OpenAI-compatible, e.g. OpenRouter) — driven by an API key you provide
suwappu ai setup --backend router --api-key sk-or-v1-... \
  [--base-url https://openrouter.ai/api/v1] [--model anthropic/claude-sonnet-5]

# 2. Claude — driven by your local Claude Code CLI / Claude subscription login
suwappu ai setup --backend claude

# 3. ChatGPT — driven by your local Codex CLI / ChatGPT subscription login
suwappu ai setup --backend chatgpt

suwappu ai "what's the cheapest route from USDC on base to ETH on arbitrum?"
suwappu ai journal    # local usage digest: totals, per-backend counts, failure rate, last 5 runs
suwappu ai lessons    # print ~/.suwappu/harness/lessons.md, or --init to seed one
```

The router backend's key is saved to `~/.config/suwappu/config.json` (0600
perms, same file `suwappu auth` uses) and is never echoed back — `ai setup`
only prints a masked form (`sk-...last4`). The `claude`/`chatgpt` backends
store no secret at all; they shell out to a CLI already on your `PATH` that
handles its own subscription auth. Every `ai` run — success or failure —
appends one line to `~/.suwappu/harness/journal.jsonl` (backend, timing,
ok/fail, first 120 chars of the prompt only).

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
