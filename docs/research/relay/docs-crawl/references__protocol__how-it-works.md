# How It Works - Relay

Source: https://docs.relay.link/references/protocol/how-it-works

On this page
Contracts
Flows
1. Execution Flow
2. Settlement Flow
3. Withdrawal Flow
Refunds
Fast Refund
Settlement
How It Works
Copy page

End-to-end walkthrough of the settlement protocol flows

Relay is a crosschain intents protocol. Users express what they want (e.g., bridge 1 ETH from Optimism to Base), and third-party solvers fill those orders using their own capital. The protocol then settles solvers — verifying fills and reimbursing them from the user’s escrowed deposit.
What makes Relay different is how settlement works. It’s designed from the ground up for maximum efficiency & compatibility:
A dedicated low-cost settlement chain (Relay Chain)
A custom Oracle that can read data from any chain / VM
Programmable MPC signatures to write back to any chain / VM
​
Contracts
The protocol is coordinated through 3 main smart contracts:
Contract	Role	Location
Depository	Holds user deposits on each origin chain	Every supported chain (80+)
Hub	Tracks token ownership and solver balances	Relay Chain
Allocator	Generates MPC withdrawal payloads	Aurora (NEAR)
​
Flows
Every crosschain order in Relay passes through three sequential flows: Execution, Settlement, and Withdrawal.
Relay Chain
Destination Chain
Origin Chain
Solver
User
Relay Chain
Destination Chain
Origin Chain
Solver
User
Execution
Settlement
Withdrawal
1. Deposit into Depository
2. Fill order
3. Submit attestation to Oracle contract
4. Move balance to withdrawal address
5. Submit proof, claim funds
​
1. Execution Flow
Execution is the user-facing part of the process. The user deposits funds on the origin chain, and a solver fills their order on the destination chain.
Destination Chain
Solver
Depository (Origin)
User
Destination Chain
Solver
Depository (Origin)
User
Native deposits can be ~21,000 gas
1. Deposit funds (orderId)
Deposit confirmed
2. Detect deposit
3. Fill order (own capital)
Action executed
Step by step:
User requests a quote — The user specifies what they want (e.g., bridge 1 ETH from Optimism to Base). The Relay API returns quotes from available solvers.
User deposits into Depository — The user sends funds to the Depository contract on the origin chain. The deposit is tagged with an orderId that links it to the solver’s commitment. This costs approximately 21,000 gas — close to a simple transfer.
Solver fills on destination — The solver detects the deposit and executes the user’s requested action on the destination chain using their own capital. The fill can be a simple transfer, a swap, or any arbitrary onchain action.
Because deposits go to the Depository (not to the solver directly), user funds are protected. If the solver fails to fill, the user can reclaim their deposit.
​
2. Settlement Flow
Settlement is the process of verifying that the solver correctly filled the order, and crediting them on the Hub.
Hub (Relay Chain)
Oracle Contract (Relay Chain)
Destination Chain
Oracle
Solver
Origin Chain
Hub (Relay Chain)
Oracle Contract (Relay Chain)
Destination Chain
Oracle
Solver
Origin Chain
Verify deposit + fill match
Solver balance updated
1. Request attestation
2. Read deposit data
3. Read fill data
4. Return signed attestation
5. Submit attestation
6. Execute MINT + TRANSFER
Step by step:
Solver requests attestation — After filling an order, the solver calls the Oracle to request settlement.
Oracle reads origin chain — The Oracle reads the origin chain to verify that the user’s deposit occurred and matches the expected order.
Oracle reads destination chain — The Oracle reads the destination chain to verify that the solver’s fill matches the user’s intent (correct destination, amount, and action).
Oracle returns attestation — Oracle validators each verify the data and sign an EIP-712 attestation. Once a threshold of signatures is collected, the signed attestation is returned to the solver.
Solver submits to Oracle contract — The solver submits the signed attestation to the Oracle contract on the Relay Chain, which verifies the authorized signer and executes on the Hub. This triggers two actions:
MINT — The user’s deposit is represented as a token balance on the Hub
TRANSFER — That balance is transferred from the user to the solver
Settlement happens in real-time, per-order. There is no batching window. As soon as the Oracle verifies a fill, the solver’s balance is updated on the Hub.
​
3. Withdrawal Flow
Withdrawal is how solvers extract funds from the Depository to replenish their capital. Solvers accumulate balances on the Hub and can withdraw from any origin chain at any time.
Depository (Origin)
Allocator (Aurora)
AllocatorSpender (Aurora)
Hub (Relay Chain)
Oracle
Solver
Depository (Origin)
Allocator (Aurora)
AllocatorSpender (Aurora)
Hub (Relay Chain)
Oracle
Solver
1. Request withdrawal initiation
2. Return signed Hub execution
3. Move balance to withdrawal address
4. Request payload params
5. Return signed payload params + Oracle signature
6. Request proof
7. Verify + forward request
8. Return MPC-signed proof
9. Submit proof
Verify signature + nonce
10. Release funds
Step by step:
Solver requests withdrawal initiation — The solver asks the Oracle to initiate a withdrawal, providing the target chain, depository, currency, amount, recipient, and nonce.
Oracle returns Hub execution — The Oracle computes the deterministic withdrawal address for those parameters and returns a signed Hub execution that moves the requested balance to that address.
Solver moves balance on Hub — The solver submits that execution on the Relay Chain, so the withdrawal address now holds the requested Hub balance.
Solver requests payload params — The solver calls the Oracle again to request the signed payload parameters for the withdrawal.
Oracle returns payload params — The Oracle verifies that the withdrawal address holds the requested balance and returns the payload parameters together with an Oracle signature for the next step.
Solver submits to RelayAllocatorSpender — The solver submits those payload parameters and the Oracle signature to RelayAllocatorSpender, which verifies the Oracle authorization and forwards the request to the Allocator.
Allocator builds and signs — The Allocator constructs the chain-specific payload and generates an MPC-signed cryptographic proof (EIP-712 for EVM, Ed25519 for Solana).
Proof is returned to solver — The signed proof is returned to the solver.
Solver submits proof — The solver submits the signed proof to the Depository contract on the target chain.
Depository releases funds — The Depository verifies the signature, confirms the nonce hasn’t been used, and transfers the funds to the solver.
Solvers choose their own withdrawal strategy. They can withdraw frequently to maximize capital velocity, or batch withdrawals to minimize transaction costs. The Hub balance accrues in real-time regardless.
​
Refunds
Inevitably, some orders cannot be filled, and the user needs to be refunded. Relay is designed to make this experience as smooth as possible, with multiple supported pathways, depending on the circumstances:
​
Fast Refund
If a solver can’t fill an order on the destination, they can instantly refund the user on the origin chain. The refund mirrors the execution flow — the solver detects the deposit and acts — but instead of filling on the destination, they return funds to the user on the origin. The refund is then settled like any other fill.
Hub (Relay Chain)
Oracle Contract (Relay Chain)
Oracle
Destination Chain
Solver
Depository (Origin)
User
Hub (Relay Chain)
Oracle Contract (Relay Chain)
Oracle
Destination Chain
Solver
Depository (Origin)
User
Fill not possible
1. Deposit funds (orderId)
Deposit confirmed
2. Detect deposit
3. Simulate fill
4. Refund user on origin
Funds returned
5. Request refund attestation
6. Read refund data
7. Return signed attestation
8. Submit attestation
9. Execute settlement
Step by step:
User deposits into Depository — The user deposits funds into the Depository on the origin chain, tagged with an orderId.
Solver detects deposit — The solver detects the deposit and evaluates whether it can fill the order.
Solver simulates fill — The solver simulates the fill on the destination chain and determines it can’t be completed (e.g., insufficient liquidity, contract error).
Solver refunds on origin — Instead of filling, the solver sends funds directly to the user on the origin chain, returning them immediately.
Solver requests attestation — The solver calls the Oracle to request a refund attestation.
Oracle reads origin chain — The Oracle reads the origin chain to verify the refund occurred and matched the order’s requirements.
Oracle returns attestation — Validators sign and return the attestation to the solver.
Solver submits to Oracle contract — The solver submits the attestation to the Oracle contract, which executes the settlement on the Hub — the same settlement process as a fill.
Fast refunds are the quickest way to return user funds. Because the solver acts immediately on the origin chain, the user doesn’t need to wait for any expiry window.
Additional refund and recovery UX may exist at the product layer, but only the solver-driven refund attestation flow above is directly evidenced by the protocol code in relay-settlement and relay-protocol-oracle.

Was this page helpful?

Yes
No
Overview
Relay Chain
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform