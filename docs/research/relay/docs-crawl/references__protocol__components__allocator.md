# Allocator - Relay

Source: https://docs.relay.link/references/protocol/components/allocator

On this page
Overview
How It Works
Oracle-Gated Access
Payload Builders
MPC Signing
Security Model
Source Code
Components
Allocator
Copy page

The component that authorizes crosschain withdrawals

​
Overview
The Allocator is the component responsible for authorizing withdrawals from Depository contracts. When a solver wants to claim funds they’ve earned by filling orders, the Allocator verifies their Hub balance and generates a cryptographic proof that the Depository will accept.
The Allocator uses MPC chain signatures for signing, meaning no single entity holds the private keys needed to authorize withdrawals. It is governed by the Security Council, which can suspend approved withdrawers or replace the Allocator in an emergency.
​
How It Works
Depository
Payload Builder
Allocator (Aurora)
AllocatorSpender (Aurora)
Hub (Relay Chain)
Oracle
Solver
Depository
Payload Builder
Allocator (Aurora)
AllocatorSpender (Aurora)
Hub (Relay Chain)
Oracle
Solver
1. Request withdrawal initiation
2. Return signed Hub execution
3. Execute transfer to withdrawal address
4. Request payload params
5. Return signed payload params + Oracle signature
6. Request proof (with Oracle signature)
Verify Oracle signature
7. Forward to Allocator
Construct chain-specific payload
Withdrawal request (e.g. CallRequest)
Generate MPC signature
8. Return signed withdrawal proof
9. Submit proof to target chain
Funds released
The withdrawal authorization process:
While solvers are the primary users of the withdrawal flow, any address that holds a balance on the Hub can withdraw using the same mechanism.
Solver requests withdrawal initiation — The solver requests a withdrawal from the Oracle, including the withdrawal parameters and owner authorization.
Oracle returns Hub execution — The Oracle computes the deterministic withdrawal address for the request and returns a signed execution that transfers the corresponding Hub balance to that address.
Solver executes transfer on Hub — The solver submits that execution on the Relay Chain so the withdrawal address now holds the requested Hub balance.
Solver requests payload params — Once the transfer is reflected on the Hub, the solver calls the Oracle again to obtain the signed payload parameters for the withdrawal.
Oracle returns payload params and signature — The Oracle verifies the withdrawal address balance and returns the payload parameters along with an EIP-712 signature over the withdrawal request.
Solver submits to AllocatorSpender — The solver calls the RelayAllocatorSpender contract on Aurora, passing the withdrawal parameters and the Oracle’s signature.
AllocatorSpender verifies and forwards — The RelayAllocatorSpender verifies that the Oracle signature is valid and from a registered Oracle (via ORACLE_ROLE), then forwards the request to the Allocator. Because the RelayAllocatorSpender holds APPROVED_WITHDRAWER_ROLE on the Allocator, the call is authorized.
MPC signing — The Allocator constructs the chain-specific payload via a Payload Builder and requests an MPC signature from the NEAR chain signatures network.
Proof delivery — The signed withdrawal proof is returned to the solver, who submits it to the Depository contract on the target chain.
​
Oracle-Gated Access
The Allocator uses role-based access control — only addresses holding APPROVED_WITHDRAWER_ROLE can trigger withdrawal proof generation. Rather than granting this role to individual solvers, the protocol uses a gateway contract called RelayAllocatorSpender.
In the current production deployment, RelayAllocatorSpender is the contract used to hold APPROVED_WITHDRAWER_ROLE and gate withdrawal signing behind Oracle authorization. The Allocator contract itself does not require this to be the only approved withdrawer; additional withdrawers could be granted the role by governance. In the deployed flow, this means:
No withdrawal proof can be generated without Oracle authorization — The Oracle must sign the withdrawal parameters, adding a verification layer on top of the MPC signing
Oracles are managed via ORACLE_ROLE — The Security Council controls which Oracle instances are registered on the RelayAllocatorSpender
Suspension can halt withdrawals in the current deployment — If RelayAllocatorSpender is the only approved withdrawer, suspending it halts withdrawal proof generation across the protocol
​
Payload Builders
Different chains require different transaction formats. The Allocator uses specialized Payload Builders for each chain type:
Builder	Chains	Signature Format
EVM Payload Builder	Ethereum, Base, Arbitrum, Optimism, + all EVM chains	EIP-712 typed data
Solana Payload Builder	Solana, Eclipse	Ed25519
Bitcoin Payload Builder	Bitcoin	ECDSA (secp256k1)
Each Payload Builder constructs the chain-specific request structure (e.g., CallRequest for EVM, TransferRequest for Solana) with the appropriate encoding (ABI for EVM, Borsh for Solana).
​
MPC Signing
The Allocator uses Multi-Party Computation (MPC) chain signatures for withdrawal authorization. Instead of a single private key controlling access to Depository funds, the signing key is split across multiple independent MPC nodes. A threshold of nodes must cooperate to produce a valid signature — no single entity ever holds the full key.
Key properties:
No single key holder — The private key is split across multiple MPC nodes, and a threshold must cooperate to produce a signature
Programmable authorization — The Allocator enforces rules (balance checks) before requesting any signature
Chain-agnostic — MPC signing can produce signatures for any curve or format (ECDSA, Ed25519, etc.), enabling support for EVM, Solana, Bitcoin, and other VMs
Auditable — All signing requests flow through an onchain contract, creating a transparent record
The protocol currently uses NEAR MPC chain signatures for its signing infrastructure. The Allocator contract is deployed on Aurora (NEAR ecosystem) for direct integration with the NEAR MPC network.
The MPC signing layer is designed to be implementation-agnostic. While NEAR chain signatures are used today, the architecture allows for alternative MPC networks or signing backends without changes to the rest of the protocol.
​
Security Model
The Allocator is a trust-critical component — it controls access to funds in the Depository. Several safeguards protect against misuse:
MPC signing — No single entity holds the full signing key. A threshold of independent MPC nodes must cooperate to produce a valid signature.
Oracle-gated access — Withdrawal proofs require a valid Oracle signature, verified by the RelayAllocatorSpender before the Allocator processes the request.
Balance-bounded — The Allocator can only authorize withdrawals up to a solver’s existing Hub balance. It cannot mint new balances or alter the ledger.
Security Council — A multisig where any single member can suspend an approved withdrawer such as RelayAllocatorSpender. In the current deployment, that can halt withdrawal proof generation. A supermajority can replace the Allocator entirely.
Replay protection — Every withdrawal proof includes a unique nonce and expiration timestamp, preventing reuse of stale proofs.
The Allocator cannot mint new balances or alter the Hub ledger. It can only authorize withdrawals up to a solver’s existing Hub balance. Even a compromised Allocator cannot create funds that don’t exist.
​
Source Code
The Allocator contract (RelayAllocator.sol) and the gateway contract (RelayAllocatorSpender.sol) are part of the settlement-protocol repository.

Was this page helpful?

Yes
No
Hub
Security Council
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform