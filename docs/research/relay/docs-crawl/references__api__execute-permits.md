# Submit Permit - Relay

Source: https://docs.relay.link/references/api/execute-permits

cURL

cURL

curl --request POST \
  --url https://api.relay.link/execute/permits \
  --header 'Content-Type: application/json' \
  --data '
{
  "kind": "<string>",
  "requestId": "<string>"
}
'
200
400
{
  "message": "<string>",
  "steps": [
    {
      "id": "<string>",
      "action": "<string>",
      "description": "<string>",
      "kind": "<string>",
      "items": [
        {
          "status": "<string>",
          "data": {
            "to": "<string>",
            "data": "<string>",
            "value": "<string>",
            "chainId": 123
          },
          "check": {
            "endpoint": "<string>",
            "method": "<string>"
          }
        }
      ]
    }
  ]
}
API Reference
Submit Permit

This API is used to submit a permit from the quote API.

Copy page
POST
https://api.relay.link
https://api.testnets.relay.link
/
execute
/
permits
Try it
Headers
​
x-api-key
string

Optional API key for authentication and higher rate limits.

Query Parameters
​
signature
stringrequired

The permit signature.

Body
application/json
​
kind
stringrequired

The kind of signature. This value is returned in the quote API steps body field. e.g eip3009

​
requestId
stringrequired

The requestId of the quote this permit signature applies to. Returned in the quote API steps body field.

​
api
enum<string>

The API value returned from the quote API steps body field.

Available options: bridge, swap, user-swap 
Response
200
application/json

Default Response

​
message
string
​
steps
object[]

Show child attributes

Was this page helpful?

Yes
No
Get Quote
Get Status
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform