# Publishing the Suwappu OpenClaw skill + MCP server

Three distribution surfaces. Do them in order; each is low effort and compounds discoverability.

## 1. MCP Registry (auto-propagates to Smithery / Glama / PulseMCP)

`server.json` in this folder is the registry manifest (`bot.suwappu/mcp-server`).

```bash
# install the publisher CLI
npm i -g @modelcontextprotocol/publisher    # or: brew install mcp-publisher

# prove ownership of the bot.suwappu namespace (ONE of):
#  a) GitHub: authenticate as an account in a "suwappu" GitHub org, OR
#  b) DNS: add a TXT record on suwappu.bot that the publisher prints
mcp-publisher login            # GitHub OAuth or DNS flow
mcp-publisher publish ./server.json
```

Registering at `registry.modelcontextprotocol.io` means crawlers (Smithery, Glama ~37k servers,
PulseMCP, GitHub MCP Registry, LobeHub) pick it up automatically. **Claim verified-owner listings**
on each to block typosquatters (a real post-"ClawHavoc" risk).

Optionally add discovery endpoints on the API host:
- `GET /.well-known/mcp.json` (SEP-1960)
- `GET /.well-known/mcp/server-card.json` (SEP-1649)

## 2. ClawHub skill (OpenClaw's own marketplace, Finance category)

`SKILL.md` here is ClawHub-ready. **Lead with security signals** (post-ClawHavoc the registry is
strict): publish a VirusTotal "Benign" scan, ensure the publishing GitHub account is a verified
`suwappu` org, and keep the `requires.env` list exactly matching the code's env references.

```bash
# route the FIRST submission through community-vetted repos to clear the trust bar:
#   - PR to BankrBot/openclaw-skills      (SKILL.md + catalog.json + working example)
#   - PR to VoltAgent/awesome-openclaw-skills  (after the ClawHub listing exists)
clawhub skill publish ./ --slug suwappu-dex --tags dex,defi,swaps,cross-chain,finance
```

Fills the verified gap: OpenClaw's finance category has 100+ skills but **no unified cross-chain DEX
aggregator** — single-chain competitors (OKX, Symbiosis) are already listed.

## 3. Awesome-list PRs (free, high-trust backlinks)

- `TensorBlock/awesome-mcp-servers` → `docs/finance--crypto.md` (alongside LI.FI, Jupiter, 1inch, Relay)
- `VoltAgent/awesome-openclaw-skills` → `categories/finance.md`

## Validation (already proven on 2026-06-18)

The `openclaw mcp add` one-liner was validated against the live endpoint: 9 tools loaded, a local
agent successfully called `get_quote` (0.1 ETH → ~172 USDC on Base via OKX). The command in
`SKILL.md` / README is canonical.
