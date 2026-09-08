# Fast Fill - Relay

Source: https://docs.relay.link/references/api/fast-fill

cURL

cURL

curl --request POST \
  --url https://api.relay.link/fast-fill \
  --header 'Content-Type: application/json' \
  --header 'x-api-key: <x-api-key>' \
  --data '
{
  "requestId": "<string>"
}
'
200
400
401
403
404
409
500
{
  "message": "Request successfully queued for fast fill."
}
API Reference
Fast Fill

This API accelerates the destination fill

Copy page
POST
https://api.relay.link
https://api.testnets.relay.link
/
fast-fill
Try it
Headers
​
x-api-key
stringrequired

Required API key for authentication. Contact the team for getting an API Key

Body
application/json
​
requestId
stringrequired

The request ID of the request that needs to be fast filled

​
solverInputCurrencyAmount
string

The input currency amount that the solver receives on origin

​
maxFillAmountUsd
number

Optional per-request USD limit. If the computed fill value exceeds this amount, the request is rejected. Must be lower than or equal to the app's available USDC balance.

Response
200
application/json

Request was successful. It was either queued or found to be already executed.

Request was successful. It was either queued or found to be already executed.

​
message
string
Example:

"Request successfully queued for fast fill."

Was this page helpful?

Yes
No
Advanced
Get Swap Sources
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform