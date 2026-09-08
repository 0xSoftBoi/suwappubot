# Get Currencies - Relay

Source: https://docs.relay.link/references/api/get-currencies

cURL

cURL

curl --request POST \
  --url https://api.relay.link/currencies/v1 \
  --header 'Content-Type: application/json' \
  --data '
{
  "defaultList": true,
  "chainIds": [
    123
  ],
  "term": "<string>",
  "address": "<string>",
  "currencyId": "<string>",
  "tokens": [
    "<string>"
  ],
  "verified": true,
  "limit": 123,
  "includeAllChains": true,
  "useExternalSearch": true,
  "depositAddressOnly": true
}
'
200
[
  [
    {
      "groupID": "<string>",
      "chainId": 123,
      "address": "<string>",
      "symbol": "<string>",
      "name": "<string>",
      "decimals": 123,
      "vmType": "bvm",
      "metadata": {
        "logoURI": "<string>",
        "verified": true,
        "isNative": true
      }
    }
  ]
]
Deprecated
Get Currencies

This api returns currency metadata from a curated list

Copy page
POST
https://api.relay.link
https://api.testnets.relay.link
/
currencies
/
v1
Try it
Headers
​
x-api-key
string

Optional API key for authentication and higher rate limits.

Body
application/json
​
defaultList
boolean

Return default currencies

​
chainIds
number[]

Chain IDs to search for currencies

​
term
string

Search term for currencies

​
address
string

Address of the currency contract

​
currencyId
string

ID to search for a currency group

​
tokens
string[]

List of token addresses, like: chainId:address

​
verified
boolean

Filter verified currencies

​
limit
number

Limit the number of results

​
includeAllChains
boolean

Include all chains for a currency when filtering by chainId and address

​
useExternalSearch
boolean

Uses 3rd party API's to search for a token, in case relay does not have it indexed

​
depositAddressOnly
boolean

Returns only currencies supported with deposit address bridging

Response
200 - application/json

List of currencies

​
groupID
string
​
chainId
number
​
address
string
​
symbol
string
​
name
string
​
decimals
number
​
vmType
enum<string>
Available options: bvm, evm, svm, tvm, tonvm, hypevm, lvm, xrpvm, hederavm 
​
metadata
object

Show child attributes

Was this page helpful?

Yes
No
Get Execution Status
Get Quote
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform