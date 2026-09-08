# Depository - Relay

Source: https://docs.relay.link/references/protocol/components/depository

On this page
Overview
How It Works
Deposits
EVM Chains
Solana
Bitcoin
Withdrawals
Security
Contract References
Components
Depository
Copy page

The escrow contract deployed on every supported chain

​
Overview
The Depository is deployed on every chain that Relay supports — as a smart contract on EVM and Solana chains, and as an MPC-controlled address on Bitcoin. It serves as the entry point for user funds — accepting deposits and releasing withdrawals when authorized by the Allocator.
There are currently 80+ Depository contracts deployed, one per supported chain. Each contract is non-upgradable, meaning its logic cannot be changed after deployment. See Contract Addresses for the full list.
​
How It Works
The Depository has two core responsibilities:
Accept deposits — Users send funds to the Depository, tagged with an orderId that ties the deposit to a specific solver commitment
Execute withdrawals — When a solver presents a valid proof from the Allocator, the Depository releases funds
The Depository does not track orders, verify fills, or manage balances. It is intentionally minimal — a secure vault that holds funds and releases them only when presented with a valid cryptographic proof.
​
Deposits
Deposits are designed to be as gas-efficient as possible. On EVM chains, native-token deposits can be close to a raw ETH transfer (~21,000 gas). ERC20 deposits are more expensive because they also perform a token transferFrom.
​
EVM Chains
The EVM Depository supports two deposit methods:
depositNative(depositor, id) — Deposit native ETH (or the chain’s native asset)
depositErc20(depositor, token, amount, id) — Deposit any ERC20 token
Both methods emit events that the Oracle monitors to verify deposits.
​
Solana
The Solana Depository is an Anchor program that supports:
deposit_native(amount, id) — Deposit native SOL
deposit_token(amount, id) — Deposit SPL tokens (including Token-2022)
Funds are held in a program-derived address (PDA) vault.
​
Bitcoin
On Bitcoin, the Depository is an MPC-controlled address rather than a smart contract. Deposits are standard Bitcoin transactions to this address, and withdrawals are authorized by the Allocator via ECDSA (secp256k1) MPC signatures.
​
Withdrawals
Withdrawals are triggered by solvers who have accumulated balances on the Hub. The process:
Solver requests a withdrawal from the Allocator
Allocator generates a signed CallRequest (EVM) or TransferRequest (Solana)
Solver submits the signed request to the Depository’s execute function
Depository verifies the signature against the registered allocator address
Funds are transferred to the solver
Each withdrawal request includes a nonce and expiration to prevent replay attacks and stale proofs.
Only the registered Allocator can authorize withdrawals. The Allocator address is set at deployment and can only be changed by the contract owner (a security council multisig).
​
Security
The Depository is designed with minimal trust assumptions:
Non-upgradable — Contract logic cannot change after deployment
Single authority — Only the registered Allocator can authorize fund movements. The Allocator address can only be changed by the contract owner, which is the Security Council multisig
Audited — Reviewed by Spearbit (February 2025) and Certora (June 2025). The broader Settlement Protocol, including Depository flows, was later audited by Zellic in November 2025.
​
Contract References
For full API documentation of the Depository contracts:
EVM Depository Reference
SVM Depository Reference
Contract Addresses

Was this page helpful?

Yes
No
Relay Chain
Deposit Addresses
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform