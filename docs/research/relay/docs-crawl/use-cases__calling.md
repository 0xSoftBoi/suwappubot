# Call Execution - Relay

Source: https://docs.relay.link/use-cases/calling

On this page
How it Works
Use Cases
Call Execution
Copy page

Execute transactions across any chain, pay with any token

Relay supports cross-chain transaction execution for arbitrary cross-chain transactions. This means a user can execute any call on any chain and pay with any token on any other chain. This feature is perfect for cross-chain checkout experiences as well as full chain abstraction.
Gas requirement: With standard EOA wallets, the user still needs a small amount of native gas token (e.g., ETH) on the origin chain to broadcast the initial deposit transaction. Relay handles all destination chain gas and deducts fees from the user’s tokens, but the origin chain submission requires native gas. For a fully gasless experience where users hold zero native tokens, see Gasless Swaps to find the right approach for your app, or explore Smart Accounts (EIP-7702 or ERC-4337) directly.
​
How it Works
Relay’s cross-chain execution is powered by cross-chain intents. This model results in low-cost, low-latency (1-10 seconds) cross-chain transactions. When a user wishes to perform a cross-chain action, they submit the call data to get a quote from relayers for execution. When they accept the quote, the order is validated and they submit a transfer to the Relay Depository Contract. A relayer then instantly fills the transaction on the destination chain before unlocking the funds on the origin.
Learn how to integrate cross-chain call execution with our Call Execution Integration Guide.

Was this page helpful?

Yes
No
Swaps
App Fees
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform