# Claim the `bot.suwappu` MCP-registry namespace (DNS verification)

`server.json` publishes under `bot.suwappu/mcp`. That reverse-DNS namespace must be proven
via a DNS TXT record on `suwappu.bot`. (Tool: the official `mcp-publisher` — a **Go binary** from
`github.com/modelcontextprotocol/registry`, *not* the `mcp-publisher` npm package, which is unrelated.)

## Step 1 — add this DNS TXT record (already generated for you)

| Field | Value |
|-------|-------|
| Host / Name | `suwappu.bot` (apex) |
| Type | `TXT` |
| Value | `v=MCPv1; k=ed25519; p=L4CLfsG/Rh9gYwIXac4Fw/QrLvWv4Rsg4Vxl8VX22s8=` |

The matching private key is in `./.private-key` (hex, **gitignored — keep secret, never commit**).
Verify propagation:

```bash
dig +short TXT suwappu.bot | grep MCPv1
```

## Step 2 — install mcp-publisher

```bash
brew install mcp-publisher                       # macOS/Linux (Homebrew)
# or grab the binary for your OS from:
#   https://github.com/modelcontextprotocol/registry/releases
```

## Step 3 — authenticate with the key and publish

```bash
cd packages/openclaw
mcp-publisher login dns --domain suwappu.bot --private-key "$(cat registry-claim/.private-key)"
mcp-publisher publish ./server.json
```

That registers `bot.suwappu/mcp` at `registry.modelcontextprotocol.io`. Verify the resulting
official-registry entry directly after publishing; treat third-party directory ingestion as a
separate distribution check.

## Alternative — GitHub-org namespace (no DNS)

If you'd rather not touch DNS, publish under `io.github.<org>/mcp-server` instead:
1. Ensure a GitHub org/user owns the name (e.g. `io.github.0xsoftboi/mcp-server`).
2. Change `name` in `server.json` accordingly.
3. `mcp-publisher login github` (OAuth), then `mcp-publisher publish ./server.json`.

DNS is preferred here because `bot.suwappu` matches your brand and the live `api.suwappu.bot` host.

## Security note
The generated `.private-key` controls publishing rights for this namespace. It's gitignored. If it
leaks, rotate: regenerate the keypair (`registry-claim/regenerate.sh`-style openssl flow), update the
DNS TXT to the new public key, and re-login.
