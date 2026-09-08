# Smart Accounts in Relay - Relay

Source: https://docs.relay.link/references/api/api_guides/smart-accounts

On this page
ERC-4337
EIP-7702
Why Smart Accounts Matter for Relay
🔗 Explore the Guides
Integration Guides
Smart Accounts in Relay
Copy page

How Relay uses ERC-4337 and EIP-7702 to enable smart wallet features like gas sponsorship, batching, and cross-chain execution

Smart accounts unlock new design space in Relay’s cross-chain infrastructure. With them, we can:
Batch multiple actions into one atomic call (e.g. deposit → call user wallet → mint NFT)
Delegate tx execution to the user, preserving msg.sender on the destination chain
Sponsor gas or use ERC-20s for fee payments
Route logic across chains, bridging into EOAs that execute contract logic without a separate deployment
Relay supports two complementary standards for smart account execution:
​
ERC-4337
Relay uses ERC-4337 to support complex smart account flows. Key features include:
Sponsored transactions using paymasters
Arbitrary smart account validation logic
Bundled execution: approve → swap → send, all in one tx
This is useful when you have smart accounts like Safe or Kernel, and interact via UserOperations.
​
EIP-7702
Relay uses EIP-7702 to enable EOAs to become smart accounts.
We support 7702 to:
Execute logic on destination chains where the user is msg.sender
Useful for apps where the final contract cares about the actual sender (e.g. NFT mints, purchases)
Preserve intent and gas delegation across chains
Our solver can bridge ETH or tokens to the user’s EOA, and the EOA can act as a smart wallet
Avoid smart account setup on destination: the user’s EOA behaves like a contract temporarily, powered by an authorizationList signature
​
Why Smart Accounts Matter for Relay
Smart accounts let us overcome key limitations in a cross-chain solver system:
Problem	Solved By
msg.sender is solver, but the app needs it to be the user	✅ ERC-4337 / 7702
Want to batch calls after bridging ETH	✅ ERC-4337 / 7702
Want to pay gas from any chain or abstract fees entirely	✅ ERC-4337 paymasters / 7702 signature logic
Want smart account functionality for your EOA	✅ EIP-7702
For example, when someone uses ETH on Chain A to buy an NFT on Chain B:
Relay bridges the ETH to their EOA
That EOA uses a signed 7702 tx to batch logic on Chain B: approve → mint
msg.sender = the user, not Relay
This wasn’t previously possible because we couldn’t inject logic into EOAs without deploying a contract. Now we can.
​
🔗 Explore the Guides
ERC-4337 Guide – Learn how Relay uses UserOperations and bundlers
EIP-7702 Guide – See how Relay turns EOAs into smart wallets with authorizationList
Relay supports both 4337 and 7702. Whether you’re building gasless dApps, trustless UX, or bridging into smart behavior — smart accounts are the foundation.
Let us know what you’re building.

Was this page helpful?

Yes
No
Base Builder Codes
Testnet Support
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform