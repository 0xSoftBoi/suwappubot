# Get Requests (v2) - Relay

Source: https://docs.relay.link/references/api/get-requests-v2

cURL

cURL

curl --request GET \
  --url 'https://api.relay.link/requests/v2?limit=20&sortBy=createdAt'
200
{
  "requests": {
    "id": "0xddd6c1a0340e940b7be4f5a4be076df8b7ec7de7b18f9ec6efe4bfffd2f21cf6",
    "status": "success",
    "user": "0x456bccd1eaa77d5cc5ace1723b5dcca00d67cdea",
    "recipient": "0x456bccd1eaa77d5cc5ace1723b5dcca00d67cdea",
    "depositAddress": {
      "address": "0x456bccd1eaa77d5cc5ace1723b5dcca00d67cdea",
      "depositAddressType": "open",
      "depositor": "0x456bccd1eaa77d5cc5ace1723b5dcca00d67cdea",
      "depositTxHash": "0x34d78ccb41099f0546be1c35541b28ab4c92b498aeb4cae6e849c51c05fe1f1b"
    },
    "data": {
      "subsidizedRequest": false,
      "fees": {
        "gas": "2622672522398",
        "fixed": "10000000000000",
        "price": "39000000000000"
      },
      "feesUsd": {
        "gas": "9057",
        "fixed": "34534",
        "price": "134684"
      },
      "inTxs": [
        {
          "fee": "423218878900",
          "data": {
            "to": "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
            "data": "0x5869d8",
            "from": "0x456bccd1eaa77d5cc5ace1723b5dcca00d67cdea",
            "value": "2651622672522398"
          },
          "hash": "0xe53021eaa63d100b08338197d26953e2219bcbad828267dd936c549ff643aad7",
          "type": "onchain",
          "chainId": 7777777,
          "timestamp": 1713290377
        }
      ],
      "currency": "eth",
      "price": "2600000000000000",
      "usesExternalLiquidity": false,
      "outTxs": [
        {
          "fee": "1837343366480",
          "data": {
            "to": "0x456bccd1eaa77d5cc5ace1723b5dcca00d67cdea",
            "data": "0x5869d8",
            "from": "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
            "value": "2600000000000000"
          },
          "hash": "0x9da7bc54dfe6229d6980fd62250d472f23dfe0f41a1cdc870c81a08b3445f254",
          "type": "onchain",
          "chainId": 8453,
          "timestamp": 1713290383
        }
      ]
    },
    "moonpayId": "9dc342c3-538b-4731-aba7-13ed89acc7ae",
    "createdAt": "2024-04-16T17:59:39.702Z",
    "updatedAt": "2024-04-16T17:59:46.145Z"
  },
  "continuation": "<string>",
  "deprecation": {
    "message": "<string>",
    "deprecatedAt": "<string>",
    "throttledFrom": "<string>",
    "sunsetAt": "<string>",
    "successor": "<string>",
    "migrationGuide": "<string>"
  }
}
Deprecated
Get Requests (v2)

Deprecated. Returns cross-chain transactions. Use GET /requests/v3 for new integrations.

Copy page
GET
https://api.relay.link
https://api.testnets.relay.link
/
requests
/
v2
Try it
GET /requests/v2 is deprecated as of July 22, 2026 and is being sunset: its rate limit is reduced each month until it is fully retired on November 24, 2026. New integrations should use GET /requests/v3, which requires authentication and offers a richer filter surface and a cleaner response. See the migration guide for the full timeline and how to upgrade.
Headers
​
x-api-key
string

Optional API key for authentication and higher rate limits.

Query Parameters
​
limit
numberdefault:20

Maximum number of requests to return per page.

Required range: 1 <= x <= 50
​
continuation
string

Pagination cursor returned by a previous response. Pass it back to fetch the next page.

​
user
string

Filter requests where this address is the sender or recipient.

​
hash
string

Filter requests by an origin or destination transaction hash.

​
originChainId
number

Filter requests where this is the origin chain.

​
destinationChainId
number

Filter requests where this is the destination chain.

​
privateChainsToInclude
string

Comma-separated list of private chain UUIDs to include in the results.

​
id
string

