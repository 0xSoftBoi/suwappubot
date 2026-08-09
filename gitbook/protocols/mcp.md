# MCP (Model Context Protocol)

The MCP protocol lets LLMs like Claude interact with Suwappu as a tool provider. Claude Desktop, Claude Code, Cursor, and other MCP-compatible clients can discover and call Suwappu's tools automatically.

## Endpoint

```
POST https://api.suwappu.bot/mcp
```

## Authentication

Include your Bearer token in the `Authorization` header:

```
Authorization: Bearer suwappu_sk_YOUR_KEY
```

Obtain a token by registering at `POST /v1/agent/register`.

## Protocol

Suwappu source `0.6.0` supports both MCP eras on the same endpoint:

- **Modern (recommended): `2026-07-28`.** It is stateless: there is no `initialize` session. Every request carries its protocol version and client capabilities in `params._meta`; Streamable HTTP mirrors the version/method/name into request headers. Successful results include `resultType: "complete"` and server identity in `_meta`. Cacheable discovery/list/resource results also include `ttlMs` and `cacheScope`.
- **Legacy compatibility:** `2024-11-05`, `2025-03-26`, and `2025-06-18`. These continue to use the `initialize` handshake. If a legacy client requests an unsupported version, `initialize` answers with `2025-06-18`; it never negotiates the modern revision through the legacy handshake.

For application code, prefer an official MCP SDK that supports the 2026 revision and dual-era negotiation. If you are writing raw HTTP, the modern request shape below is the contract to implement.

## Modern discovery: `server/discover`

`server/discover` is public and is the cleanest way to probe the hosted server before your first tool call.

**HTTP headers:**

```text
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
Mcp-Method: server/discover
```

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": "discover-1",
  "method": "server/discover",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "my-suwappu-app",
        "version": "1.0.0"
      },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

The response advertises the server's supported revisions and capabilities and includes `resultType: "complete"`, `_meta.io.modelcontextprotocol/serverInfo`, and public cache hints. `clientInfo` is recommended but optional; `protocolVersion` and `clientCapabilities` are required on every modern request.

For every modern HTTP POST, `MCP-Protocol-Version` and `Mcp-Method` must match the body. `tools/call`, `resources/read`, and `prompts/get` also require `Mcp-Name` matching `params.name` or `params.uri`. Suwappu rejects missing/mismatched modern transport metadata before authentication or per-tool metering.

## Legacy fallback: `initialize`

