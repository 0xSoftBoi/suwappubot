# Business Model Review — Turnkey $99 Plan & Monetization (Aug 2026)

**Question:** We pay $99/mo (Turnkey Pro, 2,000 wallets included), then per-usage overage. Markup it, raise our prices, or scrap the vendor?

**Recommendation: scrap it (self-host custody), with a markup as stopgap.** Do NOT raise user-facing prices — our fee structure is already a competitive asset.

---

## 1. The vendor bill (confirmed: Turnkey)

Turnkey Pro is $99/mo with 2,000 wallets, then per-signature billing — an exact match for our bill. Integration: `bot/services/turnkey_client.py:305-366`, `api-ts/src/services/TurnkeyService.ts:76-79` (sub-org per user, keys in TEE, sentinel `"turnkey_managed"` in `bot/services/wallet.py:381`).

**UNVERIFIED:** exact contracted overage $/signature — Turnkey's public page self-contradicts ("unlimited" vs "$0.05/sig"). Pull the actual invoice before committing to any markup math.

## 2. The structural asymmetry that decides this

- **Vendor pricing scales with wallet count** (existence).
- **Our revenue scales with swap volume** (activity).
- **Self-hosted KMS cost scales with signing volume** — ~$1/mo per CMK + ~$0.03/10k requests ([AWS KMS pricing](https://aws.amazon.com/kms/pricing/)).

Paying per-wallet while earning per-swap means dead wallets bleed margin forever. Self-hosting aligns cost with revenue.

| Wallets | Turnkey (est.) | Self-hosted KMS (est., ~10 sigs/wallet/mo) |
|---|---|---|
| 2,000 | $99/mo | ~$1–5/mo |
| 5,000 | ~$150–350/mo (UNVERIFIED overage rate) | ~$5–15/mo |
| 10,000 | likely forced to Enterprise custom | ~$10–30/mo |
| 25,000 | plausibly $1,000s/mo | ~$30–75/mo |

**Key fact:** we already run a self-hosted signing path in production as the Turnkey circuit-breaker fallback — envelope-encrypted AES-GCM keys wrapped by AWS KMS (`bot/services/turnkey_fallback.py`, `bot/services/kms_client.py`, `docs/KMS_AWS_MIGRATION.md`). Promoting fallback → primary is an ops + security-review task, not new engineering.

**Trade-off accepted:** Turnkey's TEE means keys never touch our infrastructure; self-hosting moves us to software envelope encryption and increases our custody blast radius + compliance surface. This is a MONEY-PATH decision requiring `money-path-reviewer` + `security-auditor` (Opus) sign-off before implementation.

## 3. Why NOT raise prices (option b)

Every competitor is fee-only, no subscription:

| Bot | Fee |
|---|---|
| BonkBot | 1% flat |
| Trojan | ~1% (0.9% w/ referral) |
| Maestro | 1% flat |
| Banana Gun | 0.5% manual / 1% sniper |
| Photon | ~0.5%/side |
| BullX | ~0.5% |

Our tiers (`bot/services/fee_service.py:34-39`): FREE 1.0% / PRO 0.5% / PREMIUM 0.3% / ENTERPRISE 0.1% — we match the market at FREE and undercut everyone above it. Raising fees or gating behind subscriptions ($9.99/$29.99/$99.99 tiers in `api-ts/src/db/schema/points.ts`) to cover a ~$99–350/mo vendor bill would spend competitive position to solve a cost problem that has a $30/mo engineering answer.

## 4. Decision & sequencing

| Phase | Action | Owner | Gate |
|---|---|---|---|
| Now | Pull real Turnkey invoice; get contracted overage rate | founder | replaces UNVERIFIED numbers |
| Now | **Activity-gated wallet creation** — provision Turnkey wallet on first deposit, not `/start` | bot-dev | caps wallet-count exposure regardless of path chosen |
| Now (stopgap) | If overage already accruing: pass through at cost + 20–30% markup via fee line, **with disclosure** (undisclosed execution markup is the classic enforcement pattern — cco check) | cfo/cco | disclosure shipped with the charge |
| Next | Security review: promote `turnkey_fallback.py` KMS path to primary custody | money-path-reviewer + security-auditor (Opus) | explicit sign-off on TEE→software-envelope trade |
| Then | Dual-run: new wallets on KMS path, existing stay on Turnkey; migrate on user activity | coo/bot-dev | live e2e swap on KMS-path wallet |
| Then | Drop to Turnkey free tier (1,000 wallets) or cancel; keep integration code as *their* fallback | deploy-ops | invoice at $0–99 |

**Negotiating note (cso):** a working self-host path is renewal leverage even if we never fully migrate — mention it before the next Turnkey renewal.

**Reversal trigger:** if the Opus security review rejects software-envelope custody as primary, fall back to: activity-gated creation + inactive-wallet reaping + at-cost overage pass-through, and renegotiate with Turnkey using the credible-exit position.

## 5. Executive agent fleet (shipped alongside this report)

Ten C-suite agents added to `.claude/agents/`, all Sonnet (Opus stays reserved for existing quality gates per the conductor protocol):

`ceo` (decisions), `cfo` (unit economics), `cto` (build-vs-buy), `coo` (rollouts), `cmo` (pricing perception/competition), `cco` (compliance — markup disclosure, custody classification), `cso` (strategy/vendor leverage), `cao` (metrics — owns "active wallet" definition), `cdo` (data lifecycle/dual-ORM governance), `caio` (AI fleet economics + agent-facing API monetization).

Route this document's follow-ups: invoice math → `cfo`; custody migration plan → `cto` then `coo`; markup disclosure → `cco`; renewal posture → `cso`.

---
*Sources: turnkey.com/pricing, aws.amazon.com/kms/pricing, MEXC bot survey 2026, solanatools.io fee comparison 2026. Codebase refs current at commit on branch `claude/business-model-pricing-72ltoq`.*
