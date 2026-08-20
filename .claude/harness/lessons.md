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

## Facts (environment memory)

### api.suwappu.bot serves api-ts, not the Python bot
The Python bot's prod health check is its railway.app host. (Seeded from CLAUDE.md.)
