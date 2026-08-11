# Primary Account Strategy

Becoming a user's or business's *primary* account — the one their income lands in and their bills go out of — is the endgame of activation, because primary-account status is what makes churn expensive and LTV high. This doc lays out how Gekko earns that status, sequenced from the individual consumer wedge (direct deposit) through the SMB/DAO wedge (payroll, AP/AR, accounting integrations) that's a more natural near-term fit given the crypto-native beachhead.

## Direct Deposit

### What it is
An individual user redirecting their recurring paycheck (typically via ACH) so it lands directly in their Gekko account instead of their old bank — the classic consumer primary-account signal, and historically the hardest one to win against incumbent banks with payroll inertia.

### Playbook / options
- Vendors: Atomic, Pinwheel, Argyle — all specialize in detecting a user's payroll provider and generating/submitting a direct-deposit change request with minimal manual data entry, dramatically improving completion rates vs. a manual "here's a form, fill it out yourself" flow.
- Incentive structure: cash bonus ($50-200 range is common in consumer fintech, verify current market rates) or an ongoing yield/rate boost conditional on active direct deposit — mirrors how Chime, SoFi, and similar players structure this.
- Messaging: make the yield differential concrete ("your paycheck earns 4-6% from day one instead of 0%") rather than abstract product marketing.
- This only matters once a user trusts Gekko enough to route income through it — sequence after several months of active, positive usage, not at signup.

### Gekko default
Not a first-wave priority. The crypto-native beachhead doesn't reach for a "switch my W-2 direct deposit" behavior early — build the Pinwheel/Argyle integration in a later phase once retention data shows users trust Gekko enough for it, and prioritize the business-side Payroll motion below instead, which is a more natural fit for the existing user base.

### Target metric
- No target until phase 2+; once live, target 10-15% of consumer accounts active 90+ days initiating a direct deposit switch (verify against neobank industry benchmarks — figures vary widely).

## Payroll

### What it is
The business-side version — an SMB, startup, or DAO running its outgoing payroll/contributor payments through Gekko, which is stickier than individual direct deposit because switching payroll providers is operationally costly for a business to reverse.

### Playbook / options
- For crypto-native businesses (DAOs, Web3 studios), payroll is frequently already stablecoin-denominated — this is Gekko's structural advantage. Build native scheduled/recurring stablecoin payroll using the session-key + recurring-transfer infra the roadmap already earmarks (Superfluid/Sablier patterns, item #2).
- For traditional-payroll SMBs (later-stage expansion), integrate with payroll connectivity vendors (Pinwheel/Argyle at the employer level) rather than building payroll processing from scratch.
- Package payroll with the business account + card, since a business that runs payroll through Gekko has strong reason to also hold its operating balance there.

### Gekko default
This is the primary "primary-account" wedge for Gekko's first 2-3 quarters: build native stablecoin contributor-payment/payroll tooling for the crypto-native SMB/DAO vertical (see `08-icp-positioning.md`), since it reuses existing infra and doesn't require a traditional payroll-vendor integration to reach a real primary-account behavior.

### Target metric
- % of active SMB/DAO accounts running recurring contributor payroll through Gekko within 6 months: target 30%+ of that segment.
- Average business balance uplift for accounts with payroll active vs. without: track as the core justification metric for this investment.

## AP / AR

### What it is
Accounts payable (money a business owes and pays out — vendor invoices, expenses) and accounts receivable (money owed to the business — customer invoices, collections) — the operational cash-flow backbone that, if run through Gekko, makes it the business's system of record for money movement.

### Playbook / options
- AP: bill/invoice payment automation, potentially via Method (liabilities/bill connectivity) or purpose-built AP tooling; for crypto-native businesses, this can be as simple as scheduled stablecoin vendor payments.
- AR: invoicing and collection — crypto-native option is stablecoin invoicing (e.g., Request Finance-style tooling, verify current landscape) with automatic reconciliation into the Gekko balance.
- The prize here is being the single place a business sees both money in and money out — that visibility is what makes switching away painful.

