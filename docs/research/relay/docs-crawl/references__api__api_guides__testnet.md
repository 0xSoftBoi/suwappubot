# Testnet Support - Relay

Source: https://docs.relay.link/references/api/api_guides/testnet

On this page
Testnets Supported
API Support
SDK Support
UI Kit Support
Chain Support Guides
Testnet Support
Copy page

How to Utilize Testnets on Relay

Relay supports a variety of testnet and tokens. We recommend using testnets and their tokens as a way to test bridging with no cost. Our testnet chains are full supported across all of our tools: APIs, SDK, and UI Kit. Feel free to explore the chains offered below. For the latest list, please explore our Testnets Supported Chains.
Testnets are not recommended for testing swaps. Testnets typically lack real DEX liquidity making testnet swaps fail. We recommend using inexpensive L2s like Base or Arbitrum to test swapping. The cost of gas will outweight the time required to debug testnet-specific issues like illiquidity.
​
Testnets Supported
You can see all the testnets we support in the table below. You can also query our API to get a JSON of the supported testnets: https://api.testnets.relay.link/chains The API response will also return chain IDs and other relevant information.
Chain	Chain ID	Supported Tokens

Base Sepolia
	84532	All

Sepolia
	11155111	All
​
API Support
To access testnets with our API, make sure to use the correct base URL: https://api.testnets.relay.link By using this base URL, you’ll be able to bridge, swap, and transact on testnets Relay supports. To get started, check out the API documentation.
​
SDK Support
To access testnets with our SDK, make sure to use the correct base URL: https://api.testnets.relay.link You’ll pass this base URL in the baseApiUrl parameter when creating the client. To get started, check out the SDK documentation.
​
UI Kit Support
To access testnet with our UI kit, make sure to pass the testnet chain you want e.g. base sepolia, sepolia, etc. To get started, check out the UI Kit documentation.

Was this page helpful?

Yes
No
Smart Accounts in Relay
Solana Support
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform