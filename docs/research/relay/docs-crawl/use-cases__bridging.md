# Bridging & Onboarding - Relay

Source: https://docs.relay.link/use-cases/bridging

On this page
How it Works
Use Cases
Bridging & Onboarding
Copy page

Instant Bridging and Onboarding via Relay

Relay enables instant bridging (deposits & withdrawals) on supported chains. By coupling the instant cross-chain liquidity of the Relay Network with deep same-chain swap meta-aggregation, Relay enables instant onboarding and bridging of any token on any supported chain. There are several important features that make Relay onboarding great:
Instant Cross-chain Onboarding - Relay’s median bridge time is 2.7 seconds across chains.
Multi-VM Support - Relay Supports major EVM chains, as well as Bitcoin, Solana, Tron, Eclipse, and more.
Deposit Addresses - Deposit Addresses allow users to onboard onto any chain via a transfer on any network. This makes it seamless for users to onboard from centralized exchanges or without connecting a wallet.
App Fees - Our comprehensive approach to App Fees lets you easily earn when using Relay. Additionally, we have designed our fee system for you to automatically collect fees in stables (USDC).
​
How it Works
Relay’s instant bridging is powered by cross-chain intents. This model results in low-cost, low-latency (next block) cross-chain transactions. When a user wishes to bridge, they receive a quote from Relay that describes the time and cost of bridging. When they accept the quote, the order is validated and they submit a transfer to the Relay Depository Contract. A relayer then instantly fills the transaction on the destination chain before unlocking the funds on the origin.
Both Bridging and Onboarding can be integrated using Relay’s Quote API:
Bridging - Bridging across all supported networks and tokens can be integrated into wallets, apps, or any place a user may need to get funds onto a new network.
Onboarding - Onboarding users into a new wallet (or a new chain) can be done similarly to any bridging action, where the user specifies their destination account.
To learn how to integrate Relay into your application, check out our Quickstart Guide.

Was this page helpful?

Yes
No
Commerce & Payments
Swaps
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform