# Demo readiness — ETHGlobal Tokyo 2026 "Agent Swap Passport"

**Written:** 2026-09-26 16:40 UTC. Environment inspected: **Railway production** (project `suwappu`, env `production`).
Prod serves commit `f7e3f7f5` on python-api / python-worker / webapp / terminal / showcase, and `c456823b` (11:15 UTC) on api-ts.
Both contain the hackathon passport code (`8a774bed`, 10:42 UTC) — verified with `git merge-base --is-ancestor`. Later commits were
dependency/mcp-server only, so prod is effectively at HEAD. **Do not deploy anything new before the demo
unless a blocker below forces it.**

## Assumed demo path

1. Core bot: `/start` → wallet → balance → quote → swap → portfolio (Telegram + Mini App at app.suwappu.bot).
2. Agent API: register → `GET /v1/agent/me` → quote → swap on api.suwappu.bot.
3. Hackathon trust layer: World ID verify → ENS subname mint → Uniswap v4 World-ID-gated hook. (Intercepta is out of scope for the demo.)

## UPDATE 2026-09-26 16:48 UTC — trust layer enabled in prod

`HACKATHON_TRUST_LAYER=true`, `HACKATHON_INTERCEPTA=false`, `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_ENV=staging`, `WORLD_ACTION`,
`RP_SIGNING_KEY`, `ENS_MINTER_PRIVATE_KEY` are now set on api-ts production. Serving deployment: `3ffd41bd-f043-4107-98c1-ef2feb98586a`.
`GET https://api.suwappu.bot/hackathon/status` → `{"trustLayer":true,"providers":{"worldId":true,...}}`. Health still ok.
Gotcha found on the way: the local `api-ts/.env` names the key `WORLD_ID_RP_SIGNING_KEY`; prod needs `RP_SIGNING_KEY`.
`ensv2:false` in the status payload refers to the optional on-chain policy gate (`SEPOLIA_RPC_URL` unset, gate disabled, fails open);
ENS subname minting uses `ENS_SEPOLIA_RPC_URL`, which has a default. B1 below is therefore resolved; B3/B4 still stand.
Rollback: unset `HACKATHON_TRUST_LAYER` (or redeploy `df2c79a6`).

### Live proof attempt against prod (2026-09-26 17:03 UTC) — FAILED at the verifier

Headless run (Playwright + simulator.worldcoin.org, same method as the earlier local proof): `POST /hackathon/world-id/start` → 200,
simulator presented a real Orb/"Human" credential, then `POST /hackathon/world-id/verify` returned
`{"ok":false,"reason":"verifier rejected proof (http 400)"}`. World's 400 body is discarded by `guardianGate.ts:207`, so the reason is
unknown from prod logs; a local reproduction that captures the body is in progress. Suspect: the guardian gate requests the `proofOfHuman`
preset, whereas the only run that ever verified used `orbLegacy` with `allow_legacy_proofs`.
Second hazard seen: `/hackathon/world-id/verify` blocks server-side for up to 300 s while Cloudflare cuts the client off at ~100 s (524).
Any demo UI that waits on that call will time out if the human takes more than ~90 s to scan.

## BLOCKERS (must decide / act before the demo)

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| B1 | **The hackathon trust layer is OFF in prod.** The code IS in the running api-ts image, but `HACKATHON_TRUST_LAYER` is unset, so `/hackathon/*` is not mounted (`GET https://api.suwappu.bot/hackathon/status` → 404). **Decide first: does the hackathon segment run against api.suwappu.bot or a laptop dev server?** Only the laptop has ever run the full flow. | api-ts prod variable list has none of: `HACKATHON_TRUST_LAYER`, `WORLD_APP_ID`, `WORLD_RP_ID`, `RP_SIGNING_KEY`, `WORLD_ENV`, `WORLD_ACTION`, `ENS_MINTER_PRIVATE_KEY`, `INTERCEPTA_API_KEY`. `HACKATHON_INTERCEPTA` must be `false` (Intercepta is not part of the demo; with it on and no key, metered payments are rejected). | Either demo from a laptop dev server (the only place it has ever run end-to-end) **or** set the vars on prod api-ts and redeploy, then re-run the live proof. See "How to enable in prod" below. |
| B3 | **Public RPC quotas are exhausted in prod.** `public.1rpc.io/*` returns "usage limit reached" on eth/base/arb/op/bnb/matic/avax/linea/scroll/zksync/mode/ftm/klay/gnosis/opbnb (6h circuit), and meowrpc/drpc are 429-ing every few minutes on bsc/eth/arb/base. | python-api + python-worker prod logs, all day 2026-09-26. | `rpc_manager.py:540-568` orders paid `*_RPC_URL` → Alchemy → public list, so public hits on Base/Eth/Arb mean the paid tiers are ALSO failing or circuit-open at times. Pre-demo: `/b` on the demo wallet on Base and watch python-api logs for `RPC circuit OPEN` on base. BSC has **no** paid RPC var → do not demo BSC. |
| B4 | **Starknet Alchemy 503 spam** in python-worker (network not enabled on the key), every ~3 min. | worker logs 15:13–16:27 UTC. | Not on the demo path. PR #1042 adds a 15-min cooldown; merge only if logs will be on screen. Otherwise leave. |

## Verified working (live, 2026-09-26 16:25 UTC)

- api-ts `GET /health` → `{"status":"ok","db":"connected"}`, fingerprint `31f648cab56e`.
- python-api `GET /health` → `ready:true`, db + redis connected, bot in webhook mode, all 7 background services alive, RSS 0.2 GB.
- `GET /.well-known/agent.json` → 200. `/v1/agent/me`, `/v1/agent/quote`, `/v1/agent/link/code` → 401 with a clean JSON hint (auth working).
- suwappu.bot, app.suwappu.bot, terminal.suwappu.bot → 200, all under 0.7 s.
- Bot: all 24 registered commands and 30+ start/more-menu callbacks have handlers; all 36 help-text commands resolve. Python parse gate passes for `bot/` and `api/`.
- Webapp: `/alerts` route + spot-checked navigation wired. No empty `onClick` found in spot-check (not exhaustive).
- Real agent swap ran through prod at 16:24 UTC and failed only on `Insufficient USDC balance`. Correct behavior, but it means **the wallet someone is rehearsing with holds 0 USDC — fund the demo wallet** (plus one harmless `asyncio Unclosed connector` warning).
- Hackathon ENS Phase 3 and Uniswap v4 hook Phase 5: live-verified on Sepolia (tx hashes in `docs/plans/ethglobal-tokyo2026-agent-passport.md`).

## Not verified / cannot verify from this machine

- No real Telegram round-trip was sent (needs a human on the bot). No browser screenshot taken.
- World ID Phase 1 has only ever been verified against a **local** api-ts dev server (2026-09-26). Never in prod.
- `devapi.suwappu.bot/hackathon/status` returns a FastAPI-style 404, i.e. that host is fronting **python-api**, not api-ts as CLAUDE.md says.
- `railway` CLI is not installed locally, so `scripts/status.py` fails; this audit used the Railway MCP instead.

## Hidden / buried inventory (do NOT wire before the demo — hide or leave off)

Feature flags off by default in code: api-ts `MPP_ENABLED`, `AGENT_METERING_ENABLED` (set in prod env, value not inspected), `X402_FACILITATOR_ENABLED` (set in prod env), `RECURRING_BILLING_ENABLED`, `SMART_ACCOUNT_ENABLED`, `UNISWAP_COMPARISON_ENABLED`, `OTEL_ENABLED`. Python: `passkey_auth_enabled` (**must stay False**: WebAuthn signatures are not verified), `tempo_fee_sponsor_enabled`, `NL_TRADING_ENABLED` (set in prod env), `LLM_MULTI_PROVIDER_ENABLED` (set in prod env), `rewards_marketplace_enabled`, and 12 bridge rails (allbridge, symbiosis, cctp*, aave, propamm, usdt0, lattice, membership_relayer, agent_approvals).