Filter by requestId — the Relay-level intent identifier returned by the quote api. Used for status polling, webhooks, and most other API endpoints.

​
orderId
string

Filter by orderId — the protocol-level deposit identifier passed as bytes32 id to the Relay Depository when funds are deposited, and emitted in the deposit event.

​
includeOrderData
boolean

When true, include orderData; public pending requests omit its output subtree.

​
startTimestamp
number

Filter requests created at or after this Unix timestamp (seconds).

​
endTimestamp
number

Filter requests created at or before this Unix timestamp (seconds).

​
startBlock
number

Filter requests by origin-chain block number (inclusive lower bound).

​
endBlock
number

Filter requests by origin-chain block number (inclusive upper bound).

​
chainId
string

Get all requests for a single chain in either direction. Setting originChainId and/or destinationChainId will override this parameter.

​
referrer
string

Filter requests by the referrer value supplied at quote time.

​
depositAddress
string

Filter requests by deposit address. Returns all requests associated with this deposit address.

​
includeChildRequests
boolean

When filtering by id or depositAddress, also return child transactions (e.g. duplicates, retries, refunds) linked to the original request.

​
includeAuthenticatedData
boolean

When true, include fields available only to the authenticating integrator for their own requests.

​
status
enum<string>

Filter requests by status.

Available options: success, failure, refund, pending, depositing 
​
apiKey
string

Filter requests by the API key that created them.

​
sortBy
enum<string>default:createdAt

Field to sort by.

Available options: createdAt, updatedAt 
​
sortDirection
enum<string>

Sort direction.

Available options: asc, desc 
Response
200 - application/json

Default Response

​
requests
object[]

Show child attributes

Example:
{
  "id": "0xddd6c1a0340e940b7be4f5a4be076df8b7ec7de7b18f9ec6efe4bfffd2f21cf6",
  "status": "success",
  "user": "0x456bccd1eaa77d5cc5ace1723b5dcca00d67cdea",
  "recipient": "0x456bccd1eaa77d5cc5ace1723b5dcca00d67cdea",
  "depositAddress": {
    "address": "0x456bccd1eaa77d5cc5ace1723b5dcca00d67cdea",
    "depositAddressType": "open",
    "depositor": "0x456bccd1eaa77d5cc5ace1723b5dcca00d67cdea",
    "depositTxHash": "0x34d78ccb41099f0546be1c35541b28ab4c92b498aeb4cae6e849c51c05fe1f1b"
  },
  "data": {
    "subsidizedRequest": false,
    "fees": {
      "gas": "2622672522398",
      "fixed": "10000000000000",
      "price": "39000000000000"
    },
    "feesUsd": {
      "gas": "9057",
      "fixed": "34534",
      "price": "134684"
    },
    "inTxs": [
      {
        "fee": "423218878900",
        "data": {
          "to": "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
          "data": "0x5869d8",
          "from": "0x456bccd1eaa77d5cc5ace1723b5dcca00d67cdea",
          "value": "2651622672522398"
        },
        "hash": "0xe53021eaa63d100b08338197d26953e2219bcbad828267dd936c549ff643aad7",
        "type": "onchain",
        "chainId": 7777777,
        "timestamp": 1713290377
      }
    ],
    "currency": "eth",
    "price": "2600000000000000",
    "usesExternalLiquidity": false,
    "outTxs": [
      {
        "fee": "1837343366480",
        "data": {
          "to": "0x456bccd1eaa77d5cc5ace1723b5dcca00d67cdea",
          "data": "0x5869d8",
          "from": "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
          "value": "2600000000000000"
        },
        "hash": "0x9da7bc54dfe6229d6980fd62250d472f23dfe0f41a1cdc870c81a08b3445f254",
        "type": "onchain",
        "chainId": 8453,
        "timestamp": 1713290383
      }
    ]
  },
  "moonpayId": "9dc342c3-538b-4731-aba7-13ed89acc7ae",
  "createdAt": "2024-04-16T17:59:39.702Z",
  "updatedAt": "2024-04-16T17:59:46.145Z"
}
​
continuation
string
​
deprecation
object

Show child attributes

Was this page helpful?

Yes
No
Get Withdrawal Status
Get Price
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform