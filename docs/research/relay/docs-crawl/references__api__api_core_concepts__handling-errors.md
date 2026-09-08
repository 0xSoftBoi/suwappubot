# Handling Quote Errors - Relay

Source: https://docs.relay.link/references/api/api_core_concepts/handling-errors

On this page
Expected Errors
Unexpected Errors
Example Error Responses
No Routes Found
Destination Transaction Failed
Solana Transaction Too Large
Core Concepts
Handling Quote Errors
Copy page

Interpret and recover from quote errors in your integration

When calling the /quote/v2 endpoint, various errors may be returned depending on request conditions, user input, or internal routing logic. This guide outlines the possible error codes, their meanings, and how to handle them.
Looking for errors that occur after a request is submitted? See Handling Execution Errors for fill and refund failure reasons.
​
Expected Errors
These are known validation and routing issues that developers should gracefully handle in their integrations:
Error Code	Description
AMOUNT_TOO_LOW	The amount provided is below the minimum threshold required for a quote.
CHAIN_DISABLED	The origin or destination chain is currently disabled or unsupported.
EXTRA_TXS_NOT_SUPPORTED	Extra transactions are not supported for this trade type.
FORBIDDEN	User does not have the required role or permission.
INSUFFICIENT_FUNDS	The user’s wallet does not have enough balance to perform the swap.
INSUFFICIENT_LIQUIDITY	There is not enough liquidity available to complete the swap.
INVALID_ADDRESS	The provided user or recipient address is not valid for the target chain.
INVALID_EXTRA_TXS	The total value of extra transactions exceeds the intended output.
INVALID_GAS_LIMIT_FOR_DEPOSIT_SPECIFIED_TXS	Deposit-specified transactions require a supported trade type and a configured gas limit. See the call execution guide.
INVALID_INPUT_CURRENCY	The provided input currency address is invalid or not supported.
INVALID_OUTPUT_CURRENCY	The provided output currency address is invalid or not supported.
INVALID_RECIPIENT	The provided recipient resolves to a supported token contract and cannot receive funds. Use a wallet address.
INVALID_SLIPPAGE_TOLERANCE	slippageTolerance (or latePaymentSlippageTolerance) is not an integer string in the range 0–10000 basis points.
NO_INTERNAL_SWAP_ROUTES_FOUND	No valid swap route exists internally for the selected token pair.
NO_QUOTES	No available quotes for the given parameters.
NO_SWAP_ROUTES_FOUND	No route was found to fulfill the quote request with the given parameters.
PRICE_FETCH_FAILED	The upstream price feed is temporarily unavailable. Retry with backoff.
REQUEST_TIMED_OUT	An upstream RPC provider timed out before returning a result.
ROUTE_TEMPORARILY_RESTRICTED	This route is temporarily restricted due to high traffic or throttling.
RPC_HTTP_ERROR	An upstream RPC provider returned a transient infrastructure error.
SANCTIONED_CURRENCY	The token involved in the transaction is on a sanctions list.
SANCTIONED_WALLET_ADDRESS	The sender or recipient wallet address is sanctioned or blacklisted.
SERVICE_UNAVAILABLE	Relay is experiencing a transient infrastructure issue. Retry with backoff.
SOLANA_TX_TOO_LARGE	The compiled Solana deposit transaction exceeds Solana’s 1232-byte wire limit and cannot be signed or broadcast. The response message reports the measured size and how many bytes it lands over. See Solana Support.
SWAP_IMPACT_TOO_HIGH	The swap’s price impact exceeds acceptable thresholds.
UNAUTHORIZED	The user is not authenticated or lacks valid authorization.
UNSUPPORTED_CHAIN	The specified chain is not supported by the platform.
UNSUPPORTED_CURRENCY	The specified currency is not supported for input or output, or the token pair cannot be priced.
UNSUPPORTED_EXECUTION_TYPE	The execution type used is not supported for fee estimation or execution.
UNSUPPORTED_ROUTE	The swap route combination is not supported.
USER_RECIPIENT_MISMATCH	User and recipient addresses must match for this type of swap.
PRICE_FETCH_FAILED, REQUEST_TIMED_OUT, RPC_HTTP_ERROR, and SERVICE_UNAVAILABLE all indicate transient upstream infrastructure issues, not problems with your request. PRICE_FETCH_FAILED and SERVICE_UNAVAILABLE are returned with HTTP 503; REQUEST_TIMED_OUT and RPC_HTTP_ERROR are returned when upstream RPCs are classified as transient. Retry with backoff before surfacing a failure to the user.
​
Unexpected Errors
These indicate infrastructure or downstream failures and are not common:
Error Code	Description
DESTINATION_TX_FAILED	The relay transaction reverted on the destination chain.
ERC20_ROUTER_ADDRESS_NOT_FOUND	The router contract for a token could not be located.
UNKNOWN_ERROR	An unclassified or unexpected error occurred.
SWAP_QUOTE_FAILED	Failed to calculate a quote, possibly due to third-party pricing failure.
PERMIT_FAILED	Permit signature validation failed for token approvals.
​
Example Error Responses
Invalid Input Currency
{
  "message": "Invalid input or output currency",
  "errorCode": "INVALID_INPUT_CURRENCY"
}

​
No Routes Found
{
  "message": "No routes found",
  "errorCode": "NO_SWAP_ROUTES_FOUND"
}

​
Destination Transaction Failed
{
  "message": "Destination transaction failed",
  "errorCode": "DESTINATION_TX_FAILED",
  "errorData": "execution reverted"
}

​
Solana Transaction Too Large
{
  "message": "Generated Solana transaction is 1416 bytes, 184 over Solana's 1232 byte limit, so it cannot be signed or broadcast.",
  "errorCode": "SOLANA_TX_TOO_LARGE"
}


Was this page helpful?

Yes
No
Surplus & Shortage
Handling Rate Limits
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform