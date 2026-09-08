# Commerce & Payments - Relay

Source: https://docs.relay.link/solutions/commerce-and-payments

On this page
Watch a Live Demo
Who Builds with Relay
Integration Paths
Connected Wallet Checkout
Deposit Addresses
Commerce Features
What You Build on Top
Trusted by Leading Teams
Get Started
Solutions
Commerce & Payments
Copy page

Use Relay to facilitate seamless payments between users and merchants across any chain

Relay is crosschain payments infrastructure that enables seamless payments between users and merchants. Users pay in any token on any chain. Merchants configure exactly which token they receive as settlement — any stablecoin, native asset, or token on any supported chain. One integration to facilitate it all — instant, transparent, and low-fee.
85+ Chains
Connect users on every major network
< 3s Settlement
P50 fill time across all routes
$20B+
Volume enabled to date
100M+ Txs
Processed across the network
​
Watch a Live Demo
​
Who Builds with Relay
Payment processors — Add crosschain acceptance to your payment stack through a single integration. Rather than building 85+ chain connections, use Relay as the crosschain layer to connect your merchants with users on any network.
Wallets and neobanks — Let your users pay merchants directly from their existing holdings on any chain. No bridging, no chain-switching. One tap to pay, regardless of what chain the user or merchant is on.
Commerce platforms — Give your merchants onchain payment acceptance without requiring buyers to hold specific assets on specific chains. Connect any buyer to any merchant across the entire onchain ecosystem.
​
Integration Paths
​
Connected Wallet Checkout
For applications where users connect a wallet directly — web apps, mobile apps, or embedded wallets. Use the standard Relay execute flow with tradeType: EXACT_OUTPUT to guarantee merchants receive the exact amount requested.
Users connect their wallet, review the transaction, and confirm. Relay handles crosschain routing in the background. Compatible with all major wallet providers.
​
Deposit Addresses
For flows where no wallet connection is needed. Generate a unique deposit address per transaction and present it as a QR code, payment link, or in an invoice. Users send funds from any wallet on any chain, and Relay routes settlement to the merchant.
​
Commerce Features
Exact Output Settlement — Use tradeType: EXACT_OUTPUT to guarantee merchants receive precisely the configured amount. No slippage, no shortfalls. If the exact amount cannot be filled, the transaction reverts and the user is refunded on the origin chain. This eliminates partial payment edge cases and removes the need for reconciliation logic.
Fee Sponsorship — Cover destination chain fees for users to create a frictionless checkout experience. Set a maxSubsidizationAmount to cap your exposure.
Sponsored Execution — Submit transactions on behalf of users and cover gas costs entirely. Users sign a payload — your platform handles submission. Works with Permit2, ERC-4337 smart accounts, and EIP-7702, making payments completely gasless for end users.
App Fees — Collect a fee on every transaction that flows through your platform. Fees are automatically settled in USDC on Base.
Transaction Tracking — Monitor all transactions through the Relay Request API. Track status, amounts, routes, and settlement in real time via API or WebSockets.
​
What You Build on Top
Relay provides crosschain routing, settlement guarantees, deposit addresses, real-time status tracking, and exact output fills. Relay does not include a merchant management system, order management, or invoicing — it empowers you to build these solutions on top.
Merchant onboarding and management
Order IDs and payment lifecycle management
Checkout UI and product catalog
Payment confirmation and receipts
Invoicing and subscription logic
​
Trusted by Leading Teams
Relay powers crosschain transactions for MetaMask, OpenSea, Coinbase, and other leading platforms. The protocol operates with 99.9%+ transaction reliability across 85+ networks with sub-3-second settlement on most routes.
​
Get Started
Add crosschain payments to your platform through a single integration. Whether you are building a wallet checkout, a scan-to-pay flow, or a full payment processing layer, the Quote API is the primary interface. Check out the Quickstart Guide to get started, or reach out to discuss your use case.

Was this page helpful?

Yes
No
Chains
Bridging & Onboarding
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform