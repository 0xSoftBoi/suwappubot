# Product Hunt launch draft: "Swap from Claude"

These fields map 1:1 to the Product Hunt MCP `start_launch` / `update_launch` fields. The draft
stays private until it is submitted. **Do not submit** until the pre-launch checklist below is
green.

## Pre-launch checklist (must all be true)

- [ ] `claude/vigilant-brown-lwnde0` deployed to prod (keyless `get_quote`/`get_prices`,
      `sign_url`, repaired app.suwappu.bot links): api-ts, python-api, terminal, showcase.
- [ ] One real swap completed end to end: Claude → `get_quote` → `sign_url` → terminal →
      wallet signature → confirmed tx. Record the tx hash and the screen capture.
- [ ] `@suwappu/mcp-server` 0.6.0 published (npm currently serves 0.1.1).
- [ ] `ref=producthunt` attribution survives from link to swap record.
- [ ] 30–50 people lined up to try it in the first hours. Ask for feedback, never upvotes.

## Launch fields

| Field | Value |
|---|---|
| url | `https://www.suwappu.bot/?ref=producthunt` |
| name | Suwappu |
| tagline | Ask your AI to trade. Sign in your own wallet. |
| pricingType | `free` |
| productTwitterHandle | `suwappubot` |
| mcpServerUrls | `https://api.suwappu.bot/mcp` |
| soloMaker | true |
| teamSize | `TEAM_1_10` |
| bootstrapped | true |
| openSource | true (Apache-2.0) |
| categories / topics | AI Agents (primary), Crypto tools, Developer tools. Resolve IDs via `get_launch_context` |
| additionalLinks | `https://github.com/0xSoftBoi/suwappubot`, `https://terminal.suwappu.bot` |
| videoUrl | TODO: 60-second demo (script below) |
| launchDate | TODO: pick after the checklist is green; check availability with `get_launch_context` |

### Tagline alternates (≤60 chars)

1. Ask your AI to trade. Sign in your own wallet.
2. Swap any token from Claude, across 7+ chains
3. The non-custodial swap tool for AI assistants

### Description (≤260 chars recommended)

> Suwappu lets Claude and any MCP client quote token swaps across 7+ chains with no API key.
> Every quote comes with a one-tap link that opens a pre-filled swap. You review it and sign in
> your own wallet. Your keys never leave you.

### Maker first comment (`commentBody`, HTML)

```html
<p>Hey Product Hunt 👋</p>
<p>AI assistants can now research anything, but the moment you want to <em>act</em> on chain you're back to copy-pasting addresses into a DEX. I built Suwappu so the assistant can do the boring part and you keep control of the money.</p>
<p><strong>How it works</strong></p>
<ul>
<li>Add the Suwappu MCP server to Claude (or any MCP client). Quotes and prices need no API key.</li>
<li>Ask: "swap $20 of ETH to USDC on Base".</li>
<li>You get a quote plus a link that opens the swap already filled in.</li>
<li>You review it and sign in your own wallet. Nothing executes without your signature.</li>
</ul>
<p><strong>Install:</strong> <code>npx @suwappu/mcp-server</code> or point your client at <code>https://api.suwappu.bot/mcp</code></p>
<p>It's a solo project and fully open source. I'd love blunt feedback, especially on what you'd want your AI to be able to do with your wallet, and what it should never be allowed to do.</p>
```

## 60-second demo script

1. **0–5s:** Claude open, with the text "Your AI can't touch your wallet. Until you say so."
2. **5–20s:** type "swap $20 of ETH to USDC on Base", then Claude calls `get_quote`. Show the
   quote and the route.
3. **20–35s:** click `sign_url`. The terminal opens pre-filled with "Nothing is submitted until
   you tap".
4. **35–50s:** wallet popup, sign, then the tx confirmed. Show the explorer link.
5. **50–60s:** "Non-custodial. 7+ chains. No API key. suwappu.bot", plus the install command.

## X announcement thread (post 7 days before, and again on launch day)

1. Your AI can research a token in seconds, then you copy-paste into a DEX like it's 2021.
   Fixed that. Suwappu launches on Product Hunt on {DATE}. 🧵
2. Ask Claude to swap. It quotes across 7+ chains (no API key) and hands you a one-tap,
   pre-filled swap. You sign in your own wallet. Your keys never leave you.
3. It's open source and built solo. Try it on launch day and tell me what breaks: {PH_LINK}

## Gallery images (1270×760)

1. Hero: chat bubble "swap $20 ETH → USDC on Base", then a wallet signature.
2. "No API key": the MCP config snippet.
3. "You sign, always": the terminal pre-fill screen.
4. "7+ chains": a chain logo grid.
5. "Open source": the GitHub repo card.

## Measuring success

The primary metric is swaps tagged `ref=producthunt` in the first 72h. Points and rank are
secondary.

Benchmarks from the Product Hunt web3 category (last 6 months, live data 2026-11-21):

| Launch | Points | Daily rank |
|---|---|---|
| Robinhood Agentic Trading | 157 | #7 |
| Orus | 117 | #10 |
| Nina by Antalpha | 111 | #10 |
| SODAX SDK | 116 | #14 |
| Plain DEX launches | ~65 | #25 or lower |

**Target:** top 10 and ≥25 attributed swaps.
