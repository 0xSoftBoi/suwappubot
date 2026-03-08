# A2A Agent Card

The agent card is a machine-readable JSON document that describes Suwappu's capabilities, endpoints, authentication requirements, and skills. It follows the A2A (Agent-to-Agent) protocol specification and enables automated agent discovery.

## Endpoint

```
GET https://api.suwappu.bot/.well-known/agent.json
```

No authentication is required to fetch the agent card. It is publicly accessible so that other agents can discover Suwappu without prior credentials.

## Fetching the Agent Card

```bash
curl https://api.suwappu.bot/.well-known/agent.json
```

## Full Agent Card

```json
{
  "$schema": "https://specs.a2aprotocol.ai/agent-card.json",
  "id": "suwappu-dex",
  "name": "Suwappu",
  "description": "Cross-chain DEX for AI agents. Swap tokens across 7 chains via natural language.",
  "version": "0.4.0",
  "url": "https://api.suwappu.bot",
  "logo": "https://suwappu.bot/logo.png",
  "openApiUrl": "https://api.suwappu.bot/v1/agent/openapi",
  "protocolVersions": ["0.3"],
  "interfaces": [
    {
      "type": "JSON-RPC",
      "baseUrl": "https://api.suwappu.bot/a2a",
      "version": "1.0"
    }
  ],
  "securitySchemes": {
    "bearer": {
      "type": "http",
      "scheme": "bearer",
      "description": "Register at POST /v1/agent/register to get an API key (suwappu_sk_...)"
    }
  },
  "authentication": {
    "schemes": ["bearer"],
    "credentials": null
  },
  "capabilities": {
    "streaming": false,
    "pushNotifications": true,
    "stateTransitionHistory": false
  },
  "defaultInputModes": ["text"],
  "defaultOutputModes": ["text"],
  "skills": [
    {
      "id": "swap",
      "name": "Token Swap",
      "description": "Swap tokens across 7 chains (ETH, BSC, Polygon, Arbitrum, Optimism, Base, Solana)",
      "tags": ["defi", "swap", "trading", "cross-chain"],
      "examples": ["swap 0.5 ETH to USDC on Base", "swap 100 USDC to SOL on Solana"],
      "inputModes": ["text"],
      "outputModes": ["text"]
    },
    {
      "id": "quote",
      "name": "Get Quote",
      "description": "Get a swap quote without executing",
      "tags": ["defi", "quote", "price"],
      "examples": ["quote 1 ETH to USDC", "price of 100 USDC in ETH"],
      "inputModes": ["text"],
      "outputModes": ["text"]
    },
    {
      "id": "portfolio",
      "name": "Portfolio Check",
      "description": "Check token balances across all chains",
      "tags": ["balance", "portfolio", "wallet"],
      "examples": ["check balance", "show portfolio"],
      "inputModes": ["text"],
      "outputModes": ["text"]
    },
    {
      "id": "prices",
      "name": "Token Prices",
      "description": "Get real-time token prices with 24h change",
      "tags": ["defi", "price", "market-data"],
      "examples": ["get ETH price", "check SOL and USDC prices"],
      "inputModes": ["text"],
      "outputModes": ["text"]
    },
    {
      "id": "tokens",
      "name": "Token Discovery",
      "description": "List available tokens per chain for quoting and swapping",
      "tags": ["defi", "tokens", "discovery"],
      "examples": ["list tokens on Base", "search for USD tokens"],
      "inputModes": ["text"],
      "outputModes": ["text"]
    },
    {
      "id": "key-management",
      "name": "API Key Management",
      "description": "Rotate API keys for security",
      "tags": ["security", "keys"],
      "examples": ["rotate my API key"],
      "inputModes": ["text"],
      "outputModes": ["text"]
    },
    {
      "id": "webhook-management",
      "name": "Webhook Management",
      "description": "List webhook delivery events and test webhook endpoints",
      "tags": ["webhooks", "notifications"],
      "examples": ["list webhook events", "test my webhook"],
      "inputModes": ["text"],
      "outputModes": ["text"]
    }
  ],
  "provider": {
    "organization": "Suwappu",
    "url": "https://suwappu.bot"
  },
  "supportedChains": [
    {"id": 1, "name": "Ethereum", "native": "ETH"},
    {"id": 56, "name": "BSC", "native": "BNB"},
    {"id": 137, "name": "Polygon", "native": "MATIC"},
    {"id": 42161, "name": "Arbitrum", "native": "ETH"},
    {"id": 10, "name": "Optimism", "native": "ETH"},
    {"id": 8453, "name": "Base", "native": "ETH"},
    {"id": "solana", "name": "Solana", "native": "SOL"}
  ]
}
```

## Field Reference

### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for this agent. Used by other agents to reference Suwappu in multi-agent systems. |
| `name` | string | Human-readable display name. |
| `description` | string | Brief description of what this agent does. Other agents use this to decide whether Suwappu can help with a given task. |
| `version` | string | Semantic version of the agent. Clients can use this to detect capability changes. |
| `url` | string | Base URL for the agent's API. All protocol endpoints are relative to this URL. |
| `openApiUrl` | string | URL to the OpenAPI 3.1.0 specification. Enables REST API code generation and auto-discovery. |

### interfaces

Describes the communication protocols the agent supports.

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Protocol type. Suwappu uses `"JSON-RPC"` for the A2A protocol. |
| `baseUrl` | string | Full URL for the protocol endpoint (`/a2a`). |
| `version` | string | Protocol version. |

### securitySchemes

A dictionary of named security schemes. Each key is the scheme name (e.g., `"bearer"`).

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Authentication transport (`"http"`). |
| `scheme` | string | Authentication scheme (`"bearer"`). |
| `description` | string | Instructions for obtaining credentials. |

### authentication

Declares which security schemes the agent requires.

| Field | Type | Description |
|-------|------|-------------|
| `schemes` | array | List of scheme names from `securitySchemes` that the agent accepts. |
| `credentials` | null | No default credentials; agents must register to obtain a token. |

### capabilities

Declares what optional features the agent supports.

| Field | Type | Description |
|-------|------|-------------|
| `streaming` | boolean | Whether the agent supports streaming responses. Suwappu does not currently stream. |
| `pushNotifications` | boolean | Whether the agent can send push notifications (e.g., webhooks for task completion). Suwappu supports this. |
| `stateTransitionHistory` | boolean | Whether full task state transition history is retained. Suwappu does not retain transition history. |

### skills

An array of capabilities the agent can perform. Each skill has:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique skill identifier. |
| `name` | string | Human-readable skill name. |
| `description` | string (optional) | What the skill does. |
| `tags` | array (optional) | Categorization tags for discovery and filtering. |
| `examples` | array (optional) | Example natural language messages that trigger this skill. |
| `inputModes` | array | Accepted input types (e.g., `["text"]`). |
| `outputModes` | array | Output types the skill produces (e.g., `["text"]`). |

## How Agents Discover Suwappu

The agent card lives at the well-known path `/.well-known/agent.json`, following the A2A discovery convention. An agent that wants to discover Suwappu follows these steps:

1. **Fetch the agent card** from `https://api.suwappu.bot/.well-known/agent.json`.
2. **Read the description and skills** to determine if Suwappu can handle the task at hand.
3. **Check securitySchemes** to learn how to authenticate (register at `POST /v1/agent/register` to get a Bearer token).
4. **Read interfaces** to find the A2A endpoint URL.
5. **Send messages** to the A2A endpoint using the `message/send` method.

Alternatively, an agent can use the `openApiUrl` to fetch the full OpenAPI spec and integrate via the REST API instead.

## Using the Agent Card for Integration

### Programmatic Discovery (Python)

```python
import requests

# Step 1: Discover the agent
card = requests.get("https://api.suwappu.bot/.well-known/agent.json").json()

print(f"Agent: {card['name']}")
print(f"Description: {card['description']}")
print(f"Skills: {[s['name'] for s in card['skills']]}")

# Step 2: Find the A2A endpoint
a2a_url = card["interfaces"][0]["baseUrl"]

# Step 3: Register for a token
reg = requests.post(f"{card['url']}/v1/agent/register", json={
    "name": "my-agent",
    "description": "My trading agent"
})
token = reg.json()["api_key"]

# Step 4: Send a message via A2A
response = requests.post(a2a_url, json={
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/send",
    "params": {
        "message": {
            "role": "user",
            "parts": [{"type": "text", "text": "price of ETH"}]
        }
    }
}, headers={"Authorization": f"Bearer {token}"})

task = response.json()["result"]["task"]
print(f"Task {task['id']}: {task['status']['state']}")
```

### Multi-Agent Systems

In a multi-agent orchestration system, an orchestrator agent can:

1. Discover multiple agents by fetching their agent cards.
2. Match tasks to agents by reading skill descriptions.
3. Route a "swap ETH to USDC" request to Suwappu based on its `swap` skill.
4. Route other tasks to different agents based on their skills.

The agent card makes this routing automatic --- no hardcoded knowledge of Suwappu is needed.
