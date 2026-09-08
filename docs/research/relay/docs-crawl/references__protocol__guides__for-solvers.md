# For Solvers - Relay

Source: https://docs.relay.link/references/protocol/guides/for-solvers

On this page
Overview
Solver Lifecycle
1. Monitor Deposits
2. Fill Orders
3. Settlement
4. Withdrawal
Managing Balances
Hub Balance
Withdrawal Strategy
Fees and Payment
Contract References
Guides
For Solvers
Copy page

How solvers interact with the settlement protocol

​
Overview
Solvers (also called relayers) are the liquidity providers that fill crosschain orders in Relay. They front their own capital to execute user intents on destination chains, and earn payment by claiming the user’s deposited funds from the Depository.
This page explains the solver lifecycle and how each protocol component fits into the solver’s workflow.
​
Solver Lifecycle
​
1. Monitor Deposits
Solvers watch Depository contracts across supported chains for new deposits. Each deposit includes:
Origin chain and asset — What the user deposited
Destination chain and action — What the user wants executed
Amount and fees — The deposit amount and solver compensation
Order ID — A unique identifier linking the deposit to the order
​
2. Fill Orders
When a solver decides to fill an order, they execute the user’s requested action on the destination chain using their own capital. This can be a simple transfer, a swap, or any arbitrary onchain action. Fills can be as gas-efficient as a standard transfer — no routing through protocol contracts is required on the destination.
​
3. Settlement
After filling, the solver waits for the Oracle to attest both the user’s deposit and the solver’s fill. The solver then submits the signed execution to the Oracle contract on the Relay Chain, which updates the Hub and credits the solver’s balance.
Settlement happens in real-time — there is no batching window. The solver’s Hub balance updates as soon as the Oracle processes the attestation.
​
4. Withdrawal
Solvers accrue balances on the Hub and can withdraw from any Depository on any chain at any time. The withdrawal process:
Ask the Oracle to initiate the withdrawal and return the signed Hub execution
Execute that Hub transfer to the deterministic withdrawal address on the Relay Chain
Request the withdrawal payload params from the Oracle
Submit the Oracle-signed payload params to RelayAllocatorSpender, which verifies the Oracle signature and forwards the request to the Allocator
Receive the signed withdrawal proof
Submit the signed proof to the Depository on the target chain
Receive funds from the Depository
​
Managing Balances
​
Hub Balance
The solver’s Hub balance represents the total amount they are owed across all chains. This balance increases with each settled fill and decreases with each withdrawal.
Solvers can check their Hub balance by reading the Hub contract on the Relay Chain. Each asset from each origin chain has a unique token ID on the Hub.
​
Withdrawal Strategy
Solvers choose their own withdrawal strategy based on capital needs:
Frequent withdrawals — Withdraw every few minutes for maximum capital velocity. Best for solvers with limited capital.
Batched withdrawals — Withdraw less frequently to reduce transaction costs. Best for solvers with deep capital pools.
Strategic rebalancing — Withdraw on chains where capital is running low, regardless of where the original deposits occurred.
The Hub balance accrues in real-time regardless of withdrawal frequency. Solvers can optimize their withdrawal timing independently of settlement.
​
Fees and Payment
Solver compensation is determined during the quoting phase, before the order is executed. The solver’s fee is included in the deposit amount — the user deposits slightly more than the fill amount, and the difference is the solver’s payment.
Settlement fees on the Relay Chain are paid by the solver but are minimal (~$0.005 per order).
​
Contract References
For contract-level integration details, see:
EVM Depository Reference
SVM Depository Reference
Addresses

Was this page helpful?

Yes
No
Security & Audits
For Apps
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform