# Prod Verification Results — Railway env pull (2026-08-15)

Executed the CEO memo §3 runbook directly against Railway project `suwappu` (production env), services `python-api` + `python-worker`. OAuth connection returns **variable names only (values redacted)** — presence/absence is confirmed; non-emptiness of set vars is not.

## Verdicts

| Check | Result | Consequence |
|---|---|---|
| `FEE_COLLECTOR_ADDRESS` | **SET** (both services) | EVM fee collection wired. Value not visible — confirm non-empty via Railway dashboard. |
| `JUPITER_REFERRAL_ACCOUNT` / `_ACCOUNTS` / `_FEE_MINT` | **SET** (both services) | Solana on-swap fee collection wired via Jupiter referral. |
| `FEE_COLLECTOR_SOLANA` | **NOT SET** | `fee_service.py:632-640`: `sweep_all_fees` gets `collector=None` for chain=="solana" → **every Solana fee sweep fails**, permanently, marked `success: False`. Compounds CFO finding #3 (no Jupiter claim job): Solana fees accrue at referral accounts but nothing can move them. Fix: set the var + build the claim job. |
| `COMPLIANCE_MODE` | **NOT SET** (either service) | Defaults to `disabled` (`compliance_service.py`) → **CONFIRMED: zero OFAC/sanctions screening live in prod** on all swaps and all bridge corridors. CEO memo reversal trigger applies: halt new bridge-corridor launches until set. Fix needs a product decision (mode + screening provider), then one env var. |
| `LLM_MULTI_PROVIDER_ENABLED` | SET, value unknown | If `false`, CAIO's HIGH stands (process-local LLM cost caps only). Check the value in the Railway dashboard — one click. |
| `NL_TRADING_ENABLED` | SET on python-api (+ model/provider vars) | NL trading is live → the LLM cost-control question is material, not theoretical. |
| Turnkey overage rate | STILL UNVERIFIED | Not a Railway var — needs the Turnkey invoice/billing portal. Only remaining human-only item. |

## Escalations out of this pull

1. **COMPLIANCE_MODE disabled in prod** — promoted to fix-this-week list (was "verify first"). Owner: cco decides mode, deploy-ops sets var.
2. **FEE_COLLECTOR_SOLANA unset** — new confirmed finding: Solana sweep permanently broken. Owner: bot-dev (var + Jupiter claim job, MONEY-PATH review before merge).
3. Two one-click human checks remain: value of `LLM_MULTI_PROVIDER_ENABLED`, and non-emptiness of `FEE_COLLECTOR_ADDRESS` — both visible in the Railway dashboard with a session token.
