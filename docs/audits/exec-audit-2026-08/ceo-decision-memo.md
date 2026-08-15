# CEO Decision Memo — Exec Audit Synthesis (2026-08-15)

> **REVISION (same day, post-verification): the this-week list below is superseded.**
> The Opus money-path review (`money-path-review.md`) BLOCKED this memo as written, and the prod env pull (`verification-results.md`) resolved the unknowns. Corrected priorities:
>
> 1. **`/s` quickswap + all NL trades collect $0 platform fee** — `record_fee` is never called from quickswap; flagship command is entirely fee-free (REFUTED the "non-disclosure" framing; this is a HIGH revenue leak). Fix must ship fee + disclosure line in the same commit — it is a live price increase.
> 2. **Set `COMPLIANCE_MODE` in prod** — confirmed unset → OFAC screening disabled on every swap/bridge today. cco picks mode; deploy-ops sets var.
> 3. **`/rewards` import shadowing** (confirmed, worse than stated: handler never registered at all) — but `rewards_claim_callback` has never executed in prod and credits custodial balances; review it BEFORE the one-line fix makes it reachable.
> 4. **Phantom-fee root cause**: add `SwapQuote.fee_bearing`, gate `record_fee` + sweeper on it — one fix covers USDT0 (latent), layerzero/cctp/ccip/across/wormhole (live), and the collector-unset class. Also set `FEE_COLLECTOR_SOLANA` (confirmed unset → Solana sweep permanently failing).
> 5. **`totpSecret`/`db:push` gate** (unchanged from below) — still this-week.
>
> Downgraded: USDT0 alone (latent — feature flag off), points-store ENTERPRISE (redemption code verified sound; issuance-side risk accepted, cheap lever = deactivate the reward row). Cleared by scout: no dead mainnet chains; boot/parse audit clean.

## Framing
Nine execs read the same codebase for money-path, custody, compliance, data-integrity, and ops risk. The single most consequential unknown across all nine reports is **whether Suwappu is actually collecting the fee it thinks it's collecting** — CFO, CCO, and CAIO each independently hit an unverified prod env var that gates real revenue or real risk controls. That's the deadline-forcing constraint: we cannot prioritize anything else credibly until those values are pulled from Railway.

---

## 1. TOP-10 CROSS-CUTTING FINDINGS (blast radius × likelihood)

| # | Issue | Sev | Found by | Owner | MONEY-PATH |
|---|---|---|---|---|---|
| 1 | 18+ background services (`fee_sweeper`, `order_service`, `btc_bridge_poller`, etc.) boot with bare `await x.start()` — one bad env var/provider-client throw crashes the **entire** bot+API, not just that feature (`api/main.py:310-459`) | HIGH | coo | bot-dev + deploy-ops | No (infra), but takes down money-path services |
| 2 | Fee collection may be a **total no-op**: `fee_collector_address`/`fee_collector_solana`/`jupiter_referral_account` default `None`; unverified in prod. If unset, 100% of EVM or Solana swap volume collects $0 (`bot/config/settings.py:1340-1399`) | HIGH | cfo | deploy-ops (verify) → bot-dev if broken | **Yes** |
| 3 | "Non-custodial" marketing claim (bot copy, inline price cards) contradicted by server-held sole-quorum Turnkey key + server-decryptable backup keys — legal/regulatory blast radius (`turnkey_client.py:322-341`, `inline_query.py:162`) | BLOCKER | cco (+ cto, cso corroborate) | cco + growth-marketing / outside counsel | **Yes** (custody) |
| 4 | `drizzle-kit push` is destructive against a shared Postgres Python owns via additive-only migrations — already dropped `recovery_email`/`recovery_setup_at` once; `totpSecret varchar(64)` vs live `TEXT` column sets up a repeat against 2FA secrets (`users.ts:42`, `db.py:1875-1877`) | HIGH | cdo | db-migrate | Adjacent (security data) |
| 5 | USDT0 bridge swaps execute with **zero fee leg** but `fee_service.record_fee` posts a phantom fee to the ledger anyway — real revenue leak + unreconcilable books (`swap_engine.py:1751-1756`, `usdt0_api.py:359-390`) | HIGH | cfo | bot-dev | **Yes** |
| 6 | BTC/Atomiq bridge: poller gives up after ~3-4 min without checking on-chain escrow, **and** has zero heartbeat/alerting — funds can sit stuck in Starknet escrow indefinitely with nobody watching (`btc_bridge_poller.py:19,94-107`; COO confirms zero monitoring coverage) | HIGH | cto + coo | bot-dev + deploy-ops | **Yes** |
| 7 | `/rewards` command collision: three handlers bind the same command; PTB first-match-wins means the shipped **fee-cashback MONEY-PATH feature is completely unreachable** (`main.py:243,438,459,594`) | HIGH | cmo | bot-dev | **Yes** |
| 8 | `recovery_email` has no confirmed DB-level unique constraint (Drizzle declares intent, Python never enforces it) — live exploit path for account-takeover via recovery-email collision per Drizzle's own code comment (`users.py:78` vs `users.ts:52`) | HIGH | cdo | db-migrate → security-auditor | Adjacent (account security) |
| 9 | `/s` quickswap never itemizes platform fee % before confirm while silently netting `platform_fee_bps` into the output amount — undisclosed-markup pattern; ToS also states flat 1% when code is tiered 0.1–1.0% (merged CMO + CCO) | MEDIUM-HIGH | cmo + cco | bot-dev (UI) + cco (ToS) | **Yes** |
| 10 | Sanctions screening (`compliance_service.py`) defaults `compliance_mode="disabled"` — if unset in prod, every bridge (Allbridge, Symbiosis, NEAR Intents, USDT0, Lattice, BTC) executes with **zero OFAC screening** | MEDIUM-HIGH | cco | deploy-ops (verify) → cco | **Yes** |

