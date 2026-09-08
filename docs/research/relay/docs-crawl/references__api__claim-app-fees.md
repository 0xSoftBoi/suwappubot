# Claim App Fees - Relay

Source: https://docs.relay.link/references/api/claim-app-fees

cURL

cURL

curl --request POST \
  --url https://api.relay.link/app-fees/{wallet}/claim \
  --header 'Content-Type: application/json' \
  --data '
{
  "chainId": 123,
  "currency": "<string>",
  "recipient": "<string>"
}
'
200
400
{
  "steps": [
    {
      "id": "<string>",
      "action": "<string>",
      "description": "<string>",
      "kind": "<string>",
      "items": [
        {
          "status": "<string>",
          "data": "<unknown>"
        }
      ]
    }
  ]
}
API Reference
Claim App Fees

This API claims app fees for a specific wallet.

Copy page
POST
https://api.relay.link
https://api.testnets.relay.link
/
app-fees
/
{wallet}
/
claim
Try it
What are app fees?
Headers
​
x-api-key
string

Optional API key for authentication and higher rate limits.

Path Parameters
​
wallet
stringrequired
Body
application/json
​
chainId
numberrequired

Chain id of the currency to claim

​
currency
stringrequired

Currency to claim

​
recipient
stringrequired

The recipient of the claimed funds

​
amount
string

Amount to claim

Pattern: ^[0-9]+$
Response
200
application/json

Default Response

​
steps
object[]

An array of steps detailing what needs to be done to claim

Show child attributes

Was this page helpful?

Yes
No
Get App Fee Balances
Get Usage
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform