# Get Price - Relay

Source: https://docs.relay.link/references/api/get-price

cURL

cURL

curl --request POST \
  --url https://api.relay.link/price \
  --header 'Content-Type: application/json' \
  --data '
{
  "user": "<string>",
  "originChainId": 123,
  "destinationChainId": 123,
  "originCurrency": "<string>",
  "destinationCurrency": "<string>",
  "amount": "<string>"
}
'
200
400
401
500
{
  "fees": {
    "gas": {
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
    },
    "relayer": {
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
    },
    "relayerGas": {
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
    },
    "relayerService": {
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
    },
    "app": {
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
    },
    "subsidized": {
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
  },
  "details": {
    "operation": "<string>",
    "sender": "<string>",
    "recipient": "<string>",
    "currencyIn": {
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
    },
    "currencyOut": {
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
    },
    "totalImpact": {
      "usd": "<string>",
      "percent": "<string>"
    },
    "swapImpact": {
      "usd": "<string>",
      "percent": "<string>"
    },
    "rate": "<string>",
    "slippageTolerance": {
      "total": "<string>",
      "origin": {
        "usd": "<string>",
        "value": "<string>",
        "percent": "<string>"
      },
      "destination": {
        "usd": "<string>",
        "value": "<string>",
        "percent": "<string>"
      }
    },
    "timeEstimate": 123,
    "userBalance": "<string>"
  }
}
Deprecated
Get Price

This API returns a lightweight quote without calldata or steps.

Copy page
POST
https://api.relay.link
https://api.testnets.relay.link
/
price
Try it
This API has been replaced by the Get Quote API, which supports bridging, swapping and calling through a single unified API.
Body
application/json
​
user
stringrequired

Address that is depositing funds on the origin chain and submitting transactions or signatures

​
originChainId
numberrequired
​
destinationChainId
numberrequired
​
originCurrency
stringrequired
​
destinationCurrency
stringrequired
​
amount
stringrequired

Amount to swap as the base amount (can be switched to exact input/output using the dedicated flag), denoted in the smallest unit of the specified currency (e.g., wei for ETH)

Pattern: ^[0-9]+$
​
tradeType
enum<string>required

Whether to use the amount as the output or the input for the basis of the swap

Available options: EXACT_INPUT, EXACT_OUTPUT, EXPECTED_OUTPUT 
​
recipient
string

Address that is receiving the funds on the destination chain, if not specified then this will default to the user address

​
txs
object[]

Show child attributes

​
referrer
string
​
refundTo
string

Address to send the refund to in the case of failure, if not specified then the recipient address or user address is used

​
refundOnOrigin
booleandeprecated

Always refund on the origin chain in case of any issues

​
useExternalLiquidity
boolean

Enable this to use canonical+ bridging, trading speed for more liquidity

​
useFallbacks
boolean

Enable this for specific fallback routes

​
usePermit
boolean

Enable this to use permit (eip3009) when bridging, only works on supported currency such as usdc

​
useDepositAddress
boolean

Enable this to use a deposit address when bridging, in scenarios where calldata cannot be sent alongside the transaction. only works on native currency bridges.

​
slippageTolerance
string

Slippage tolerance for the swap, if not specified then the slippage tolerance is automatically calculated to avoid front-running. This value is in basis points (1/100th of a percent), e.g. 50 for 0.5% slippage. Must be 0–10000 bps.

Pattern: ^([0-9]{1,4}|10000)$
​
appFees
object[]

Show child attributes

Response
200
application/json

Default Response

​
fees
object

Show child attributes

​
details
object

A summary of the swap and what the user should expect to happen given an input

Show child attributes

Was this page helpful?

Yes
No
Get Requests (v2)
Get Config
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform