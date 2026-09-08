# Security - Relay

Source: https://docs.relay.link/references/protocol/vaults/security

On this page
Threat model
Curator
Origins
Audits
Vaults
Security
Copy page
​
Threat model
Relay vaults are receiving funds from users who deposit their tokens to provide liquidity to the vaults. The contracts are not upgradable, meaning that once deployed, the code cannot be changed.
​
Curator
However, there are several configuration parameters that can be changed by the owner of the vaults (called its curator), such as the base yield pool, or the origins, and few other minor elements. In order to protect the user funds, each vault is deployed and “owned” by a timelock contract, which means that any change submitted by its curator on the contract can only happen after a delay. This allows the community to review the changes, and, if needed, Liquidity Providers can pull their liquidity out of the vaults before the changes are applied.
Additionally, for vaults curated by the Relay team, the curator is a multisig wallet with a 3 of 5 policy. This means that any change to the vaults must be approved by at least 3 distinct members of the Relay team, providing an additional layer of security.
​
Origins
Another threat is one where a specific origin (and its bridge) gets compromised. This can take multiple forms, such as a bridge being exploited, or an origin chain reorg that would lead to funds that had been previously bridged, not actually being sent to the vault.
In order to mitigate these risks, each origin has a maximum debt setting which specifies the maximum amount of funds that can be bridged from that origin at any given time (capping the loss that a vault can endure). The origins also have a specific cool down period which is the minimum delay between a bridging transaction and the dispersion of funds to the recipient.
Finally, each origin has a specific curator who can instantly pause the origin in case of an emergency. This allows the Relay team to quickly react to any potential issues with a specific origin.
​
Audits
The Relay Vault contracts have been audited by Spearbit and you can find the audit reports in our Github repo.

Was this page helpful?

Yes
No
Architecture
Backend
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform