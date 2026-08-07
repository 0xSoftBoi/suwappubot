# OpenClaw Integration

OpenClaw can consume MCP servers directly, so the clean Suwappu integration is the hosted MCP endpoint rather than a second tool wrapper.

## Quick start

```bash
# 1. Register an agent key
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" -d '{"name":"my-openclaw"}'
export SUWAPPU_API_KEY=suwappu_sk_...

# 2. Add the hosted MCP server. Keep unsigned transaction preparation out of
# the default research agent unless the product explicitly needs it.
openclaw mcp add suwappu \
  --url https://api.suwappu.bot/mcp \
  --transport streamable-http \
  --header "Authorization=Bearer $SUWAPPU_API_KEY" \
  --exclude execute_swap

# 3. Discover the live catalog
openclaw mcp probe suwappu
```

Do not copy a chain count, token list, quote output, or venue into your integration as a constant. Use `list_chains`, `list_tokens`, `tools/list`, and live quote results as the runtime source of truth.

## Capability map

The hosted catalog currently covers these product areas:

| Area | Examples | Capability boundary |
|------|----------|---------------------|
| Discovery/data | `list_chains`, `list_tokens`, `get_prices`, `get_portfolio` | Read |
| Quotes/simulation | `get_quote`, `simulate_swap` | Read / dry-run |
| Transaction preparation | `execute_swap` | Returns unsigned self-custody transaction data; never signs or broadcasts |
| Predictions | `predict_markets`, `predict_market`, `predict_book`, `predict_price`, `predict_trades` | Read |
| Perps | `perps_markets`, `perps_quote`, `perps_positions` | Market/position research; no Agent API open/close method |
| Lending | `lend_markets`, `lend_market` | Read-only market research |
| Managed-swap observability | `get_swap_status`, `get_swap_history` | Reads records created by the separate REST managed-execution path |

Call `tools/list` for exact names, input schemas, annotations, and the current catalog rather than maintaining this table as a registry in your app.

## Approval-first transaction preparation

The MCP tool name `execute_swap` is historical: it does **not** execute a managed swap. If you expose it to an OpenClaw agent, use an explicit workflow:

1. `get_quote` — display amount, route, expiry, minimum output, and costs.
2. `simulate_swap` — dry-run the exact intent and surface warnings.
3. Require an application/user approval for that exact quote and wallet.
4. `execute_swap` — prepare the unsigned transaction.
5. Stop. A separate wallet/review flow owns signing and broadcasting.

Managed server-side execution is a different REST capability: `POST /v1/agent/swap/execute`. Do not grant it implicitly because an agent has MCP access.

Example local allowlists:

```jsonc
{
  "agents": {
    "research": {
      "mcp": {
        "suwappu": {
          "include": ["get_quote", "get_prices", "get_portfolio", "simulate_swap"]
        }
      }
    },
    "prepare": {
      "mcp": {
        "suwappu": {
          "include": ["get_quote", "simulate_swap", "execute_swap"]
        }
      }
    }
  }
}
```

Treat discovered MCP annotations as descriptions, not authorization. Your application-owned allowlist and approval state should remain the permission boundary.

## Distribution status

Prefer the hosted endpoint. Repository source `@suwappu/mcp-server` `0.6.0` is a thin stdio bridge for clients that require a local process, but npm still reports `0.1.1` as of 2026-08-07. The official-registry manifest is therefore remote-only until the forwarding bridge is actually published.

Before publishing a directory/marketplace update, probe the live endpoint, verify public vs authenticated calls, and run a non-custodial quote/simulation smoke test. Do not use an old price quote or old tool count as release evidence.

See `packages/openclaw/PUBLISHING.md` for the registry/distribution checklist.
