# Audit of the deletion branch `claude/first-principles-review-in7j3f`

Written incrementally. Purpose: verify every deletion against main with evidence
that is independent of the greps used to make it, restore anything that fails,
and reproduce CI locally.

## Rule adopted for the re-audit

A file stays deleted only if NOTHING in the tracked tree names it: not code, not
docs, not plans, not skills, not READMEs, not comments. "No importer" is not
enough. Reference material and staged work declare themselves in prose, not
imports, and a grep for imports cannot see intent.

## Findings

### F1. flet-curve/ was deleted on a false premise. RESTORED (commit 08f7449).
- The recon called it "a vendored yield-curve library". Its own FORK.md says it is
  Suwappu's fork of michwill/flet-curve-demo, an alternative Curve Finance UI,
  vendored 2026-08-23 "so it deploys and evolves with the rest of Suwappu", and
  the reference implementation behind native Curve support in terminal/ and
  showcase/. 529 files restored byte-for-byte; CodeQL exclusion restored.
- Root cause: I accepted a subagent's one-line characterisation without reading
  the directory's provenance file.

### F2. Terminal deletions contradicted the founder's own wiring backlog. RESTORED.
- .claude/skills/goal/SKILL.md item E2 names useDCA as the hook DCAPanel is to be
  wired onto. terminal/TERMINAL.md documents PairSelector, InsiderMetrics,
  useAlerts, useSelectedPair and copilot.ts as architecture. All 8 terminal
  files and the DCAManager comment restored.

### F3. webapp TokenDetail page is the anchor of P0 items in two product plans. RESTORED.
- docs/plans/trading-product-essentials.md P0-7, P0-8, P1-4 cite TokenDetail.tsx
  line numbers. It is unrouted today, which is a wiring bug per the plan, not
  dead code.

### F4. Other webapp files named somewhere in the repo. RESTORED.
- SettingsDrawer (webapp/README.md component list) + DrawerToggle.
- ApiContext, TonConnectContext (.claude/agents/webapp-dev.md).
- ProviderLogo, QuoteComparison, TransactionTracker, SwapCard, SwapImpactGauge
  (named in the design-system story prose as the consumers of those tokens),
  plus their stories, plus HomeScreen/WalletScreen stories (use ApiContext).
- Stocks.tsx and SwapTokens.stories.tsx comment edits reverted.

### F5. AWS ECS workflows and api/Dockerfile were retained on purpose. RESTORED.
- .github/workflows/deploy-railway.yml:8 says the Railway workflow "Replaces the
  AWS ECS workflows (deploy-api.yml / deploy-frontend.yml, kept for ..." and
  docs/deployment/railway.md:162 documents them as a manual fallback. Deleting
  a documented fallback is a product/ops call, not a cleanup.

### F6. showcase QuoteRaceGL and ChainSphereGL are a documented open task. RESTORED.
- .claude/skills/design-iterate/SKILL.md:125-130 tracks QuoteRaceGL as "BUILT but
  NOT WIRED" with an open bug and uses ChainSphereGL as the working reference.

## Still deleted after re-audit: 84 files, each with zero references of any kind

Evidence per file: `git grep -w <stem>` over the whole tracked tree (minus the
harness journal and lockfiles) returns either nothing or only word collisions in
unrelated code (e.g. "tiers" in api-ts billing, "Navigation" in bot handlers,
terminal's own SlippageControl/LimitOrderPanel/QuoteComparison, which are
different files with the same names).

- showcase, public routes with no inbound link and no doc naming them except
  showcase/CLAUDE.md's own "dead" verdict: hero-a, hero-b, hero-c, hero-e (page +
  css), hero-d/page.tsx (its css survives as src/app/hero.css), classic/page.tsx.
- showcase, components nothing imported before or after: AgentHandoff,
  CopyInstall, CosmicAtmosphere, DocsMasonry (+css), LanguageSwitcher (+css),
  LiveTerminal, MarketProof, MobileWaitlistForm (+css), RouteField, RouteStages,
  StatsStrip, Terminal, TerminalErrorBoundary, lib/highlight.ts. Three of these
  are still named in CSS comments only; the rules are inert.
- webapp, pages/components/hooks with no route, no importer, no doc, no plan:
  Support page (Settings.tsx has its own inline Support section), Navigation,
  ConnectionStatus, BiometricIcon (Passkey.stories defines its own local one),
  SwapHistory, CopyTradeCard, TokenDiscovery, PriceAlertCard, DCAScheduler,
  LimitOrderPanel, SwapRouteVisualizer, SlippageControl, the four Sakura showcase
  components, TierDisplay + TierCard, useSwapForm, useCopyTrading,
  usePredictionTrade, useHaptic, lib/amount-parser, four barrels nothing imported
  (pages/index, components/showcase/index, components/icons/index, tiers/index),
  App.tsx.bak, and the 15 stories that only rendered the above.
- packages/primitives-client: private, never published, zero consumers, not in
  any workspace or lockfile, not named in docs or plans. Its README describes a
  viem client for the on-chain primitives; the contracts and their tests remain.
- railway.suwappubot.json + .Dockerfile.noop: the image printed "deprecated"; the
  Railway best-practices doc already listed it as an orphan.

## Deletions made on judgment rather than zero-reference evidence (unchanged, flagged)
- 9947c73 removed the `@prev` plan chaining in the Agent Desk (329 lines). The
  argument: the aggregator already returns the real multi-hop route in one quote,
  so a hand-chained plan is the same job done worse (N quotes, N signatures,
  stale amounts). The smoke suite passes at 92/92 with the six chaining
  assertions removed. This was a product feature two days old; `git revert
  9947c73` restores it whole.
- be83272 consolidated three hop fallbacks into one (net -2 lines, rendering
  verified by screenshot). Not a deletion of behaviour.

## Independent review: none obtained
- A `reviewer` agent was asked to adversarially audit the deletions and declined
  on a role-conflict basis without examining the diff. A `scout` agent given the
  final 84-path list ran out of turns before writing a single finding. This audit
  is therefore one pair of eyes plus the mechanical scans below. Treat the 84
  remaining deletions as "no evidence found against", not "independently cleared".

## Mechanical scans run on the final tree (all clean)
- `git grep -w <stem>` for every remaining deleted path (word collisions triaged
  by hand; the triage table is in the session scratchpad).
- Route strings: no `'/support'`, `'/token…'`, `'/classic'`, `'/hero-*'` in any
  app source outside stories.
- Storybook: both `.storybook/main.ts` files use `src/**/*.stories.*` globs; no
  explicit story path can dangle.
- primitives-client symbols (`createSuwappuClient`, `baseSepoliaDeployment`,
  the package name): zero hits outside the deleted package.
- Restored files: none imports anything still deleted; every app builds.

## How to undo any of it
Every deletion is on this branch only; main is untouched. `git checkout
origin/main -- <path>` restores any single file; `git revert <sha>` restores a
whole commit: 9947c73 for @prev, a3bc8d4 for the showcase routes, 0606574 for
the repo-wide cut. Commits 08f7449 and 1d8a5b4 are themselves restores.

## CI lanes reproduced locally
- Railway deployment contract: PASS (29 instances)
- SDK package contract (verify-ts-packages.sh): PASS
- Python env schema: PASS (338 vars)
- Builder docs contract (regen-docs, gen-llms, check-doc-contract, git diff): PASS
- showcase stats:check: PASS
- terminal: build + 100/100 tests, re-run on the restored tree: PASS
- webapp: build (tsc + vite) + 55/55 tests, re-run on the restored tree: PASS
- showcase: build (175 pages), re-run on the restored tree: PASS. The webmcp
  smoke suite (92/92 before the restore) was not re-run afterwards because no
  restore touched showcase/src/app/agent-terminal.
- Terminal's 3 tsc errors: files byte-identical to main and import nothing
  deleted, so pre-existing. CI's terminal lane runs `bun run test` + `vite build`,
  not tsc, which is why they never failed CI.
