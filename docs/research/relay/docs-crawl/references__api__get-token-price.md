# Get Token Price - Relay

Source: https://docs.relay.link/references/api/get-token-price

cURL

cURL

curl --request GET \
  --url https://api.relay.link/currencies/token/price
200
400
{
  "price": 123
}
API Reference
Get Token Price

This API returns the price of a token on a specific chain.

Copy page
GET
https://api.relay.link
https://api.testnets.relay.link
/
currencies
/
token
/
price
Try it
Headers
​
x-api-key
string

Optional API key for authentication and higher rate limits.

Query Parameters
​
address
stringrequired

Token address to get price for

​
chainId
numberrequired

Chain ID of the token

Response
200
application/json

Default Response

​
price
number

Token price in USD

Was this page helpful?

Yes
No
Get Currencies
Transactions Index
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform