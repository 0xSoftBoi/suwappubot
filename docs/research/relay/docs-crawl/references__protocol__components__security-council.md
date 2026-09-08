# Security Council - Relay

Source: https://docs.relay.link/references/protocol/components/security-council

On this page
Overview
Tiered Thresholds
Suspend Mechanism
Scope
Components
Security Council
Copy page

The multisig governance body that protects the protocol

​
Overview
The Security Council is a multisig composed of multiple independent parties across different timezones. It serves as the protocol’s emergency response and governance mechanism, with the authority to suspend approved withdrawers, manage roles, and replace the Allocator.
​
Tiered Thresholds
The Security Council uses tiered thresholds to balance rapid response with governance safety:
Action	Threshold	Purpose
Suspend approved withdrawer	1-of-N	Any member can revoke APPROVED_WITHDRAWER_ROLE from a withdrawer
Restore approved withdrawer	Governance action	Re-grant APPROVED_WITHDRAWER_ROLE after investigation
Update Allocator	Quorum	Add payload builders to add support for new chains
Add/Remove Oracle instances	Quorum	Add or remove Oracles whose attestations are taken into account
Replace Allocator	Supermajority	Upgrade or fix the Allocator contract
Change Membership	Supermajority	Add or remove council members
The low suspend threshold (1-of-N) ensures rapid response to emergencies, while the high thresholds for structural changes prevent unilateral action. Restoring a suspended withdrawer is done through a role grant by the Allocator owner; any stricter threshold is an operational governance choice rather than a rule enforced by the contract itself.
​
Suspend Mechanism
In the current production deployment, withdrawal proof generation flows through the RelayAllocatorSpender contract, which holds APPROVED_WITHDRAWER_ROLE on the Allocator. Any single Security Council member can call suspend(address) on the Allocator to revoke this role from a specific withdrawer, including RelayAllocatorSpender.
If RelayAllocatorSpender is the only approved withdrawer, then suspending this single address is effectively a global halt for new withdrawal proofs. That is a deployment property, not an invariant enforced by the Allocator contract itself.
​
Scope
The Security Council cannot:
Modify the Hub ledger or create balances
Withdraw user funds from the Depository
Alter Oracle attestations
Access funds held in any contract

Was this page helpful?

Yes
No
Allocator
Security & Audits
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform