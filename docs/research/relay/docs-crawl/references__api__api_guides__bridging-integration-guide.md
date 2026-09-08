# Bridging Integration Guide - Relay

Source: https://docs.relay.link/references/api/api_guides/bridging-integration-guide

On this page
Before you start
Get a Quote
Execute the Bridge
Monitor Bridge Status
See Also
Integration Guides
Bridging Integration Guide
Copy page

How to integrate the Relay API for bridging and onboarding

New to Relay? Start with the Quickstart Guide and work your way through your first cross-chain transaction.
​
Before you start
While not mandatory for integration, doing the following will improve the UX for your users considerably:
Verify user balance - Ensure the user has sufficient funds for the bridge amount plus fees
Check chain support - Confirm both origin and destination chains are supported
Validate quote - Quotes are revalidated when being filled, keep your quotes as fresh as possible.
Handle errors - Implement proper error handling for API requests and transaction failures
1

Get a Quote

Every action in Relay starts with a Quote, this includes bridging. The quote provides all necessary information including fees, transaction data, and execution steps. Use the quote endpoint to request a bridge quote.
Relay supports three trade types for bridging:
EXACT_INPUT — specify the amount you want to send; the output amount may vary based on fees and slippage.
EXPECTED_OUTPUT — specify the approximate amount you want to receive; the input amount is calculated accordingly and the output may vary slightly due to slippage.
EXACT_OUTPUT — specify the exact amount you want to receive; the input amount is calculated accordingly. If the exact output cannot be filled, the request fails and the user is refunded on the origin chain.
EXACT_INPUT
EXACT_OUTPUT
Response
curl -X POST "https://api.relay.link/quote/v2" \
  -H "Content-Type: application/json" \
  -d '{
    "user": "0x03508bb71268bba25ecacc8f620e01866650532c",
    "originChainId": 1,
    "destinationChainId": 8453,
    "originCurrency": "0x0000000000000000000000000000000000000000",
    "destinationCurrency": "0x0000000000000000000000000000000000000000",
    "amount": "100000000000000000",
    "tradeType": "EXACT_INPUT"
  }'

You can learn more about quote request parameters and response data here.
Create an API key in the Relay Dashboard.
2

Execute the Bridge

After receiving a bridge quote, execute it by processing each step in the response. The execution handles both the origin chain transaction and destination chain fulfillment.

Learn more about step execution using the API here.
3

Monitor Bridge Status

You can check the status of a bridge operation at any time using the status endpoint with the requestId located inside each step object in your quote response.
Request
Response
curl "https://api.relay.link/intents/status/v3?requestId=0xed42e2e48c56b06f8f384d66d5f3e6c450fc3a2c7cba19d92a01a649a31a0e94"

Poll this endpoint once per second. To avoid polling entirely, configure a webhook in the Relay Dashboard to push status updates to your backend, or subscribe to Relay’s websocket server for a real-time status stream.
Learn more about how to check the status of the fill here.
Learn more about the status lifecycle, see the status lifecycle diagram.
​
See Also
App Fees: Monetize your integration by adding a fee (in bps) to every quote.
Deposit Addresses: Use Relay deposit addresses to unlock new chains and reduce wallet friction.
Fee Sponsorship: Sponsor fees for your users to reduce friction and improve the user experience.
Handling Errors: Handle quote errors when using the Relay API.
Cost & Fee Structure: Understand the fees associated with using the Relay API.

Was this page helpful?

Yes
No
Contract Compatibility
Call Execution Integration Guide
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform