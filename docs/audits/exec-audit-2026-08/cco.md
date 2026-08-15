# CCO Audit — Compliance Exposure (exec-audit-2026-08)

## 1. CUSTODY — BLOCKER
Marketing claims "non-custodial" unconditionally; the default bot wallet path is custodial.
- `bot/services/turnkey_client.py:5` docstring claims keys "never touch our servers", but `create_sub_organization` (:322-341) sets the sole root user / quorum threshold=1 to **Suwappu's own server-held API key** — no user passkey co-signer. The server can unilaterally sign for any user sub-org.
- `bot/services/turnkey_fallback.py:193-250` + `bot/utils/envelope_crypto.py`: per-wallet backup key decrypted **server-side** on circuit-breaker trip or `turnkey_fallback_mode="manual"` — directly contradicts "never touch our servers".
- `bot/handlers/inline_query.py:162`: "non-custodial cross-chain swaps" stamped on every shared price card, unqualified.
- `bot/services/tos_service.py:19-20` correctly distinguishes self-custody vs custodial mode — the team knows the distinction; the marketing surface doesn't apply it. `webapp/src/pages/Wallet.tsx:592-593` describes a genuinely client-side passkey flow — must not be conflated with the bot's server-authorized flow.
**Fix:** gate every "non-custodial"/"self-custody" string on `wallet.provider in EXTERNAL_PROVIDERS`; outside counsel on whether server-sole-quorum Turnkey is defensible as "non-custodial" at all.

## 2. FEE DISCLOSURE — fix-before-ship
- Full wizard discloses platform fee before confirm (`bot/handlers/swap.py:1169,1810`) — good.
- `/s` quickswap (`quickswap.py:207-218`) shows Gas/Bridge/Total only — **platform fee never itemized**, while `swap_engine.py:1484-1500` silently nets `platform_fee_bps` into `to_amount_human`. Classic undisclosed-markup pattern. (Corroborates CMO finding #2.)
- `tos_service.py:20` states flat "1% fee on all swaps"; code implements tiered 1.0%→0.1% (`fee_service.py`, `docs/DATAROOM.md:180-184`). ToS stale.
**Fix:** platform-fee line on quickswap confirm; correct ToS fee clause.

## 3. BRIDGE / SANCTIONS — fix-before-ship
- Real OFAC screening exists (`bot/services/compliance/compliance_service.py`, wired at `swap_engine.py:4169-4183`) but **defaults to `compliance_mode="disabled"`** (`bot/config/settings.py:625-632`). If prod env unset, every bridge (Allbridge, Symbiosis, NEAR Intents, USDT0, Lattice, btc_bridge) executes with zero sanctions screening.
- Module docstring (:35-42) admits bulk_pay and CCTP bridge legs are unscreened; OFAC list static, no SDN refresh schedule.
- No per-bridge-provider jurisdiction gating; all rely on the disabled-by-default app-layer screen.
**Fix:** confirm prod `COMPLIANCE_MODE` now; close bulk_pay/CCTP gap or accept in writing; schedule SDN refresh.

## 4. XSTOCKS — monitor (well-controlled)
`bot/config/xstocks.py:230-269` fail-closed geo-gates US/GB/CA/AU; no securities language in registry. Recommend brand-guardian pass over `bot/handlers/stocks.py` copy.

## 5. ToS SINGLE SOURCE — monitor
Only binding ToS text is the in-bot `TOS_TEXT` string (`tos_service.py`, enforced via `bot/utils/tos_utils.py`). Webapp/showcase legal copy consistency unchecked this pass.

## Minimum changes to ship
(a) qualify custody copy by wallet provider; (b) platform-fee line on quickswap confirm; (c) confirm/fix prod compliance_mode; (d) correct ToS fee clause to tiered schedule.
