# Solana Support - Relay

Source: https://docs.relay.link/references/api/api_guides/solana

On this page
Required Information
SDK Properties
Solana Tokens
API
Params
Execution
Example: Deposit to Solana from Base
Transaction Size Optimization
SDK
Chain Support Guides
Solana Support
Copy page

How to Deposit or Withdraw on Solana from an EVM Chain

Relay now fully supports depositing & withdrawing to Solana from any EVM chain we support. This is a great way to get users funds on Solana to complete transactions. You can onboard users funds from Blast ETH to Solana USDC to make transactions on a game. You could also swap funds from Solana SOL to Zora ETH for users to mint. The possibilities are limitless when you use Relay embedded in your app.
​
Required Information
There are few things that make transacting on Solana different than another EVM chain. The provided information below should review all the exceptions where your input is Solana specific.
Solana wallet addresses are case sensitive.
​
SDK Properties
Action	Parameter	Input	Description
Deposit to Solana	toChainId	792703809	Chain ID assigned to access Solana for Relay’s tools.
	recipient	User’s Solana Address	Must be a valid Solana address. Do not use an Ethereum wallet address. Case Sensitive
	toCurrency	Contract Address of Solana Token	Must be a valid Solana token address. Do not use an EVM address. We support all tokens tradeable on Jupiter.
Withdraw from Solana	chainId	792703809	Chain ID assigned to access Solana for Relay’s tools.
	currency	Contract Address of Solana Token	Must be a valid Solana token address. Do not use an EVM address. We support all tokens tradeable on Jupiter.
When withdrawing from Solana using the SDK, you will not need to specify the depositing wallet address.
​
Solana Tokens
In the table, we have provided the most frequently used Solana tokens & their contract addresses. We do support all tradeable tokens on Jupiter.
Solana token addresses are case sensitive.
Token	Token Address	Token Symbol	Decimals
SOL	11111111111111111111111111111111	SOL	9
USDC	EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v	USDC	6
wSol	So11111111111111111111111111111111111111112	wSOL	9
USDT	Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB	USDT	6
Relay supports any Solana token available on Jupiter. You can visit Jupiter to explore all the tokens available.
​
API
​
Params
Action	Parameter	Input	Description
Deposit to Solana	recipient	User’s Solana Address	Must be a valid Solana address. Do not use an Ethereum wallet address. Case Sensitive
	destinationChainId	792703809	Chain ID assigned to access Solana for Relay’s tools.
	destinationCurrency	Contract Address of Solana Token	Must be a valid Solana token address. Do not use an EVM address. We support all tokens tradeable on Jupiter.
Withdraw from Solana	user	User’s Solana Address	Must be a valid Solana address. Do not use an Ethereum wallet address. Case Sensitive
	originChainId	792703809	Chain ID assigned to access Solana for Relay’s tools.
	originCurrency	Contract Address of Solana Token	Must be a valid Solana token address. Do not use an EVM address. We support all tokens tradeable on Jupiter.
​
Execution
Once you have the necessary information, you can start utilizing our API for full Solana withdrawal and deposit support. To get started, check out the execution steps of our API. Then when you’re ready to swap, head over to the Get Quote API endpoint.
Please note that instead of the usual calldata returned with EVM transactions, there’s different calldata that needs to be handled accordingly.
​
Example: Deposit to Solana from Base
Request
Response
curl -X POST "https://api.relay.link/quote/v2" \
  -H "Content-Type: application/json" \
  -d '{
    "user": "0x03508bb71268bba25ecacc8f620e01866650532c",
    "originChainId": 8453,
    "originCurrency": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "destinationChainId": 792703809,
    "destinationCurrency": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "recipient": "GTtzwxqy67xx9DVESJjx28TgXqpc8xTqtiytgNMaQBTE",
    "tradeType": "EXACT_INPUT",
    "amount": "10000000"
  }'

​
Transaction Size Optimization
Solana transactions have a hard 1232-byte wire limit. Relay gates every Solana-origin quote — same-chain and cross-chain — against this raw limit at quote time, so a quote that returns successfully is guaranteed to be signable and broadcastable as-is.
When the compiled deposit transaction would exceed 1232 bytes, POST /quote, POST /quote/v2, and POST /price return a 400 response with errorCode: "SOLANA_TX_TOO_LARGE" and a message that reports the measured size and the number of bytes over the limit:
{
  "message": "Generated Solana transaction is 1416 bytes, 184 over Solana's 1232 byte limit, so it cannot be signed or broadcast.",
  "errorCode": "SOLANA_TX_TOO_LARGE"
}

Re-quoting the same route with the same input typically returns another oversized route. To recover, restrict routing (see the mitigations below) or retry with a different input amount.
Wallets and SDKs that prepend compute-budget instructions at send time (roughly 60 bytes) are responsible for checking that their additions still fit under 1232 bytes. A quote that fits the wire limit exactly leaves no room for client-added instructions — clients that add them should measure the returned steps and skip the injection if there is not enough room.
Pass includedOriginSwapSources in your quote request to restrict routing to a single, size-conservative source:
curl -X POST "https://api.relay.link/quote/v2" \
  -H "Content-Type: application/json" \
  -d '{
    "user": "GTtzwxqy67xx9DVESJjx28TgXqpc8xTqtiytgNMaQBTE",
    "originChainId": 792703809,
    "originCurrency": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "destinationChainId": 792703809,
    "destinationCurrency": "So11111111111111111111111111111111111111112",
    "recipient": "GTtzwxqy67xx9DVESJjx28TgXqpc8xTqtiytgNMaQBTE",
    "tradeType": "EXACT_INPUT",
    "amount": "10000000",
    "includedOriginSwapSources": ["jupiter"]
  }'

Pass maxRouteLength in your quote request to limit the number of hops in the Solana swap routing. Fewer hops means a smaller transaction.
Recommended values:
maxRouteLength	When to use
4	Start here. Works for most integrations.
3	Use if transactions are still too large with 4.
For the full list of quote parameters, see the Get Quote API reference.
​
SDK
To use the SDK with Solana, install and configure the SVM wallet adapter. The adapter handles transaction signing and broadcasting.
npm install @relayprotocol/relay-svm-wallet-adapter

For implementation details and code samples, see the Adapters documentation.

Was this page helpful?

Yes
No
Testnet Support
Bitcoin Support
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform