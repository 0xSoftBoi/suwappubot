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
  "id": "suwappu-dex",
  "name": "Suwappu",
  "description": "Cross-chain DEX for AI agents. Swap tokens across 7 chains via natural language.",
  "version": "0.4.0",
  "url": "https://api.suwappu.bot",
  "openApiUrl": "https://api.suwappu.bot/v1/agent/openapi",
  "interfaces": [
    {
      "type": "JSON-RPC",
      "baseUrl": "https://api.suwappu.bot/a2a",
      "version": "1.0"
    }
  ],
  "securitySchemes": [
    {
      "type": "http",
      "scheme": "bearer",
      "description": "Register at POST /v1/agent/register"
    }
  ],
  "capabilities": {
    "streaming": false,
    "pushNotifications": true,
    "stateTransitionHistory": false
  },
  "skills": [
    {
      "id": "swap",
      "name": "Token Swap",
      "description": "Swap tokens across 7 chains"
    },
    {
      "id": "quote",
      "name": "Get Quote"
    },
    {
      "id": "portfolio",
      "name": "Portfolio Check"
    },
    {
      "id": "prices",
      "name": "Token Prices"
    },
    {
      "id": "tokens",
      "name": "Token Discovery"
    },
    {
      "id": "key-management",
      "name": "API Key Management"
    },
    {
      "id": "webhook-management",
      "name": "Webhook Management"
    }
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

Describes how to authenticate with the agent.

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Authentication transport (`"http"`). |
| `scheme` | string | Authentication scheme (`"bearer"`). |
| `description` | string | Instructions for obtaining credentials. |

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
