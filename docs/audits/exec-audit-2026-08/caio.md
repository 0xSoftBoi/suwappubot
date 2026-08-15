# caio — AI Systems Executive Audit (2026-08-15)

Scope: LLM usage/cost control (bot side), agent-facing metering (api-ts), prompt-injection surface, internal agent fleet roster.

---

## 1. LLM usage in the product

**Overall: this is the best-engineered subsystem in the repo.** Single call site, cost-weighted distributed budget, per-provider usage normalization, tier gating, markup math all correct.

### 1.1 [INFO] Single LLM call site, no shadow paths
`bot/services/nl_intent_service.py` is the ONLY place `anthropic.AsyncAnthropic`/`openai.AsyncOpenAI` are constructed in `bot/` (confirmed via repo-wide grep for `.messages.create`/`chat.completions.create` — zero other hits). Every LLM call in the product goes through this one module, which always routes through `bot/config/llm_models.py` (catalog/pricing) and `bot/services/llm_credit_service.py` (metering) when multi-provider mode is on. No parallel/undocumented LLM integration exists (no LLM calls found in `api-ts/` route/service code either — `api-ts/src/routes/agent.ts:2050`'s `/execute` "natural language command execution" is pure regex, not LLM-backed, despite the name — see 2.1).

### 1.2 [HIGH] Primary cost control is disabled by default; fallback control is architecturally weak
- `bot/config/settings.py:1138` — `LLM_MULTI_PROVIDER_ENABLED` defaults `False`.
- `bot/config/settings.py:1095` — `NL_TRADING_ENABLED` (master switch for the whole NL-trading feature) also defaults `False`.
- When `LLM_MULTI_PROVIDER_ENABLED=False`, `nl_intent_service.py:723` skips `reserve_budget`/`settle_budget` entirely — the Redis-backed, cost-weighted, cross-replica `llm_budget` (`bot/utils/llm_budget.py`) never engages.
- The ONLY cost control left on that legacy path is `_llm_fallback_cap_exceeded` (`nl_intent_service.py:316-327`), backed by **plain in-process dicts** (`_fallback_counts_by_user`, `_fallback_counts_global`, `nl_intent_service.py:308-309`) — not Redis, not shared across replicas, reset on every deploy.
- Default caps: `NL_LLM_FALLBACK_PER_USER_DAILY=30`, `NL_LLM_FALLBACK_GLOBAL_DAILY=5000` (`bot/config/settings.py:1124-1131`). With N replicas the *effective* ceiling is `cap × N` — the module's own docstring (`bot/utils/llm_budget.py:1-7`) and `capabilities.yaml:451-455` both document this exact failure mode, so it's a known, accepted risk, not a hidden bug — but it means the safety net most likely to be live in production (the flag defaults off) is the weaker one.
- **Cost/risk if spammed**: legacy path default model is `claude-haiku-4-5-20251001` (~1500 in / 300 out tokens/call per `ESTIMATED_INPUT_TOKENS`/`ESTIMATED_OUTPUT_TOKENS`, `llm_credit_service.py:208-209`) ≈ $0.003/call raw. At the documented default caps that's ~$15/day/replica-instance in the worst case before any budget check — bounded, but scales linearly with replica count with no backstop, and this path is **unmetered against user credits** (it predates the credit system), so it is 100% platform-borne cost.
- **Fix**: confirm via Railway env inspection whether `LLM_MULTI_PROVIDER_ENABLED`/`NL_TRADING_ENABLED` are actually `true` in prod (not verified in this audit — no Railway tool access this session; flag for `deploy-ops`/`coo` to confirm). If NL trading is live in prod, treat enabling `LLM_MULTI_PROVIDER_ENABLED` as a P1 — it's not a partial rollout, it's the difference between a Redis-backed $25/day global cap and an unbounded-by-replica-count fallback counter.

### 1.3 [INFO] Pricing table is accurate and self-auditing
`bot/config/llm_models.py` prices verified against live search (2026-08-15): Claude Sonnet 5 $2/$10 intro → $3/$15 post-2026-08-31 (file deliberately prices at the **post-intro** rate to avoid under-charging, `llm_models.py:194-206` — correct call), Claude Haiku 4.5 $1/$5 (matches). The file has a self-expiring staleness check (`assert_price_table_fresh`, 60-day max age) and a markup applied via `LLM_CREDIT_MARKUP` (default 1.5x, `llm_credit_service.py:46`). No drift found.

### 1.4 [INFO] Tier gating enforced server-side, not just UI
`bot/handlers/llm_model.py` and `nl_intent_service.py:595-625` (`_resolve_user_model`) both re-check `spec.is_tier_allowed(user_ctx.tier)` — a FREE user cannot select `claude-sonnet` (PREMIUM-gated) even by forging a preference string; `resolve_model()` silently falls through to the tier-allowed default. Billing correctly gates on `spec.metered`, not `min_tier` (comment at `nl_intent_service.py:611-613` calls this out explicitly) — a FREE-selectable model can still be metered, which is the right invariant.

---

## 2. Agent-facing surface (api-ts) — is x402 enforced everywhere?

### 2.1 [INFO] `/v1/agent/execute` is not LLM-backed despite its name
`api-ts/src/routes/agent.ts:2050-2295` — "Natural language command execution" is pure regex (`lowerCommand.match(/swap\s+.../)`), not a model call. No prompt-injection or unbounded-LLM-cost risk here; it's metered at 5 credits (`COST_WEIGHTS.execute`, `x402Payment.ts:41`) for what is actually a cheap regex parse — arguably over-priced relative to its real compute cost, but that's a pricing-coherence note for `cfo`, not a security gap.

### 2.2 [INFO] Metering coverage is consistent
- REST: `agentRoutes.use('/quote'|'/swap'|'/execute'|'/swap/execute'|'/swap/simulate'|'/portfolio'|'/prices'|'/tokens', meteredPayment(...))` (`agent.ts:530-538`) covers every state-changing or paid-data endpoint. `/billing` and `/billing/topup` are explicitly excluded (correct — can't require payment to pay).
- MCP: `api-ts/src/routes/mcp.ts:1523-1601` charges via `chargeAgentForCall`/`costForTool` before dispatch, uniformly across all 20+ tool cases (`mcp.ts:1617-1686`), with `list_chains`/`list_tokens`/`get_tempo_tokens`/`browse_mpp_directory` deliberately free (discovery, matches REST's free `/tokens`,`/chains`).
- Rate limiting: `rateLimit()` applied to essentially every mutating/read-metered route (`agent.ts:486-513`), plus an extra `ipRateLimit(30)` specifically on the owner-facing JWT approval endpoints (`agent.ts:518-521`) to blunt brute-force/scripted approve-spam independent of per-agent limits.

### 2.3 [MEDIUM] `BYPASS_TIERS` includes a literal tier named `'agent'` — verify no self-service path can reach it
`api-ts/src/middleware/x402Payment.ts:98` — `BYPASS_TIERS = new Set(['agent', 'pro', 'premium', 'enterprise'])`. `agents.rateLimitTier` defaults to `'free'` at the schema level (`api-ts/src/db/schema/agents.ts:41`) and no write path in `api-ts/src` sets it to `'agent'` (grep confirmed) — it appears to be an ops/admin-only manual promotion for trusted partners, not self-service. **Not currently exploitable**, but the tier name collision with the product noun "agent" is a footgun: a future PR that programmatically sets `rateLimitTier` based on caller type (e.g. "if caller is an AI agent, tier = 'agent'") would silently zero out metering for every agent on the platform. Recommend renaming to something unambiguous (e.g. `'partner'`) or adding an inline comment at the schema default plus a test asserting no registration/update code path can set this tier without going through an admin-only route.

---

## 3. Prompt-injection surface

### 3.1 [INFO] The one LLM→action path has real instruction/data separation
`bot/services/nl_intent_service.py` is the only place untrusted text reaches an LLM that can influence a money-adjacent action (trade intent → confirmation flow). Defenses present:
- Explicit delimiter wrapping (`_USER_MSG_OPEN`/`_USER_MSG_CLOSE`, `nl_intent_service.py:179-184, 249-257`) with **injection-proof escaping**: both the live message and any echoed prior-turn fields strip literal delimiter sequences before re-embedding, so untrusted text can't forge a fake closing tag and escape into instruction context (`_sanitize_echo_field`, `nl_intent_service.py:187-199`; `_build_user_content`, `:249-257`).
- System prompt explicitly instructs the model to treat `<user_message>` content as data-only and ignore embedded role/rule redefinition attempts (`_SYSTEM_PROMPT`, `nl_intent_service.py:153-155`).
- **Forced tool-choice, not free text**: every call sets `tool_choice={"type":"tool"/"function", "name": "record_trade_intent"}` (`:422`, `:485`) — the model cannot emit prose or a different tool; output is constrained to a fixed schema.
- The module **never executes** — it only produces a `TradeIntent`. Actual execution is gated behind the existing confirm-swap flow (2FA), a boundary the module's own docstring states as a hard invariant (`nl_intent_service.py:1-13`).
- Server-side re-validation of the confidence/required-field gate (`_apply_confidence_gate`, `:231-246`) — doesn't trust the model's self-reported confidence for the swap path.

This is a solid, textbook mitigation (delimiters + forced schema + no-execute boundary + server-side re-check). No changes recommended.

### 3.2 [LOW] AEGIS injection scanning is observe-only on both surfaces
- Bot side: `await get_aegis().ascan(...)` (`nl_intent_service.py:706-711`) is explicitly "Phase 1, observe-mode only... never blocks or alters this parse flow."
- Agent-API side: `scanForThreatsObserveOnly(command, ...)` (`api-ts/src/routes/agent.ts:2083-2095`) — same, log-only, feeds `AgentTrustService` but never gates `/execute`.
- Given `/execute` isn't actually LLM-backed (3.1/2.1) this is lower stakes than it looks, but if `/execute` or any future agent-facing endpoint becomes LLM-backed, confirm AEGIS moves from observe to enforce before that ships — flag for `security-auditor` at that point, not now.

---

## 4. Internal fleet roster (`.claude/agents/*.md`)

### 4.1 [INFO] No tier drift found — Opus usage matches doctrine exactly
Grep of all 26 agent files' `model:` frontmatter confirms only `art-director`, `money-path-reviewer`, `security-auditor`, `suwappu-lead` are `opus` — exactly the four CLAUDE.md names as the quality gates. Every dev/exec/research agent (including the 10 C-suite personas: `ceo cfo coo cmo cco cso cto cdo cao caio`) is `sonnet`; `scout` is `haiku`. As authored, the roster enforces the conductor doctrine correctly.

### 4.2 [LOW] C-suite personas (10 agents) aren't in CLAUDE.md's routing table
`ceo, cfo, coo, cmo, cco, cso, cto, cdo, cao, caio` exist and are well-scoped (each has a distinct, non-overlapping domain sentence) but none appear in the "Routing table" in `CLAUDE.md`. That table is for the conductor's automatic day-to-day dev-task routing, and these are evidently invoked directly/on-demand for exec-style audits (as this one was) — that's a reasonable split, but it's implicit. Recommend one line in CLAUDE.md noting the C-suite roster is invoked directly by name for strategic/audit questions, not auto-routed, so a future reader doesn't conclude they're dead/unrouted agents.

### 4.3 [LOW] `caio.md` references a skill that doesn't exist
This agent's own definition (`.claude/agents/caio.md`, "Pricing AI features" bullet) says to "verify against current model pricing (use the claude-api skill reference, never memory)." No `claude-api` skill exists under `.claude/skills/` (contents: `aegis-goal, design-iterate, goal, redesign-skill, taste-skill` — confirmed via `find`). This session fell back to `WebSearch` to verify Sonnet/Haiku pricing (§1.3), which worked, but the referenced skill is a dangling pointer. Fix: either author `.claude/skills/claude-api/SKILL.md` with a maintained pricing table + fetch instructions, or edit `caio.md` to say "WebSearch the current Anthropic pricing page" instead of citing a skill that isn't there.

### 4.4 [INFO] No meaningful roster overlap found
Checked the most collision-prone pairs:
- `cto` (sonnet, build-vs-buy/feasibility) vs `suwappu-lead` (opus, "genuinely large multi-service architecture... do NOT spawn for a single-service task") — cleanly separated by scope and the latter's own frontmatter says so.
- `reviewer` (sonnet, general code quality) vs `security-auditor` (opus, OWASP/secrets) vs `money-path-reviewer` (opus, funds/keys/billing diffs only) — three different trigger conditions (any change / security posture / MONEY-PATH tag), not redundant.
- `cdo` (data governance/lifecycle) vs `cao` (KPI/metrics computation) — different domains (what we store vs. what the numbers say).
No agent found that's an 80%+ duplicate of another; no retirement candidates identified this pass.

---

## Summary of actionable items

| # | Sev | Item | Owner |
|---|-----|------|-------|
| 1 | HIGH | Confirm `LLM_MULTI_PROVIDER_ENABLED`/`NL_TRADING_ENABLED` prod values on Railway; if NL trading is live, the Redis budget must be on — the fallback-only path scales cost with replica count | `deploy-ops`/`coo` |
| 2 | MEDIUM | `BYPASS_TIERS` includes `'agent'` — rename or guard against future auto-assignment zeroing out metering | `api-ts-dev` |
| 3 | LOW | `/v1/agent/execute` priced like a 5-credit LLM call but is regex — pricing-coherence check | `cfo` |
| 4 | LOW | Point `caio.md`'s "claude-api skill" reference at something real | `caio` (self) |
| 5 | LOW | CLAUDE.md: note C-suite agents are invoked directly, not conductor-routed | doc fix |

No prompt-injection or metering-bypass vulnerabilities were confirmed exploitable in the current code. The design of the metered LLM path (§1, §3.1) is a model implementation — the main risk is operational (is the good system actually turned on).
