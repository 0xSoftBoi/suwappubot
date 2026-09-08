# API Overview - Relay

Source: https://docs.relay.link/references/api/advanced

On this page
Core
Utilities
Advanced
API Overview
Copy page

Overview of the Relay API surface

We offer multiple APIs to fully harness Relay’s tools. You can use our APIs for instant bridging or cross-chain execution.
The full OpenAPI specification is available at api.relay.link/documentation/json. Use it to auto-generate types, clients, or import into tools like Postman.
​
Core
Get Quote: Get an executable quote for a bridge, swap or call
Execute: Execute a gasless transaction
Get Status: Returns current execution status
Get Requests: Returns all relay transactions
​
Utilities
Get Chains: Returns all possible chains available and their configurations
Get Chains Liquidity: Returns solver liquidity balances per currency on a specified chain
Get Currencies: Returns all the tokens available on a specific chain
Get Token Price: Returns the price of a token on a specific chain
Transactions Index: Notify the backend in order to fetch the traces and detect any internal deposits
Transactions Single: Notify the backend to index transfers, wraps and unwraps
Deposit Address Reindex: Reindex transactions for a deposit address
​
Advanced
Fast Fill: Fast fills a destination fill

Was this page helpful?

Yes
No
Quickstart
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform