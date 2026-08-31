# WebMCP: the Suwappu Agent Desk

**Live surface:** `/agent-terminal` on the showcase site.
**Code:** `showcase/src/app/agent-terminal/` + `GET /public/swap/preview` in `api-ts`.

Suwappu already speaks to agents over REST, MCP and A2A — all of which need a
key and live outside the browser. The Agent Desk is the fourth door: a page that
hands the routing engine to whatever agent is driving the user's browser via the
W3C Web Model Context API, with no key and no signup.

## The problem

An agent that wants to trade for you today has two bad options: scrape a UI
built for eyes, or take custody through an API key. Both are wrong — one is
brittle, the other hands a language model your money.

The Desk takes neither. The agent gets typed tools over the real engine. The
human keeps the decision and the key. And between them sits the piece that is
usually missing: **a mandate.**

## The mandate

Approving trades one at a time is the thing that makes agentic UX exhausting,
and it scales badly — the tenth "are you sure?" gets clicked without reading.
So the human writes an envelope once:

- per-trade and per-day USD caps
- which chains the agent may touch
- which tokens it may buy
- ceilings on price impact and slippage

The agent can **read** it (`read_mandate`) and **dry-run against it**
(`check_mandate`) silently and for free, so it sizes a trade to fit instead of
showing you things you were always going to refuse. A proposal that breaks the
envelope still appears — in red, with the exact rule, limit and actual value —
but **Approve is disabled in the DOM** until the human resolves it.

### The envelope itself completes

The criticism that kills most agent demos is that nothing ever finishes: the
agent proposes, and then hands you a link. On this desk one thing finishes in
place. `amend_mandate` lets the agent propose a change to the envelope itself —
citing what happened, e.g. two proposals that hit the per-trade cap. The human
sees a **before/after diff with every loosened rule flagged in red**, because an
agent asking for more rope must never be able to phrase it as a tidy-up. Approve
and the mandate really changes, persists, and governs the very next
`check_mandate`.

`compile_mandate_to_policy` then turns that negotiated envelope into
`POST /v1/agent/wallet/policy` payloads — real Turnkey policies that gate
managed execution server-side, where a browser page cannot reach. It reports
honestly what did not survive the compile (a per-trade cap has no direct Turnkey
equivalent; a token allow-list needs addresses, not symbols). You leave with a
rule set, not a session.

### The agent can argue, but it cannot route around you

When something is blocked, the desk registers `request_override` — a tool that
does not otherwise exist. The agent states its case for bending one named rule;
the human sees that argument as its own card and either allows it once or keeps
the rule. This is the interaction the challenge is really about: not a
permission prompt, a negotiation.

### Honest scope

The desk does not execute, so the mandate **cannot physically cap spending** —
a user who ignores the desk and signs in their wallet is outside its reach. It
governs what this page puts in front of you and what the agent is told before it
asks. Binding enforcement lives server-side in Suwappu's wallet spending
policies (`POST /v1/agent/wallet/policy`), which gate managed execution. The
mandate is the browser-side sibling of that idea, not a replacement. The code
says so, and so does `read_mandate`'s own payload.

## Design rules

1. **Read tools answer, write tools ask.** Every tool that costs money is a
   *proposal*. `propose_swap` / `propose_plan` return
   `awaiting_human_approval` (or `blocked_by_mandate_awaiting_human`) and a
   `proposalId`. Nothing else happens.
2. **Plans, not clicks.** `propose_plan` takes up to five ordered steps — bridge,
   buy, set an alert — prices every leg, rolls them into one combined notional,
   and asks for one approval. Agents think in plans; the desk lets them.
3. **The agent waits for a person, not a poll.** `check_approval(proposalId,
   waitSeconds)` blocks up to 120s and resolves the instant the human clicks,
   carrying back any note they typed. Proposals expire after 10 minutes.
4. **Tools appear and disappear with the human's state.** `request_override`
   exists only while something is blocked; `open_signing_handoff` only while an
   approved, unspent proposal is on the desk, and it refuses a replay once
   consumed. An agent cannot reach for a tool the human has not unlocked.
5. **This page never holds a key.** The handoff opens Terminal
   (`/alert-swap`, which prefills the ticket and still requires a human tap) or
   the Telegram bot with a copy-ready `/s` command. A plan hands off one link
   per leg, in order.
6. **Everything is on the record.** Each tool call streams into an on-page
   activity log, and `export_receipt` (or the Download receipt button) emits the
   whole session: every rationale, mandate verdict, override argument, human
   decision and note.
7. **The page works without WebMCP.** Every tool has a human control.
8. **Both halves of the spec.** Alongside the imperative tools, the ticket
   itself is a *declarative* WebMCP tool: the real `<form>` carries
   `toolname="fill_and_price_ticket"` / `tooldescription`, every field a
   `name` + `toolparamdescription`, and submit answers the engine through
   `SubmitEvent.respondWith()` with the priced ticket. Deliberately **no
   `toolautosubmit`** — an engine can fill the form, but pricing still goes
   through the same submit a human uses. In a browser without WebMCP the
   attributes are inert and the form is just the form.

## How an agent finds the desk

Agent traffic is a first-class visitor here, so the desk is discoverable, not
just callable. It is listed alongside Suwappu's other agent surfaces in the
ARD manifest at `GET https://api.suwappu.bot/.well-known/ai-catalog.json`
(resource type `webmcp-page`) and in `https://suwappu.bot/llms.txt`, next to
the MCP server, A2A card and OpenAPI spec. An agent that lands anywhere in
Suwappu's machine-readable surface learns the desk exists — and the reverse:
`compile_mandate_to_policy` points browser agents at the API, whose pay-per-call
metering runs over HTTP 402 (x402), so a key-less agent has both a policy
envelope and a payment rail waiting for it.

## Untrusted in both directions

The WebMCP trust model cuts both ways and the desk honours both halves.
Agent→page: every piece of agent-written free text (proposal rationales,
override arguments) renders under an explicit "agent-written — unverified"
label, quoted, never interpolated into the page's own voice. Page→agent: tool
descriptions state facts instead of issuing imperatives — the LLM evals caught
`read_mandate`'s "Read this FIRST." overriding user intent, and that class of
instruction-injection-shaped description is now gone.

## Tools

| Tool | Kind | What it does |
| --- | --- | --- |
| `read_mandate` | read | The human's envelope, plus today's remaining budget |
| `amend_mandate` | **completes** | Propose changing the envelope; approval rewrites it in place |
| `compile_mandate_to_policy` | **completes** | Compile the envelope into enforceable wallet-policy payloads |
| `navigate_desk` | read | Move the human's view to a section; report what lives there |
| `check_mandate` | read | Silent dry-run: which rules a trade breaks, with limit vs actual |
| `list_chains` | read | Chains Suwappu can route across |
| `find_token` | read | Resolve a ticker/address to a canonical address + decimals |
| `get_prices` | read | USD spot for major symbols |
| `preview_swap` | read | Price a swap, render it, attach the mandate verdict |
| `compare_routes` | read | The same swap as RECOMMENDED / FASTEST / CHEAPEST / SAFEST |
| `read_desk` | read | Ticket, quote, mandate headroom, proposals, activity |
| `propose_swap` | propose | One trade + rationale in front of the human |
| `propose_plan` | propose | An ordered multi-step plan as one approval |
| `propose_price_alert` | propose | An alert to arm in the bot |
| `check_approval` | read | Block on / poll the human's decision, with their note |
| `request_override` | unlocked | Only while blocked: argue for bending one rule |
| `open_signing_handoff` | unlocked | Only after approval: the signing links |
| `export_receipt` | read | The full audit trail, optionally as a download |

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
bun run dev            # serve the desk on :4321
bun run webmcp:smoke   # 47 assertions against a modelContext polyfill
```

`scripts/webmcp-smoke.mjs` installs a spec-shaped `document.modelContext` and
drives the real page through **47 assertions**, among them: that the ticket
form is a declarative WebMCP tool (named, described, six described parameters,
no `toolautosubmit`) and that submitting it prices for real; that a
mandate-breaking proposal reports itself blocked **and** its Approve button is
`disabled` in the DOM; that `request_override` does not exist until then; that a
blocked `check_approval` resolves on the human's actual click with their note
intact; that the handoff appears only after approval and retires once spent;
that a plan's headroom already reflects the earlier approval; that an amendment
**flags itself as loosening a rule**, leaves the mandate untouched while pending,
and on approval actually rewrites it so the new envelope governs the next check;
that the compiled policy bundle names its endpoint and states it holds no key;
and that the receipt preserves every rationale, breach and override argument.

## Evals: measuring whether an agent can actually use this

Claiming good tool design is cheap. The Chrome team ships
[`webmcp-evals`](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-evals),
an official harness that puts a real LLM in front of a tool schema and checks
that a natural-language request produces the *right tool call with the right
arguments*. We wrote a suite for it.

- `showcase/webmcp/tools.schema.json` — the 16 static tool schemas, **exported
  from the live page** by `bun run webmcp:schemas`, never hand-written, so the
  eval target cannot drift from what an agent really sees.
- `showcase/webmcp/evals.json` — 15 cases in Google's format, written as things
  a person would actually say ("What am I actually letting you do here?",
  "Don't put it in front of me yet, just check").

Two of those cases are the ones that matter, because they test *restraint*
rather than capability:

| Case | What it proves |
| --- | --- |
| "Would swapping 2 ETH fit my rules? Don't put it in front of me yet, just check." | The agent reaches for `check_mandate`, not `propose_swap` — it dry-runs silently instead of spending the human's attention. |
| "Give me the whole thing as one approval, not two." | The agent reaches for `propose_plan` rather than firing two proposals. |

```bash
bun run webmcp:schemas     # re-export schemas from the live page
bun run webmcp:evals       # deterministic: execute every case for real, no API key
bun run webmcp:evals:llm   # Google's LLM harness (needs OPENAI_API_KEY or GOOGLE_AI)
```

There are now **15 cases across 16 tools**. `webmcp:evals` resolves each case's matcher constraints to concrete arguments
and invokes the tool on the live page, asserting it exists, accepts the shape
and returns without error — currently **15/15 clean**. It means `evals.json`
cannot rot: rename a tool or tighten a schema and CI fails long before an agent
meets it. The LLM half — does the *model* pick the right tool — scores **12/15 (80%)**
on Gemini, and caught a real flaw on its first run: `read_mandate`'s description
opened with "Read this FIRST", and the model obeyed that over the user's actual
request, calling it when someone plainly asked for a price. The imperative is
gone and `preview_swap` went fail → pass. Full breakdown, including the three
remaining misses and why they are recorded as misses rather than explained away,
is in `showcase/webmcp/README.md`.

## Spec notes

The `modelContext` getter moved from `navigator` to `document` in the May 2026
draft and `navigator.modelContext` is deprecated in Chromium 150, so
`getModelContext()` feature-detects both and prefers `document`. Tools are
registered with `{ signal }` so aborting one controller unregisters a whole set
— which is exactly how the two conditional tools come and go. Long-running
`execute` callbacks honour `options.signal`. The API is HTTPS-only.