### Gekko default
Build a lightweight native AP/AR view for the crypto-native SMB/DAO segment (stablecoin invoicing in, stablecoin vendor/contributor payments out, unified in the same dashboard as the payroll feature) rather than integrating a third-party AP/AR platform prematurely — keep it thin and reuse the multicall3-based portfolio infra already planned for the bank-statement view (roadmap item #3).

### Target metric
- % of active SMB accounts using Gekko for both an AP and an AR flow (not just one): target 20%+ within 6-9 months.

## Bill Pay

### What it is
Paying recurring external liabilities — utilities, rent, credit cards, subscriptions — directly from the Gekko account, applicable to both consumer and SMB accounts, and a strong "primary account" signal because it requires the account to be trusted with essential, non-optional payments.

### Playbook / options
- Vendor: Method is the standard integration for connecting to and paying down a user's external liabilities/bills programmatically.
- Sequence bill pay after card and basic transaction activation are proven — it's a deeper commitment ask than a card swipe.
- For SMBs, bill pay overlaps heavily with the AP motion above — avoid building two separate systems for what's functionally the same capability at consumer vs. business scale.

### Gekko default
Defer a Method integration until post-card-launch, and when built, design it as the same underlying capability serving both the consumer bill-pay use case and the SMB AP use case rather than two parallel builds.

### Target metric
- Deferred; revisit once card + basic transaction activation metrics (see `12-activation.md`) are healthy. No target set yet.

## Accounting Integrations

### What it is
Connecting Gekko transaction and balance data into a business's accounting software (QuickBooks, Xero, NetSuite, etc.) so bookkeeping doesn't require manual reconciliation — a table-stakes requirement for any SMB to treat Gekko as a real operating account rather than a side wallet.

### Playbook / options
- Vendors: Codat or Rutter — both specialize in normalizing financial data across accounting platforms and are the standard integration layer fintechs use rather than building direct integrations to each accounting platform individually.
- This is table-stakes for the SMB segment specifically — a business will not move real operating funds to an account it has to manually reconcile every month.
- Sequence after the core AP/AR and payroll features are live, since accounting integration is about exporting/syncing that data, not a standalone feature.

### Gekko default
Integrate via Codat or Rutter (pick based on pricing/coverage once evaluated — verify) as soon as the SMB/DAO segment has meaningful transaction volume worth reconciling; this is a near-term must-have for SMB primary-account status, not a nice-to-have.

### Target metric
- % of active SMB accounts with an accounting integration connected: target 50%+ within 9-12 months of the integration going live (verify — this is typically a strong indicator of primary-account commitment).

## Multi-Product Adoption

### What it is
The number of distinct Gekko products/features a single user or business actively uses (e.g., yield + card + payroll + bill pay) — the strongest predictor of both retention and primary-account status across neobanks generally, since each additional product raises switching cost.

### Playbook / options
- Track a per-account "product adoption count" and treat it as a core health metric alongside balance and transaction volume.
- Cross-sell sequencing: yield (day one) → card (post-KYC) → payroll/AP-AR (SMB) → bill pay → accounting integration — each step should be prompted contextually based on what the user has already done, not blasted all at once.
- Industry pattern (verify current figures): neobank users with 3+ active products churn at a fraction of the rate of single-product users.

### Gekko default
Instrument product-count per account from day one and make it a primary internal success metric alongside revenue — actively design in-app and in-bot nudges that move users from 1 product (yield) to 2+ (card, then payroll/AP-AR for SMBs) rather than treating each feature launch as an independent growth initiative.

### Target metric
- Average products-per-active-account: target 2.0+ within first year (verify baseline once tracking exists).
- 90-day retention rate for 3+-product accounts vs. 1-product accounts: track as the core internal case for cross-sell investment.
