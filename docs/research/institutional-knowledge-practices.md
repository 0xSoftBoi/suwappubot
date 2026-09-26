# How Big Tech Keeps Institutional Knowledge (Research, Aug 2026)

Per-company survey of how major engineering orgs persist knowledge, from their
own blogs/books/repos (primary sources cited inline; secondary sources and
unverified claims flagged). Ends with an adoption plan for Suwappu.

## The one-line finding

**Knowledge survives only when the artifact is welded to a gate engineers
already can't skip** — Google's submit-blocking code review, Amazon's silent
memo-reading ritual, Microsoft's PR-merge-as-acceptance, Shopify's
docs-generated-from-tests. Docs living outside a mandatory workflow (wikis,
volunteer docs) rot in every company's own account. The corollary: pick the
gate first, then attach the doc to it.

## Google

- **Design docs** with canonical sections (Context/Scope, Goals & Non-Goals,
  Design + system-context diagram, Alternatives Considered, Cross-cutting
  concerns). Review widens from co-authors → team list → synchronous review
  for high-stakes systems. The durable habit is *retrieval*: "where's the
  design doc?" is the first question on any unfamiliar system.
  ([industrialempathy.com/posts/design-docs-at-google](https://www.industrialempathy.com/posts/design-docs-at-google/))
- **g3doc**: Markdown docs in the same source tree, changed in the *same
  changelist* as the code, through the same review/OWNERS approval — doc rot
  is caught like a bad diff. (*Software Engineering at Google* ch. 10,
  [abseil.io](https://abseil.io/resources/swe-book/html/ch10.html))
- **Code review + readability certification** as the actual mechanism for
  propagating "how we do things": submit tooling blocks commits without the
  required approvals. ([google.github.io/eng-practices](https://google.github.io/eng-practices/review/),
  SWE book ch. 9)
- **SRE playbooks linked to alerts**: every paging alert maps to a playbook
  entry; stale playbooks are treated as an on-call reliability defect, and
  playbook content "decays at the same rate as production."
  ([sre.google/workbook](https://sre.google/workbook/on-call/))

## Amazon

- **Six-page narrative memos, PowerPoint banned** (2004): meetings open with
  20-30 min silent reading, so authors must write for cold readers — the
  ritual is the enforcement. ([Bezos on CNBC](https://www.cnbc.com/2018/04/23/what-jeff-bezos-learned-from-requiring-6-page-memos-at-amazon.html))
- **PR/FAQ "working backwards"**: the customer press release + FAQ is written
  *before* building and becomes the durable record of why a product exists
  and which tradeoffs were rejected. ([workingbackwards.com](https://workingbackwards.com/concepts/working-backwards-pr-faq-process/))
- **Correction of Error (COE)**: the mandatory postmortem format — incident
  summary, quantified impact, timeline, 5-Whys, *owned and time-bound* action
  items; explicitly blameless and action-driven, not descriptive.
  ([AWS Cloud Ops blog](https://aws.amazon.com/blogs/mt/why-you-should-develop-a-correction-of-error-coe))
- **Builders' Library**: 25 years of operational practice published as living
  articles by named principal engineers. ([aws.amazon.com/builders-library](https://aws.amazon.com/builders-library))

## Microsoft

- **Code With Engineering Playbook**: the public, git-hosted handbook —
  itself maintained docs-as-code via PRs. ([github.com/microsoft/code-with-engineering-playbook](https://github.com/microsoft/code-with-engineering-playbook))
- **ADRs where merge = acceptance**: ADR opened as a PR in "proposed" status,
  discussed as a normal review, merged to main only when "accepted" — decision
  gating reuses branch protection verbatim. ([decision-log README](https://github.com/microsoft/code-with-engineering-playbook/blob/main/docs/design/design-reviews/decision-log/README.md))
- **Append-only ADR log**: never edit an accepted record; supersede and link.
  Records must be "pithy, assertive, factual" with rationale linked out, so
  the log doesn't decay into essays. ([learn.microsoft.com Well-Architected](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record))

## Meta

- **Bootcamp**: all new engineers (grads to directors) rotate ~6 weeks through
  real bug fixes across teams before choosing one — the rotation *is* the
  knowledge transfer, plus it seeds a cross-team social graph.
  ([engineering.fb.com 2009](https://engineering.fb.com/2009/11/19/production-engineering/facebook-engineering-bootcamp/));
  reportedly shrunk to ~2-4 weeks recently (unverified secondary:
  [Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/why-is-meta-destroying-its-engineering)).
- **Glean code indexing** (open-sourced 2024): whole-monorepo index behind
  code search/browsing/doc generation — used by default because required dev
  tools are built on it. ([engineering.fb.com](https://engineering.fb.com/2024/12/19/developer-tools/glean-open-source-code-indexing/))

## Netflix

- **Context, not control + informed captains**: distributed decision *rights*
  (with strategic context pushed down) substitute for centralized decision
  documentation. ([jobs.netflix.com/culture](https://jobs.netflix.com/culture))
- **Full-cycle developers on a paved road**: teams operate what they build, so
  operational knowledge never separates from the team that needs it; the
  central platform wins adoption by being strictly better, not mandated.
  ([netflixtechblog.com](https://netflixtechblog.com/full-cycle-developers-at-netflix-a08c31f83249))

## Apple — the counter-example

Need-to-know compartmentalization on iPhone-era work meant knowledge lived in
small teams' heads and demo culture ("creative selection" loops), not
artifacts; even insiders lacked the high-level view, which only became legible
through a memoir years later (Kocienda, *Creative Selection*;
[Wharton interview](https://knowledge.wharton.upenn.edu/podcast/knowledge-at-wharton-podcast/what-an-insider-reveals-about-apples-design-process/)).
Works only with extreme co-location and tight demo loops — the model a small
remote crypto team can least afford to copy.

## Stripe

- **Writing culture with review**: strategy docs, meeting notes, and essays
  posted to company-wide lists; line-edits before anything ships; operating
  principles quoted verbatim years later — the writing-review *loop*, not the
  repository, made it stick. ([Brie Wolfson, Every.to](https://every.to/p/what-i-miss-about-working-at-stripe))
- **Friction logs**: a named, repeatable artifact type — first-person
  walkthrough of the product as a user, capturing UX knowledge.
  ([mikebifulco.com](https://mikebifulco.com/posts/how-stripe-uses-friction-logs))
- **Paid ownership**: "Home" intranet and "Trailhead" internal docs are run by
  a small dedicated team — institutional knowledge has an owner on payroll.
  (secondary: [Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/stripe))

## Shopify

- **The Vault** (since 2012): GitHub-and-Markdown-backed internal knowledge
  platform with full version history, "default to open."
- **Docs generated from tests/schema**: REST API docs generated from unit
  tests, GraphQL docs from schema — documentation as a byproduct of required
  code; it cannot drift without breaking the build. The strongest enforcement
  mechanism in this survey. ([shopify.engineering](https://shopify.engineering/good-documentation-productivity),
  [rebuild writeup](https://gfscott.com/blog/how-we-rebuilt-shopify-developer-docs-again/))

## Mid-size & sweep

- **GitLab — handbook-first**: write it down publicly *before* announcing in
  chat; Slack is never the source of truth. ([handbook.gitlab.com](https://handbook.gitlab.com/handbook/company/culture/all-remote/handbook-first/))
- **Spotify — in-repo ADRs** (faster onboarding, safe handoffs across reorgs;
  [engineering.atspotify.com](https://engineering.atspotify.com/2020/04/when-should-i-write-an-architecture-decision-record))
  and **Backstage TechDocs** — markdown beside code, rendered centrally; the
  most-used plugin in their portal. ([backstage.io](https://backstage.io/blog/2020/09/08/announcing-tech-docs/))
- **PagerDuty**: publishes its actual internal incident-response docs +
  postmortem template — copy directly. ([github.com/pagerduty/incident-response-docs](https://github.com/pagerduty/incident-response-docs))
- **Etsy — day-one deploy**: a new hire ships a real change on day one, so
  onboarding docs are tested by every hire. ([Etsy Code as Craft](https://www.etsy.com/codeascraft/making-it-virtually-easy-to-deploy-on-day-one/))
- **Uber**: mandatory RFC with named approvers before any new service.
  ([Pragmatic Engineer on RFCs](https://blog.pragmaticengineer.com/scaling-engineering-teams-via-writing-things-down-rfcs/))
- **Airbnb**: open-sourced Knowledge Repo — git-versioned, peer-reviewed data
  science posts. ([github.com/airbnb/knowledge-repo](https://github.com/airbnb/knowledge-repo))
- **Squarespace**: docs-as-code in the same PR as the change, deployed to
  Backstage via CI. ([engineering.squarespace.com](https://engineering.squarespace.com/blog/2025/making-documentation-simpler-and-practical-our-docs-as-code-journey))
- LinkedIn / Dropbox / Slack / Palantir: no primary-source doc-culture
  writeups found at survey depth — deliberately not cited.

## Agent-era conventions (2025-26)

- Root instruction file **short, command-first, links out**; cut anything the
  agent can infer ("if removing this line wouldn't cause a mistake, cut it").
  Bloated files cause real instructions to be ignored.
  ([code.claude.com best practices](https://code.claude.com/docs/en/best-practices))
- **AGENTS.md** is the tool-agnostic standard (Linux Foundation; 20+ tools;
  nearest-file-wins in monorepos). ([agents.md](https://agents.md))
- **Per-directory scoping** over one giant root file; Cursor caps always-apply
  rules ~200 words; Copilot instructions ~1k lines.
- **Facts → instruction files; workflows → skills; must-always-happen →
  hooks.** Skills are built-in progressive disclosure (only name+description
  load until invoked).
- **Drift automation**: Mercari runs agents on every PR to flag rule drift and
  suggest rule edits ([engineering.mercari.com](https://engineering.mercari.com), Oct 2025);
  Basis marks every artifact **canonical vs non-canonical** with daily
  staleness scanners (2.5x commit velocity, self-reported:
  [getbasis.ai](https://getbasis.ai/blogs/how-we-made-our-monorepo-ergonomic-for-agents)).
- **Agent-optimized ADRs**: imperative, scoped, machine-checkable so agents
  read them each session and CI can fail PRs violating accepted decisions.
  ([actual.ai](https://www.actual.ai/blog/agent-optimized-adrs))

## Anti-patterns (recurring across all sources)

Wiki as source of truth (no review gate → rot) · giant always-loaded
instruction files · prose where runnable commands belong · no named owner or
staleness signal · the same fact duplicated across CLAUDE.md/AGENTS.md/docs/
(guaranteed contradictions) · ADRs written but never enforced · knowledge
locked in heads/demo culture (the Apple failure mode).

## Adoption plan for Suwappu (ranked, each with its precedent)

1. **`docs/adr/` with merge-as-acceptance** (Microsoft/Spotify): Nygard
   format, `NNNN-title.md`, append-only, supersede-don't-edit. Backfill 3-5
   from `docs/DECISIONS.md` (Railway-not-AWS, KMS envelope encryption,
   dual-ORM no-Alembic, polling-single-replica). Require an ADR link on
   MONEY-PATH/cross-stack PRs via the existing money-path-reviewer gate.
2. **Docs change in the same PR as the code change** (Google g3doc /
   Squarespace): make it a review-checklist norm now; later add a CI nudge
   when `bot/services/` or `api-ts/src/` changes without a docs/ touch.
3. **Root `AGENTS.md`** (thin pointer to CLAUDE.md + docs/README.md) +
   **per-directory CLAUDE.md** for `bot/`, `api-ts/`, `webapp/` — fixes the
   phantom `.claude/rules/` reference and cuts always-loaded context.
4. **COE-style postmortems** (Amazon/PagerDuty): adopt the COE section list
   for production incidents; file them under `docs/incidents/` and feed action
   items back into DECISIONS.md and runbooks.
5. **Drift check in `verify.sh`** (Mercari/Basis pattern, cheap version):
   flag docs referencing file paths that no longer exist; mark DECISIONS.md
   entries canonical vs historical.
6. **Generated docs where possible** (Shopify): the api-ts OpenAPI/MCP schema
   drift checks in CI are already this pattern — extend to bot command list
   and chain/provider counts (generate `docs/` stats from `bot/config/`
   instead of hand-writing numbers that go stale).
7. **Onboarding as the staleness test** (Etsy): every new contributor runs
   `docs/ONBOARDING.md` verbatim and PRs any fix.
