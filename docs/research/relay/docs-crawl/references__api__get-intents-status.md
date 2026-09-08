# Get Execution Status - Relay

Source: https://docs.relay.link/references/api/get-intents-status

cURL

cURL

curl --request GET \
  --url https://api.relay.link/intents/status
200
{
  "status": "success",
  "inTxHashes": [
    "0xe53021eaa63d100b08338197d26953e2219bcbad828267dd936c549ff643aad7"
  ],
  "txHashes": [
    "0x9da7bc54dfe6229d6980fd62250d472f23dfe0f41a1cdc870c81a08b3445f254"
  ],
  "time": 1713290386145,
  "originChainId": 7777777,
  "destinationChainId": 8453
}
Deprecated
Get Execution Status

This API returns current status of intent.

Copy page
GET
https://api.relay.link
https://api.testnets.relay.link
/
intents
/
status
Try it
Please use Get Execution Status v2 as this is deprecated
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

Note that fallback is returned in the case of a refund

Available options: failure, fallback, pending, received, success 
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
time
number

The last timestamp the data was updated

​
originChainId
number
​
destinationChainId
number

Was this page helpful?

Yes
No
Get Config
Get Currencies
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform