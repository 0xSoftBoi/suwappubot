# Get Chains - Relay

Source: https://docs.relay.link/references/api/get-chains

cURL

cURL

curl --request GET \
  --url https://api.relay.link/chains
200
{
  "chains": [
    {
      "id": 123,
      "name": "<string>",
      "displayName": "<string>",
      "httpRpcUrl": "<string>",
      "wsRpcUrl": "<string>",
      "explorerUrl": "<string>",
      "explorerName": "<string>",
      "explorerPaths": {
        "transaction": "<string>",
        "address": "<string>",
        "token": "<string>"
      },
      "depositEnabled": true,
      "tokenSupport": "All",
      "disabled": true,
      "partialDisableLimit": 123,
      "blockProductionLagging": true,
      "currency": {
        "id": "<string>",
        "symbol": "<string>",
        "name": "<string>",
        "address": "<string>",
        "decimals": 123,
        "supportsBridging": true
      },
      "withdrawalFee": 123,
      "depositFee": 123,
      "surgeEnabled": true,
      "featuredTokens": [
        {
          "id": "<string>",
          "symbol": "<string>",
          "name": "<string>",
          "address": "<string>",
          "decimals": 123,
          "supportsBridging": true,
          "metadata": {
            "logoURI": "<string>"
          }
        }
      ],
      "erc20Currencies": [
        {
          "id": "<string>",
          "symbol": "<string>",
          "name": "<string>",
          "address": "<string>",
          "decimals": 123,
          "supportsBridging": true,
          "supportsPermit": true,
          "withdrawalFee": 123,
          "depositFee": 123,
          "surgeEnabled": true
        }
      ],
      "solverCurrencies": [
        {
          "id": "<string>",
          "symbol": "<string>",
          "name": "<string>",
          "address": "<string>",
          "decimals": 123
        }
      ],
      "iconUrl": "<string>",
      "logoUrl": "<string>",
      "brandColor": "<string>",
      "contracts": {
        "multicall3": "<string>",
        "multicaller": "<string>",
        "onlyOwnerMulticaller": "<string>",
        "relayReceiver": "<string>",
        "erc20Router": "<string>",
        "approvalProxy": "<string>",
        "v3": {
          "erc20Router": "<string>",
          "approvalProxy": "<string>"
        }
      },
      "vmType": "bvm",
      "explorerQueryParams": {},
      "baseChainId": 123,
      "statusMessage": "<string>",
      "solverAddresses": [
        "<string>"
      ],
      "tags": [
        "<string>"
      ],
      "protocol": {
        "v2": {
          "chainId": "<string>",
          "depository": "<string>",
          "depositoryVault": "<string>"
        }
      }
    }
  ]
}
API Reference
Get Chains

This API returns all possible chains available.

Copy page
GET
https://api.relay.link
https://api.testnets.relay.link
/
chains
Try it
Headers
​
x-api-key
string

Optional API key for authentication and higher rate limits.

Query Parameters
​
includeChains
string | null
Response
200 - application/json

Default Response

​
chains
object[]

An array of supported chains

Show child attributes

Was this page helpful?

Yes
No
Utilities
Get Chains Liquidity
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform