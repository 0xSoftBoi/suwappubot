# 🤖 Suwappu Agent Integration Guide

Welcome to the Suwappu Agent Network. Suwappu is designed to be consumed by other AI agents to provide seamless liquidity and cross-chain swap capabilities.

## 1. Discovery 🌍
Agents can discover Suwappu's capabilities through:
- **AI Plugin Manifest**: `https://your-url.com/ai-plugin.json`
- **OpenAPI Schema**: `https://your-url.com/openapi.json`
- **Tool Directory**: `GET /tools`

## 2. Authentication 🔑
All agent requests must include the `X-Agent-Key` header.
```bash
curl -H "X-Agent-Key: YOUR_SECRET_KEY" https://your-url.com/tools
```

## 3. Tool Reference 🛠️
Suwappu exposes the following core tools for agents:

### `get_portfolio`
Check user balances before trading.
- **Endpoint**: `GET /users/{user_id}/portfolio`

### `get_wallets`
Find deposit or swap target addresses.
- **Endpoint**: `GET /users/{user_id}/wallets`

### `execute_command` (Easy Mode ⚡)
The most direct way to use Suwappu. Send a raw trading string and get a result.
- **Endpoint**: `POST /v1/agent/execute`
- **Body**:
```json
{
  "text": "swap 0.5 eth to usdc on base",
  "user_id": 1
}
```

### `provision_wallet`
Create a new wallet for a user programmatically.
- **Endpoint**: `POST /v1/agent/wallets`
- **Body**:
```json
{
  "user_id": 1,
  "chain_type": "evm",
  "name": "Trading Agent Wallet"
}
```

## 4. MCP Server & SDK 🔌
While we provide a REST-first interface for maximum stability, you can bridge Suwappu into **Claude Desktop** or **Cursor** by pointing your MCP client to our `/tools` metadata.
