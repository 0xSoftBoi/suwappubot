# Publishing the Suwappu OpenClaw skill + MCP server

Three distribution surfaces. Verify each listing after submission; directory ingestion and review policies change independently.

## 1. MCP Registry

`server.json` in this folder is the registry manifest (`bot.suwappu/mcp`). It is intentionally remote-only while npm still serves `@suwappu/mcp-server@0.1.1`; add the source `0.6.0` stdio bridge only after that exact version has been published and verified.

```bash
# install the publisher (Go binary from github.com/modelcontextprotocol/registry — NOT the npm pkg)
brew install mcp-publisher     # or download from the registry repo's Releases

# prove ownership of the bot.suwappu namespace, then publish.
# The DNS TXT record + private key are pre-generated in ./registry-claim/ —
# see registry-claim/NAMESPACE_CLAIM.md for the exact record and commands.
mcp-publisher login dns --domain suwappu.bot --private-key "$(cat registry-claim/.private-key)"
mcp-publisher publish ./server.json
```

After publishing, query the official registry and verify the remote URL/auth metadata. Other MCP directories may crawl the registry, but treat each directory as a separate distribution surface and verify its resulting listing rather than assuming propagation.

Optionally add discovery endpoints on the API host:
- `GET /.well-known/mcp.json` (SEP-1960)
- `GET /.well-known/mcp/server-card.json` (SEP-1649)

## 2. ClawHub skill (OpenClaw's own marketplace, Finance category)

Keep the `requires.env` list exactly matching the code's environment-variable references and follow ClawHub's current review/verification requirements at submission time.

```bash
# route the FIRST submission through community-vetted repos to clear the trust bar:
#   - PR to BankrBot/openclaw-skills      (SKILL.md + catalog.json + working example)
#   - PR to VoltAgent/awesome-openclaw-skills  (after the ClawHub listing exists)
clawhub skill publish ./ --slug suwappu-dex --tags dex,defi,swaps,cross-chain,finance
```

## 3. Awesome-list PRs (free, high-trust backlinks)

- `TensorBlock/awesome-mcp-servers` → `docs/finance--crypto.md` (alongside LI.FI, Jupiter, 1inch, Relay)
- `VoltAgent/awesome-openclaw-skills` → `categories/finance.md`

## Validation before each publish

Do not reuse an old tool count, quote, or venue result as current proof. Exercise the documented connection against the live endpoint, call `tools/list`, verify the public/authenticated boundary, and run a non-custodial quote/simulation smoke test. Record the date and exact revision in the release notes; keep `tools/list` as the runtime catalog source of truth.