Only legacy clients initialize. A modern `2026-07-28` client should not send this handshake.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18"
  }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "suwappu",
      "version": "0.6.0"
    }
  }
}
```

If `params.protocolVersion` is omitted, asks for `2026-07-28`, or names another version the legacy path does not recognize, `result.protocolVersion` is the latest supported **legacy** revision (`2025-06-18`) rather than an echo.

## Discover Tools: tools/list

List all available tools and their input schemas:

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

**Response:**

Returns the live tool definitions and input schemas. Source `0.6.0` currently advertises **22 tools**; `tools/list` is the runtime source of truth if this page and a deployed server ever differ.

## Pay-Per-Call Pricing

Every `tools/call` is metered in prepaid credits (1 credit ≈ $0.001 USD). Agents on the `agent`, `pro`, `premium`, or `enterprise` tier (active subscription) bypass metering entirely — calls are free while the subscription window is active. Free-tier agents are charged per call; if the balance is insufficient, the server returns HTTP 402 with an x402 payment challenge instead of the JSON-RPC result. See [Agentic Payments](../billing/agentic-payments.md) for the full 402 → pay → retry flow, and [Pricing](../billing/pricing.md) for tier prices.

| Tool | Description | Key Params | Credits |
|------|-------------|------------|---------|
| `get_quote` | Get a swap quote for exchanging tokens (EVM via Li.Fi, Solana via Jupiter, Tempo via internal router) | `from_token`, `to_token`, `amount`, `chain`, `from_chain`, `to_chain`, `wallet_address`, `slippage` | 1 |
| `get_portfolio` | Token balances and portfolio value for a wallet across all supported chains | `wallet_address`, `chain` | 1 |
| `get_prices` | Current USD prices with 24h change for up to 20 symbols | `symbols` | 1 |
| `list_chains` | List all supported blockchain networks. No parameters. | — | 0 (free) |
| `list_tokens` | List available tokens on a chain | `chain`, `search` | 0 (free) |
| `simulate_swap` | Dry-run a swap with zero funds moved — pre-flight checks (balance, allowance, gas, `eth_call` revert preview, slippage) plus `would_execute` verdict | same as `get_quote`, plus optional `quote_id` | 1 |
| `execute_swap` | Historical name for preparing an unsigned self-custody transaction; never signs or broadcasts | `quote_id`, `wallet_address`, `idempotency_key` | 5 |
| `get_tempo_tokens` | TIP-20 token list on Tempo mainnet (chain 4217) — USD-denominated stablecoins | `search` | 0 (free) |
| `browse_mpp_directory` | Browse the third-party MPP (Machine Payments Protocol, directory.mpp.dev) service directory | `category`, `limit` | 0 (free) |
| `predict_markets` | Search and browse Polymarket prediction markets with live prices/volumes | `query`, `limit` | 1 |
| `predict_market` | Detailed market info with live CLOB midpoint prices per outcome (alias: `predict_market_detail`) | `market_id` | 1 |
| `perps_markets` | List supported HyperLiquid perpetual futures markets (live mark/funding, Suwappu quote max, raw venue max) | — | 1 |
| `perps_quote` | Quote a HyperLiquid perp position: indicative entry, margin, liquidation price, current funding, fees | `market`, `side`, `size`, `leverage` | 1 |
| `perps_positions` | Open HyperLiquid perp positions for a wallet (size, entry, PnL, liquidation price, current market funding) | `address` | 1 |
| `lend_markets` | Current Morpho APY/utilization, USD liquidity, listing status, and warnings for one chain | `chain_id` | 1 |
| `lend_market` | Chain-scoped detail for a single Morpho lending market | `market_id`, `chain_id` | 1 |
| `get_swap_status` | Status of a managed swap created through REST `/swap/execute` | `swap_id` | 1 |
| `get_swap_history` | Paginated managed-swap history for the authenticated agent | `status`, `limit`, `offset` | 1 |
| `predict_book` | Live CLOB order book for every outcome of a prediction market | `market_id` | 1 |
| `predict_price` | Live CLOB midpoint price for every outcome of a prediction market | `market_id` | 1 |
| `predict_trades` | Recent CLOB trades across a prediction market's outcomes | `market_id`, `limit` | 1 |
| `list_wallet_policies` | Read managed-wallet spending/whitelist policies for the authenticated agent | `wallet_address` | 1 |

`predict_market_detail` is a legacy alias for `predict_market` kept for older clients — both route to the same handler and cost.

The zero-cost discovery calls `list_chains`, `list_tokens`, `get_tempo_tokens`, and `browse_mpp_directory` can be called without a Bearer token. MCP lifecycle/discovery methods (`server/discover`, legacy `initialize`, `tools/list`, `resources/list`, `resources/templates/list`, `resources/read`, and prompts) are public as well. Other tools require agent authentication even when their purpose is read-only.

## Selected Tool Examples

The examples below focus on method parameters. Do not hard-code this numbered subset as the complete inventory; discover the live catalog with `tools/list`. When sending them as raw `2026-07-28` HTTP, also include the modern `_meta` and matching headers described above; an MCP SDK should do that for you.

### 1. get_quote

Get a swap quote for a token pair.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `from_token` | string | Yes | Source token symbol (e.g., "ETH") |
| `to_token` | string | Yes | Destination token symbol (e.g., "USDC") |
| `amount` | string | Yes | Amount of source token to swap |
| `chain` | string | No | Chain name for same-chain swaps (e.g., "base") |
| `from_chain` | string | No | Source chain for cross-chain swaps |
| `to_chain` | string | No | Destination chain for cross-chain swaps |
| `wallet_address` | string | No | Wallet address for the quote |
| `slippage` | string | No | Slippage tolerance (e.g., "0.5" for 0.5%) |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_quote",
    "arguments": {
      "from_token": "ETH",
      "to_token": "USDC",
      "amount": "0.5",
      "chain": "base"
    }
  }
}
```

### 2. execute_swap

Prepare an unsigned self-custody transaction from a previously obtained quote. The caller remains responsible for reviewing, signing, and broadcasting the returned transaction.

`idempotency_key` on this MCP tool is an optional **correlation value**: the server echoes it with the prepared transaction so your own submission workflow can carry the same intent identifier forward. MCP preparation itself does not submit an on-chain transaction, so this field does not create server-side submission deduplication. For Suwappu-managed execution, use the REST `Idempotency-Key` header on `POST /v1/agent/swap/execute` instead.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `quote_id` | string | Yes | Quote ID from a `get_quote` response |
| `wallet_address` | string | Yes | Wallet address to execute the swap from |
| `idempotency_key` | string | No | Correlation key echoed with the unsigned transaction; no MCP-side broadcast/deduplication |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "execute_swap",
    "arguments": {
      "quote_id": "q_abc123",
      "wallet_address": "0x1234567890abcdef1234567890abcdef12345678",
      "idempotency_key": "self-custody-intent-001"
    }
  }
}
```

### 3. get_portfolio

Check token balances for a wallet.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `wallet_address` | string | Yes | Wallet address to check |
| `chain` | string | No | Filter by specific chain |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "get_portfolio",
    "arguments": {
      "wallet_address": "0x1234567890abcdef1234567890abcdef12345678",
      "chain": "base"
    }
  }
}
```

### 4. get_prices

Get current prices for one or more tokens.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `symbols` | string | Yes | Comma-separated token symbols (e.g., "ETH,BTC,SOL") |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/call",
  "params": {
    "name": "get_prices",
    "arguments": {
      "symbols": "ETH,BTC,SOL"
    }
  }
}
```

### 5. list_chains

List all supported blockchain networks. No parameters required.

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "list_chains",
    "arguments": {}
  }
}
```

### 6. list_tokens

Search and list available tokens.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chain` | string | No | Filter tokens by chain |
| `search` | string | No | Search by token name or symbol |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "method": "tools/call",
  "params": {
    "name": "list_tokens",
    "arguments": {
      "chain": "base",
      "search": "USDC"
    }
  }
}
```

### 7. get_tempo_tokens

Get the TIP-20 token list on Tempo mainnet (chain ID 4217). Includes USD-denominated stablecoins.

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 9,
  "method": "tools/call",
  "params": {
    "name": "get_tempo_tokens",
    "arguments": {}
  }
}
```

### 8. browse_mpp_directory

Browse the third-party MPP (Machine Payments Protocol, directory.mpp.dev) service directory. Discover available services and their payment requirements. (This is a different protocol from Suwappu's own pathUSD micropayment auth used elsewhere in the API — see [Agentic Payments](../billing/agentic-payments.md).)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | string | No | Filter by service category |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "tools/call",
  "params": {
    "name": "browse_mpp_directory",
    "arguments": {
      "category": "ai"
    }
  }
}
```

### 9. predict_markets

Search and browse prediction markets on Polymarket with live prices and volumes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Search term |
| `limit` | number | No | Maximum results (default 10, max 50) |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "method": "tools/call",
  "params": {
    "name": "predict_markets",
    "arguments": {
      "query": "crypto",
      "limit": 10
    }
  }
}
```

### 10. predict_market

Get detailed market information with live CLOB midpoint prices for each outcome.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market `id` returned by `predict_markets` (not `conditionId`) |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "method": "tools/call",
  "params": {
    "name": "predict_market",
    "arguments": {
      "market_id": "<market-id>"
    }
  }
}
```

Older clients may still call the supported `predict_market_detail` alias, but new integrations should use the name returned by `tools/list`: `predict_market`.

### 11. perps_markets

List supported Hyperliquid perpetual futures markets with live mark/funding context, the Suwappu quote `maxLeverage`, raw `venueMaxLeverage`, and size decimals. No parameters required.

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 13,
  "method": "tools/call",
  "params": {
    "name": "perps_markets",
    "arguments": {}
  }
}
```

### 12. perps_quote

Quote a Hyperliquid perpetual position: indicative entry price, margin required, approximate liquidation price, current raw market funding rate, and fees. Requires authentication and does not execute a position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market` | string | Yes | Perp market `name` (e.g. `"ETH-USD"`, `"BTC-USD"`) returned by `perps_markets` |
| `side` | string | Yes | Position direction: `long` or `short` |
| `size` | number | Yes | Position size in the base asset |
| `leverage` | number | Yes | Leverage multiplier from 1 through that market's returned `maxLeverage` |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 14,
  "method": "tools/call",
  "params": {
    "name": "perps_quote",
    "arguments": {
      "market": "ETH-USD",
      "side": "long",
      "size": 1.5,
      "leverage": 10
    }
  }
}
```

### 13. perps_positions

List open Hyperliquid perpetual positions for a wallet address, with size, entry price, unrealized PnL, liquidation price, and current raw market funding rate. The funding field is market context, not accrued position funding PnL.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | string | Yes | Wallet address to inspect |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 15,
  "method": "tools/call",
  "params": {
    "name": "perps_positions",
    "arguments": {
      "address": "0x1234567890abcdef1234567890abcdef12345678"
    }
  }
}
```

### 14. lend_markets

List current Morpho lending-market snapshots for one chain. Responses include supply/borrow APY, LLTV, utilization, nullable USD supply/borrow/available-liquidity values, interface listing status, and Morpho warning objects. This is a read-only research tool; it does not deposit, withdraw, borrow, or repay.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chain_id` | number | No | EVM chain ID (default 8453 = Base) |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 16,
  "method": "tools/call",
  "params": {
    "name": "lend_markets",
    "arguments": {
      "chain_id": 8453
    }
  }
}
```

### 15. lend_market

Get details for one Morpho lending market. Market identity is chain-scoped, so persist the market ID together with its chain ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Morpho market unique ID (from `lend_markets` results) |
| `chain_id` | number | No | Positive EVM chain ID (default 8453 = Base) |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 17,
  "method": "tools/call",
  "params": {
    "name": "lend_market",
    "arguments": {
      "market_id": "0xabcdef1234...",
      "chain_id": 8453
    }
  }
}
```

`supplyApy`, `borrowApy`, and `utilization` are percentage values (`4.2` means 4.2%). `totalSupplyUsd`, `totalBorrowUsd`, and `availableLiquidityUsd` are explicitly USD-valued and can be `null`; the older `totalSupply` and `totalBorrow` names are deprecated aliases. `listed: true` and an empty `warnings` array are useful interface signals, not guarantees that a market is safe. See [Lending Markets](../api-reference/lend.md) for the exact wire contract and [Build a Lending Monitor](../guides/lending-monitor.md) for a production pattern.

## Response Format

All `tools/call` responses return content as an array of parts. Modern `2026-07-28` results also carry `resultType` and server identity:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "resultType": "complete",
    "_meta": {
      "io.modelcontextprotocol/serverInfo": {
        "name": "suwappu",
        "version": "0.6.0"
      }
    },
    "content": [
      {
        "type": "text",
        "text": "{\"quote_id\":\"q_abc123\",\"from_token\":\"ETH\",\"to_token\":\"USDC\",\"from_amount\":\"0.5\",\"to_amount\":\"1247.50\",\"chain\":\"base\",\"expires_at\":\"2026-03-07T12:05:00Z\"}"
      }
    ]
  }
}
```

For tools that declare an MCP `outputSchema`, Suwappu also returns `structuredContent`; prefer it when your client exposes it. The `content` text part remains available for compatibility and contains the same JSON value. Tool-level failures set `isError: true`; do not treat a syntactically successful JSON-RPC response as proof the tool action succeeded. Legacy results omit `resultType`; clients should interpret that as a completed result for compatibility.

## Client Setup

Suwappu's preferred MCP path is the hosted Streamable HTTP server at `https://api.suwappu.bot/mcp`. Point any remote-capable MCP client at that URL with your Bearer key in the `Authorization` header. See [MCP Client Setup](../quickstart/mcp-clients.md) for exact config snippets for Claude Code, Claude Desktop, Cursor, Codex, and OpenCode.

Source `0.6.0` also contains `@suwappu/mcp-server`, a thin stdio bridge for clients that require a local process. The npm registry can lag source, so check the published version before using `npx`; the hosted endpoint is the canonical catalog either way.

If you're building an agent programmatically instead of using an interactive client, the `@suwappu/openclaw` npm package wraps this same MCP surface (and the REST API) as a typed skill client:

```bash
npm install @suwappu/openclaw
```

## MCP Registry Listing

Suwappu publishes a manifest (`packages/openclaw/server.json`) to the official
[MCP registry](https://registry.modelcontextprotocol.io) under the
domain namespace `bot.suwappu/mcp`, so MCP-aware clients that browse
the registry (rather than being hand-configured) can discover the remote
endpoint above. The checked-in manifest is intentionally remote-only while
source `@suwappu/mcp-server@0.6.0` is newer than the npm release, so registry
clients are not sent to an unpublished stdio package. See the publishing steps and DNS-verification note in
[`packages/openclaw/README.md`](../../packages/openclaw/README.md#publishing-to-the-mcp-registry).

## Claude Desktop Configuration

Add Suwappu as an MCP server in your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "suwappu": {
      "url": "https://api.suwappu.bot/mcp",
      "headers": {
        "Authorization": "Bearer suwappu_sk_YOUR_KEY"
      }
    }
  }
}
```

After saving the config and restarting Claude Desktop, you can ask Claude to interact with Suwappu directly:

- "Get me a quote for swapping 1 ETH to USDC on Base"
- "What's the price of ETH and BTC?"
- "Show my portfolio on 0xabc..."
- "What chains does Suwappu support?"

Claude will automatically discover the available tools and call them on your behalf.

## Full Example: Quote Flow with curl

```bash
# Modern 2026-07-28: every POST is self-contained; there is no initialize step.
# Step 1: Discover server capabilities
curl -X POST https://api.suwappu.bot/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: server/discover" \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"curl-example","version":"1.0.0"},"io.modelcontextprotocol/clientCapabilities":{}}}}'

# Step 2: List available tools
curl -X POST https://api.suwappu.bot/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/list" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'

# Step 3: Get a quote
curl -X POST https://api.suwappu.bot/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/call" \
  -H "Mcp-Name: get_quote" \
  -d '{
    "jsonrpc":"2.0","id":3,"method":"tools/call",
    "params":{
      "name":"get_quote",
      "arguments":{
        "from_token":"ETH",
        "to_token":"USDC",
        "amount":"0.5",
        "chain":"base"
      },
      "_meta":{
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientCapabilities":{}
      }
    }
  }'
```
