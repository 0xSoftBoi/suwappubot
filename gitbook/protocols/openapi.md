# OpenAPI Spec

Suwappu publishes several machine-readable discovery files so agents can learn the API without reading docs: an OpenAPI 3.1 specification, an `llms.txt` summary, an A2A agent card, and an OpenAI-style plugin manifest. Point an LLM or agent at any of these and it can start swapping tokens immediately.

## Discovery Endpoints

All discovery files are public — no authentication required.

| File | Endpoint | Purpose |
|------|----------|---------|
| OpenAPI 3.1 spec | `GET https://api.suwappu.bot/v1/agent/openapi` | Full endpoint schema for client/code generation |
| llms.txt | `GET https://api.suwappu.bot/llms.txt` | Plain-text API summary LLMs can read directly |
| Agent card | `GET https://api.suwappu.bot/.well-known/agent.json` | A2A-compatible agent descriptor |
| Agent card (alt) | `GET https://api.suwappu.bot/.well-known/agent-card.json` | Same card, alternate well-known path |
| Agent card (root) | `GET https://api.suwappu.bot/agent-card.json` | Same card at the root path |
| Plugin manifest | `GET https://api.suwappu.bot/ai-plugin.json` | OpenAI-style plugin manifest |

## OpenAPI Specification

The full OpenAPI 3.1 document describes every REST endpoint, its parameters, request bodies, and response shapes. Fetch it at:

```bash
curl https://api.suwappu.bot/v1/agent/openapi
```

Use it to generate a typed client in any language, or to feed an agent a complete map of the REST surface. The spec is also referenced from the agent card's `openApiUrl` field.

### Generating a Client

Any OpenAPI-compatible generator works. For example, with `openapi-typescript`:

```bash
npx openapi-typescript https://api.suwappu.bot/v1/agent/openapi -o suwappu.d.ts
```

## llms.txt

`llms.txt` is a concise, human- and LLM-readable summary of the API: base URL, auth, the quick-start flow, and a categorized endpoint list. It is the fastest way for an LLM to understand Suwappu.

```bash
curl https://api.suwappu.bot/llms.txt
```

It documents the public endpoints (`/register`, `/chains`, `/openapi`), the authenticated endpoints (`/quote`, `/swap`, `/swap/execute`, `/portfolio`, `/wallets`, `/execute`, `/webhooks`, ...), and the three protocols (REST, MCP, A2A) with their base URLs.

## Agent Card

The agent card is an A2A-compatible JSON descriptor served at three paths (`/.well-known/agent.json`, `/.well-known/agent-card.json`, and `/agent-card.json`). It advertises the agent's name, description, skills, supported chains, authentication scheme, and protocol interfaces.

```bash
curl https://api.suwappu.bot/.well-known/agent.json
```

See [A2A Agent Card](agent-card.md) for the full field reference.

## Plugin Manifest

`ai-plugin.json` is an OpenAI-style plugin manifest with a model-facing description, Bearer auth declaration, and a pointer to the OpenAPI spec:

```bash
curl https://api.suwappu.bot/ai-plugin.json
```

## Discovery Flow for Agents

A well-behaved agent bootstraps from these files in order:

1. **Fetch the agent card** at `/.well-known/agent.json` to learn the agent's identity, skills, and interfaces.
2. **Read `securitySchemes`** to learn how to authenticate, then register at `POST /v1/agent/register` for a Bearer token.
3. **Fetch the OpenAPI spec** (or `llms.txt`) from the card's `openApiUrl` to learn the REST surface.
4. **Call the API** over REST, MCP, or A2A using the obtained token.

No hardcoded knowledge of Suwappu is required — every integration point is self-describing.
