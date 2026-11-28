# Suwappu Bank — execution plan (Nov 2026)

Goal: ship every idea on the "crypto neobank ideas" brief as working code on top of
the existing custody / swap / Morpho / P2P / x402 substrate. No scope cuts: where a
feature needs an external licence, provider key or capital, the code path is built
behind a provider adapter and the missing input is listed in **Blockers** — never
silently dropped.

## Shape

- All new backend lives in **api-ts** under the `bank` domain.
  - Webapp users: `/webapp/bank/*` (Telegram `telegramAuth()`).
  - Agents + embedded partners (BaaS): `/v1/agent/bank/*` (API key / x402).
  - Provider webhooks: `/bank/webhooks/:provider` (signature-verified).
- Tables are prefixed `bank_`; Drizzle schema in `api-ts/src/db/schema/bank*.ts`.
- Money is integer minor units in `numeric`/string — never floats.
- Every fund-moving path is tagged `MONEY-PATH` and goes through `money-path-reviewer`.
- Execution reuses the existing signing path (Turnkey / fallback) — no new custody.

## Modules → brief coverage

| # | Module | Brief items covered |
|---|--------|---------------------|
| M0 | **Core**: accounts, double-entry ledger, transfer executor, idempotency | dollar accounts where banks fail; global from day one |
| M1 | **Multi-currency + FX**: USDC/USDT/EURC/BRZ/XSGD/MXNB accounts, direct local↔local swap | local-currency stablecoins without routing through dollars |
| M2 | **Earn**: vault deposit/withdraw (Morpho), auto-sweep idle balance, yield accounting | start with yield; balances+yield stay in-app |
| M3 | **Credit**: revolving line against collateral + DeFi positions, real-time LTV, liquidation alerts; score-based undercollateralized limit engine; receivables financing | credit is where the business is; onchain origination; revolving lines w/ real-time LTV; credit lines from defi positions |
| M4 | **Remittance**: send to handle/phone/address, claim link, recipient auto-gets account (+earn, +credit history), local payout sandwich | remittance into a bank; sandwich w/ local offramp; cash out locally |
| M5 | **Ramps**: provider adapters (Bridge, + pluggable), virtual accounts, local rails (PIX/UPI/SPEI/VietQR/SEPA/ACH), best-quote liquidity router | last mile; local-fiat liquidity; clever onramps; qr + real-time rails |
| M6 | **Cards**: issuing adapter, card on stablecoin balance, programmable controls (date windows, MCC/merchant allowlists, per-tx/daily caps), auth webhook rule engine | card on a stablecoin balance; expense cards that only turn on for travel dates / merchants |
| M7 | **Payments**: payment links, invoices, QR, escrow release-on-delivery, streaming/micropayments | escrow that releases on delivery; microtransactions |
| M8 | **Payroll & payouts**: batch + recurring payroll, contractor payouts, instant payout pool w/ later settlement | workers paid across borders; pay out in seconds from a stablecoin pool |
| M9 | **Business**: orgs, roles, approvals, treasury, vendor payments, collections, single-denomination books export, corporate cards | corporate dollar banking; corporate cards for treasury/expenses |
| M10 | **Agents**: agent accounts, agent↔agent pay-per-call (x402 both sides), spend policies, metered settlement without invoices | agents paying each other; wallet easier than a bank account |
| M11 | **Platform / BaaS**: embedded accounts API for third-party apps, bank-core connector, branded stablecoin adapter w/ reserve-yield share, open payment-request standard + resolver | bank inside an app people already use; branded stablecoin; layer for banks; open network standard; one global platform |
| M12 | **Payments chains + privacy**: Tempo (stablecoin gas, predictable fees) routing, fee model endpoint, stealth-address private payouts w/ compliance view keys | payments-first chain; privacy + compliance parity for payroll/b2b |
| M13 | **Verticals**: segment profiles (creators, athletes, nomads, cross-border SMEs, sharia-compliant = interest-free mode) driving defaults | serve one niche extremely well |
| M14 | **Surfaces**: webapp Bank hub + pages, bot `/bank`, SDK types, MCP tools | everything reachable |

## Order

1. M0 + M1 foundation (schema, ledger, executor, route + layer wiring).
2. Fan out in parallel on disjoint files: M2/M3 · M4/M5 · M6 · M7/M8 · M9 · M10/M11/M12/M13.
3. M14 surfaces (webapp, bot, SDK, MCP).
4. Money-path review → fix → push → deploy dev → live checks.

## Blockers (external inputs, tracked — not scope cuts)

Filled in as discovered during the build. Expected: ramp/card provider API keys +
KYB, issuing BIN sponsor, capital source for undercollateralized credit, licensing
per corridor.

### Blocker: credit-card refund settlement into the lender pool

A provider refund on a credit-funded card lands at the card program's settlement address
(`BANK_CARD_SETTLEMENT_ADDRESS_EVM/_SOLANA`), which is program-owned, not a Suwappu custody
wallet, so the API cannot sign the sweep. Until it is swept, the refund stays a pending op
(`bank_credit_ops.op_key = cardref:<providerTransactionId>`), visible as event
`card_refund_pending` ("refund received by card program — awaiting settlement to lender pool")
and in `GET /credit/refunds/pending` (amount, age, totals). No interest accrues on that amount
from the refund time. The debt drops only when a confirmed transfer into the line's pool account
carries `metadata.cardRefundTxn = <providerTransactionId>`.

Closes with ONE of: (a) ops signs a transfer from the settlement address to the pool account and
records it with that metadata (needs a privileged ops endpoint, not built); (b) the provider
supports refund-to-address or a webhook with an on-chain settlement tx hash we can verify.
Ops-wide (all owners) listing is not built; only owner-scoped.
