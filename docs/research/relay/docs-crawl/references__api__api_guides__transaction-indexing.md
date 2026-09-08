# Transaction Indexing - Relay

Source: https://docs.relay.link/references/api/api_guides/transaction-indexing

On this page
Overview
API 1: transactions/single
When to Use
Purpose
API Reference
Request Example
API 2: transactions/index
When to Use
Purpose
API Reference
Request Example
Integration
Decision Matrix
Key Takeaways
Integration Guides
Transaction Indexing
Copy page

How to integrate Relay’s transaction indexing APIs

​
Overview
Relay provides two key APIs for transaction indexing:
transactions/single - For indexing same-chain transfers, wraps, and unwraps
transactions/index - For accelerating indexing of transactions with internal deposits
​
API 1: transactions/single
​
When to Use
Use this API for same-chain actions including:
Token transfers
Token wraps (e.g., ETH to WETH)
Token unwraps (e.g., WETH to ETH)
Note: This is not required for same-chain swaps.
​
Purpose
Ensures same-chain actions are properly indexed
Relay’s indexer doesn’t actively monitor same-chain actions by default
Critical for applications supporting same-chain token operations
​
API Reference
Documentation
Implementation Reference
​
Request Example
curl -X POST 'https://api.relay.link/transactions/single' \
  -H 'Content-Type: application/json' \
  -d '{
  "tx": "{\"from\":\"0x03508bB71268BBA25ECaCC8F620e01866650532c\",\"to\":\"0x3c499c542cef5e3811e1192ce70d8cc03d5c3359\",\"data\":\"0xa9059cbb00000000000000000000000036329d1ff4b31ec85280a86e7cf58fca7c005ed000000000000000000000000000000000000000000000000000000000000f4240\",\"value\":\"0\",\"chainId\":137,\"gas\":\"94464\",\"maxFeePerGas\":\"34643644476\",\"maxPriorityFeePerGas\":\"34180692255\",\"txHash\":\"0x935be17e13f1dc4aee15e75cc9c119f2d639e58b061a54246843f2ddf1052f7c\"}",
  "chainId":"137",
  "requestId":"0xcb6bec4106d2bc6f692831e00445f843fa39239ca61bc304486b0c96e1d531a9"
}'

​
API 2: transactions/index
​
When to Use
Use this API for transactions that contain internal deposits that need to be detected through trace analysis. This is particularly important for teams using their own proxy contracts.
​
Purpose
Accelerates the indexing process by triggering indexing before transaction validation completes
Ensures Relay fetches transaction traces to detect internal deposits
Recommended for custom proxy contract implementations
​
API Reference
Documentation
Implementation Reference
​
Request Example
cURL
curl -X POST 'https://api.relay.link/transactions/index' \
  -H 'Content-Type: application/json' \
  -d '{
  "txHash": "0x9f2c5e8b1d4a7f0c3e6b9d2f5a8c1e4b7d0a3f6c9e2b5d8a1f4c7e0b3d6a9f2c",
  "chainId": 8453
}'

​
Integration
Call this API immediately after submitting a transaction, before waiting for confirmation.
If you receive a 404 for a freshly broadcast Bitcoin transaction, wait for at least one block confirmation and retry.
​
Decision Matrix
Transaction Type	API Endpoint	Reason
Cross-chain transactions	transactions/index	Accelerates indexing before validation
Proxy contract transactions	transactions/index	Detects internal deposits via trace analysis
Same-chain swaps	transactions/index	Accelerates indexing and detects internal deposits
Same-chain token transfers	transactions/single	Not actively monitored by default indexer
ETH ↔ WETH wraps/unwraps	transactions/single	Same-chain operations need explicit indexing
​
Key Takeaways
transactions/single is essential for same-chain operations that aren’t automatically monitored
transactions/index is for accelerating indexing of transactions with internal deposits
Call these APIs immediately after transaction submission for optimal indexing performance
Choose the appropriate API based on your transaction type using the decision matrix above
For detailed implementation examples, refer to the Relay SDK source code links provided above.

Was this page helpful?

Yes
No
Call Execution Integration Guide
Base Builder Codes
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform