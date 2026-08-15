# AEGIS → Suwappu: Fork / Extend / Integrate Plan

**Source:** https://github.com/gaiarobotics/aegis (MIT, fork-friendly)
**Date:** 2026-08-02 · **Status:** Plan (researched, not yet implemented)
**Research basis:** 6-agent read-only fan-out over a full clone of `gaiarobotics/aegis` and the Suwappu codebase (api-ts + Python bot).

---

## 1. What AEGIS is (verified from source, not the README)

AEGIS ("Agent Embedding Guard & Immune System", PyPI `aegis-shield` v0.1.0) is an **agent immune system**: it wraps LLM clients (`aegis.wrap(client)`) and layers defenses against prompt injection and compromised-agent cascades in multi-agent networks.

- **Core** (`aegis/`): 14,318 LOC Python, 87 files, compiles cleanly, **1,433 test functions** (~19k LOC of tests). Hard deps are only `pyyaml`, `pydantic>=2`, `httpx` — everything else is optional extras with graceful degradation.
- **Modules**: scanner (regex signatures + 6 semantic heuristics + optional ML/YARA/LLM-screen/embedding intent-divergence), broker (tool-action gating, capability manifests, write budgets, quarantine triggers), identity (trust tiers w/ decay, Ed25519/HMAC attestation, "NK cell" verdict fusion), behavior (drift z-scores, SimHash content fingerprints), memory guard (blocks persisting instruction-shaped content), recovery (auto-quarantine + rollback), integrity (model-file hashing), monitoring (opt-in central reporting).
- **Companions**: `aegis-monitor` (FastAPI fleet dashboard, R₀ estimation, contagion hash DB with quorum anti-poisoning — the most mature piece), `aegis-sentinel` (honeypot agent skeleton), `aegis-openclaw` (hooks + skill; enforcement is mostly advisory), `aegis_proxy` (~570 LOC stdlib LLM-scanning reverse proxy, real but minimal).
- **Signature format**: trivially extensible YAML (`{id, category, pattern, severity, description}`), merged via `scanner.signatures.additional_files` — **custom domain packs need zero code**.
- **Maturity honesty**: self-rated "Early"; scoring weights hand-tuned, not calibrated; 4 GitHub stars, one PyPI release (2026-03-16). MIT license permits everything.
- **Self-declared unbuilt**: real endpoint patchers (broker only sees voluntarily-routed actions), mature sidecar proxy, **TypeScript port**, empirical calibration, "Endpoint Defense" behavioral attestation gating.

## 2. Where it fits Suwappu (key findings from our own surface map)

**Critical asymmetry:** `api-ts` has **zero LLM inference** — `/v1/agent/execute`, A2A `message/send`, and MCP `tools/call` are regex parsers. The Python stack has exactly **one LLM consumer**: `bot/services/nl_intent_service.py` (Anthropic Haiku + OpenAI-compat fallbacks), which concatenates untrusted user text with previously-LLM-extracted `pending_intent` context (`nl_intent_service.py:214-216` — an injection persistence loop), plus WhatsApp voice → Whisper transcripts that re-enter the router as typed text (`api/main.py:2522-2524`).

So the classic "prompt injection into a completion" risk is narrow but real (NL trading, voice), while the bigger wins are AEGIS's **non-LLM layers**: signature scanning of untrusted text, per-agent trust/quarantine, action brokering, and outbound sanitization.

Existing assets to build on (found in recon):
- `BlacklistService.add_to_blacklist / report_scam` (`bot/services/token_security/blacklist_service.py:284,388`) — an existing quarantine store; hard-block precedent at `paste_trade.py:213` and `swap.py:1101`.
- `token_analyzer` / honeypot detector / compliance screening — an existing domain-specific "immune system" AEGIS can federate with, not replace.
- Gaps AEGIS-thinking exposed regardless of adoption (§6 quick wins): dead `InputSanitizer` (defined, imported nowhere), Markdown injection via external token metadata (`paste_trade.py:214-233`) and support tickets → admin chat (`support.py:196`), WhatsApp signature check **fail-open** without `WHATSAPP_APP_SECRET`, agent `apiKey` stored **plaintext** alongside its hash (`api-ts/src/db/schema/agents.ts:26-27`), all rate limiters in-process memory (multiplied by replica count), MPP directory JSON returned verbatim to agents (`mcp.ts:570`), **no per-agent trust/reputation table at all** in api-ts.

## 3. Strategy decision

**Fork + depend, don't vendor-copy.** Fork `gaiarobotics/aegis` → `0xsoftboi/aegis`; pin the Python dependency to our fork (git ref) so we control cadence of a pre-1.0 upstream while keeping upstream merges cheap (MIT). Copy nothing into `bot/` except our own config/signature YAML. For api-ts, **port a minimal TS subset** ("aegis-ts" in `packages/`) that shares the *same YAML signature format* — this is also upstream's #1 unbuilt roadmap item, so it's a genuine "extend/improve", contributable later.

Run **observe mode first everywhere** (AEGIS's own `mode: observe` + `block_on_threat: false` defaults support this), measure FP rates on real traffic via telemetry JSONL, then flip to enforce per-surface. Never put ML extras (~100-400ms/scan) on the swap hot path — regex/heuristic tier only (sub-ms).

## 4. Phased plan

### Phase 1 — Python: scanner at the LLM + message choke points (highest value/effort ratio)
1. Add `aegis-shield` (fork-pinned, **no extras**) to Python deps; create `bot/config/aegis.yaml` (observe mode) + a **crypto signature pack** `bot/config/aegis_signatures/crypto.yaml`: seed-phrase solicitation, "validate your wallet", fake-support DMs, drainer-approval language, address-substitution lures — maps onto existing `credential_extraction` / `social_engineering` categories, ~20 lines each, zero code.
2. **LLM pre-flight**: `Shield.scan_input()` in `parse_trade_intent` (`nl_intent_service.py:404`) before the Anthropic call; adopt AEGIS prompt-envelope provenance delimiting in `_build_user_content:214` and sanitize the `pending_intent` echo (`:182-192`).
3. **WhatsApp seam**: scan in `_wa_dispatch` (`api/main.py:2512-2531`) — covers text, button payloads, `nfm_reply` JSON, and post-Whisper transcripts in one place.
4. **Telegram seam**: group `-1` scanner handler in `bot/main.py` `add_handlers` (before line 740) or wrap `PerUserSerializingProcessor.do_process_update` (`bot/utils/update_processor.py:25`) — sees every update pre-dispatch. Scan-only (log/telemetry), no blocking of normal commands.
5. **Agent NL API**: `api/main.py:2163-2183` currently has API key → `handle_command` with **no rate limit and no scanner** — insert both.
- Route: `bot-dev`; tests via `test-engineer`; observe-mode telemetry reviewed after ~1 week before any enforce flip. Latency budget: <5ms added p50 (regex tier only).

### Phase 2 — Python: quarantine + token-address broker (federate with existing immune system)
1. Persist AEGIS threat verdicts into `BlacklistService` (`report_scam:388`) so detections accumulate as immunological memory in the store the bot already hard-blocks on.
2. **Token-address broker** at the paste surface: extend `quick_check` beyond Solana to EVM in `_render_token_card` (`paste_trade.py:197`, closing the "Buy button still shown on EVM" gap at `:207-208`), and pipe every pasted/embedded address through `blacklist_service.check` + `compliance.assert_compliant` before the Buy keyboard is stashed (`:223`); same for `/intel` and snipe `receive_contract` (`snipe.py:253`).
3. Per-user trust adaptation (AEGIS `TrustManager`, DB-backed not in-memory): repeated threat-flagged inputs decay trust → stricter rate limits / soft quarantine, reusing the runtime-migration pattern in `database/db.py::_ensure_schema()`.
- Route: `bot-dev` + `db-migrate`; anything touching swap/blacklist gating is **MONEY-PATH** → `money-path-reviewer` before merge.

### Phase 3 — api-ts: minimal TS port (`packages/aegis-ts`) — the genuine "extend"
1. Scanner core: YAML signature loader (same format/files as Python — one shared signature source of truth in the repo) + the ~6 semantic heuristics that are pure string logic. No ML.
2. Hono middleware wired at the three recon-identified insertion points: REST `agent.ts:2051` (`/execute`), A2A `a2a.ts:621` (`userText` materialized), MCP `mcp.ts:1519-1522` (after arg validation, **before** `chargeAgentForCall` so blocked calls aren't billed).
3. **Per-agent trust table** (Drizzle, keyed `agents.id`): trust score w/ decay, threat-event counters, `quarantinedUntil`; read in `agentBearerAuth` (`auth.ts:180`) beside `applyEffectiveTier`; written from scanner verdicts + `incrementAgentStats` call sites. DB-backed → also fixes the rate-limit-per-replica multiplication.
4. Outbound sanitization: schema-validate + filter the MPP directory passthrough (`mcp.ts:570`) and scrub reflected free-text in A2A unknown-command echo (`a2a.ts:338`).
- Route: `api-ts-dev`; Effect-TS idioms (Context.Tag + Layer, `Effect.tryPromise` at boundaries); `bun run check` incrementally.

### Phase 4 — Hardening quick wins (do regardless of AEGIS; small, independent PRs)
1. Apply `safe_md` at `paste_trade.py:214-233`, `support.py:196`, `api/main.py:2675-2679` (Railway payload → admin chat).
2. WhatsApp signature verification **fail-closed** when `WHATSAPP_APP_SECRET` unset (prod).
3. Wire `InputSanitizer` where useful or delete it (dead defense is worse than none).
4. Drop/backfill the plaintext `agents.api_key` column (keep hash only) — **MONEY-PATH review**.
- Route: `bot-dev` / `api-ts-dev` / `db-migrate`; `/bugclass` fits items 1–2.

### Phase 5 — Stretch / upstream contributions (only after 1–4 prove out)
- Deploy `aegis-monitor` as a Railway service in observe mode for fleet visibility over bot + api-ts scanners (it's upstream's most mature component; dual SQLite/Postgres backends fit Railway).
- Contribute upstream: our crypto signature pack, the TS port, and an FP/FN calibration harness against our real observe-mode telemetry (upstream explicitly names calibration as its "appropriate next step").
- Skip for now: sentinel (needs a multi-agent social network we don't have), integrity module (no local model files), aegis_proxy (no LLM egress worth proxying beyond what Phase 1 wraps in-process).

## 5. Risks & mitigations
| Risk | Mitigation |
|---|---|
| FPs block real trades/commands | Observe-first per surface; enforce only after telemetry review; `confidence_threshold` stays ≥0.8; single-heuristic hits capped at 0.5 by design |
| Latency on hot paths | Regex/heuristic tier only (sub-ms); no `[ml]`/`[embeddings]` extras in request path |
| Pre-1.0 upstream churn / abandonment (4 stars) | Fork-pinned dep; core has zero exotic deps; MIT lets us hard-fork if upstream dies |
| Trust/quarantine state in memory across replicas | All new trust/quarantine state DB-backed from day one (both stacks) |
| Scanner itself on the money path | Phases 2–3 gating changes tagged MONEY-PATH → Opus review; scanner failures fail-open for commands, fail-closed only for the paste-surface Buy gate |

## 6. Effort estimate
Phase 1: ~2–3 sessions. Phase 2: ~2 sessions (+review). Phase 3: ~3–4 sessions. Phase 4: ~1 session. Phase 5: unscoped stretch. Each phase ships independently via `/ship`; verify with `scripts/verify.sh` + `python3 scripts/status.py` per standing rules.

## Appendix — research artifacts
Full per-agent reports (module map w/ LOC, detection-layer deep dive, companion-package audit, roadmap/positioning, api-ts surface map, Python surface map) were produced in-session; the file:line references above are drawn from them and were current as of `main` on 2026-08-02. Aegis upstream at commit `e3e87b3`.
