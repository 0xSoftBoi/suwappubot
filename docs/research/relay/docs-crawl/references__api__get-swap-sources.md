# Get Swap Sources - Relay

Source: https://docs.relay.link/references/api/get-swap-sources

cURL

cURL

curl --request GET \
  --url https://api.relay.link/swap-sources
200
400
{
  "sources": [
    "<string>"
  ]
}
API Reference
Get Swap Sources

This API returns all the available swap sources that can be either included or excluded for routing.

Copy page
GET
https://api.relay.link
https://api.testnets.relay.link
/
swap-sources
Try it
Headers
​
x-api-key
string

Optional API key for authentication and higher rate limits.

Query Parameters
​
chainId
number

Chain ID to get swap sources for

Response
200
application/json

Default Response

​
sources
string[]

An array of swap sources

Was this page helpful?

Yes
No
Fast Fill
Gasless Execution
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform