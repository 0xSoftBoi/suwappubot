# How Other Companies Keep Institutional Knowledge (Research, Aug 2026)

Survey of how established engineering orgs and AI-agent-heavy teams persist
knowledge, with recommendations for Suwappu. Sources cited inline; treat
vendor-reported numbers as directional.

## The convergent pattern

Across Google, AWS, Spotify, GitLab, PagerDuty, and 2025-26 agent-first teams,
the same shape recurs: **decisions and operational knowledge live as
version-controlled text next to the code, are cheap to write, and are kept
fresh by process (PR gates, CI checks, owners) — never by goodwill.** For
agent-heavy teams there's a second convergence: **a short always-loaded index
that links out, with detail loaded on demand** (progressive disclosure).

## 1. Architecture Decision Records (ADRs)

- Nygard format (Title / Status / Context / Decision / Consequences) is the de
  facto standard ([adr.github.io](https://adr.github.io/)). AWS runs 200+ ADRs
  and references them in architecture reviews ([AWS blog](https://aws.amazon.com/blogs/architecture/master-architecture-decision-records-adrs-best-practices-for-effective-decision-making/)).
  Spotify credits in-repo ADRs with faster onboarding and safe ownership
  handoffs across reorgs ([Spotify Engineering](https://engineering.atspotify.com/2020/04/when-should-i-write-an-architecture-decision-record)).
- Convention: `docs/adr/NNNN-title.md`, in-repo (greppable, reviewed in the
  same PR), lifecycle `proposed → accepted → superseded` (supersede, never
  edit history).
- Failure mode: ADRs written but unenforced → architecture drifts. Fix seen in
  practice: CI "fitness functions" that fail PRs contradicting an accepted ADR.
- 2026 twist: **agent-optimized ADRs** — imperative, scoped, machine-checkable
  so coding agents read them per session and can flag violations
  ([actual.ai](https://www.actual.ai/blog/agent-optimized-adrs)).

## 2. Docs-as-code

- **GitLab handbook-first**: write the decision down *before* announcing it in
  chat; Slack is never the source of truth; anyone PRs the handbook, a named
  DRI merges ([handbook](https://handbook.gitlab.com/handbook/company/culture/all-remote/handbook-first/)).
- **Diátaxis**: split docs into tutorial / how-to / reference / explanation;
  mixing them in one doc is why "complete" docs feel useless
  ([diataxis.fr](https://diataxis.fr/)). Our `docs/README.md` classification
  (runbook/reference/plan/research) is a variant of this.
- **Spotify Backstage TechDocs**: markdown beside code, rendered centrally —
  the most-used plugin in Spotify's developer portal because docs live where
  engineers already are ([backstage.io](https://backstage.io/blog/2020/09/08/announcing-tech-docs/)).

## 3. Runbooks & postmortems

- Google SRE blameless postmortems: systemic causes, and findings **fed back
  into runbooks and onboarding**, not archived ([SRE book](https://sre.google/sre-book/postmortem-culture/)).
- PagerDuty open-sources its actual internal incident-response docs and
  postmortem template — copy directly ([github.com/pagerduty/incident-response-docs](https://github.com/pagerduty/incident-response-docs)).
- Our `docs/DECISIONS.md` (What/Why/Consequence) is already a lightweight
  postmortem log; extend it, don't replace it.

## 4. Onboarding as the staleness test

Etsy's day-one production deploy: a new hire ships a real small change on day
one with a buddy — so if setup docs are wrong, day one fails visibly and the
docs get fixed ([Etsy Code as Craft](https://www.etsy.com/codeascraft/making-it-virtually-easy-to-deploy-on-day-one/)).
The mechanism is that **onboarding itself tests the docs**.

## 5. Agent-era conventions (2025-26)

- **Root instruction file: short, command-first, links out.** Anthropic's own
  guidance: include only what applies broadly (commands agents can't guess,
  non-default style, gotchas); cut anything inferable from code — "if removing
  this line wouldn't cause a mistake, cut it." Bloat causes real instructions
  to be ignored ([code.claude.com best practices](https://code.claude.com/docs/en/best-practices)).
- **AGENTS.md** is now the tool-agnostic standard (OpenAI-led, Linux
  Foundation, read by 20+ tools incl. Claude Code, Cursor, Copilot; nearest
  file up the tree wins in monorepos) ([agents.md](https://agents.md)).
- **Per-directory scoping** beats one giant root file: child-dir CLAUDE.md /
  nested AGENTS.md load only when working there. Cursor caps always-apply
  rules ~200 words ("token tax"); GitHub caps copilot-instructions ~1k lines.
- **Facts → instruction files; workflows → skills; must-always-happen →
  hooks.** Skills are the built-in progressive-disclosure mechanism (only
  name+description load until invoked).
- **Drift automation**: Mercari runs agents on every PR to flag rule drift and
  suggest rule edits ([engineering.mercari.com](https://engineering.mercari.com), Oct 2025).
  Basis splits every artifact into **canonical vs non-canonical** (never both)
  with daily staleness scanners; reports 2.5x commit velocity (self-reported)
  ([getbasis.ai](https://getbasis.ai/blogs/how-we-made-our-monorepo-ergonomic-for-agents)).
- **llms.txt**: curated index file pointing at real docs so agents don't crawl
  ([llmstxt.org](https://llmstxt.org)) — the same idea as our `docs/README.md`.

## Anti-patterns (called out repeatedly)

Giant root file loaded every session · prose instead of runnable commands ·
no owner or staleness signal · the same fact duplicated in CLAUDE.md, AGENTS.md
and docs/ (guaranteed contradictions) · wiki as source of truth (rots outside
review) · fetching docs into the main context instead of via a subagent.

## Recommendations for Suwappu (ranked)

1. **`docs/adr/` with Nygard-format ADRs**, backfilling 3-5 from
   `docs/DECISIONS.md` (Railway-not-AWS, KMS envelope encryption, dual-ORM
   no-Alembic, polling-single-replica). Require an ADR link on MONEY-PATH /
   cross-stack PRs — enforceable via the existing money-path-reviewer gate,
   no new tooling.
2. **Add a root `AGENTS.md`** (thin pointer to CLAUDE.md + docs/README.md) so
   non-Claude tools get the same knowledge. Near-zero cost.
3. **Per-directory instruction files** (`api-ts/CLAUDE.md`, `bot/CLAUDE.md`,
   `webapp/CLAUDE.md`) — also fixes the phantom `.claude/rules/` reference.
   Trim root CLAUDE.md with the "would removing this cause a mistake?" test.
4. **Cheap drift check in `scripts/verify.sh`**: flag docs referencing file
   paths that no longer exist; extend the env-schema-drift pattern we already
   run in CI.
5. **Mark DECISIONS.md entries canonical vs historical** (Basis pattern) —
   directly addresses this repo's known "docs drift; code is ground truth"
   problem.
6. **Onboarding self-test**: keep `docs/ONBOARDING.md` honest by having every
   new contributor (human or agent session) run its steps verbatim and PR any
   fix — the Etsy loop, no ritual required.
