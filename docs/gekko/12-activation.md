# Activation

Activation is the set of behaviors that turn a funded account into a habitual one — distinct from onboarding (getting the account set up) in that these are the deepening actions a user takes over the following weeks. Each section below names a specific named vendor pattern the fintech industry uses for this exact behavior, since most of these problems (account linking, wallet provisioning, direct deposit switching) are solved problems with mature infra, not something Gekko should build from scratch.

## Fund Account

### What it is
Moving real money/crypto into the Gekko account beyond the initial first deposit covered in onboarding — recurring or larger top-ups that establish Gekko as a real balance holder, not just a place with a token deposit.

### Playbook / options
- Recurring auto-funding: "sweep idle balance weekly" or scheduled top-ups, using the same session-key/smart-account infra the roadmap earmarks for DCA (item #2).
- Multiple funding sources: crypto wallet transfer, on-ramp (MoonPay/Transak), and eventually linked bank account (via Astra, see Connect External Bank below).
- Nudge users whose balance drops near zero with a re-fund prompt rather than letting the account go dormant silently.

### Gekko default
Default every funded account into an opt-out (not opt-in) auto-sweep of idle trading balance into yield, since this is the single behavior the roadmap identifies as the biggest white-space opportunity — make it the path of least resistance rather than a feature users have to discover.

### Target metric
- % of funded accounts with recurring/auto-funding enabled within 30 days: target 40%+.
- Average balance growth month-over-month for activated accounts: track as a leading retention indicator.

## Connect External Bank

### What it is
Linking a traditional bank account to Gekko, enabling ACH transfers in/out — a prerequisite for direct deposit switching, bill pay, and giving crypto-native users an on/off-ramp to their existing fiat life.

### Playbook / options
- Standard account-linking infra: Plaid (broadest bank coverage, most established) or Astra (purpose-built for account-linking + automated transfers, often used by neobanks specifically for this flow).
- Instant micro-deposit or credential-based verification (Plaid's standard flow) to minimize friction vs. manual routing/account number entry.
- This step matters most for the SMB/startup segment and for crypto-native users bridging into "primary account" territory — less critical for a pure trading-balance user.

### Gekko default
Integrate Plaid (or Astra if its automated-transfer feature fits better — verify pricing/fit before choosing) as the bank-linking layer, but treat this as a second-wave feature gated behind card launch — don't build it before there's a funded, active card base asking for it.

### Target metric
- % of activated accounts with a linked external bank within 60 days: target 25%+ (verify — likely lower for the crypto-native beachhead than a traditional neobank).

## Add Card to Wallet

### What it is
Provisioning the Gekko card into Apple Wallet / Google Wallet so it becomes a tap-to-pay option on the user's phone — a strong predictor of ongoing card usage since it removes the physical-card-in-hand requirement.

### Playbook / options
- Push provisioning: issuer-side integration (through the card program partner — Gnosis Pay/Immersve per the roadmap) that lets a user add the card to Apple/Google Wallet directly from within the Gekko app with one tap, no manual card-number entry.
- Prompt this immediately at card activation (see `11-onboarding.md`), not as a later discovery — data across fintech card products consistently shows wallet-added cards get used sooner and more often (verify specific figures).
- Track wallet-add as a distinct funnel step, since it's a common silent drop-off point (users activate a card but never tap "add to wallet").

### Gekko default
Make "add to Apple/Google Wallet" the default next action shown immediately after virtual card issuance, not an optional settings-menu item — treat it as part of the activation flow, not a discretionary feature.

### Target metric
- % of activated cards added to a mobile wallet within 24 hours: target 50%+ (same target as onboarding doc — this is the same event, tracked here for retention framing).
- Card usage rate for wallet-added vs. not: track as a cohort comparison to validate the push.

## Move Direct Deposit

### What it is
Getting a user to redirect their recurring paycheck deposit from their old bank into Gekko — the single strongest primary-account signal in consumer fintech, covered in full in `13-primary-account-strategy.md`.

### Playbook / options
- Direct-deposit switch kits: Atomic, Pinwheel, or Argyle — these vendors specialize in identifying a user's payroll provider and generating/submitting the switch request programmatically, removing the "log into my employer's HR portal and change a form" friction that kills most manual attempts.
- Incentivize with a cash bonus or yield boost for completing a direct deposit switch (standard neobank tactic — Chime, SoFi, etc. all run variants of this, verify current offer sizes).
- Show users what they gain concretely (e.g., "your paycheck starts earning 4-6% the day it lands" vs. sitting in a checking account at 0%).

### Gekko default
Not a priority for the initial crypto-native beachhead (most early users are not looking to route a W-2 paycheck through a crypto-native banking app yet) — build the Pinwheel/Argyle integration only once the SMB/startup segment creates real demand for it. See `13-primary-account-strategy.md` for the full build sequencing.

### Target metric
- Deferred; see `13-primary-account-strategy.md`.

## Move Payroll

### What it is
The business-side equivalent of direct deposit — getting an SMB/startup/DAO to run its payroll disbursement through Gekko, which is a much stickier and higher-value primary-account signal than an individual consumer switch.

### Playbook / options
- Payroll connectivity infra: Pinwheel and Argyle both support payroll-system integrations at the employer level, not just individual switch requests (verify current employer-side product offerings).
- For crypto-native SMBs/DAOs specifically, "payroll" is often already stablecoin-based contributor payments — Gekko can offer this natively without needing traditional payroll rails at all, which is a real structural advantage.
- Bundle payroll with the business account + card + bill pay offering as a package, not a standalone pitch.

### Gekko default
Build native stablecoin payroll/contributor-payment tooling for the crypto-native SMB/DAO vertical first (reusing the roadmap's recurring-transfer/session-key infra) rather than integrating traditional payroll rails — this is a case where Gekko's crypto-native starting point is a genuine shortcut, not a limitation.

### Target metric
- Deferred to `13-primary-account-strategy.md`; tracked there under Payroll.

## Pay First Bill

### What it is
The first time a user pays a recurring bill (utility, subscription, rent, credit card) directly from Gekko — an activation event that signals the account is being used for real financial life management, not just holding a balance.

### Playbook / options
- Bill pay infra: Method is the standard vendor for connecting to and paying down external liabilities/bills programmatically from within a fintech app.
- Prompt users to link and pay one recurring bill during activation, with a small incentive (fee waiver, cashback) for the first one.
- Track bill categories paid to understand which use case resonates (subscriptions vs. utilities vs. credit card payoff) — don't assume upfront.

### Gekko default
Lower priority in the initial crypto-native phase; the more relevant early "bill" for this user is often a subscription or recurring on-chain payment already native to how they operate. Defer a full Method integration until the SMB segment (which has real AP/bill-pay needs — see `13-primary-account-strategy.md`) creates clear demand.

### Target metric
- Not an initial-phase target; revisit once Method integration is live for the SMB segment.

## First Card Spend

### What it is
The first time a user actually swipes/taps the Gekko card for a purchase — arguably the single clearest "this is now part of my daily financial life" signal available, distinct from a wallet-add or a test transaction.

### Playbook / options
- Small cashback or bonus on first card transaction to remove hesitation (standard fintech card-launch tactic).
- Push a notification/prompt shortly after card activation and wallet-add suggesting a specific low-stakes use case (coffee, a subscription) rather than leaving it open-ended.
- Track time-to-first-spend as a key activation health metric — a card that's activated and wallet-added but never used within a week is a strong churn signal.

### Gekko default
Pair card activation with an immediate small first-spend incentive (e.g., a few dollars of cashback or a fee waiver on the first transaction) — this is a proven, low-cost way to convert "card in wallet" into "card habit," and worth the modest cost given how predictive early card usage is for retention.

### Target metric
- Card activated → first spend within 7 days: target 40%+ (verify against card-program partner benchmarks once live).
- Repeat spend within 30 days of first spend (i.e., not a one-off): target 60%+ of first-spenders.