TODO hotspots (largest first): `api-ts/src/routes/webappStubs.ts` (19), `bot/services/swap_engine.py` (12), `bot/services/giftcard_api.py` (10), `bot/services/referral_service.py`, `bot/handlers/points.py`, `api-ts/src/routes/agent.ts` (6 each), `bot/services/p2p_service.py`, `bot/handlers/p2p_handler.py`, `bot/services/bridge/base.py` (5 each). `webappStubs.ts` is mounted at `/webapp` *after* the real routes and returns **501 FEATURE_NOT_ENABLED** for copy-trading, battle, referrals (`/referrals/code|stats|leaderboard`) and alerts when no real handler exists. Mini App screens that call them: `pages/PriceAlerts.tsx`, `pages/Referrals.tsx`, `pages/Battle.tsx`, and the copy-trading entries in `lib/api.ts`. **Keep the demo on Swap / Portfolio / Wallet; do not open Alerts, Referrals, Battle, or Copy in the Mini App** unless verified in a real Telegram session (unauthenticated probe returns 401/404, so this could not be confirmed from here).

Known 500s in prod logs (not demo path): `GET /v1/agent/lend/market/<id>` returns 500 for unknown ids (should be 404); `GET /v1/agent/predict/market/<id>/book` 500 on a literal placeholder id. api-ts hit Railway's 500 logs/sec cap 5 times this week (log noise, not a fault).

## Do-not-merge list until after the demo

External-contributor PRs #990, #993, #995; MONEY-PATH PRs #977, #994; draft surface-removal #1011; every Dependabot bump (#1016, #1013, #997, #996, #973, #972, #971, #970, #967, #966); #1015 (perf), #981 (geo-block), #978 (stabilization). Exception: #1042 (Starknet cooldown), only if worker logs will be shown.

## Rollback targets (last green prod deployments, commit f7e3f7f5)

| Service | Deployment id |
|---------|---------------|
| python-api | `499cdb3d-8fec-4a10-a99b-185e3ad7deef` (commit `f9c7fddc`, RPC-classification fixes, boot verified 16:56 UTC; previous green `d2110791`) |
| python-worker | `ac123f73-1226-4c5a-93a0-8cdc39023ad8` (commit `f9c7fddc`; previous green `ea70cf58`) |
| webapp | `a3bb0482-e8c6-46b2-ac57-932c1306d626` |
| terminal | `a82283de-ad19-4d0d-a9a2-eac6ef4fa965` |
| showcase | `b6e4859e-ad57-40a3-93e5-8381ea6993d9` |
| api-ts | `3ffd41bd-f043-4107-98c1-ef2feb98586a` (trust layer ON); pre-trust-layer green `df2c79a6` |

A manual python-api prod deploy was triggered at 16:27 UTC by the repo owner and ended SKIPPED (no source change). Nothing changed.

## How to enable the trust layer in prod (if the demo must run on api.suwappu.bot)

Set on Railway → suwappu → production → api-ts, then redeploy:

```
HACKATHON_TRUST_LAYER=true
HACKATHON_INTERCEPTA=false          # Intercepta is out of scope; keep OFF (fail-closed otherwise)
HACKATHON_ENSV2=true                # gates.ts fails OPEN when unconfigured (never blocks a swap); set false to be safe
WORLD_APP_ID=app_1b018287a10e1b3d9d56de5d3096ffc6
WORLD_RP_ID=rp_ce904182c872598d
WORLD_ENV=staging
WORLD_ACTION=agent-swap-passport-verify
RP_SIGNING_KEY=<from World developer portal; MCP tool get_world_id_signing_key>
ENS_MINTER_PRIVATE_KEY=<contents of scripts/.ens_sepolia_key, local only, gitignored>
```

Then prove it: `GET /hackathon/status` → 200, run the World ID V4 proof page (`scripts/.world_id_v4_test_page.html`) against prod, confirm `GET /v1/agent/me` shows `ens_name`, and watch api-ts logs for 5 minutes. Rollback = unset `HACKATHON_TRUST_LAYER` and redeploy.
