# Deep Linking - Relay

Source: https://docs.relay.link/references/api/api_guides/deep-linking

On this page
Deep Linking to the Bridge Page
Examples
Bridge from Zora to Base
Bridge from Ethereum to Optimism with a preset address
Bridge 0.01 ETH from Optimism to Zora
Bridge $100 USDC from Base to Arbitrum
Deep Linking to dedicated Chain pages
Examples
Bridge from Zora to Base
Bridge from Ethereum to Optimism with a preset address
Bridge 0.01 ETH from Optimism to Zora
Bridge $100 USDC from Base to Arbitrum
Deep Linking to the Onramp Page
Unsupported Chains list
Supported Currencies
Examples
Onramp onto Base with Base DEGEN
Integration Guides
Deep Linking
Copy page

How to deep link to the Relay App

​
Deep Linking to the Bridge Page
The following query parameters are supported:
Parameter	Description	Example
toAddress	A valid address to receive the bridge	0x03508bB71268BBA25ECaCC8F620e01866650532c
amount	The amount to have the input initially set to	0.1
fromChainId	The chainId of the origin chain	8453
fromCurrency	The currency address for the from chain	0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
toCurrency	The currency address for the to chain	0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
tradeType	Whether to use the amount as the output or the input for the basis of the swap	EXACT_INPUT, EXPECTED_OUTPUT, EXACT_OUTPUT
To deep link to a specific toChain, you must replace the slug after /bridge with the desired chain’s name, like so: relay.link/bridge/{chainName}. Spaces should be replaced with dashes. You can check out the list of supported chains here.
​
Examples
​
Bridge from Zora to Base
https://relay.link/bridge/base?fromChainId=7777777
​
Bridge from Ethereum to Optimism with a preset address
https://relay.link/bridge/optimism?fromChainId=1&toAddress=0x03508bB71268BBA25ECaCC8F620e01866650532c
​
Bridge 0.01 ETH from Optimism to Zora
https://relay.link/bridge/zora?fromChainId=10&amount=0.01
​
Bridge $100 USDC from Base to Arbitrum
https://relay.link/bridge/arbitrum?fromChainId=8453&fromCurrency=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913&toCurrency=0xaf88d065e77c8cc2239327c5edb3a432268e5831&amount=100
​
Deep Linking to dedicated Chain pages
Relay hosts branded interfaces for onboarding and offramping from supported chains. If you’re a chain that’s launching these pages will prove to be a handy way to get users onboarded onto your chain, with a best in class user experience and support for canonical bridging. Get in touch if you want to customize these pages further.
The following query parameters are supported:
Parameter	Description	Example
toAddress	A valid address to receive the swap	0x03508bB71268BBA25ECaCC8F620e01866650532c
fromCurrency	The currency address on the origin chain	0x4200000000000000000000000000000000000006
toCurrency	The currency address on the destination chain	0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
amount	The amount to have the input initially set to in the widget	0.1
tradeType	Whether to use the amount as the output or the input for the basis of the swap	EXACT_INPUT, EXPECTED_OUTPUT, EXACT_OUTPUT
fromChainId	The chainId of the origin chain	8453
​
Examples
​
Bridge from Zora to Base
https://relay.link/bridge/base?fromChainId=7777777
​
Bridge from Ethereum to Optimism with a preset address
https://relay.link/bridge/optimism?fromChainId=1&toAddress=0x03508bB71268BBA25ECaCC8F620e01866650532c
​
Bridge 0.01 ETH from Optimism to Zora
https://relay.link/bridge/zora?fromChainId=10&amount=0.01
​
Bridge $100 USDC from Base to Arbitrum
https://relay.link/bridge/arbitrum?fromChainId=8453&fromCurrency=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913&toCurrency=0xaf88d065e77c8cc2239327c5edb3a432268e5831&amount=100
​
Deep Linking to the Onramp Page
The following query parameters are supported:
Parameter	Description	Example
toAddress	A valid address to receive the bridge	0x03508bB71268BBA25ECaCC8F620e01866650532c
toCurrency	The currency address for the to chain	0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
To deep link to a specific toChain, you must replace the slug after /onramp with the desired chain’s name, like so: relay.link/onramp/{chainName}. Spaces should be replaced with dashes.
​
Unsupported Chains list
Forma
Gravity
Hychain
Onchain Points
Powerloom
Sanko
Kai
​
Supported Currencies
Our currencies are currently limited, make sure to check the currencies api with depositAddressOnly set to true.
​
Examples
​
Onramp onto Base with Base DEGEN
https://relay.link/onramp/base?toCurrency=0x4ed4e862860bed51a9570b96d89af5e1b0efefed

Was this page helpful?

Yes
No
Lighter Support
Websockets
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform