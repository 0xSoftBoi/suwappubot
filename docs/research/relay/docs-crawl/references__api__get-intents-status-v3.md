# Get Status - Relay

Source: https://docs.relay.link/references/api/get-intents-status-v3

cURL

cURL

curl --request GET \
  --url https://api.relay.link/intents/status/v3
200
{
  "status": "success",
  "inTxHashes": [
    "0xe53021eaa63d100b08338197d26953e2219bcbad828267dd936c549ff643aad7"
  ],
  "txHashes": [
    "0x9da7bc54dfe6229d6980fd62250d472f23dfe0f41a1cdc870c81a08b3445f254"
  ],
  "updatedAt": 1713290386145,
  "originChainId": 7777777,
  "destinationChainId": 8453
}
API Reference
Get Status

This API returns current status of intent.

Copy page
GET
https://api.relay.link
https://api.testnets.relay.link
/
intents
/
status
/
v3
Try it
Polling is not the only way to track status. Configure a webhook in the Relay Dashboard to have status updates pushed to your backend, or subscribe to websockets for a real-time stream.
Relay statuses take one of the following options:
Status	Description
waiting	Waiting for deposit confirmation
depositing	Origin deposit confirmed via /execute API, pending fill
pending	Deposit confirmed, pending destination chain submission
submitted	Destination transaction submitted
success	Successful fill on destination
delayed	Destination fill delayed, still processing
refund	Successfully refunded
failure	Unsuccessful fill
Headers
​
x-api-key
string

Optional API key for authentication and higher rate limits.

Query Parameters
​
requestId
string

A unique id representing the execution in the Relay system. You can obtain this id from the requests api or the check object within the step items.

Response
200 - application/json

Default Response

​
status
enum<string>
Available options: refund, waiting, depositing, failure, pending, submitted, success 
​
details
string
​
inTxHashes
string[]

Incoming transaction hashes

​
txHashes
string[]

Outgoing transaction hashes

​
updatedAt
number

The last timestamp the data was updated

​
originChainId
number
​
destinationChainId
number
​
quoteCreatedAt
number

The timestamp when the quote request was created

​
failReason
enum<string> | null
Available options: UNKNOWN, SLIPPAGE, AMOUNT_TOO_LOW_TO_REFUND, DEPOSIT_ADDRESS_MISMATCH, DEPOSIT_CHAIN_MISMATCH, INCORRECT_DEPOSIT_CURRENCY, DOUBLE_SPEND, SOLVER_CAPACITY_EXCEEDED, SOLVER_BALANCE_TOO_LOW, DEPOSITED_AMOUNT_TOO_LOW_TO_FILL, NEGATIVE_NEW_AMOUNT_AFTER_FEES, NO_QUOTES, MISSING_REVERT_DATA, REVERSE_SWAP_FAILED, GENERATE_SWAP_FAILED, TOO_LITTLE_RECEIVED, EXECUTION_REVERTED, NEW_CALLDATA_INCLUDES_HIGHER_RENT_FEE, TRANSACTION_REVERTED, TRANSACTION_TOO_LARGE, ORIGIN_CURRENCY_MISMATCH, NO_INTERNAL_SWAP_ROUTES_FOUND, SWAP_USES_TOO_MUCH_GAS, INSUFFICIENT_FUNDS_FOR_RENT, SPONSOR_BALANCE_TOO_LOW, ORDER_EXPIRED, ORDER_IS_CANCELLED, TRANSFER_FROM_FAILED, TRANSFER_FAILED, SIGNATURE_EXPIRED, INVALID_SIGNATURE, INSUFFICIENT_NATIVE_TOKENS_SUPPLIED, TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE, TRANSFER_AMOUNT_EXCEEDS_BALANCE, INVALID_SENDER, ACCOUNT_ABSTRACTION_INVALID_NONCE, ACCOUNT_ABSTRACTION_SIGNATURE_ERROR, SEAPORT_INEXACT_FRACTION, TOKEN_NOT_TRANSFERABLE, ZERO_SELL_AMOUNT, MINT_NOT_ACTIVE, ERC_1155_TOO_MANY_REQUESTED, INCORRECT_PAYMENT, INVALID_GAS_PRICE, FLUID_DEX_ERROR, ORDER_ALREADY_FILLED, SEAPORT_INVALID_FULFILLER, INVALID_SIGNER, MINT_QUANTITY_EXCEEDS_MAX_PER_WALLET, MINT_QUANTITY_EXCEEDS_MAX_SUPPLY, JUPITER_INVALID_TOKEN_ACCOUNT, INVALID_NONCE, ACCOUNT_ABSTRACTION_GAS_LIMIT, CONTRACT_PAUSED, SWAP_IMPACT_TOO_HIGH, INSUFFICIENT_POOL_LIQUIDITY, TTL_EXPIRED, DEPOSIT_CONFIRMATION_TIMEOUT, ORPHANED_DEPOSIT_REFUND, GASLESS_PERMIT_BALANCE_TOO_LOW, MANUAL_ADMIN_REFUND, QUOTED_GAS_LIMIT_EXCEEDED, DESTINATION_TOKEN_TRANSFER_REJECTED, DEPOSIT_REORGED, BLOCKED_WALLET, PROTOCOL_DEADLINE_EXPIRED, TRANSACTION_NOT_INCLUDED, TRANSACTION_SUBMISSION_FAILED, N/A 
​
refundFailReason
enum<string> | null
Available options: AMOUNT_TOO_LOW_TO_REFUND, NEGATIVE_NEW_AMOUNT_AFTER_FEES, SWAP_CURRENCY_NOT_ON_ORIGIN, REFUND_RECIPIENT_IS_VASP, MANUAL_REFUND_REQUIRED 

Was this page helpful?

Yes
No
Submit Permit
Get Requests
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform