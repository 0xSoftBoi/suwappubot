# The Relay Chain - Relay

Source: https://docs.relay.link/references/protocol/components/relay-chain

On this page
Overview
Why a Dedicated Chain
Technical Details
What Lives on the Relay Chain
Exploring Settlement Activity
Components
The Relay Chain
Copy page

A purpose-built settlement chain for crosschain intent processing

​
Overview
The Relay Chain is a dedicated blockchain purpose-built for settlement of crosschain intents. It serves as the home of the Hub contract — the central ledger that tracks all token ownership and solver balances in the protocol.
By running settlement on a dedicated chain, Relay avoids competing for blockspace on congested networks and keeps settlement costs minimal, regardless of how expensive the origin or destination chains are.
​
Why a Dedicated Chain
Intent protocols typically settle on the origin chain, which means settlement competes with all other activity on that chain. This creates several problems:
Cost — Gas prices on popular chains (Ethereum, Base, Arbitrum) fluctuate with demand, making settlement costs unpredictable
Throughput — High-volume order flow can be bottlenecked by chain congestion
Complexity — Each origin chain requires its own settlement logic and proof verification
The Relay Chain solves these by providing:
Predictable, low-cost gas — Settlement costs ~$0.005 per order, regardless of origin/destination chain gas prices
Dedicated throughput — No competition with external traffic. The chain is optimized for settlement operations
Single settlement point — All orders across all chains settle in one place, simplifying the protocol and reducing the number of moving parts
Users and app developers never interact with the Relay Chain directly. It operates entirely in the background — deposits and fills happen on the origin/destination chains, while settlement is handled automatically.
​
Technical Details
Property	Value
Chain ID	537713
RPC	https://rpc.chain.relay.link
Block Explorer	explorer.chain.relay.link
Native Asset	ETH
Stack	Sovereign Stack (rollup)
Data Availability	Celestia
VM	EVM-compatible
​
What Lives on the Relay Chain
The Relay Chain hosts the core settlement contracts:
Hub — The ERC6909 multi-token ledger that tracks all balances
Oracle — The contract that processes oracle attestations (mint, burn, transfer)
ERC20View — A wrapper contract that exposes Hub token balances as standard ERC20 tokens for wallet compatibility
The Allocator is deployed on Aurora (NEAR ecosystem) rather than on the Relay Chain, for direct integration with the NEAR MPC network used for withdrawal proof generation.
Settlement activity on the Relay Chain includes deposit attestations, fill and refund settlement executions, balance transfers, and withdrawal-burn executions. Withdrawal proof generation itself happens on Aurora via the Allocator, not on the Relay Chain.
​
Exploring Settlement Activity
Every settlement transaction is visible on the Relay Chain Block Explorer. You can trace the full lifecycle of any order by looking at the Oracle contract’s attestation transactions, which record deposits, fills, and withdrawals.

Was this page helpful?

Yes
No
How It Works
Depository
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform