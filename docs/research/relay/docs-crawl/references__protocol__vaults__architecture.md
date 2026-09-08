# Architecture - Relay

Source: https://docs.relay.link/references/protocol/vaults/architecture

Vaults
Architecture
Copy page

Architecture of Relay Vaults

A Relay Vault is a smart contract (RelayPool.sol) that implements the ERC4626 standard. It is deployed on specific EVM network, for a specific currency, represented by an ERC20. It is possible to use wrapped tokens (such as WETH) to handle native currencies (we provide a Native Gateway for this purpose).
Each vault has a base yield pool, in which funds are instantly deposited and withdrawn. This pool is typically a lending protocol such as Aave or Morpho, but it can be any contract that implements the ERC4626 standard. The base yield pool is used to generate yield for the vault.
Each vault also has origins. Origins are contracts deployed on different chains. Origins can be treated as “bridging” contracts. When a user sends funds to a bridge, they can receive the same amount (minus fees) of funds from the vault on the destination chain. In order to achieve this, the RelayBridge contracts uses Hyperlane to send a message to the vault. As soon as the message reaches the vault, the funds are pulled from the yield pool and sent to the recipient. At the same time, the vault initiates the transfer of funds using an underlying bridge (e.g. native bridges, … ).
The Relay Vaults can be considered to be an “accelerator” where funds are “dispersed” without requiring to wait for the full resolution of the bridge, in exchange for a small fee.
In order to abstract the underlying bridges, we rely on the concept of BridgeProxy. A BridgeProxy contract is deployed on both the origin chain and the vault’s chain and implements the specificities of the underlying bridge.
Each origin has its own fee which represents the “opportunity cost” of the funds being bridged: shorter bridges should have lower fees than longer ones.
Finally, the vault contract is designed to resist “inflation” attacks. Any yield generated (thru fees, or extra rewards) is not accrued instantly by the vault, but streamed over a specific period of time, rendering any attack where funds deposited and withdrawn in a short period of time ineffective.

Was this page helpful?

Yes
No
Overview
Security
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform