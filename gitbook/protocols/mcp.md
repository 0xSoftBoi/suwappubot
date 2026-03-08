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

All requests and responses follow JSON-RPC 2.0, using MCP protocol version `2024-11-05`.

## Handshake: Initialize

Before calling any tools, initialize the MCP session:

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {}
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "suwappu",
      "version": "0.4.0"
    }
  }
}
```

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

Returns an array of tool definitions. See the tool reference below for all six tools.

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

## npm Package (Local stdio Server)

For local MCP setups, install the `@suwappu/mcp-server` npm package:

```bash
npm install -g @suwappu/mcp-server
```

Run directly:

```bash
SUWAPPU_API_KEY=suwappu_sk_YOUR_KEY npx @suwappu/mcp-server
```

The stdio server connects to the Suwappu API and exposes the same six tools as the remote endpoint. Use this when your MCP client requires a local process (e.g., Claude Desktop with stdio transport).

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

Alternatively, use the local stdio server:

```json
{
  "mcpServers": {
    "suwappu": {
      "command": "npx",
      "args": ["-y", "@suwappu/mcp-server"],
      "env": {
        "SUWAPPU_API_KEY": "suwappu_sk_YOUR_KEY"
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
