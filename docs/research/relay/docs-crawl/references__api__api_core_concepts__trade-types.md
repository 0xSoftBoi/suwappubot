# Trade Types - Relay

Source: https://docs.relay.link/references/api/api_core_concepts/trade-types

On this page
Exact Input
Expected Output
Exact Output
Core Concepts
Trade Types
Copy page

Learn trade types Relay supports.

Relay supports three trade types: exact_input, expected_output and exact_output.
​
Exact Input
The first supported type is EXACT_INPUT. In this order type, the user specifies how much of the input currency they want to provide for a swap or bridge. The user is told how much of the output token they will receive for a given input. This trade type fails if the input amount is too small to cover associated fees with the request. Associated fees can include but are not limited to relay fees, app fees, and gas fees.
​
Expected Output
The second supported type is EXPECTED_OUTPUT. In this order type, the user quotes via specifying the general amount of output currency they expected to receive from the swap or bridge. The user is then told how much of the origin token this will require. The resulting output amount received can be less or more than what is requested, depending on slippage. This trade type automatically accounts for any associated fees including relay fees, app fees, and gas fees. We recommend using EXPECTED_OUTPUT for when an exact output amount is not necessary, or if calls do not need to be executed on destination.
​
Exact Output
The third supported type is EXACT_OUTPUT. In this order type, the user specifies exactly how much of the output currency they want to receive from the swap, bridge, or cross-chain call. The user is told how much of the origin token this will require to receive exactly the output amount. If the exact requested amount out cannot be filled, the request is failed and the user is refunded on origin. This trade type automatically accounts for any associated fees including relay fees, app fees, and gas fees. We recommend using EXACT_OUTPUT when a precise output amount is required — for example, bridging an exact amount to a destination address, guaranteeing a merchant receives a specific payment amount, or executing a destination call that requires a fixed input such as minting with an exact ERC20 amount. Destination calls also support EXACT_INPUT when you want to cap spend and accept a variable output.

Was this page helpful?

Yes
No
Input Validation
Surplus & Shortage
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform