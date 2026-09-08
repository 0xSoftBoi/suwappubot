# Refunds - Relay

Source: https://docs.relay.link/references/api/api_core_concepts/refunds

On this page
What is a refund?
What causes refunds to happen?
Refund amounts and costs
When is there no refund given?
What currency is used for refunds?
Are refunds automatic & instant?
How can I force a refund for testing purposes?
Core Concepts
Refunds
Copy page

Learn how Relay handles refunds.

Relay strives for 100% successful bridges & swaps. Occasionally, due to a variety of possible circumstances, a bridge or swap might be refunded instead of completed. Learn more about Relay’s refund logic and how it works.
​
What is a refund?
A refund returns funds to a user when a swap or bridge cannot be completed. Refunds are paid on the origin chain to the refundTo address supplied on the quote. If refundTo is not set, automatic refund is disabled.
​
What causes refunds to happen?
A refund is triggered when the swap or bridge fails to complete. A failure can occur for a variety of reasons including but not exclusive to:
Transactions Reverting: Before giving a quote, we simulate the transaction to ensure it will succeed. Between the time the quote is given and the user accepts & deposits funds, the transaction could revert. Transactions reverting could be caused by if there is a contested mint or execution was delayed.
User’s Wallet Address is Different Than Transaction Depositing Address: This happens when the user switches wallets right before signing the transaction. Users must execute the transaction with the wallet address that received the quote.
User Deposits Too Little: The user explicitly deposits a lower amount than Relay requested.
Destination Chain is Unavailable: Occasionally, the destination chain will have a network outage beyond our control. An example could be an RPC that is down or the chain is experiencing a large reorganization.
User Sends Deposits With the Same Request ID in the Calldata Multiple Times
User Send Deposits Without a Request ID in the Calldata
Quote Regeneration leads to high slippage: Quotes are regenerated upon execution. Each quote contains a currencyOut.minimumAmount which details the minimum a user will receive, if regeneration leads to a lower currencyOut.minimumAmount, the user will be refunded.
​
Refund amounts and costs
The refund amount may be less than what you originally deposited due to several factors:
Gas costs are deducted: The gas cost of processing the refund transaction is deducted from the refunded amount.
Origin swaps: If your transaction included an origin swap, you will only receive what the depository contract actually received after the swap, not your original deposit amount.
For example, if you send us a memecoin it will be swapped to USDC as a part of the deposit transaction. In the case of a refund we will refund in USDC for the amount the deposit contract received after the swap into USDC minus the cost of gas.
​
When is there no refund given?
If the refund amount is not enough to cover the cost of gas, Relay will mark the bridge or swap as failed & no refund will be sent.
​
What currency is used for refunds?
The refund currency can vary by route. Relay will always attempt to refund the user in the original currency they sent. Usually this is one of the currencies in the solverCurrencies in the chain api response, which are native or stable coins.
​
Are refunds automatic & instant?
Yes, refunds happen automatically when swaps or bridges fail to complete. If a failure occurs, Relay will refund the user’s funds almost instantly. Please remember no refund is given if the refund amount cannot cover the cost of gas.
​
How can I force a refund for testing purposes?
You can force a refund by passing debug-force-refund as the referrer.
cURL
curl -X POST \
  'https://api.relay.link/quote/v2' \
  -H 'Content-Type: application/json' \
  -d '{
    "referrer": "debug-force-refund",
    "user":"0xf3d63166F0Ca56C3c1A3508FcE03Ff0Cf3Fb691e",
    "originChainId":8453,
    "destinationChainId": 10,
    "originCurrency":"0x0000000000000000000000000000000000000000",
    "destinationCurrency":"0x0000000000000000000000000000000000000000",
    "recipient":"0xf3d63166F0Ca56C3c1A3508FcE03Ff0Cf3Fb691e",
    "tradeType":"EXACT_INPUT",
    "amount":"1000000000000000000"
  }'


Was this page helpful?

Yes
No
Cost & Fee Structure
Input Validation
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform