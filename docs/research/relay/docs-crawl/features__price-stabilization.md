# Price Stabilization - Relay

Source: https://docs.relay.link/features/price-stabilization

On this page
Price Stabilization Options
Fee Sponsorship
Fixed Rates
Why This Works for Stablecoins
Features
Price Stabilization
Copy page

Deliver consistent stablecoin pricing across chains

Price Stabilization gives you two mechanisms for stablecoin swaps: fee sponsorship, where you cover transaction fees so the user receives the full market-rate output, or fixed rates, where you lock in a specific exchange rate (e.g. 1:1) and absorb the volatility yourself.
Stablecoins don’t actually trade at 1:1. When users swap between stablecoins cross-chain, the output fluctuates based on market rates, swap impact, and fees. For a $100 USDC-to-USDT swap, even small deviations from peg mean the user might receive 99.95 or 100.05 USDT instead of a clean 100.
With fixed rates, you sometimes sponsor and sometimes earn the difference, with the expectation that it nets out over time.
For a cross-chain swap between major stablecoins, the cost is roughly: $0.02 + 1bps.
For $100 USDC input, the user would get $99.97 worth of USDT
This is on top of the market rate for the pair:
If 1 USDT = 1.0000 USDC, that’s 99.97 USDT
If 1 USDT = 0.9995 USDC, that’s 100.02 USDT
If 1 USDT = 1.0005 USDC, that’s 99.92 USDT
​
Price Stabilization Options
Relay supports multiple options for stabilizing prices for better UX:
​
Fee Sponsorship
With sponsorship, you cover the fees. So for $100 USDC in, the user gets $100 USDT out, and you cover the $0.03 in fees. Importantly, this doesn’t mean the user gets 1:1 in our USDC:USDT example:
If 1 USDT = 1.0000 USDC, that’s 100 USDT out
If 1 USDT = 0.9995 USDC, that’s 100.05 USDT out
If 1 USDT = 1.0005 USDC, that’s 99.95 USDT out
Request
Response
curl --request POST \
  --url https://api.relay.link/quote/v2 \
  --header 'Content-Type: application/json' \
  --header 'x-api-key: my-api-key' \
  --data '
{
  "user": "0x03508bb71268bba25ecacc8f620e01866650532c",
  "originChainId": 8453,
  "destinationChainId": 42161,
  "originCurrency": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "destinationCurrency": "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
  "amount": "100000000",
  "tradeType": "EXACT_INPUT",
  "subsidizeFees": true
}
'

Learn more about how fee sponsorship works.
​
Fixed Rates
If your goal is to give the user 1:1, you can use fixed rates. In this case, the user would always get 100 USDT, and you would sponsor a dynamic amount. If USDT is worth less than USDC, you actually would earn the difference as fees:
If 1 USDT = 1.0000 USDC, user gets 100 USDT, you sponsor $0.03
If 1 USDT = 0.9995 USDC, user gets 100 USDT, you earn $0.02
If 1 USDT = 1.0005 USDC, user gets 100 USDT, you sponsor $0.08
Effectively, you absorb the volatility, sometimes sponsoring, and sometimes earning fees, with the idea that it nets out over a long time period. Of course, during periods you are sponsoring, you need to be careful that it’s not being arbitraged.
During periods where you are sponsoring the spread, monitor for arbitrage. A fixed rate that deviates from the market can be drained by arbitrageurs.
If you want, you can set rates other than 1:1. E.g. if you set it to 1:1.0005, then you are effectively setting the price to 5bps, and only sponsoring when the market rate + fees is above that. The rate is expressed as “input:output”.
If 1 USDT = 1.0000 USDC, user gets 99.95 USDT, you earn $0.02
If 1 USDT = 0.9995 USDC, user gets 99.95 USDT, you earn $0.07
If 1 USDT = 1.0005 USDC, user gets 99.95 USDT, you sponsor $0.03
Fixed rates work for all stablecoins that Relay holds as solver currencies — common examples include USDC, USDC.e, USDT, USDe, USDH, mUSD, and DAI. Solver currencies vary by chain: to check which stablecoins are supported on a given chain, call the chains API and inspect that chain’s solverCurrencies array. For example, on MegaETH the solver holds USDT and USDm, so fixed rates work for both.
Request
Response
curl --request POST \
  --url https://api.relay.link/quote/v2 \
  --header 'Content-Type: application/json' \
  --header 'x-api-key: my-api-key' \
  --data '
{
  "user": "0x03508bb71268bba25ecacc8f620e01866650532c",
  "originChainId": 8453,
  "destinationChainId": 42161,
  "originCurrency": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "destinationCurrency": "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
  "amount": "100000000",
  "tradeType": "EXACT_INPUT",
  "subsidizeFees": true,
  "fixedRate": "1:1"
}
'

​
Why This Works for Stablecoins
Stablecoin pairs are uniquely suited to price stabilization because the swap impact component of Relay’s fees is typically sub 1bps between major stablecoins. That leaves the flat execution fee (~$0.02) and the Relay bps fee as the dominant costs — both small, predictable amounts that are cheap to sponsor or absorb into a fixed rate.
For a full breakdown of Relay’s fee components and pricing tiers, see Cost & Fee Structure.

Was this page helpful?

Yes
No
Gasless Swaps
Compliance
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform