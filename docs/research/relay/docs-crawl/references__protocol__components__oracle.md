# Oracle - Relay

Source: https://docs.relay.link/references/protocol/components/oracle

On this page
Overview
What the Oracle Attests
Deposits
Fills
Refunds
Withdrawals
How It Works
Pull-Based Verification
Batch Execution
Oracle Contract
Security
Source Code
Components
Oracle
Copy page

The oracle service and onchain verifier that process settlement attestations

​
Overview
The Oracle witnesses crosschain activity and produces signed attestations for the Hub on the Relay Chain. It has two components:
Oracle Service (offchain) — One or more oracle operators that read chain data, witness what has already happened onchain, and return cryptographically signed EIP-712 attestations to the caller
Oracle Contract (on Relay Chain) — Accepts attestation submissions, verifies that the submitted signature is valid for an authorized oracle signer or oracle signer contract, and executes the corresponding actions on the Hub. Each attestation can only be processed once.
The Oracle only acts in response to requests. Solvers and users call the Oracle when they need verification or withdrawal initiation, and the Oracle returns signed attestations or executions that the caller then submits onchain. This pull-based model keeps costs low and avoids the overhead of maintaining persistent message channels to every chain.
​
What the Oracle Attests
The Oracle supports deposits, fills, refunds, and several withdrawal-related attestations:
​
Deposits
When requested, the Oracle verifies that a user’s deposit into the Depository occurred on the origin chain. The resulting attestation triggers a MINT action on the Hub, creating a token balance that represents the deposited funds.
​
Fills
When requested, the Oracle verifies that a solver’s fill on the destination chain matched the user’s intent (correct destination, amount, and action). The resulting attestation triggers a TRANSFER action on the Hub, moving the balance from the user to the solver.
​
Refunds
If a solver can’t fill an order, they can send funds directly to the user on the origin chain. The solver then requests an attestation from the Oracle, which verifies the refund occurred and returns a signed attestation. The solver submits this to the Oracle contract to get reimbursed — the same settlement process as a fill.
​
Withdrawals
The Oracle plays three roles in the withdrawal flow:
Initiation — The Oracle computes the deterministic withdrawal address for the request and returns a signed Hub execution that transfers the requested balance to that address.
Payload authorization — Once the withdrawal address holds the requested balance, the Oracle returns signed payload parameters that can be used with the Allocator withdrawal flow to obtain a chain-specific proof.
Completion / burn — After the solver claims funds from the Depository, the solver requests a withdrawal attestation. The Oracle verifies the target-chain withdrawal and returns a signed execution that burns the corresponding Hub balance (or refunds it back if the withdrawal expires).
​
How It Works
Hub (Relay Chain)
Oracle Contract (Relay Chain)
Supported Chains
Oracle Service
Caller (Solver / User)
Hub (Relay Chain)
Oracle Contract (Relay Chain)
Supported Chains
Oracle Service
Caller (Solver / User)
3. Oracle signer signs EIP-712 attestation
1. Request attestation
2. Read and verify chain data
4. Return signed attestation
5. Submit signed execution
6. Verify authorized signer
7. Execute actions (MINT / TRANSFER / BURN)
The Oracle operates as a request-response pipeline:
Request — A solver or user calls the Oracle to request verification of a crosschain event
Verify — The oracle service reads chain data to confirm event details
Sign — An authorized oracle signer creates an EIP-712 typed data signature over the execution or payload parameters
Optional peer collection — Oracle instances can request additional peer signatures when configured, but the onchain RelayOracle contract itself verifies one authorized signer address per submitted execution
Return — The signed attestation or execution is returned to the caller, who submits it to the Oracle contract on the Relay Chain. The contract verifies the signer and executes the actions on the Hub
​
Pull-Based Verification
A key cost optimization is that the Oracle does not require message-passing infrastructure (like LayerZero or Hyperlane) between chains. Instead:
Validators read historical chain data on-demand when a caller requests verification
Attestations are submitted by the caller to the Relay Chain, meaning no gas is spent on origin or destination chains for verification
This dramatically reduces the per-order cost of verification compared to protocols that emit and relay crosschain messages
​
Batch Execution
The Oracle supports batch attestation via executeMultiple(). Multiple attestations (across different orders and action types) can be submitted in a single transaction on the Relay Chain, further amortizing gas costs.
If an individual attestation in a batch has already been processed, it is skipped rather than reverting the entire batch.
​
Oracle Contract
The Oracle contract on the Relay Chain is a thin verification layer. It receives signed executions, verifies that the submitted signature is valid for an authorized oracle address, and calls the corresponding action on the Hub. That authorized oracle address can itself be an EOA or an EIP-1271 contract such as RelayOracleMultisig. The contract itself does not perform any crosschain verification — it trusts the configured oracle signer.
The contract manages authorized oracle signers via role-based access control, and ensures idempotency so that the same attestation cannot be processed twice.
​
Security
The Oracle is a trust-critical component — it determines which deposits and fills are considered valid. Several properties limit the impact of a compromise:
Signer-controlled — The onchain Oracle accepts attestations only from authorized oracle signers. If a multisig signer such as RelayOracleMultisig is used, any thresholding happens behind that signer contract rather than inside RelayOracle
Cannot steal funds — Even a compromised Oracle can only incorrectly attribute balances on the Hub. User funds in the Depository remain protected by the Allocator’s independent withdrawal authorization.
Bounded impact — The Security Council can halt all withdrawal proof generation if anomalous attestations are detected
​
Source Code
Oracle application — relay-protocol-oracle. See the Third-Party Oracle guide for deployment and operation instructions.
Oracle contract — Part of the settlement-protocol repository, deployed on the Relay Chain.

Was this page helpful?

Yes
No
Deposit Addresses
Hub
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform