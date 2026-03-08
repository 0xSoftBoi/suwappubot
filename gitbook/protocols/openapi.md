# OpenAPI Specification

Suwappu publishes an OpenAPI 3.1.0 specification that describes all REST API endpoints. The spec enables automated code generation, API documentation, and programmatic agent discovery.

## Endpoint

```
GET https://api.suwappu.bot/v1/agent/openapi
```

No authentication is required to fetch the OpenAPI spec.

## Fetching the Spec

```bash
curl https://api.suwappu.bot/v1/agent/openapi
```

To save it to a file:

```bash
curl -o suwappu-openapi.json https://api.suwappu.bot/v1/agent/openapi
```

To pretty-print it:

```bash
curl -s https://api.suwappu.bot/v1/agent/openapi | python3 -m json.tool
```

## What the Spec Contains

The OpenAPI 3.1.0 JSON document describes:

- **Info** --- API name, version, description, and contact details.
- **Servers** --- Base URL (`https://api.suwappu.bot`).
- **Paths** --- All REST API endpoints with request/response schemas, including:
  - `POST /v1/agent/register` --- Agent registration
  - `GET /v1/agent/quote` --- Get a swap quote
  - `POST /v1/agent/swap` --- Execute a swap
  - `GET /v1/agent/portfolio` --- Check wallet portfolio
  - `GET /v1/agent/prices` --- Get token prices
  - `GET /v1/agent/chains` --- List supported chains
  - `GET /v1/agent/tokens` --- List and search tokens
  - `GET /v1/agent/openapi` --- This spec itself
- **Components** --- Reusable schemas for request/response objects.
- **Security** --- Bearer token authentication scheme.

## Using with Code Generation Tools

### openapi-generator

Generate a client library in any supported language:

```bash
# Install openapi-generator
npm install -g @openapitools/openapi-generator-cli

# Generate a Python client
openapi-generator-cli generate \
  -i https://api.suwappu.bot/v1/agent/openapi \
  -g python \
  -o ./suwappu-python-client

# Generate a TypeScript client
openapi-generator-cli generate \
  -i https://api.suwappu.bot/v1/agent/openapi \
  -g typescript-axios \
  -o ./suwappu-ts-client

# Generate a Go client
openapi-generator-cli generate \
  -i https://api.suwappu.bot/v1/agent/openapi \
  -g go \
  -o ./suwappu-go-client
```

### openapi-typescript

Generate TypeScript types from the spec:

```bash
npx openapi-typescript https://api.suwappu.bot/v1/agent/openapi -o suwappu.d.ts
```

### Swagger UI

You can load the spec into Swagger UI for an interactive API explorer:

```bash
docker run -p 8080:8080 \
  -e SWAGGER_JSON_URL=https://api.suwappu.bot/v1/agent/openapi \
  swaggerapi/swagger-ui
```

Then open `http://localhost:8080` in your browser.

## Programmatic Usage

### Auto-Discovery (Python)

An agent can fetch the spec at runtime to discover endpoints and their parameters without any hardcoded knowledge:

```python
import requests

# Fetch the OpenAPI spec
spec = requests.get("https://api.suwappu.bot/v1/agent/openapi").json()

# List all available endpoints
for path, methods in spec["paths"].items():
    for method, details in methods.items():
        print(f"{method.upper()} {path} - {details.get('summary', '')}")

# Get the schema for a specific endpoint
quote_params = spec["paths"]["/v1/agent/quote"]["get"]["parameters"]
for param in quote_params:
    required = "required" if param.get("required") else "optional"
    print(f"  {param['name']} ({required}): {param.get('description', '')}")
```

### Auto-Discovery (JavaScript)

```javascript
const spec = await fetch("https://api.suwappu.bot/v1/agent/openapi").then(r => r.json());

// List all endpoints
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, details] of Object.entries(methods)) {
    console.log(`${method.toUpperCase()} ${path} - ${details.summary || ""}`);
  }
}
```

### Dynamic Client Construction

AI agents can use the OpenAPI spec to dynamically build API calls without pre-built client libraries:

```python
import requests

spec = requests.get("https://api.suwappu.bot/v1/agent/openapi").json()
base_url = spec["servers"][0]["url"]

# Register to get a token
reg = requests.post(f"{base_url}/v1/agent/register", json={
    "name": "auto-agent",
    "description": "Dynamically configured agent"
})
token = reg.json()["api_key"]
headers = {"Authorization": f"Bearer {token}"}

# Use the spec to build a quote request
quote_endpoint = spec["paths"]["/v1/agent/quote"]["get"]
response = requests.get(f"{base_url}/v1/agent/quote", params={
    "from_token": "ETH",
    "to_token": "USDC",
    "amount": "1.0",
    "chain": "base"
}, headers=headers)

print(response.json())
```

## Relationship to Other Protocols

The OpenAPI spec describes the REST API. The same underlying functionality is also available through:

- **A2A Protocol** (`/a2a`) --- Natural language interface over JSON-RPC. See [A2A Protocol](a2a.md).
- **MCP Protocol** (`/mcp`) --- Tool-based interface for LLMs. See [MCP Protocol](mcp.md).

The agent card at `/.well-known/agent.json` includes the `openApiUrl` field pointing to this spec, enabling agents to discover both the A2A and REST interfaces from a single entry point. See [Agent Card](agent-card.md).
