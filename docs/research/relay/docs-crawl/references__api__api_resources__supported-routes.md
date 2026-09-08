# Supported Tokens & Routes - Relay

Source: https://docs.relay.link/references/api/api_resources/supported-routes

On this page
Solver Currencies and Swap Support
How to check if a route is supported?
Step 1: Check Token Support Level
Step 2: Check Individual Token Support
Step 3: Verify Bridging Support
Examples of Supported and Limited Token Routes
Example: All Tokens Supported
Example: Limited Token Support
Gas Top-Up
API Reference
Chains, Tokens, Contracts
Supported Tokens & Routes
Copy page

Relay currently supports multiple cross-chain routes across 69+ blockchain networks. This guide explains how to determine if a particular route and token pair are supported by Relay

​
Solver Currencies and Swap Support
Chain Name	Solver Currencies (supported natively)	Swaps Supported	Gas Top Up Supported

Ethereum	ETH, USDC, USDT, ANIME, WETH, SYND, USDe, PLUME, mUSD, DAI, APE, SIPHER, USDG, AUSD, PYUSD	true	true
Base	ETH, USDC, USDT, cbBTC, WETH, SYND, SOL, DEGEN	true	true
Arbitrum	ETH, USDC, USDT, WETH, ANIME, APE	true	true
Optimism	ETH, USDC, USDT, WETH	true	true
BNB	USDC, USDT, SOMI, USDe, BNB	true	true
Polygon	USDC, USDT, USDC.e, pUSD	true	true
Solana	USDC, USDT, PENGU, CASH, PYUSD, USDG, SOL	true	false
Abstract	ETH, USDC, PENGU	true	true
Animechain	USDC, ANIME	false	true
ApeChain	APE	true	true
Avalanche	USDC, GUN, USDe	true	true
B3	ETH, USDC	false	true
Berachain	USDC, WETH	false	false
Bitcoin	BTC	N/A	false
Blast	ETH, WETH	true	true
BOB	ETH	true	true
Boba Network	ETH	true	true
Celo	USDC	true	true
Cronos	USDC, USDC.e, CRO	true	true
Doma	ETH, USDC.e	true	true
Eclipse	ETH	false	false
Ethereal	USDe	false	true
Flow EVM	USDC, FLOW	true	true
Gensyn	ETH, USDC	true	true
Gnosis	USDC, xDAI	true	true
Gunz	GUN	false	true
HyperEVM	USDC, USD₮0, USDe, HYPE	true	true
Hyperliquid	USDC, USDe	true	false
Ink	ETH, USDC, USDT0	true	true
Katana	ETH, USDC, USDT	true	true
Lighter	ETH (Spot), USDC (Perp)	true	false
Linea	ETH, USDC, mUSD	true	true
Lisk	ETH	false	true
Manta Pacific	ETH	true	true
Mantle	USDC	true	true
MegaETH	ETH, USDT, USDm	true	true
Metis	WETH	true	true
Mode	ETH	true	true
Monad	USDC, mUSD, MON	true	true
Morph	ETH	false	true
Mythos	ETH, USDC.e	false	true
Plasma	USD₮0, XPL	true	true
Plume	USDC, WETH, pUSD, PLUME	true	true
Robinhood Chain	ETH, USDG	true	true
Ronin	USDC, RON	true	true
Scroll	ETH	true	true
Shape	ETH	true	true
Somnia	SOMI	false	true
Soneium	ETH, USDC.e	true	true
Sonic	USDC	true	true
Stable	USDT0	false	false
Superseed	ETH	false	true
Tempo	USDC, PathUSD, USDT0	true	true
TON	GRAM	false	false
Tron	USDT, TRX	false	false
Unichain	ETH, USDC	true	true
World Chain	ETH, USDC	true	true
XRP	XRP	false	false
Zircuit	ETH	false	true
zkSync Era	ETH	true	true
Zora	ETH, USDzC	true	true
​
How to check if a route is supported?
To determine if a route is supported (also referred to as whether a token is supported for bridging), use the Chains API to check for an available route between a given token pair.
curl -X GET "https://api.relay.link/chains"

The response will return a list of chains, each containing supported token pairs. To verify if a route is supported, follow these steps:
​
Step 1: Check Token Support Level
Look for the tokenSupport field in the response for a given chain:
If tokenSupport is "All", then routes involving this chain as either the origin or destination are supported for tokens where Solver or DEX liquidity is available.
If tokenSupport is "Limited", proceed to step 2.
​
Step 2: Check Individual Token Support
If tokenSupport is "Limited", check the erc20Currencies and currency fields in the response. These fields contain token objects with metadata indicating whether a token supports bridging.
​
Step 3: Verify Bridging Support
Locate the supportsBridging field in the token object:
If supportsBridging is true, the token is supported for bridging.
If supportsBridging is false or if the token pair is not listed in erc20Currencies or currency, then the route is not supported.
​
Examples of Supported and Limited Token Routes
​
Example: All Tokens Supported
{
  "chains": [
        {
            "id": 10,
            "name": "optimism",
            "displayName": "Optimism",
            "tokenSupport": "All",
            "currency": {
                "id": "eth",
                "symbol": "ETH",
                "name": "Ether",
                "address": "0x0000000000000000000000000000000000000000",
                "decimals": 18,
                "supportsBridging": true
            },
            "erc20Currencies": [
                {
                    "id": "wbtc",
                    "symbol": "WBTC",
                    "name": "Wrapped BTC",
                    "address": "0x68f180fcce6836688e9084f035309e29bf0a2095",
                    "decimals": 8,
                    "supportsBridging": false,
                    "withdrawalFee": 0,
                    "depositFee": 0,
                    "surgeEnabled": false
                },
                {
                    "id": "usdt",
                    "symbol": "USDT",
                    "name": "Tether USD",
                    "address": "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58",
                    "decimals": 6,
                    "supportsBridging": true,
                    "withdrawalFee": 0,
                    "depositFee": 0,
                    "surgeEnabled": false
                },
                {
                    "id": "dai",
                    "symbol": "DAI",
                    "name": "Dai Stablecoin",
                    "address": "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
                    "decimals": 18,
                    "supportsBridging": false,
                    "withdrawalFee": 0,
                    "depositFee": 0,
                    "surgeEnabled": false
                },
                {
                    "id": "usdc",
                    "symbol": "USDC",
                    "name": "USD Coin",
                    "address": "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
                    "decimals": 6,
                    "supportsBridging": true,
                    "supportsPermit": true,
                    "withdrawalFee": 0,
                    "depositFee": 0,
                    "surgeEnabled": false
                }
            ]
        }
  ]
}

See all 65 lines
Since the tokenSupport field is "All", routes involving this chain are supported for tokens where Solver or DEX liquidity is available.
​
Example: Limited Token Support
{
  "chains": [
        {
            "id": 7777777,
            "name": "zora",
            "displayName": "Zora",
            "tokenSupport": "Limited",
            "currency": {
                "id": "eth",
                "symbol": "ETH",
                "name": "Ether",
                "address": "0x0000000000000000000000000000000000000000",
                "decimals": 18,
                "supportsBridging": true
            },
            "erc20Currencies": [
                {
                    "id": "usdc",
                    "symbol": "USDzC",
                    "name": "USD Coin (Bridged from Ethereum)",
                    "address": "0xcccccccc7021b32ebb4e8c08314bd62f7c653ec4",
                    "decimals": 6,
                    "supportsBridging": true,
                    "withdrawalFee": 0,
                    "depositFee": 0,
                    "surgeEnabled": false
                }
            ]
        }
  ]
}

Here, tokenSupport is "Limited", meaning only specific tokens can be bridged. In this case, usdc is listed under erc20Currencies with supportsBridging: true, so routes involving usdc as an origin or destination token on Zora are supported.
​
Gas Top-Up
For full documentation on enabling gas top-up and checking support requirements, see Gas Top-Up.
​
API Reference
For the most up-to-date information on supported tokens and routes, always refer to the Chains API endpoint, as token support can change over time.

Was this page helpful?

Yes
No
Contract Addresses
Troubleshooting
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform