# Execute Gasless Txs - Relay

Source: https://docs.relay.link/references/api/execute

cURL

cURL

curl --request POST \
  --url https://api.relay.link/execute \
  --header 'Content-Type: application/json' \
  --header 'x-api-key: <x-api-key>' \
  --data '
{
  "executionKind": "rawCalls",
  "data": {
    "chainId": 123,
    "to": "<string>",
    "data": "<string>",
    "value": "<string>",
    "authorizationList": [
      {
        "chainId": 123,
        "address": "<string>",
        "nonce": 123,
        "yParity": 123,
        "r": "<string>",
        "s": "<string>"
      }
    ]
  },
  "executionOptions": {
    "subsidizeFees": true,
    "referrer": "<string>"
  }
}
'
200
400
401
500
{
  "message": "Transaction submitted",
  "requestId": "0xabc123..."
}
API Reference
Execute Gasless Txs

This API executes gasless transactions

Copy page
POST
https://api.relay.link
https://api.testnets.relay.link
/
execute
Try it
Headers
​
x-api-key
stringrequired

Required API key for authentication. Contact the team for getting an API Key

Body
application/json
​
executionKind
enum<string>required

The kind of gasless transaction to execute. Currently supported: rawCalls

Available options: rawCalls 
​
data
objectrequired

Raw call parameters for the gasless transaction

Show child attributes

​
executionOptions
objectrequired

Options related to gas fee sponsorship, app referrer and destination calls

Show child attributes

​
requestId
string

The request ID of the gasless transaction to execute

Response
200
application/json

Transaction successfully queued for execution

Transaction successfully queued for execution

​
message
string
Example:

"Transaction submitted"

​
requestId
string
Example:

"0xabc123..."

Was this page helpful?

Yes
No
Get Swap Sources
Attest Deposit
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform