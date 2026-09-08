# execute - Relay

Source: https://docs.relay.link/references/relay-kit/sdk/actions/execute

On this page
Parameters
Example
Handling onProgress updates
Actions
execute
Copy page

Execute a quote and get updates on its progress

​
Parameters
Property	Description	Required
quote	A valid quote retrieved using the getQuote action	✅
wallet	A valid WalletClient from viem or an adapted wallet generated from an adapter that meets this interface.	✅
depositGasLimit	The gas limit used for the deposit transaction.	❌
onProgress	Callback to update UI state as execution progresses. Can also be used to get the transaction hash for a given step item. The following data points are returned: steps, fees, breakdown, txHashes, currentStep, currentStepItem, details	❌
disableCapabilitiesCheck	Skip wallet.getCapabilities calls used for EIP-5792 atomic-batch detection and smart-wallet detection. Set this for wallets with a broken getCapabilities implementation that hangs or never resolves. When true, execution falls back to sequential transactions.	❌
​
Example
import { getClient, Execute, getQuote } from "@relayprotocol/relay-sdk";
import { useWalletClient } from 'wagmi'

...

const { data: wallet } = useWalletClient()

const options = ... //define this based on getQuote options

const quote = await getClient().actions.getQuote(options)

getClient().actions.execute({
  quote,
  wallet,
  onProgress: ({steps, fees, breakdown, currentStep, currentStepItem, txHashes, details}) => {
        //custom handling
  },
})


​
Handling onProgress updates
The state of progress is updated as users are moved through the flow. The onProgress callback will fire every time there are changes to the status. Below is a breakdown of the data returned and how it may be useful in representing the status:
steps: This is the full steps object as it’s returned by the api and enhanced with some additional properties on the client. Notably the step status has been updated as well as any errors have been attached.
fees: This is the full fees object as it’s returned by the api
breakdown: This is the full breakdown object as it’s returned by the api
currentStep: We’ve conveniently pinpointed the current step that’s being processed and made it accessible in this callback.
currentStepItem: Similarly to the step we’ve hoisted the current step item that is being processed so it’s more easily accessible. A step can contain multiple items that are processed in parallel as a batch.
txHashes: A full list of all the transaction hashes that have been processed so far during execution.
details: A summary of the swap action that will be performed. This includes information pertinent to the swap: currencyIn, currencyOut, swap rate, etc.

Was this page helpful?

Yes
No
getQuote
getAppFees
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform