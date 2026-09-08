# Get Chains Liquidity - Relay

Source: https://docs.relay.link/references/api/get-chains-liquidity

cURL

cURL

curl --request GET \
  --url https://api.relay.link/chains/liquidity
200
{
  "liquidity": [
    {
      "chainId": 123,
      "currencyId": "<string>",
      "symbol": "<string>",
      "address": "<string>",
      "decimals": 123,
      "balance": "<string>",
      "amountUsd": "<string>"
    }
  ]
}
API Reference
Get Chains Liquidity

Returns solver liquidity balances per currency on a specified chain.

Copy page
GET
https://api.relay.link
https://api.testnets.relay.link
/
chains
/
liquidity
Try it
Headers
​
x-api-key
string

Optional API key for authentication and higher rate limits.

Query Parameters
​
chainId
numberrequired
Response
200 - application/json

Default Response

​
liquidity
object[]

Available solver balances per configured currency on the requested chain.

Show child attributes

Was this page helpful?

Yes
No
Get Chains
Get Currencies
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform