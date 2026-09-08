# useQuote - Relay

Source: https://docs.relay.link/references/relay-kit/hooks/useQuote

On this page
Parameters
Return Data
Usage
Query Function
Hooks
useQuote
Copy page

Fetch a quote and then execute it with this convenient hook

​
Parameters
Parameter	Description	Required
client	A RelayClient instance. You can create one using the SDK or retrieve one using the useRelayClient hook from the UI kit.	✅
wallet	A valid WalletClient from Viem or an AdaptedWallet generated from an adapter. This parameter can be left empty if just retrieving a quote, but is required for executing a quote.	❌
options	Options that map directly to the quote API.	✅
onRequest	A callback function that triggers when a request is made to fetch the quote.	❌
onResponse	A callback function that triggers when a response is returned.	❌
queryOptions	Tanstack query options. Refer to the Tanstack docs.	❌
​
Return Data
The hook returns an object with the base Tanstack Query response, it also returns an executeQuote function which allows you to conveniently execute the quote. The function takes one parameter, an onProgress callback that mirrors the underlying execute action. from the SDK.
​
Usage
Fetching a Quote
Executing a Quote
import { useQuote } from '@relayprotocol/relay-kit-hooks'
import { useWalletClient } from 'wagmi'
import { getClient } from '@relayprotocol/relay-sdk'

const queryOptions = {...} //Query options from tanstack
const walletClient = useWalletClient()
const relayClient = getClient() //Either use getClient, createClient or useRelayClient from the ui kit

const {
data: quote,
isLoading: isFetchingQuote,
executeQuote,
error
} = useQuote(
relayClient ? relayClient : undefined,
walletClient.data,
{
user: address,
originChainId: 1,
destinationChainId: 10,
originCurrency: "0x0000000000000000000000000000000000000000",
destinationCurrency: "0x0000000000000000000000000000000000000000",
tradeType: "EXACT_INPUT",
amount: "10000000"
},
() => {
console.log("Request Triggered!")
},
() => {
console.log("Response Returned!")
},
queryOptions
)


​
Query Function
import { queryQuote } from "@relayprotocol/relay-kit-hooks";

const response = queryQuote("https://api.relay.link", {
  user: address,
  originChainId: 1,
  destinationChainId: 10,
  originCurrency: "0x0000000000000000000000000000000000000000",
  destinationCurrency: "0x0000000000000000000000000000000000000000",
  tradeType: "EXACT_INPUT",
  amount: "10000000",
});


Was this page helpful?

Yes
No
Installation
useRelayChains
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform