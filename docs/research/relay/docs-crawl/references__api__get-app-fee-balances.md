# Get App Fee Balances - Relay

Source: https://docs.relay.link/references/api/get-app-fee-balances

cURL

cURL

curl --request GET \
  --url https://api.relay.link/app-fees/{wallet}/balances
200
400
{
  "balances": [
    {
      "currency": {
        "chainId": 8453,
        "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "symbol": "USDC",
        "name": "USD Coin",
        "decimals": 6,
        "metadata": {
          "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
          "verified": false,
          "isNative": false
        }
      },
      "amount": "30754920",
      "amountFormatted": "30.75492",
      "amountUsd": "30.901612",
      "minimumAmount": "30454920"
    }
  ],
  "totalBalanceUsd": 123,
  "outstandingFastFillBalanceUsd": 123,
  "availableBalanceUsd": 123
}
API Reference
Get App Fee Balances

This API returns app fee balances for a specific wallet.

Copy page
GET
https://api.relay.link
https://api.testnets.relay.link
/
app-fees
/
{wallet}
/
balances
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

Wallet to get the app fees for

Response
200
application/json

Default Response

​
balances
object[]

An array of app fee balances across multiple currencies

Show child attributes

​
totalBalanceUsd
number

Total app fee balance in USD across all currencies.

​
outstandingFastFillBalanceUsd
number

Outstanding fast fill balance in USD that has not yet settled. This amount is deducted from the available collateral for new fast fills and claims.

​
availableBalanceUsd
number

Total balance minus outstanding fast fill balance. The effective collateral available for new fast fills and claims.

Was this page helpful?

Yes
No
Deposit Address Reindex
Claim App Fees
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform