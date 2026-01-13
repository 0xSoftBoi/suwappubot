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

### `execute_swap` (WhatsApp Path)
Submit a natural language trading command.
- **Endpoint**: `POST /webhook`
- **Body**: WhatsApp formatted message payload.

### `execute_swap` (Direct Path - TBD)
Coming soon: Direct JSON-structured swap execution.

## 4. MCP Server Note 🔌
While we provide a REST-first interface for maximum stability, you can bridge Suwappu into **Claude Desktop** or **Cursor** by pointing your MCP client to our `/tools` metadata.
