# Harness lessons (bounded, evolved)

Behavioral rules learned from real sessions, maintained by `/reflect` and
`/evolve`. Hard cap: **25 lessons** (enforced by `scripts/harness/harness_lint.py`).
When full, merge related lessons or evict the least-cited one — never just append.

Format per lesson: `### <imperative title>` + 1-3 lines: the rule, the evidence
(session date or journal bucket), and where it was promoted from.
A lesson that keeps being re-edited (3+ times in `git log -- .claude/harness/lessons.md`)
is NOT being absorbed — promote it into CLAUDE.md, a hook, or a skill instead.

## Rules

### Verify the bot boots after deploy, not just CI
CI does not exercise `bot/main.py`'s import chain. Use `python3 scripts/status.py`
and grep Railway logs for ImportError. (Seeded from CLAUDE.md standing rule 1.)

### Never batch audit findings for end-of-session output
Spend limits killed multiple audits that buffered JSON for the end. Stream
findings to disk as confirmed. (Seeded from CLAUDE.md Security Audits.)

### Long commands get explicit 600000ms timeouts
Bash tool caps ~2min by default; slow suites are normal, not hung.
(Seeded from CLAUDE.md CI/Testing.)

### Marketing surfaces exist to surface capabilities, never hide them
User vetoed a minimal-hero home replica: the standing goal is highlighting the
hidden platform (execution, PM, routing, research). Reference sites set the
quality bar, not the content bar. (Session 2026-08-24.)

### Frontend "done" means funnels clicked end-to-end
Build green + screenshot is not done: click/curl every link and CTA (booking,
contracts, docs, live-data endpoints) and confirm real destinations, no mocks.
(Session 2026-08-24 — user correction after a shipped-but-unclicked page.)

### Resume subagents that stop mid-pass instead of respawning
Background agents repeatedly stop before delivering their final report; a
SendMessage to the same agent id continues them with context intact.
(Session 2026-08-24 — 4 of 6 agents needed a resume.)

## Facts (environment memory)

### api.suwappu.bot serves api-ts, not the Python bot
The Python bot's prod health check is its railway.app host. (Seeded from CLAUDE.md.)

### Hero live quote dies when the demo agent runs out of credits
Upstream 402 insufficient_credits → showcase /api/quote 502 → Cloudflare HTML
masks the JSON. Check demo-agent credits before debugging the widget; topping
up is a billing action needing user sign-off. (Diagnosed 2026-08-24.)
