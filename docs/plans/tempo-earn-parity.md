# Tempo Earn Feature Parity Map

Source: https://tempo.xyz/blog/introducing-tempo-earn/ (Aug 2026)
Branch: `claude/feature-parity-rdlofp`

Tempo Earn = embedded yield on idle stablecoin balances inside the host platform.
Suwappu equivalent = the `/save` stack (Aave V3 USDC on Base, Morpho, Starknet BTC venues),
registered at `bot/main.py:521`.

| Tempo Earn feature | Suwappu status | Action |
|---|---|---|
| Opt-in yield on idle stablecoins | ✅ `/save` — Aave V3 USDC (Base), non-custodial aToken to user wallet (`bot/services/savings_service.py`) | none |
| Range of risk/return profiles (money market / lending / credit) | ✅ Aave (lending) + Morpho (curated vaults) + BTC venues (`bot/services/starknet_yield.py`) | none |
| **Spend while earning** — funds earn until needed, then become available in the same flow | ❌ swap/withdraw fail on insufficient idle USDC even when Earn covers it | **BUILD**: auto-redeem shortfall from Aave inside the swap confirm flow (USDC-on-Base sells) |
| Balances keep earning, visible in-platform | ❌ earn position not shown in `/b` or `/p` | **BUILD**: show Earn balance + live APY in balance & portfolio views |
| "Earn" naming / entry point | partial — command is `/save` | **BUILD**: `/earn` alias, same conversation |
| Transfer memos for reconciliation | ❌ | **BUILD**: optional memo on withdrawals, stored on `savings_events` (additive migration) |
| Reward distribution splits (platform keeps a cut of yield) | ➖ intentionally 0% — Suwappu passes full venue APY to users; taking a yield cut is a product/pricing decision | not built; flagged for product |
| Custom account policies (access/transfer rules) | ✅ covered by existing `/limits` handler + ToS gating (`enforce_tos`) | none |
| Fee sponsorship (platform pays gas) | ➖ users self-pay Base gas from their own wallet; sponsorship needs a paymaster/relayer | not built; flagged for product |
| Private earning (Tempo Zones) | n/a — chain-level privacy feature of Tempo's own L1 | n/a |

## Money-path review (Opus) — verdict BLOCK, fixes in progress
Findings on commits 1793904 + cf6ca00 being fixed on this branch before merge:
- **CRITICAL**: 2FA + spending-limit gates ran *after* the on-chain Earn redeem → gates hoisted ahead of the withdraw; 2FA-required path defers the redeem until after TOTP verification.
- **HIGH**: redeem stash survived state-preserving paths (replayable callback → double-withdraw) → stash popped before the withdraw + rate limit on the handler.
- **HIGH**: exact-shortfall redeem + cross-RPC balance lag could leave the swap still failing after funds moved → small over-redeem buffer, round-up wei conversion, post-redeem balance poll.
- **MEDIUM ×3**: "funds are safe" note unreachable on the likeliest failure path; no quote re-validation after the redeem; `/b`/`/p` could block ~2min on slow Base RPC (no timeout, uncached APY).
- **LOW ×2**: memo markdown escaping without parse_mode; memo button attaches to latest withdrawal instead of the tapped one (event id now carried in callback data + user-scoped update).
Verified clean by the review: wallet-identity binding, no key exposure, memo IDOR not exploitable (defense-in-depth filter added anyway), additive migration, double-tap serialization, swap-leg idempotency.

## Build items (this branch)
1. **Spend-while-earning** [MONEY-PATH]: in the swap flow, when selling USDC on Base and
   idle balance < amount ≤ idle + earn position, redeem the shortfall from Aave first,
   then proceed — one confirm screen, labelled "includes X USDC redeemed from Earn".
2. **Earn visibility**: `/b` and `/p` show the Aave position (+APY) when non-zero.
3. **`/earn` alias** for the savings conversation.
4. **Withdraw memos**: `memo` column on `savings_events` (additive, idempotent) + optional
   memo capture in the withdraw flow.