*Noted for completeness:* points-store ENTERPRISE-via-sybil-referral (cfo, MEDIUM), Turnkey wallet-creation-on-`/start` cost bleed (cfo/cso), LLM fallback cost control weak-by-default (caio), Li.Fi single-vendor cross-chain concentration (cso, strategic).

---

## 2. THE DECISION

**DECISION:** Fix the five items below this week; schedule the custody/bridge/strategic work over the next 2-4 weeks; explicitly accept three named risks rather than let them silently block the week.

**THIS WEEK (max 5, in order):**
1. **Pull the 5 Railway env-var values** (see Verification Runbook) — unblocks knowing whether #2 and #10 are live fires. `deploy-ops`, today.
2. **Fix `/rewards` collision** (#7) — one-line rename + de-shadow import. `bot-dev`.
3. **Fix `totpSecret` Drizzle type + gate `db:push`** off shared Python-owned tables (#4). `db-migrate`.
4. **Wrap the 18 bare `.start()` calls in `_track_degraded`** (#1) — mechanical, reuses existing pattern, converts total-outage into degraded-service. `bot-dev` + `deploy-ops`.
5. **Ship quickswap fee-disclosure line + correct ToS fee clause** (#9) — cheap, closes undisclosed-markup exposure. `bot-dev` + `cco`.

**SCHEDULED (2-4 weeks):**
- USDT0 fee-leg fix or ledger correction (#5) — via `money-path-reviewer` before merge.
- BTC bridge escrow-check-before-fail + heartbeats for `btc_bridge_poller`/`cctp_relayer`/`fee_sweeper` (#6).
- `recovery_email` unique index + live-schema confirmation (#8) — then `security-auditor` sign-off.
- Custody copy audit + outside-counsel opinion on server-sole-quorum Turnkey as "non-custodial" (#3) — longest lead time, start the clock now.
- Activity-gated wallet creation (Turnkey cost lever, already scoped in `docs/business/pricing-model-2026-08.md`).

**RISK ACCEPTED (named):**
- Points-store ENTERPRISE-via-sybil-referral — low observed abuse signal, no live exploit confirmed.
- Turnkey custodial hot-wallet signing lacks circuit-breaker fallback (cto HIGH) — bundle into the custody security-review track.
- Li.Fi single-vendor cross-chain concentration — strategic, not urgent-this-week; scope the fallback prototype in parallel.

**REVERSAL TRIGGER:** If the Railway pull shows `fee_collector_*`/`jupiter_referral_account` unset in prod — this becomes the #1 item company-wide, reviewed same-day. If `compliance_mode` is confirmed `disabled` in prod — halt new bridge-corridor launches until fixed. If referred-ENTERPRISE redemptions exceed 3/month, cap the points store at PREMIUM immediately. Review this list in 30 days or at the next exec-audit cycle, whichever is first.

**EXECUTION:** `deploy-ops` runs the verification runbook first. `bot-dev` takes items 2, 4, 5 in parallel once verification returns. `db-migrate` takes item 3 independently. `cco` starts the custody-copy/legal thread today (longest lead time).

---

## 3. VERIFICATION RUNBOOK — prod env vars unverifiable from code

Run against Railway `python-api` (prod) and `api-ts` (prod). Report raw values, not "looks fine."

```bash
# 1. Fee collection wiring — CFO finding #2 (blast radius: 100% of revenue)
railway variables --service python-api --environment production | grep -iE \
  "FEE_COLLECTOR_ADDRESS|FEE_COLLECTOR_SOLANA|JUPITER_REFERRAL_ACCOUNT"
# Expect: all three set to real addresses. Also confirm the Jupiter referral
# token account was created via the Jupiter Referral dashboard (a bare wallet
# address breaks /swap per settings.py docstring) — confirm, don't assume.

# 2. Sanctions screening — CCO finding #10
railway variables --service python-api --environment production | grep -i "COMPLIANCE_MODE"
# Expect: NOT "disabled". If disabled/unset, every bridge executes with zero OFAC screening.

# 3. LLM cost control — CAIO finding
railway variables --service python-api --environment production | grep -iE \
  "LLM_MULTI_PROVIDER_ENABLED|NL_TRADING_ENABLED"
# If NL_TRADING_ENABLED=true and LLM_MULTI_PROVIDER_ENABLED=false, the only live
# cost cap is process-local and scales with replica count — escalate to P1.

# 4. Turnkey overage rate — pricing-model doc, still UNVERIFIED
# Not a Railway var — pull the actual Turnkey invoice/contract (billing portal
# or account rep) to replace the assumed $0.05/sig before markup/self-host math.

# 5. Cross-check fee collection is actually landing (once #1 confirmed set)
psql $DATABASE_URL -c "
SELECT SUM(fee_amount_usd)/NULLIF(SUM(from_amount_usd),0) AS blended_take_rate,
       SUM(fee_amount_usd) AS fee_revenue_usd, COUNT(*) AS n
FROM fee_transactions ft JOIN swap_transactions st ON ft.swap_id = st.id
WHERE st.status='completed' AND st.created_at >= now() - interval '30 days';"
# Near-zero take rate despite configured collectors = collection wiring broken.
```

**Owner:** `deploy-ops`, today. Report the actual strings back, not a summary judgment.

---

**Source reports:** `docs/audits/exec-audit-2026-08/{cfo,cto,coo,cmo,cco,cso,cao,cdo,caio}.md` · context: `docs/business/pricing-model-2026-08.md`
