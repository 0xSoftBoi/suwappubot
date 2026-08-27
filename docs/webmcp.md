# WebMCP: the Suwappu Agent Desk

**Live surface:** `/agent-terminal` on the showcase site.
**Code:** `showcase/src/app/agent-terminal/` + `GET /public/swap/preview` in `api-ts`.

Suwappu already speaks to agents over REST, MCP and A2A — all of which require a
key and live outside the browser. The Agent Desk is the fourth door: a page that
hands the routing engine to whatever agent is driving the user's browser, using
the W3C Web Model Context API, with no key and no signup.

## The problem it solves

An agent that wants to trade for you today has two bad options: scrape a UI built
for eyes, or be handed custody through an API key. The Desk takes neither. The
agent gets *typed tools* over the same engine the product runs on, and the human
keeps the two things that matter — the decision and the key.

## Design rules

1. **Read tools answer, write tools ask.** Every tool that costs money is a
   *proposal*, not an action. `propose_swap` renders a card with the priced trade
   and the agent's written rationale; it returns `awaiting_human_approval` and a
   `proposalId`. Nothing else happens.
2. **The agent waits for a person, not a poll.** `check_approval(proposalId,
   waitSeconds)` blocks up to 120s and resolves the instant the human clicks
   Approve or Reject, carrying back any note they typed. Proposals expire after
   10 minutes so an agent is never stuck.
3. **Approval unlocks a tool that did not exist.** `open_signing_handoff` is
   registered dynamically, only while an approved and unspent swap proposal is on
   the desk, and unregistered the moment it is consumed. An agent cannot reach
   for it speculatively — it is absent from the page's tool list.
4. **This page never holds a key.** The handoff opens Terminal
   (`/alert-swap`, which prefills the ticket and still requires the human to tap
   Buy/Sell) or the Telegram bot with a copy-ready `/s` command. No signing code
   ships to this page.
5. **Everything the agent does is visible.** Each tool call and result is
   appended to an on-page activity log, next to the ticket the agent is editing.
6. **The page works without WebMCP.** Every tool has a human control. In a
   browser with no `modelContext` the desk says so and stays fully usable.

## Tools

| Tool | Kind | What it does |
| --- | --- | --- |
| `list_chains` | read | Chains Suwappu can route across, with the keys other tools accept |
| `find_token` | read | Resolve a ticker/address on a chain to a canonical address + decimals |
| `get_prices` | read | USD spot for major symbols |
| `preview_swap` | read | Price a same-chain or cross-chain swap and render it on the desk |
| `compare_routes` | read | The same swap priced RECOMMENDED / FASTEST / CHEAPEST / SAFEST |
| `read_desk` | read | Ticket, live quote, all proposals and their state, recent activity |
| `propose_swap` | propose | Put a priced trade + rationale in front of the human |
| `propose_price_alert` | propose | Propose an alert to arm in the bot |
| `check_approval` | read | Block on / poll the human's decision, with their note |
| `open_signing_handoff` | unlocked | Only exists after approval; returns the signing links |

## API

`GET /public/swap/preview` (`api-ts/src/routes/publicSwap.ts`) is the only new
endpoint. It is unauthenticated and IP rate-limited, and deliberately **not
executable**: the quote is never written to the quote cache and no
`transactionRequest` is returned, so a preview id cannot be fed to
`POST /public/swap/execute`. Pricing uses a placeholder receiver unless the
caller names one.

## Verifying it

```bash
cd showcase
bun run dev                              # serve the desk
bun run webmcp:smoke                     # drive the tools with a modelContext polyfill
```

`scripts/webmcp-smoke.mjs` installs a spec-shaped `document.modelContext`, then
runs the whole loop: register → `preview_swap` → `propose_swap` → assert the
handoff tool is *absent* → click Approve in the real UI → assert the blocked
`check_approval` resolves with the human's note → assert the handoff tool
appeared → consume it → assert a replay is refused.

## Spec notes

The `modelContext` getter moved from `navigator` to `document` in the May 2026
draft and `navigator.modelContext` is deprecated in Chromium 150, so
`getModelContext()` feature-detects both and prefers `document`. Tools are
registered with `{ signal }` so aborting one controller unregisters the whole
set. The API is HTTPS-only.
