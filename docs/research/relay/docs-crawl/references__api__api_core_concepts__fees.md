# Cost & Fee Structure - Relay

Source: https://docs.relay.link/references/api/api_core_concepts/fees

On this page
Fees in the API
Fee Sponsorship
Deprecated: Fees Object
Core Concepts
Cost & Fee Structure
Copy page

Learn about Relay’s cost and fee structure

In any given token swap or bridge powered by Relay, there are four potential fee and cost components:
Execution Cost (formerly Execution Fees)
Covers execution costs including network gas on the origin and/or destination chain, and includes:
$0.02 flat fee — always included
Destination (fill) gas estimate — always included, covers transaction fulfillment on the destination chain
Origin gas estimate — only included for gasless transactions, covers transaction submission on the origin chain on the user’s behalf
For regular (non-gasless) transactions, the user pays origin gas directly from their own wallet to the network — it’s not part of the Execution Cost.
Swap Cost (formerly Swap Fees)
Covers payments to liquidity providers that facilitate cross-asset and cross-chain token swaps, and includes:
DEX fees
DEX swap impact
Solver cross-chain rebalancing fees
Note: Hyperliquid charges a $1 activation fee for new deposits. Relay cannot change this fee — it is passed through to users.
Platform Fees (formerly Relay Fees)
A flat basis point fee charged for using the Relay API gateway and related services, including via the Relay.link frontend.
Standard Fees	Token Bridge & Same-Chain Wrap/Unwrap	Stablecoin Swap	Major Swap	Minor Swap
Platform Fees charged to end users	0.00%	0.01%	0.06%	0.15%
Relay integrators can receive a revenue share on the Platform Fees. The revenue share varies by asset pair type and volume tier, as detailed below. To qualify, integrators must:
Pass an API key in the Relay quote
Complete Know Your Business (KYB) verification
Exceed $10,000,000 in aggregate U.S. dollar volume over a trailing 30-day period
Provide an EVM wallet address to receive revenue share
The revenue share cannot be used to discount the Relay product to end users.
Revenue Share Volume Tier* (U.S. Dollars)	Token Bridge & Same-Chain Wrap/Unwrap	Stablecoin Swap	Major Swap	Minor Swap
$10M – $100M	0%	34%	25%	33.33%
$100M – $1B	0%	67%	50%	66.67%
* The Revenue Share Volume Tier is calculated based on the aggregate U.S. dollar value of the transactions for the trailing 30 days.
Relay Transaction Types:
Token Bridge: a token bridge transaction. Examples:
USDC on Arbitrum to USDC on Base
Same-Chain Wrap/Unwrap: a 1:1 conversion on the same chain between a native asset and its tokenized equivalent via a single smart contract. Wrapping locks the native asset and mints the wrapped token; unwrapping burns the wrapped token and releases the native asset. Examples:
ETH to WETH on Ethereum
SOL to WSOL on Solana
POL to WPOL on Polygon
BNB to WBNB on BNB Chain
Stablecoin swap: same-chain or cross-chain swaps between any pair of these stablecoins: USDC, USDC.e, USDT, USDT0, DAI, USDe, USDS, USD1, PYUSD, USDG, mUSD, USDm, USDH, pUSD, and PlumeUSD (each, a “Major Stablecoin”). Examples:
USDC to USDT on Ethereum
USDC on Optimism to USDT on Solana
Major swap: same-chain or cross-chain swaps between any pair of these tokens: ETH, WETH, BTC, WBTC, SOL, WSOL, POL, BNB, and PLUME (each, a “Major Token”), and between any Major Token and any Major Stablecoin. Examples:
ETH to POL on Polygon
ETH on Ethereum to SOL on Solana
Minor swap: same-chain or cross-chain token swaps between any pair of tokens that are not a Major Stablecoin or Major Token. Examples:
LINK to UNI on Ethereum
AVAX on Avalanche to Aster on BNB Chain
App Fees
Fees added on top of a Relay quote by the integrator.
If you are interested in learning how app fees work, and how you can add them to your quotes please check out our App Fees Doc.
Please note that the above fee structure applies to standard cases. In certain cases, such as route-specific campaigns or promotions, different fees may apply.
​
Fees in the API
GET /requests/v3 returns a request’s fees in the data.fees object, with quoted (estimated at quote time) and actual (computed at fill time) values. It breaks fees down into the following components:
execution - Execution costs covering network gas on the origin and/or destination chain plus the flat fee.
swap - Swap costs from cross-currency and cross-chain exchange, including DEX fees, swap slippage, and solver rebalancing.
platform - The Platform Fees, a flat basis-point fee charged by Relay for routing and meta-aggregation services.
app - App fees added on top by the integrator, when present.
sponsored - The portion of fees the integrator subsidizes on behalf of the user via Fee Sponsorship.
When displaying fees to users, we recommend mapping the data.fees fields as follows:
execution → Execution Cost
swap → Swap Cost
platform → Platform Fees
app → App Fee
In the quote API and GET /requests/v2, this same breakdown is returned as the expandedPriceImpact object, and the platform component is named relay.
​
Fee Sponsorship
Integrators with Fee Sponsorship enabled can subsidize fees for their users. By default, setting subsidizeFees to true sponsors all fee components.
For more granular control, use the sponsoredFeeComponents parameter in the quote request to choose which specific fee components to sponsor. This allows you to sponsor some components (e.g. execution and platform) while letting the user pay others (e.g. swap).
Deposit addresses do not support sponsoredFeeComponents.
See the Fee Sponsorship Doc for setup details.
​
Deprecated: Fees Object
The fees object is deprecated. It is still returned from the quote API and the GET /requests/v2 API for backwards compatibility, but it only reports Relay-related fees and does not reflect the full cost of a request. Do not rely on it for new integrations.
To understand or display the complete fee breakdown of a request, use the data.fees object in GET /requests/v3 (or expandedPriceImpact in the quote API and GET /requests/v2) instead, which covers execution, swap, platform, app, and sponsored fees.
The deprecated fees object is segmented into the following fields:
relayerService: The service fee paid to the relayer to facilitate execution.
relayerGas: The gas fee given to the solver to pay gas fees on the destination chain.
relayer: The sum of the relayerService and the relayerGas.
app: Third party fees added on top of the existing fees, this fee is added by app developers and accrues offchain to minimize gas costs.
subsidized: The Fees in the order that are subsidized by the integrator.

Was this page helpful?

Yes
No
Wallet Detection
Refunds
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform