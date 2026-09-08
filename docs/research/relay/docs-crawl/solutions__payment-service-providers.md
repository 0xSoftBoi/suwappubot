# Payment Service Providers - Relay

Source: https://docs.relay.link/solutions/payment-service-providers

On this page
Use Cases
Pay-ins or Commerce
Disbursements
Compliance & Screening
Features
Pricing
Security
Get Started
Solutions
Payment Service Providers
Copy page

Accept and disburse any asset, on any supported chain, settled in the currency you run on

Relay lets payment service providers add universal onchain acceptance and payouts through a single integration. Consumers and businesses can spend any onchain currency they hold, and Relay routes and converts to your chosen asset and chain.
​
Use Cases
​
Pay-ins or Commerce
Accept funds in any asset on any supported chain and receive your settlement asset through two integration paths:
Connected or embedded wallets — Use the standard quote and deposit flow when your user connects a wallet. Deposits are optionally gasless, with fixed or market rates.
Deposit addresses — Generate an address for each order or reusable route so users can pay without connecting a wallet, including from surfaces that don’t support wallet connections, such as centralized exchanges. Funds sent to the address are routed and converted to your settlement asset automatically.
​
Disbursements
Run pay-ins in reverse to send funds out — marketplace seller payouts, creator and worker disbursements, and cross-border payouts — to any supported chain and asset from your settlement balance, through the same integration.
​
Compliance & Screening
Relay screens every transaction in real time against multiple independent blockchain-analytics providers and a continuously maintained internal blocklist, enforcing OFAC and other global sanctions requirements. Screening covers every party to a transfer — sender, recipient, and fee recipient, plus the depositing wallet on deposit-address flows — not just a single address. A match on any party blocks the quote and fill. See Compliance for details.
​
Features
Exact-output settlement — Specify the exact amount you need to receive; Relay sizes the input. No slippage, no shortfalls.
Price stabilization — Lock a fixed rate (e.g. 1:1) on stablecoin pairs, or sponsor fees so the user receives the full market-rate output. Removes exchange rate surprises from settlement.
Gasless execution — Your users transact without spending gas directly. This can be used for Relay deposits or more generally for any onchain gasless execution.
Fee sponsorship — Pay or subsidize gas or spreads on your users’ behalf, and let them pay in the asset they already hold.
App fees — Attach your own fee to any flow and collect it at settlement, automatically settled in USDC on Base.
MEV protection — Swaps are routed for best execution.
Webhooks and tracking — Lifecycle events are pushed to your backend (HMAC-signed), and every payment carries a requestId for reconciliation.
Reliability — 99.9%+ fill success with sub-3-second settlement on supported routes.
​
Pricing
Relay’s cost is transparent in every quote. The expandedPriceImpact object breaks each payment into its execution, swap, and Relay fee components, plus any app fee you add — so your finance team can model unit economics exactly. Integrators above a volume threshold qualify for a revenue share on the Relay fee. See Cost & Fee Structure.
​
Security
Relay’s contracts are independently audited, and the protocol runs an ongoing bug bounty. Review the Contract Audits and Bug Bounty before you integrate.
​
Get Started
Add cross-chain pay-ins and disbursements to your platform through a single integration. The Quote API is the core endpoint behind both flows.
Quickstart Guide — make your first cross-chain transaction.
Quote API reference — the core endpoint behind pay-ins and disbursements.
Deposit Addresses — wallet-less acceptance.
Contact us — discuss your corridors, volumes, and settlement requirements.

Was this page helpful?

Yes
No
How Relay Works
Wallets & Wallet Providers
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform