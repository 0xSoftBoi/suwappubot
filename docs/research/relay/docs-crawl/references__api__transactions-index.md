# Transactions Index - Relay

Source: https://docs.relay.link/references/api/transactions-index

cURL

cURL

curl --request POST \
  --url https://api.relay.link/transactions/index \
  --header 'Content-Type: application/json' \
  --data '
{
  "chainId": "<string>",
  "txHash": "<string>"
}
'
200
400
404
{
  "message": "<string>"
}
API Reference
Transactions Index

Notify the backend in order to fetch the traces and detect any internal deposits

Copy page
POST
https://api.relay.link
https://api.testnets.relay.link
/
transactions
/
index
Try it
Headers
​
x-api-key
string

Optional API key for authentication and higher rate limits.

Body
application/json
​
chainId
stringrequired
​
txHash
stringrequired
​
requestId
string
Response
200
application/json

Default Response

​
message
string

Was this page helpful?

Yes
No
Get Token Price
Transactions Single
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform