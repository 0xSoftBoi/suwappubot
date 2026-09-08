# Transactions Single - Relay

Source: https://docs.relay.link/references/api/transactions-single

cURL

cURL

curl --request POST \
  --url https://api.relay.link/transactions/single \
  --header 'Content-Type: application/json' \
  --data '
{
  "requestId": "<string>",
  "chainId": "<string>",
  "tx": "<string>"
}
'
200
{
  "message": "<string>"
}
API Reference
Transactions Single

Notify the backend to index transfers, wraps and unwraps.

Copy page
POST
https://api.relay.link
https://api.testnets.relay.link
/
transactions
/
single
Try it
Headers
​
x-api-key
string

Optional API key for authentication and higher rate limits.

Body
application/json
​
requestId
stringrequired
​
chainId
stringrequired
​
tx
stringrequired
Response
200 - application/json

Default Response

​
message
string

Was this page helpful?

Yes
No
Transactions Index
Deposit Address Reindex
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform