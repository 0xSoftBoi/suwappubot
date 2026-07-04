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

All requests and responses follow JSON-RPC 2.0. The server negotiates `protocolVersion` on `initialize`: if your client requests a version we support (`2024-11-05`, `2025-03-26`, or `2025-06-18`), we echo it back; otherwise we respond with our latest supported version (`2025-06-18`). We're a simple JSON-RPC server with no version-gated tool/resource behavior, so negotiation is limited to the handshake.

## Handshake: Initialize

Before calling any tools, initialize the MCP session:

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

If `params.protocolVersion` is omitted or is a version we don't recognize, `result.protocolVersion` will be our latest supported version (`2025-06-18`) rather than an echo.

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

Returns an array of tool definitions. See the tool reference below for all 15 tools.

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
| `execute_swap` | Execute a swap using a previously obtained `quote_id`; returns an unsigned transaction to sign | `quote_id`, `wallet_address` | 5 |
| `get_tempo_tokens` | TIP-20 token list on Tempo mainnet (chain 4217) — USD-denominated stablecoins | `search` | 0 (free) |
| `browse_mpp_directory` | Browse the third-party MPP (Machine Payments Protocol, directory.mpp.dev) service directory | `category`, `limit` | 0 (free) |
| `predict_markets` | Search and browse Polymarket prediction markets with live prices/volumes | `query`, `limit` | 1 |
| `predict_market` | Detailed market info with live CLOB midpoint prices per outcome (alias: `predict_market_detail`) | `market_id` | 1 |
| `perps_markets` | List HyperLiquid perpetual futures markets (mark price, funding rate, max leverage) | — | 1 |
| `perps_quote` | Quote a HyperLiquid perp position: entry price, margin, liquidation price, fees | `market`, `side`, `size`, `leverage` | 1 |
| `perps_positions` | Open HyperLiquid perp positions for a wallet (size, entry, PnL, liquidation price) | `address` | 1 |
| `lend_markets` | List Morpho lending markets on a chain (supply/borrow APY, LLTV, utilization, TVL) | `chain_id` | 1 |
| `lend_market` | Detail for a single Morpho lending market by ID | `market_id` | 1 |

`predict_market_detail` is a legacy alias for `predict_market` kept for older clients — both route to the same handler and cost.

## Available Tools

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

Execute a previously obtained quote.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `quote_id` | string | Yes | Quote ID from a `get_quote` response |
| `wallet_address` | string | Yes | Wallet address to execute the swap from |

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
      "wallet_address": "0x1234567890abcdef1234567890abcdef12345678"
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
| `category` | string | No | Filter by category |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "method": "tools/call",
  "params": {
    "name": "predict_markets",
    "arguments": {
      "category": "crypto"
    }
  }
}
```

### 10. predict_market_detail

Get detailed market information with live CLOB midpoint prices for each outcome.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Polymarket condition ID |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "method": "tools/call",
  "params": {
    "name": "predict_market_detail",
    "arguments": {
      "market_id": "0x1234abcd..."
    }
  }
}
```

### 11. perps_markets

List available Hyperliquid perpetual futures markets with mark price, funding rate, max leverage, and size decimals. No parameters required.

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

Quote a Hyperliquid perpetual position: entry price, margin required, liquidation price, funding rate, and fees. Requires authentication.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market` | string | Yes | Perp market symbol (e.g. "ETH-PERP", "BTC-PERP") from `perps_markets` |
| `side` | string | Yes | Position direction: `long` or `short` |
| `size` | number | Yes | Position size in the base asset |
| `leverage` | number | Yes | Leverage multiplier (e.g. 10) |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 14,
  "method": "tools/call",
  "params": {
    "name": "perps_quote",
    "arguments": {
      "market": "ETH-PERP",
      "side": "long",
      "size": 1.5,
      "leverage": 10
    }
  }
}
```

### 13. perps_positions

List open Hyperliquid perpetual positions for a wallet address, with size, entry price, unrealized PnL, and liquidation price.

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

List Morpho lending markets on a chain with supply/borrow APY, LLTV, utilization, and TVL.

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

Get details for a single Morpho lending market by its unique market ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Morpho market unique ID (from `lend_markets` results) |

**Example call:**

```json
{
  "jsonrpc": "2.0",
  "id": 17,
  "method": "tools/call",
  "params": {
    "name": "lend_market",
    "arguments": {
      "market_id": "0xabcdef1234..."
    }
  }
}
```

## Response Format

All `tools/call` responses return content as an array of parts:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"quote_id\":\"q_abc123\",\"from_token\":\"ETH\",\"to_token\":\"USDC\",\"from_amount\":\"0.5\",\"to_amount\":\"1247.50\",\"chain\":\"base\",\"expires_at\":\"2026-03-07T12:05:00Z\"}"
      }
    ]
  }
}
```

The `text` field contains a JSON string. Parse it to access the structured data.

## Client Setup

Suwappu's MCP server is hosted remotely at `https://api.suwappu.bot/mcp` (Streamable HTTP transport) — there is no local stdio server to install. Point any MCP-compatible client at that URL with your Bearer key in the `Authorization` header. See [MCP Client Setup](../quickstart/mcp-clients.md) for exact config snippets for Claude Code, Claude Desktop, Cursor, Codex, and OpenCode.

If you're building an agent programmatically instead of using an interactive client, the `@suwappu/openclaw` npm package wraps this same MCP surface (and the REST API) as a typed skill client:

```bash
npm install @suwappu/openclaw
```

## MCP Registry Listing

Suwappu publishes a manifest (`packages/openclaw/server.json`) to the official
[MCP registry](https://registry.modelcontextprotocol.io) under the
domain-verified namespace `bot.suwappu/mcp`, so MCP-aware clients that browse
the registry (rather than being hand-configured) can discover the remote
endpoint above. See the publishing steps and DNS-verification note in
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
# Step 1: Initialize
curl -X POST https://api.suwappu.bot/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

# Step 2: List available tools
curl -X POST https://api.suwappu.bot/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Step 3: Get a quote
curl -X POST https://api.suwappu.bot/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -d '{
    "jsonrpc":"2.0","id":3,"method":"tools/call",
    "params":{
      "name":"get_quote",
      "arguments":{
        "from_token":"ETH",
        "to_token":"USDC",
        "amount":"0.5",
        "chain":"base"
      }
    }
  }'
```
