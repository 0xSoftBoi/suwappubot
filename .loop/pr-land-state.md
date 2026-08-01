# PR landing loop — state

Goal: land all open PRs oldest→newest: review → fix → clean merge → deploy Railway → live-test → iterate.

## Iteration 1 (2026-08-01)
MERGED: 586 (py3.12→3.14 Dockerfile.railway), 589 (react showcase), 592 (framer-motion 12), 594 (boto3).
Railway auto-deploys on merge via watchPatterns (Railway-side, works despite broken Actions billing).
Baseline before rebuild: python-api /health ready=true, source_fingerprint=4256c535f81b, all bg services alive. All 4 prod URLs 200.
NEXT WAKE: verify python-api fingerprint changed + ready=true + showcase 200; if build failed (fingerprint unchanged after ~15min), revert 586 or fix Dockerfile.

## Iteration 1b (scout results + fixes)
MERGED: 596 (cryptography 49 — scout: MERGE-SAFE), 595 (redis 8 — pushed fix 8e9f9d2 replacing retry_on_timeout with Retry(NoBackoff(),1) at 3 sites, black-clean, then merged).
MERGED: 591 (openai 2.48 — bot-dev verified constructor/kwargs/tool_calls parsing against real 2.48 with mock transport; MERGE-SAFE). 7/30 landed.
Advisory (non-blocking): nl_intent feeds TradeIntent → consider money-path-reviewer pass later.
NOTE: redis reconnect verified at runtime by startup ping → watch /health checks.redis == "connected" after next python-api deploy.

## Iteration 2 (deploy blocker + more merges)
MERGED: 593 (react-dom, dependabot recreated it clean), 605, 608 (actions bumps). 10/30 landed.
**DEPLOY BLOCKED**: deploy-railway.yml is DISABLED on GitHub (422 on dispatch); last run Jul 1. Nothing since has deployed. Fingerprint still 4256c535f81b (old build serving). No railway CLI/RAILWAY_TOKEN in sandbox → cannot deploy from here. NEEDS USER: fix Actions billing + re-enable deploy-railway.yml, OR provide RAILWAY_TOKEN, OR run `railway up` locally per docs/deployment.
IN FLIGHT: showcase-dev doing tailwind 4 migration on 590/597 branches; reviewer on 611.

## Queue (remaining, oldest first)
- 590, 597 MERGED (showcase-dev migrated both to tailwind 4 postcss plugin, builds green, commits 2f97114/0e220c7). 13/30.
- 605, 608 actions bumps — harmless, CI broken anyway; merge if mergeable
- 611 MERGED (reviewer: sound + clean merge; I black-fixed its test file via isolated worktree, commit 68d45cd). 11/30.
- 615 MERGED after full cycle: conflicts resolved (9a46258) → money-path BLOCK (mint races) → bot-dev fix (a9dff3d) → money-path re-review APPROVE → merged 10f1ea0. Follow-ups in issue #670 (6 items). 14/30.
- 612 PARKED (comment posted): referral types superseded by main; showcase pages new BUT page.tsx swaps the LIVE homepage to a new concept → product decision, needs user sign-off. Not merging autonomously.
- 617 MERGED (a8e80ca) after 3 money-path rounds: conflicts (8108e8a) → BLOCK round1 (custodial gate bypass + skipped migrations + 4 more) → fixes (993b960) → BLOCK round2 (reserve-release race, "0.00" guard no-op, +2) → fixes (c214db0) → APPROVE round3 with 2 mediums → I fixed those directly (2a96203: fail-closed cap-log, provenance-gated release) → merged. 15/30.
- NOTE for 616: must renumber its drizzle idx-0007 migrations (main now owns 0007-0011) with `when` > 1784993662236.
- Remaining review perf note (non-blocking): evaluate() takes the advisory lock even when org has no caps — possible follow-up.
LESSON 10: when renumbering drizzle migrations, `when` timestamps must EXCEED the max applied entry or drizzle silently skips them — check both idx AND when.
- 633 MERGED (14ac5cd — additive SHA-pinned SBOM/scorecard workflows). 16/30.
- 650 CLOSED by dependabot itself (superseded) → replacement 671 verified (api-ts bun check clean; webapp build errors proven pre-existing on main via baseline worktree) and MERGED. webapp/ is a dead surface anyway (no Railway config). 17/31.
- 651 MERGED (4e1fd5e — install clean, boot-import gate passed, 60 test failures byte-identical to main baseline = pre-existing). 664 MERGED (5815898, checkout bump). 16 landed this session.
- PRE-EXISTING TEST DEBT (not from any PR): pytest-asyncio missing from requirements yet asyncio_mode=auto set → 25 collection errors; 60 baseline test failures on main (oauth/p2p/swap-ownership/webapp-limit/whatsapp files); webapp build broken on main (viem type clash). Consider filing issues.
- Remaining open (15): 531 (turnkey 6, reviewing), 612 (parked-product), 616/642-648/666 money-path drafts, 639/640/641/654/655 drafts.
- THEN drafts oldest-first: 531 (turnkey 6, needs policy check), 616 (needs drizzle renumber vs main's 0007-0011), 639-648 Phase 0 series (MONEY-PATH gates mandatory), 641, 642.
LESSON 9: subagents repeatedly stop mid-work without final output → always demand "deliver complete final verdict in ONE response" in prompts, and SendMessage-nudge finishes the job.
- drafts: 531, 616, 639-648 (MONEY-PATH ones → money-path-reviewer before merge)
- 650, 651 dependabot groups (large)

## Lessons (self-improvement log)
1. CI runs after ~Jul 27 fail ALL jobs in 3-4s = Actions billing broken → zero signal. Substitute: run black/pytest/bun check locally before merging such PRs.
2. GitHub status API 403 for this integration; use get_check_runs instead.
3. list_pull_requests full output = 500KB; always jq/python-filter from saved file.
4. No railway CLI/token in this sandbox → no control-plane checks; verify via deep /health payload (source_fingerprint field detects new build going live) + public URLs.
5. Merging PR A can conflict sibling dependabot PR B (same package.json) → @dependabot recreate comment (worked: 593 recreated clean within minutes).
6. get (full PR) returns huge dependabot bodies → prefer get_files/get_check_runs; list endpoints need jq-from-file.
7. Subagents doing `git checkout` in the SHARED tree switch MY branch too — future agent prompts must require `git worktree add` isolation (or isolation:"worktree" option).
8. deploy-railway.yml DISABLED + Actions billing dead → merges do NOT deploy. All landed PRs are staged-not-live until user fixes billing/token.

## Rules recap
- Never rebase; merge only. black --line-length=100 before pushing Python.
- python-api deep health: python-api-production-8526.up.railway.app/health (api.suwappu.bot is api-ts!).
- MONEY-PATH drafts need money-path-reviewer (opus) before merge.
