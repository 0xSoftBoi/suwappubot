# Surplus & Shortage - Relay

Source: https://docs.relay.link/references/api/api_core_concepts/surplus-and-shortage

On this page
Origin Operation Types
How are surpluses or shortages handled?
Surplus Example
Shortage Example
Core Concepts
Surplus & Shortage
Copy page

Learn how Relay handles surpluses or shortages.

Relay allows for users to instantly bridge or swap funds cross-chain while saving on gas. There are swaps or bridges where a surplus or shortage can happen. To understand how we handle either, we first need to understand how an origin operation can produce a surplus or shortage.
​
Origin Operation Types
When starting a bridge or swap, Relay labels them as origin operations. After submission, origin operations send their output to the solver to complete the bridge or swap. There are three possible outcomes for an origin operation:
Exact: When the origin operation matches the solver’s input exactly, the destination operation proceeds as initially quoted.
Surplus: When the solver executes the origin operation input, there is positive slippage after the swap or bridge. This results in a surplus or extra funds.
Shortage: When the solver executes the origin operation input, there is negative slippage after the swap or bridge. This results in a shortage or less funds.
​
How are surpluses or shortages handled?
An origin operation can produce three possible outcomes. Depending on the outcome will determine how Relay handles the bridge or swap.
Exact: The expected amount is received. The destination operation proceeds as initially quoted.
Surplus: The solver receives more than expected. The quoted rate is used as a heuristic to determine whether to proceed with the operation. Specifically, if the solver can guarantee that the input amount can be swapped for at least the quoted rate of the expected amount, the operation continues. Surpluses typically result in the user receiving more than expected on the destination chain.
Shortage: The solver receives less than expected. The quoted rate is used as a heuristic to determine whether to proceed with the operation. Specifically, if the solver can guarantee that the input amount can be swapped for at least the quoted rate of the expected amount, the operation continues. Shortages typically result in the user receiving less than expected on the destination chain.
​
Surplus Example
Consider the following quote to a user:
Quoted Transaction: 100 USDC → 0.01 ETH → 0.01 ETH → 100 DAI
However, during the origin operation, this happens:
Actual Transaction: 100 USDC → 0.011 ETH
In this case, the new output amount (0.011 ETH) is passed to the destination swap. The operation continues as long as the solver can swap 0.011 ETH at a rate of at least 0.01 ETH per 100 DAI, resulting in the user receiving a little extra.
​
Shortage Example
Consider the following quote to a user:
Quoted Transaction: 100 USDC → 0.01 ETH → 0.01 ETH → 100 DAI
However, during the origin operation, this happens:
Actual Transaction: 100 USDC → 0.009 ETH
In this case, the new output amount (0.009 ETH) is passed to the destination swap. The operation continues as long as the solver can swap 0.009 ETH at a rate of at least 0.01 ETH per 100 DAI, resulting in the user receiving a little less.

Was this page helpful?

Yes
No
Trade Types
Handling Quote Errors
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform