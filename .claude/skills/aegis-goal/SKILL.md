---
name: aegis-goal
description: "Standing goal: implement every phase of the AEGIS fork/extend plan (docs/plans/aegis-fork-extend.md) until all are shipped and verified. Shows the phase backlog with file:line anchors and how to work it. Usage: /aegis-goal [phase|item]"
---

# /aegis-goal — Ship the AEGIS integration, all phases

Standing goal: **every phase of `docs/plans/aegis-fork-extend.md` implemented, verified, and merged.** The plan (2026-08-02) adopts `gaiarobotics/aegis` (MIT, fork-pinned) as Suwappu's agent immune system: Python scanner at the LLM/message choke points, quarantine federated with BlacklistService, a minimal TypeScript port for the api-ts agent surfaces, plus standalone hardening fixes the research surfaced. Upstream reference commit: `e3e87b3`.

## How to use
- `/aegis-goal` — pick the next unchecked item in phase order, **re-verify its file:line anchor against current code** (the plan is a point-in-time audit; lines drift), implement it, run the phase's verification, check it off, and commit the edit to this file in the same PR as the work.
- `/aegis-goal <phase|item>` — jump to that phase or item (e.g. `/aegis-goal 2` or `/aegis-goal 3.3`).
- One phase ≈ one PR via `/ship`. Don't batch phases. Items within a phase may split into smaller PRs if independently shippable.
- When implementation reveals a new gap (like Phase 4's items were found), ADD it here under the right phase.
- Goal is DONE when every box is checked; then archive this skill (delete the directory in a final commit noting completion).

## The backlog

### Phase 1 — Python scanner at LLM + message choke points (observe mode)
**SHIPPED: PR #685 merged to main (58b24f0), CI green, 58 tests, cubic review findings addressed.** Deploy to Railway is still pending — auto-deploy is broken (billing) and the CCR session has no Railway credentials; run `/deploy prod python-api` from a machine with the Railway CLI, then `python3 scripts/status.py` to verify boot. 1.7b's telemetry clock starts at that deploy.
- [x] 1.1 Pinned `aegis-shield` to immutable upstream commit `e3e87b3791fb…` in requirements.in + pip-compile'd lockfile (minimal diff; all 3 hard deps already present). Verified clean-venv install + scan smoke test. **Manual follow-up:** session repo-scoping blocked creating the `0xsoftboi/aegis` fork — fork on GitHub when convenient and repoint the requirements.in URL (same SHA).
- [x] 1.2 `bot/config/aegis.yaml` (observe, scanner-only modules, block_on_threat: false) + `bot/config/aegis_signatures/crypto.yaml` (14 SW-* signatures) + `bot/services/aegis_service.py` (fail-open singleton wrapper, WARNING-log mirror for Railway) + `AEGIS_ENABLED` setting. Verified: pack loads (52 sigs total), 14/14 detection cases pass, p50 0.22ms.
- [x] 1.3 DONE (commit 3618d9b) — LLM pre-flight: `Shield.scan_input()` in `parse_trade_intent` (`bot/services/nl_intent_service.py:404`, before the Anthropic call); provenance-delimit untrusted text in `_build_user_content` (`:214-216`); sanitize the `pending_intent` echo (`:182-192` — injection persistence loop).
- [x] 1.4 DONE (commit f8d896b) — WhatsApp seam: scan in `_wa_dispatch` (`api/main.py:2512-2531`) — must cover text, button payloads, `nfm_reply` JSON, and post-Whisper voice transcripts (`:2522-2524`).
- [x] 1.5 DONE (commit ee4747b, group -1 at top of add_handlers) — Telegram seam: group `-1` scanner handler in `bot/main.py` `add_handlers` (before `:740`) or wrap `PerUserSerializingProcessor.do_process_update` (`bot/utils/update_processor.py:25`). Scan-and-log only — never blocks normal commands.
- [x] 1.6 DONE (commit f8d896b, 30/60s per-key limit + scan) — Agent NL API `api/main.py:2163-2183`: add scanner + per-key rate limit (today it has neither between the API-key check and `handle_command`).
- [x] 1.7a Code gate DONE (commit 59a0bc2): 57 tests pass (19 AEGIS + 38 NL incl. 6 new prompt-hardening), p50 scan latency 0.12ms. Suite caught+fixed a real bug (ThreatMatch flat-field access blanked signature_ids telemetry).
- [ ] 1.7b Telemetry review: after Phase 1 deploys, review observe-mode detections (Railway logs `AEGIS threat detected` + `.aegis/telemetry.jsonl`) after ~1 week of prod traffic **before any enforce flip anywhere**.

### Phase 2 — Quarantine + token-address broker (federate with existing immune system)
- [x] 2.1 DONE — high-precision verdicts (credential_extraction / SW-04x + validated embedded address) reported via report_scam as 'aegis-scanner'; never add_to_blacklist. NOTE: report_scam is currently log-only upstream (auto-blacklist commented out) — quorum/threshold logic is future work under 2.3. Was: Persist AEGIS threat verdicts into `BlacklistService.report_scam` (`bot/services/token_security/blacklist_service.py:388`) so detections accumulate in the store the bot already hard-blocks on (`paste_trade.py:213`, `swap.py:1101`).
- [x] 2.2 DONE (MONEY-PATH) — shared check_address_gate (blacklist fail-open + compliance fail-closed) on paste_trade/_render_token_card, /check, snipe receive_contract + /snipe quick-path, and /intel (warning banner). EVM gap: analyzer is Solana-only, so EVM gets blacklist+sanctions but no honeypot sim. Was: Token-address broker at the paste surface: extend `token_analyzer.quick_check` beyond Solana to EVM in `_render_token_card` (`bot/handlers/paste_trade.py:197`; closes "Buy button still shown on EVM" at `:207-208`); pipe every pasted/embedded address through `blacklist_service.check` + `compliance.assert_compliant` before the Buy keyboard is stashed (`:223`); same for `/intel` (`bot/handlers/intel.py:169,323`) and snipe `receive_contract` (`bot/handlers/snipe.py:253`). **MONEY-PATH.**
- [x] 2.3 DONE — AegisUserTrust table (DB-backed, replica-safe), record-only trust decay/recovery wired fail-open into scan/ascan; no enforcement yet. Was: Per-user trust adaptation (AEGIS `TrustManager` semantics), **DB-backed** via `database/db.py::_ensure_schema()` additive migration — never in-process memory (multi-replica webhook mode). Fold in the PR #685 review note: move the `/v1/agent/execute` per-key limiter to the same shared store (Redis is already a dep) and add idle-key eviction — today it's in-process like every other limiter in the repo.
- [x] 2.4 DONE — Opus money-path review: SHIP WITH FIXES. 3/4 areas cleared (gate mirror faithful+fail-closed, migration idempotent, 0.0-falsy fix confirmed, no injection); one MEDIUM (per-message trust DB read) fixed via negative cache. Noted for future: EVM honeypot gap (analyzer Solana-only), snipe_quick_ dead button must gate if ever wired, recovery needs periodic job when enforcement lands.

### Phase 3 — `packages/aegis-ts`: minimal TypeScript port (the genuine "extend")
- [ ] 3.1 Scanner core: YAML signature loader consuming the **same signature files** as Python (one source of truth in-repo) + the pure-string semantic heuristics. No ML.
- [ ] 3.2 Hono scanner middleware at the three insertion points: REST `api-ts/src/routes/agent.ts:2051` (`/execute`), A2A `routes/a2a.ts:621` (`userText`), MCP `routes/mcp.ts:1519-1522` (after arg validation, **before** `chargeAgentForCall` so blocked calls aren't billed). Effect-TS idioms (Context.Tag + Layer; `Effect.tryPromise` at boundaries).
- [ ] 3.3 Per-agent trust table (Drizzle, keyed `agents.id`): trust score w/ decay, threat counters, `quarantinedUntil`; read in `agentBearerAuth` (`middleware/auth.ts:180`) beside `applyEffectiveTier`; written from scanner verdicts + `incrementAgentStats` call sites. DB-backed — also fixes rate-limit-×-replica multiplication. Dual-ORM check: does Python need to read it? If yes → `db-migrate` both stacks.
- [ ] 3.4 Outbound sanitization: schema-validate/filter the MPP directory passthrough (`mcp.ts:570` — currently returned verbatim to agents) and scrub reflected free-text in the A2A unknown-command echo (`a2a.ts:338`).
- [ ] 3.5 Verification: `bun run check` (incremental), vitest for loader + middleware, `bash scripts/verify.sh api`.

### Phase 4 — Standalone hardening quick wins (do regardless of AEGIS; small independent PRs)
- [ ] 4.1 Apply `safe_md` (`bot/utils/telegram_safe.py:26`) at `paste_trade.py:214-233` (external token metadata → Markdown), `support.py:196` (user ticket text → admin chat), `api/main.py:2675-2679` (Railway payload → admin chat). `/bugclass` candidate: "untrusted text rendered with parse_mode=Markdown".
- [ ] 4.2 WhatsApp signature verification **fail-closed** in prod when `WHATSAPP_APP_SECRET` unset (`bot/services/whatsapp_service.py:367-384`).
- [ ] 4.3 `bot/utils/sanitizer.py` `InputSanitizer` — wire it where it earns its keep or delete it (defined, imported nowhere).
- [ ] 4.4 Drop/backfill the plaintext `agents.api_key` column in api-ts (`db/schema/agents.ts:26-27`), keep hash only. **MONEY-PATH**; needs key-migration care for existing agents.

### Phase 5 — Stretch / upstream (start only after 1–4 are shipped & verified)
- [ ] 5.1 Deploy `aegis-monitor` as a Railway service (observe mode; SQLite→Postgres as needed) for fleet visibility over both stacks' scanners.
- [ ] 5.2 Upstream contributions to `gaiarobotics/aegis`: crypto signature pack, the TS port, FP/FN calibration harness fed by our observe-mode telemetry.

## Rules
- **Observe first, enforce later** — no surface flips to enforce until 1.7's telemetry review is done and FP rate is acceptable for that surface. Scanner failures fail-open for commands; fail-closed only for the paste-surface Buy gate.
- Anything touching swap gating, blacklist blocking, keys, or billing: tag **MONEY-PATH** → `money-path-reviewer` before merge.
- Routing per CLAUDE.md conductor table: `bot-dev` (Phases 1–2, 4.1–4.3), `api-ts-dev` (Phase 3, 4.4), `db-migrate` (2.3, 3.3), `test-engineer` for suites, `deploy-ops` (5.1).
- `black --line-length=100` on changed Python; `bun run check` incrementally for TS; ship each phase via `/ship`; after deploy verify with `python3 scripts/status.py` (CI green ≠ bot boots).
- Re-verify every file:line anchor before editing — the plan and this backlog are point-in-time snapshots.
