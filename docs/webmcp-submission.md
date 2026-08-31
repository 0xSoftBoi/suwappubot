# WebMCP Challenge — Devpost submission brief

Judge-aware pitch for the Suwappu Agent Desk (`/agent-terminal`). Structured on
the four official criteria; judge research and citations in
`docs/webmcp-judges.md`. Deadline: **Sept 3, 2026, 1:00pm PDT** at
https://webmcp.devpost.com/.

## One-liner

**Give your agent a mandate, not your keys.** A cross-chain trading desk that
hands the agent driving your browser typed tools over a real routing engine —
bounded by a spending envelope you write, that the agent can read, dry-run
against, and even argue with, while approval and signing stay human.

## Elevator pitch (~200 words, Devpost "story" opener)

An agent that wants to trade for you today has two bad options: scrape a UI
built for eyes, or take custody through an API key. One is brittle; the other
hands a language model your money. The Agent Desk takes neither. Via WebMCP,
the agent gets 19 typed tools over Suwappu's live cross-chain routing engine —
no key, no signup, in the session you're already in. Between agent and engine
sits the piece that's usually missing: a **mandate**. You write the envelope
once — per-trade/per-day USD caps, allowed chains and tokens, impact ceilings.
The agent reads it and dry-runs against it silently, so it sizes trades to fit
instead of spending your attention on things you'd refuse. Everything that
costs money is a proposal; Approve is physically disabled in the DOM when a
proposal breaks your rules. The agent can argue — `request_override` exists
only while something is blocked — but it cannot route around you. And the
envelope itself completes: approve an amendment and it rewrites in place;
compile it and you leave with real server-side wallet-policy payloads. Every
rationale, breach, argument, and decision exports as a receipt.

## Criterion 1 — WebMCP Leverage

- **Both halves of the API.** 16 static + 2 dynamically registered imperative
  tools on `document.modelContext` (feature-detecting the May 2026 `document`
  draft over deprecated `navigator.modelContext`) — plus the *declarative*
  half: the real ticket `<form>` is itself a WebMCP tool
  (`toolname`/`tooldescription`/`toolparamdescription`, answering the engine
  via `SubmitEvent.respondWith()`, deliberately without `toolautosubmit` so
  submit stays an explicit act).
- Registration with `{ signal }`: conditional tools (`request_override`,
  `open_signing_handoff`) appear/disappear with the human's state by aborting
  controllers — `toolchange` fires, proven against Google's reference polyfill
  (`webmcp:spec`, 11/11).
- Long-running `execute` honours `options.signal`; `check_approval` blocks up
  to 120s and resolves on the human's actual click.
- Nahas's taxonomy end-to-end: read tools answer; `navigate_desk` is the
  page's system prompt; write tools only propose.
- Eval-driven tool descriptions: Google's `webmcp-evals` LLM harness runs
  against schemas **exported from the live page** — it caught a real
  description bug ("Read this FIRST" outranking user intent) that we fixed and
  documented.

## Criterion 2 — Execution

- Real product surface (Suwappu's live showcase, Next.js), real pricing via a
  new deliberately non-executable public endpoint — not a mock.
- Three independent verification layers, all green: 47 behavioural assertions
  (`webmcp:smoke`), 11 spec-conformance checks against Google's own polyfill
  (`webmcp:spec`), 15/15 deterministic eval executions + 12/15 (80%) on the
  official LLM harness — misses reported honestly, not explained away.
- The page fully works without WebMCP: every tool has a human control.
  Progressive enhancement, not an agent-only backdoor.

## Criterion 3 — Potential Impact

- The problem is specific and real: agentic commerce currently means scraping
  or custody. Structured, session-scoped tool access with human-held signing
  is the missing third path — for DeFi here, but the mandate pattern
  (read → dry-run → propose → argue → approve → compile) generalises to any
  consequential-action domain.
- The envelope compiles to **enforcement that actually binds**: real Turnkey
  wallet-policy payloads for Suwappu's API — honest about what didn't survive
  the compile. Browser UX and server-side enforcement meet.
- Agent-native economics: the API the mandate compiles toward meters
  pay-per-call over HTTP 402 (x402) — discoverable, callable, **payable**.
- Discoverable: listed in Suwappu's ARD manifest
  (`/.well-known/ai-catalog.json`) and `llms.txt` beside its MCP server, A2A
  card, and OpenAPI spec.

## Criterion 4 — Creativity & Ambition

- The novel object is the **mandate as a negotiated, living contract**: agents
  don't just obey rules — they dry-run against them, argue for one-time
  overrides as a first-class interaction, and propose amendments the human
  approves as a red-flagged before/after diff. Not a permission prompt — a
  negotiation.
- Untrusted in both directions: agent-written text is labeled
  "agent-written — unverified" wherever it renders; tool descriptions state
  facts, never imperatives (the eval that caught our own injection-shaped
  description is part of the submission).
- Everything on the record: `export_receipt` emits the full session — every
  rationale, verdict, argument, decision, and note.
- This *had* to be WebMCP: the human-in-the-loop contract lives in DOM state
  (a disabled Approve button an agent cannot click around), session-scoped,
  key-free — none of which a backend MCP server can offer.
- **Grounded, not vibes**: the design answers named literature — approval
  fatigue is measured (Akhawe & Felt, USENIX Sec 2013; Anderson et al., CHI
  2015: habituation by the *second* exposure), pure yes/no gatekeeping
  degrades engagement (Faas et al., CHI 2026), the negotiation pattern is
  mixed-initiative interaction (Horvitz, CHI 1999), the untrusted-both-ways
  rule is the indirect-prompt-injection defense literature (Greshake,
  arXiv:2302.12173; Spotlighting, arXiv:2403.14720), and mandate-to-policy
  parallels authenticated delegation (South et al., arXiv:2501.09674). No
  peer-reviewed paper yet names WebMCP itself — this desk is ahead of the
  literature on the protocol. Full bibliography: `docs/webmcp-papers.md`.

## Demo video beats (≤3 min)

1. Human writes the mandate (10s). 2. Agent previews + `check_mandate`
silently, sizes to fit (20s). 3. In-envelope proposal → approve → signing
handoff appears, then retires once spent (30s). 4. Over-cap proposal lands
red, Approve disabled → `request_override` appears → "allow once" (40s).
5. Agent cites two blocked trades, proposes `amend_mandate` → red-flagged
diff → approve → next check governed by new envelope (40s). 6. Compile to
wallet policies + download receipt (20s). Close on the three test suites
running green (10s).

## Pre-submission checklist

- [ ] Live URL verified in ChatGPT Atlas (native WebMCP) — currently proven
      against Google's polyfill; Atlas run is the remaining gap.
- [ ] `bun run webmcp:smoke && webmcp:spec && webmcp:evals` green on the
      deployed URL, not just localhost.
- [ ] Video shows the DOM-disabled Approve (the anti-"route around" proof).
- [ ] Devpost text names the eval-caught description bug — honest measurement
      is a differentiator for this panel.
- [ ] Fresh `webmcp:schemas` export committed (schemas cannot drift).
- [ ] `webmcp:evals:llm` re-scored with a GOOGLE_AI key after the description
      fixes — 12/15 is the last measured number and must not be quoted for the
      current schemas until re-run.
- [ ] Demo video shows the declarative half too: the agent filling the ticket
      form and the human pressing Price it.
- [ ] Re-verify every literal count in the docs (47 assertions, 16 static /
      18 imperative / 19 total tools) against the suites and `TOOLS` before
      submitting — these numbers are hand-written and rot silently.
