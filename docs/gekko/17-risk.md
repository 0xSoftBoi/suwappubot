# Risk

Gekko inherits real fraud/chargeback/reserve exposure the moment it launches
a card and credit line (see `05-cards.md`, `06-credit.md`) — surface area
Suwappu's current pure-swap product doesn't have. The roadmap's differentiation
thesis is "trust (non-custodial) as a moat," so risk tooling here has to protect
that trust story, not undercut it with opaque freezes or slow disputes. This
file assumes card/credit are live and treats the on-chain-native risks
(liquidation, protocol exposure) as first-class alongside traditional fraud.

## Fraud

### What it is
Detecting and blocking unauthorized transactions, account takeovers, and
scam-induced transfers — both the traditional card-fraud pattern and the
crypto-native pattern of a user being socially engineered into approving a
malicious transaction.

### Vendor / provider options
- **Sardine** — crypto-native fraud/AML, built specifically for on-chain + card hybrid products, strong fit.
- **Unit21** — rules + ML fraud detection, widely used across fintech, flexible case-management layer.
- **Sift** — mature fraud-detection platform, broad e-commerce/fintech coverage, less crypto-specific.
- **Alloy Fraud** — identity + fraud decisioning combined, useful if onboarding KYC (USDY track) and fraud need to share signal.
- **Effectiv** — newer unified fraud/risk platform, real-time decisioning across multiple product lines.

### Gekko default
**Sardine** — it's built for exactly Gekko's shape of product (non-custodial
wallet + card), so it needs the least adaptation and already understands
on-chain transaction risk signals, not just card-network ones.

### Build checklist
- [ ] Sardine integration on card-auth and credit-draw events
- [ ] Wallet-approval risk scoring (flag suspicious contract approvals, not just card swipes)
- [ ] User-facing "this looks like a scam" warning before high-risk approvals
- [ ] False-positive appeal path that doesn't silently freeze funds (protects the non-custodial trust story)

## Credit

### What it is
Risk that a borrower's collateral value falls faster than the position can
be liquidated, or (for any future fiat line) that a borrower defaults —
distinct from fraud, this is market/counterparty risk on the credit book
described in `06-credit.md`.

### Vendor / provider options
- Protocol-native: Aave/Morpho liquidation engines handle the overcollateralized case with no separate vendor.
- **Pagaya** — if/when fiat undercollateralized credit exists, for default-risk modeling (see `06-credit.md` Underwriting).

### Gekko default
For v1, credit risk is **entirely protocol-native** — Aave/Morpho liquidation
mechanics, monitored via `alert_service`, with no separate vendor. This stays
true as long as Gekko's credit product is the overcollateralized GHO/Morpho
line from `06-credit.md`; revisit only if fiat credit is added.

### Build checklist
- [ ] Real-time health-factor monitoring dashboard across all open credit positions
- [ ] Threshold-based user alerts before liquidation (already scoped in `06-credit.md`)
- [ ] Internal concentration-risk view (too much collateral in one volatile asset)
- [ ] (verify) Reassess vendor need if/when fiat credit line is added

## ACH Returns

### What it is
Failed or reversed ACH transfers — insufficient funds, closed accounts, or
unauthorized-transfer disputes — relevant to Gekko only at the fiat on/off-ramp
edge (roadmap item #7), not to on-chain balances.

### Vendor / provider options
- Handled by the fiat on-ramp partner's own rails (MoonPay/Transak/Bridge per the roadmap) — Gekko typically doesn't need a standalone ACH-returns vendor if it's using a widget integration.
- **Modern Treasury** — if Gekko ever runs its own ACH origination rather than a widget, for return-code handling and reconciliation.

### Gekko default
No dedicated vendor for v1 — the MoonPay/Transak widget integration
(roadmap item #7) absorbs ACH-return handling on the partner side. Only
build direct ACH-returns handling if Gekko moves off a widget to
direct rail origination.

### Build checklist
- [ ] Confirm chosen ramp partner's ACH-return SLA and user-notification behavior
- [ ] Map return-code webhook (if exposed) into a user-facing status, not a silent failure
- [ ] Reconcile ramp-partner return events against internal ledger
- [ ] (verify) Revisit if Gekko ever originates ACH directly instead of via widget

## Chargebacks

### What it is
Card-network disputes where a cardholder contests a charge and the issuer
reverses it — a direct financial-loss vector for the debit/credit card
product in `05-cards.md`, and one of the more labor-intensive ops burdens
in any card program.

### Vendor / provider options
- **Chargeblast** — dispute-response automation, generates evidence packets to fight chargebacks.
- **Justt** — end-to-end chargeback management with a win-rate-based pricing model, popular with crypto/fintech cards.
- **Quavo** — dispute-management platform used by banks/issuers, handles Reg E/Z compliance workflows.

### Gekko default
**Justt** — its outcome-based pricing model fits a card program still
proving its loss rate, and it's already a common choice among crypto/fintech
card issuers, meaning better familiarity with wallet-funded card disputes.

### Build checklist
- [ ] Justt integration on the chosen card issuer's dispute webhook
- [ ] Evidence-collection flow (transaction metadata, wallet approval logs) fed automatically to Justt
- [ ] User-facing dispute-status tracker in webapp/bot
- [ ] Track chargeback rate as a KPI — card-network fines trigger above certain thresholds (verify current network thresholds)

## Reserves

### What it is
Capital Gekko (or its card-issuing partner) sets aside to cover expected
losses — chargebacks, fraud, credit defaults — rather than being caught
short when they materialize.

### Vendor / provider options
- Typically structured through the card-issuing partner's program-risk terms (Immersve/Gnosis Pay/Rain each set their own reserve requirements) rather than a separate vendor.
- **Modern Treasury** — for tracking/segregating reserve balances across rails if Gekko manages its own.

### Gekko default
Inherit reserve requirements from the chosen card-issuing partner's program
terms rather than standing up an independent reserve vehicle — Gekko is not
a bank and shouldn't self-insure at this stage. Track reserve balance
internally so it's visible alongside the liquidity-management view in
`07-treasury.md`.

### Build checklist
- [ ] Confirm reserve requirement terms with chosen card partner (Immersve/Gnosis Pay) before launch (verify)
- [ ] Internal dashboard showing reserve balance vs. requirement, tied into `fee_sweeper`/liquidity view
- [ ] Alert when projected chargeback/fraud losses approach reserve ceiling
- [ ] Quarterly reserve-adequacy review as loss data accumulates

## Loss Prevention

### What it is
The cross-cutting operational discipline of catching risk before it becomes
a loss — combining the fraud, credit, and chargeback tooling above into one
monitoring and response practice, plus manual review for edge cases
automation misses.

### Vendor / provider options
- **Unit21** — case-management layer that can sit on top of Sardine's detection to unify fraud + credit + dispute investigation workflows.
- **Alloy Fraud / Effectiv** — alternative unified decisioning layers if Unit21 doesn't fit.

### Gekko default
**Unit21** as the case-management layer on top of Sardine's detection —
avoids fragmenting fraud, credit-risk, and dispute investigations across
disconnected tools during the highest-risk early months of the card program.

### Build checklist
- [ ] Unit21 case-management integration wired to Sardine fraud signals
- [ ] Manual-review queue + SLA for human-reviewed edge cases
- [ ] Weekly loss-metrics review (fraud rate, chargeback rate, liquidation frequency) as one dashboard
- [ ] Post-incident review process feeding back into rule/threshold tuning
