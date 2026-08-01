# LOOP MISSION (updated): fix broken routes one by one

New goal: find real broken routes and fix them one at a time with verification.
CONSTRAINT: no Railway CLI/token in sandbox → cannot pull prod logs directly. Unauth probes return 401 (route mounted) not 500, so post-auth code bugs don't show via curl. Substitute = STATIC provably-broken detection (attr/method mismatches vs models, async/sync, imports) — same method that found the mobile points 500s. Runtime-only errors needing prod logs get flagged for the user to paste a log tail.
Known-broken already (issue #670): GET /v1/mobile/points (up.points/up.spendable_points/... don't exist on UserPoints), GET /v1/mobile/points/rewards (r.cost vs points_cost).
Discovery IN FLIGHT: scout audit of Python routes (api/routes, api/main, api/webapp, bot/handlers) + scout audit of api-ts routes (+bun check). Fix loop: audit → fix one → ast/black or bun check → next.
Also open from PR loop: #531 turnkey review, #641 overlap review (may surface more broken paths).

## Broken-route findings (round 1)
PYTHON: scout found 24 broken attr/method refs ALL in api/routes/mobile.py → 5 routes 500: get_points, get_rewards(/points/rewards), get_leaderboard, get_trader_leaderboard, get_trader_profile, get_copy_trades, get_my_follows. Root cause: reads fields that don't exist on UserPoints/Reward/TraderProfile/CopyTrade/CopyFollow (renamed columns + methods-called-as-props). Other python route files CLEAN.
ROUND 1 DONE (dbd2ed09): mobile.py fully fixed — all 24 refs + 4 EXTRA broken CopyFollow fields (copy_amount→copy_amount_usd, max_per_trade→max_trade_usd, daily_limit→daily_limit_usd, total_copied→total_copied_trades) that scout missed. trader_name upgraded to a real TraderProfile join. Every attr verified vs model. ast/black clean, grep-zero bad refs. Read-only GETs → not money-path. NOT pytest-verified (no sqlalchemy/fastapi in sandbox) — code-complete + static-verified.
ROUND 1 QA (conductor, opus): I re-verified the mobile.py diff against the models myself — LEVELS list matched, get_level_info/xp_to_next_level/get_fee_discount confirmed methods, and the NEW JOIN is genuinely correct (CopyTrade.trader_id and TraderProfile.user_id are both FK->users.id). Fixed one drift risk myself (996eff84): level order now derived from LEVELS sorted by xp instead of a duplicated hardcoded list; verified output identical.
ROUND 2: dead-button audit found 4 real dead buttons out of 69 prefixes checked vs 88 handler patterns (pred_amt_* correctly ruled false-positive): history_stats (handler EXISTS but never registered), snipe_watch_add (x2), admin_status, admin_import_wallet. bot-dev fixing now with rules: reuse existing renderers, never half-wire the wallet-import KEY path (money-path → flag, make button honest instead of faking a feature), every handler must query.answer().
API-TS: CLEAN — bun run check passes, all mounted routes (perps/p2p/predict/tokens/health/lend/rewards/smartAccount/staking/publicSwap) have verified DI services + schema cols. No broken api-ts routes. So breakage = the mobile.py python cluster only (this round).
ROUND 2 DONE (6514ed33): history_stats WIRED (handler existed, just never registered); admin_status WIRED by extracting /st into _render_status_message() and reusing it (no duplication, handles "message not modified"); snipe_watch_add MADE HONEST — grep proved NO service anywhere creates WatchedToken rows, so no fake feature; admin_import_wallet FLAGGED MONEY-PATH → issue #672 (import_hot_wallet() exists and takes a raw private key, but a paste-key-into-Telegram flow is a real key-exposure hazard: hits TG servers + message history, no redaction. Refused to wire it; button now honest). ast+black clean, each callback registered exactly once, no dupes.
ROUND 3 CLEAN: terminal Mini App → backend contract consistent. 99 frontend calls all resolve (auth 12 + webapp 57 + terminal 24 python routes, 6 api-ts agent routes). No 404s. Live Mini App is NOT the breakage source.
ROUND 4 STRUCTURAL FINDING: `mobile/` does NOT exist on origin/main (CLAUDE.md lists it as a key dir — doc drift). It lives on origin/dev + feature branches, while api/routes/mobile.py's 41 endpoints ARE deployed from main. So a shipped Expo app (built off dev) talks to a prod backend from a different branch = prime contract-drift territory. Also must check whether dev's copy of mobile.py still carries the old broken attrs → the fix needs forward-porting to dev or dev-built clients keep hitting 500s.
CONFIRMED BY DIRECT CHECK: origin/dev's api/routes/mobile.py STILL has all the broken attrs (up.points L530, up.spendable_points L531, r.cost L584, t.total_pnl L779/L810, f.total_pnl L907, CopyTrade.follower_id L923) → dev Railway project serves the same 500s. NEEDS FORWARD-PORT to dev. NOT doing it unasked: pushing to dev is outside my designated branch — needs user go-ahead.
  Nuance: CopyFollow.follower_id (L832/840/866/891) is a REAL column — only CopyTrade.follower_id was wrong. My fix correctly changed only the CopyTrade one.
ROUND 4 REDIRECTED: cross-branch audit, origin/dev mobile client → fixed backend — especially RESPONSE-SHAPE mismatches (backend returns camelCase; does the app read keys the handler never returns?), incl. re-checking the just-fixed points/rewards/copy-trading handlers against app expectations.

DEPLOY CAVEAT: fixes land on my branch; getting them LIVE still needs user to unblock Railway (Actions billing / token) — sandbox can't deploy.
STATIC-AUDIT COVERAGE SO FAR: attr/method mismatches (found 28), dead buttons (found 4), api-ts routes+types (clean), terminal contract (clean). REMAINING CLASSES NEED REAL LOGS: external API/RPC failures, timeouts, auth-token edge cases, data-dependent 500s — none of these are statically detectable. Ask user for `railway logs --service python-api` tail to go further.

---

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
