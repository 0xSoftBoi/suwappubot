# Deposit Address Reindex - Relay

Source: https://docs.relay.link/references/api/deposit-address-reindex

cURL

cURL

curl --request POST \
  --url https://api.relay.link/transactions/deposit-address/reindex \
  --header 'Content-Type: application/json' \
  --data '
{
  "chainId": 123,
  "depositAddress": "<string>"
}
'
200
400
403
404
429
503
{
  "message": "<string>",
  "triggeredCurrencies": [
    {
      "currency": "<string>",
      "symbol": "<string>",
      "balance": "<string>"
    }
  ],
  "checkedCurrencies": 123,
  "failedCurrencies": 123
}
API Reference
Deposit Address Reindex

Reindex transactions for a deposit address

Copy page
POST
https://api.relay.link
https://api.testnets.relay.link
/
transactions
/
deposit-address
/
reindex
Try it
What are deposit addresses?
Headers
​
x-api-key
string

Optional API key for authentication and higher rate limits.

Body
application/json
​
chainId
numberrequired

Chain ID the deposit address was originally registered on.

​
depositAddress
stringrequired

The deposit address to reindex.

​
sweep
boolean

Deprecated. No longer supported on this endpoint.

​
targetChainId
number

Chain ID to reindex on, when different from chainId. Use this if funds landed on a chain other than the one the deposit address was registered on. Defaults to chainId.

​
currency
string

Address of a specific currency to reindex. Defaults to checking every depositable currency on the chain.

Response
200
application/json

Default Response

​
message
string

Human-readable summary of the reindex outcome.

​
triggeredCurrencies
object[]

Currencies for which a withdrawal was queued.

Show child attributes

​
checkedCurrencies
number

Total number of currencies whose balance was checked.

​
failedCurrencies
number

Number of currencies whose balance check failed.

Was this page helpful?

Yes
No
Transactions Single
Get App Fee Balances
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform