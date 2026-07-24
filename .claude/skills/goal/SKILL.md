---
name: goal
description: "Standing goal: connect every built-but-unwired feature. Shows the audited disconnect backlog (Jul 2026), how to verify each item, and how to keep this list current. Usage: /goal [item]"
---

# /goal — Connect the scattered features

Standing goal: **no feature should exist in the codebase without being wired end-to-end** (handler registered, service started, table created, endpoint mounted, UI calling a real backend). This backlog comes from a 3-surface audit (bot / APIs / frontends) on 2026-07-24, triggered by finding the entire support-ticket system built but unregistered (fixed in PR #615) and mobile referral stats returning hardcoded zeros from a nonexistent-method call (same PR).

## How to use
- `/goal` — review this list, verify the next unchecked item against current code (items may have been fixed since the audit — always re-verify before working), fix it, then check it off and commit the edit to this file.
- `/goal <item>` — jump to that item.
- When you find a NEW built-but-unwired feature anywhere, ADD it here.

## The backlog

### A. Mobile API ghost methods (api/routes/mobile.py) — silent fake data
All wrapped in broad `except Exception` returning defaults, so they "work" but lie.
- [x] A1. `mobile.py:552` — `await points_service.daily_checkin()` is a **sync** method being awaited → TypeError swallowed; mobile daily check-in never credits points. Fix: call sync, map response.
- [x] A2. `mobile.py:565` — `points_service.get_milestones()` **does not exist**. Find the real milestones source (points_service) and wire it.
- [x] A3. `mobile.py:600` — `points_service.redeem_reward()` **does not exist** (real: `redeem_subscription_reward` / `redeem_marketplace_reward`). Mobile redemption silently no-ops. MONEY-PATH — tag reviewer.
- [x] A4. `mobile.py:692` — `referral_service.get_stats()` → fixed in PR #615 (`get_referral_stats`, key mapping).
- [x] A5. Sweep done (remaining awaits are legitimately async: ws.create_wallet, httpx calls). Tests for api/routes/mobile.py still missing — see F. Sweep the REST of mobile.py for the same pattern (every `await <service>.<method>` inside try/except: verify the method exists and its sync/async-ness). Add tests for api/routes/mobile.py — currently zero coverage.

### B. Bot: unstarted services & orphaned models
- [x] B1. Support system (handlers + notifier + SupportTicket model) — wired in PR #615.
- [x] B2. Wired: battle_monitor start/stop in bot/main.py (settles expired /battle positions). `bot/services/battle_monitor.py`
- [x] B3. Fixed: imports added to database/db.py. Models never imported in `database/db.py` schema init (tables may never be created — verify at runtime first; another import path may create them): `bot/models/custodial.py` (CustodialBalance, CustodialTransaction, HotWallet, GasSponsorshipConfig, UserGasUsage), `bot/models/favorites.py` (FavoriteSwapPair, PriceAlert, UserSettings), `bot/models/tempo_access_key.py`.

### C. Unmounted / missing API routes
- [ ] C1. `api-ts/src/routes/tokens.ts` exports `tokenRoutes` but is never mounted in app.ts (intended `/webapp/tokens` per its comments) → webapp's `/webapp/tokens/prices` call (api.ts:322) has no backend.
- [ ] C2. `api/main.py:653,660,667` — imports `api.routes.webapp`, `api.routes.swap`, `api.routes.a2a` which don't exist as files; silently skipped by try/except. Decide: create, repoint, or remove the imports.

### D. Frontend calls with no (or wrong-path) backend
- [x] D1. Webapp support form called `/webapp/support/tickets` with NO backend in either stack (the June api-ts routes were wiped). Fixed in PR #615: GET/POST `/webapp/support/tickets` added to Python `api/webapp.py` (terminal-JWT auth, support_notifier fan-out picks tickets up via notified_at).
- [ ] D2. `/webapp/snipe` POST (`api.ts:634`) — no backend in either stack; webapp snipe is dead. MONEY-PATH when built.
- [ ] D3. `GET /swaps/{id}` (`api.ts:122`) — no detail endpoint in either stack.
- [ ] D4. Terminal tweet monitor (`terminal/src/components/tweets/TweetMonitorPanel.tsx`) — all `/webapp/tweets/*` calls 404; no backend.

### E. "Coming soon" stubs where the backend already EXISTS (quick wins)
- [ ] E1. Terminal AlertsPanel (`terminal/src/components/alerts/AlertsPanel.tsx:30,56`) — disabled stub, but `/webapp/alerts` backend exists. Wire it.
- [ ] E2. Terminal DCAPanel (`terminal/src/components/trade/DCAPanel.tsx:68-73`) — stub, DCA backend exists (mobile/bot paths). Wire it.

### F. Genuine not-yet-built stubs (product decisions, not wiring)
- [ ] F1. Webapp Wallet "Send funds" (`Wallet.tsx:350`) — `alert('coming soon')`. Terminal has deposit/withdraw; port it.
- [ ] F2. Terminal perps TP/SL (`PositionsTable.tsx:33,276`) — needs backend order-type support.
- [ ] F3. P2P native escrow (`P2P.tsx:213,384`) — executor unwired (EscrowNotConfiguredError; known).
- [ ] F4. Webapp in-app referral claiming (`Referrals.tsx:216`) — intentional bot-only for now.

## Rules
- Re-verify every claim against current code before acting — this is a point-in-time audit.
- Anything touching funds/points/keys: tag MONEY-PATH and get money-path-reviewer before merge.
- The disease pattern to grep for elsewhere: broad `except Exception` returning defaults around service calls; exported handlers not in `bot/main.py`; `.start()` services never started; Hono routers never `.route()`d; frontend paths not in either stack.
