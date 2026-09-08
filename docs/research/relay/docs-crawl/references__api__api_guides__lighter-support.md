# Lighter Support - Relay

Source: https://docs.relay.link/references/api/api_guides/lighter-support

On this page
Prerequisites
API Access
Lighter-specific API Parameters
Getting Your Lighter Account Index
How to deposit
How to withdraw
SDK
Chain Support Guides
Lighter Support
Copy page

How to deposit to and withdraw from Lighter using the Relay API

Relay supports depositing and withdrawing to Lighter from any supported chain. You can try depositing today using the Relay App (note: withdrawing is not yet supported in the app). This document details how to integrate Lighter into your application.
​
Prerequisites
Before you can bridge funds to Lighter, you must first set up an account on lighter.exchange. Once your account is created, you can retrieve your account index to use as the recipient for deposits.
​
API Access
Lighter can be accessed using the standard Relay API flow. To get started, review the execution steps documentation. When you’re ready to execute deposits or withdrawals, refer to the Get Quote API endpoint.
If you’re integrating via the SDK, the Lighter wallet adapter wraps this flow — it resolves the user’s Lighter account index, manages the API key lifecycle, and submits the L2 transfer on your behalf.
​
Lighter-specific API Parameters
Parameter	Input	Description
toChainId / fromChainId	3586256	Lighter Chain ID. Use toChainId for deposits and fromChainId for withdrawals.
recipient	Lighter account index	The Lighter account index to credit — not a wallet address.
user	Lighter account index	On withdrawals, the Lighter account index to debit.
These parameters are specific to Lighter interactions. All other standard API parameters remain required.
The recipient parameter must be your Lighter account index, not your wallet address. See below for how to retrieve your account index.
​
Getting Your Lighter Account Index
To deposit to Lighter, you need to use your Lighter account index as the recipient parameter. You can retrieve this using the Lighter API’s accountsByL1Address endpoint:
curl 'https://mainnet.zklighter.elliot.ai/api/v1/accountsByL1Address?l1_address=YOUR_WALLET_ADDRESS'

Replace YOUR_WALLET_ADDRESS with your Ethereum wallet address. The response will include your accountIndex, which you should use as the recipient in your quote request.
For more details, see the Lighter API documentation.
​
How to deposit
Request
Response
curl 'https://api.relay.link/quote/v2' \
  -H 'content-type: application/json' \
  -d '{
    "user": "0x03508bB71268BBA25ECaCC8F620e01866650532c",
    "originChainId": 8453,
    "destinationChainId": 3586256,
    "originCurrency": "0x0000000000000000000000000000000000000000",
    "destinationCurrency": "0",
    "recipient": "509564",
    "tradeType": "EXACT_INPUT",
    "amount": "1000000000000000000"
  }'

In this example:
originChainId: 8453 - Depositing from Base
destinationChainId: 3586256 - Lighter chain ID
recipient: "509564" - Your Lighter account index (replace with your actual account index)
The response will include the execution steps required to complete the deposit. Follow the standard step execution flow to complete the transaction.
​
How to withdraw
Request
Response
curl 'https://api.relay.link/quote/v2' \
  -H 'content-type: application/json' \
  -d '{
    "user": "509564",
    "originChainId": 3586256,
    "destinationChainId": 8453,
    "originCurrency": "0",
    "destinationCurrency": "0x0000000000000000000000000000000000000000",
    "recipient": "0x03508bB71268BBA25ECaCC8F620e01866650532c",
    "tradeType": "EXACT_INPUT",
    "amount": "1000000"
  }'

The Quote API returns a transaction step with Lighter-specific execution data:
{
  "data": {
    "action": {
        "type": "transfer",
        "parameters": {
          "toAccountIndex": 723071,
          "assetIndex": 3,
          "fromRouteType": 0,
          "toRouteType": 0,
          "amount": 1000000,
          "usdcFee": 3000000,
          "memo": "0xfc88e4016659ca122b91dae1aedbb9038e09693a7ce33a1ed1a053d71bdb6aa2"
      }
    }
  }
}

The fields returned inside data.action are:
Property	Type	Description
type	string	The Lighter action to perform. For withdrawals this is always transfer.
toAccountIndex	number	The Lighter account index to transfer funds to (the relayer’s account that executes the fill).
assetIndex	number	Identifier of the asset being transferred on Lighter (e.g. 3 for USDC).
fromRouteType	number	The route type to debit from on the sender’s Lighter account.
toRouteType	number	The route type to credit on the recipient Lighter account.
amount	number	Amount of the asset to transfer, in the asset’s smallest unit.
usdcFee	number	Fee paid in USDC, in the asset’s smallest unit, covering Lighter execution costs.
memo	string	Hex-encoded Relay requestId used to correlate the Lighter transfer with the Relay order.
In order to interact with the Lighter API you must first request a Lighter API key which is scoped to the specific account. You’ll then need to use the data returned by the Relay Quote API along with the API key from Lighter to send transactions. There is a binary used for signing which the SDK packages and lazily loads for you.
​
SDK
To use the SDK with Lighter, install and configure the Lighter wallet adapter.
yarn add @relayprotocol/relay-lighter-wallet-adapter @relayprotocol/relay-sdk viem

If you want the adapter to run its own bootstrap (fresh keygen, accountApiKey, or storage paths), you also need the Lighter SDK:
yarn add @relay-protocol/lighter-ts-sdk

For implementation details and code samples, see the Adapters documentation.

Was this page helpful?

Yes
No
Hyperliquid Support
Deep Linking
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform