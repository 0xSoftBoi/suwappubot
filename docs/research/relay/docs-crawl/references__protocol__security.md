# Security & Audits - Relay

Source: https://docs.relay.link/references/protocol/security

On this page
Trust Model
Depository
Oracle
Hub
Allocator
Security Council
Audits
Bug Bounty
Source Code
Settlement
Security & Audits
Copy page

Trust model, security architecture, and audit history

​
Trust Model
Relay Settlement is designed to be non-custodial — no single entity can unilaterally access user funds. Each component has different trust properties:
​
Depository
The Depository contracts are the most trust-minimized component:
Non-upgradable — Contract logic is immutable after deployment
Single authorization path — Only the registered Allocator can authorize withdrawals
Short custody duration — Funds are typically held for seconds to minutes, not hours or days
No admin withdrawal — There is no backdoor function for the contract owner to withdraw user funds
The Depository’s security relies on the Allocator’s signing authority. If the Allocator is compromised, it could authorize unauthorized withdrawals — but it cannot create balances that don’t exist on the Hub.
​
Oracle
The Oracle determines which deposits and fills are considered valid:
Can attribute balances — The Oracle controls what gets minted, transferred, or burned on the Hub
Cannot steal Depository funds — Even an incorrect attestation only affects Hub balances. The Allocator independently verifies Hub balances before authorizing any withdrawal.
Authorized signer model — Attestations must be signed by an authorized oracle signer. If a signer contract such as RelayOracleMultisig is used, any thresholding is enforced there rather than in the RelayOracle contract itself.
The Oracle is the main trust-bearing component. A compromised unauthorized signer cannot submit false attestations. A compromised authorized oracle signer, or a compromised threshold behind an oracle signer contract, could incorrectly attribute balances, but the damage is bounded by the Allocator’s balance checks and the Security Council’s ability to halt all withdrawal proof generation.
​
Hub
The Hub is a deterministic smart contract on the Relay Chain:
Rule-based — Balance changes only occur through Oracle-attested actions (MINT, TRANSFER, BURN)
Idempotent — The same attestation cannot be processed twice
Transparent — All balance changes are visible on the Relay Chain block explorer
​
Allocator
The Allocator controls withdrawal authorization:
MPC signatures — No single entity holds the full signing key
Balance-bounded — Can only authorize withdrawals up to a solver’s Hub balance
Oracle-gated — Withdrawal proofs require a valid Oracle signature, verified by the RelayAllocatorSpender before the Allocator processes the request
Governed by Security Council — A multisig where any single member can suspend an approved withdrawer, and a supermajority can replace the Allocator
Replay-protected — Nonces and expirations prevent proof reuse
​
Security Council
The Security Council is a multisig that governs the Allocator. Any single member can immediately suspend an approved withdrawer such as RelayAllocatorSpender. In the current deployment, that halts new withdrawal proof generation because withdrawals are routed through that contract. Structural changes (replacing the Allocator, changing membership) require a supermajority.
See the full Security Council page for details on tiered thresholds and scope.
​
Audits
The protocol has been audited by leading security firms:
Date	Scope	Auditor	Report
February 2025	Relay Depository (EVM)	Spearbit	View Report
June 2025	Relay Depository (EVM)	Certora	View Report
November 2025	Settlement Protocol	Zellic	View Report
April 2026	Oracle	Zellic	View Report
​
Bug Bounty
Details of the Relay bug bounty program can be found on the Bug Bounties page.
​
Source Code
All protocol contracts are open source:
settlement-protocol — Depository, Deposit Addresses, Hub, Oracle, Allocator contracts
relay-protocol-oracle — Relay Protocol Oracle application

Was this page helpful?

Yes
No
Security Council
For Solvers
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform