# executeGaslessBatch - Relay

Source: https://docs.relay.link/references/relay-kit/sdk/actions/executeGaslessBatch

On this page
Parameters
Example
Example with Subsidized Fees
Handling onProgress updates
Actions
executeGaslessBatch
Copy page

Execute a gasless batch transaction using EIP-7702 delegation

The executeGaslessBatch action takes a quote from getQuote, delegates the user’s EOA to a batch executor using EIP-7702, batches the quote’s transaction steps atomically, and submits via Relay’s execute API with the sponsor covering gas costs. This means the user pays no gas fees.
An API key is required for gasless batch execution. Configure it via createClient({ apiKey: "..." }).
​
Parameters
Property	Description	Required
quote	A valid quote retrieved using the getQuote action	✅
walletClient	A valid WalletClient from viem with an account attached	✅
executor	Batch executor configuration. Defaults to the Calibur executor.	❌
subsidizeFees	Whether the sponsor pays all fees. Defaults to false.	❌
originGasOverhead	Gas overhead for the origin chain gasless transaction. Overrides the executor’s default if provided (Calibur default: 80,000).	❌
onProgress	Callback for each stage of the execution flow. Returns status, requestId, and details. See onProgress statuses below.	❌
​
Example
import { getClient, getQuote, executeGaslessBatch } from "@relayprotocol/relay-sdk";
import { createWalletClient, custom } from "viem";

const walletClient = createWalletClient({
  account: "0x...",
  chain: mainnet,
  transport: custom(window.ethereum),
});

const quote = await getClient().actions.getQuote({
  // ...quote options
});

const result = await executeGaslessBatch({
  quote,
  walletClient,
  onProgress: ({ status, requestId, details }) => {
    console.log(`Status: ${status}`, requestId);
  },
});

console.log("Request ID:", result.requestId);

​
Example with Subsidized Fees
const result = await executeGaslessBatch({
  quote,
  walletClient,
  subsidizeFees: true,
  onProgress: ({ status }) => {
    console.log(`Status: ${status}`);
  },
});

​
Handling onProgress updates
The onProgress callback fires at each stage of the gasless batch execution. The status field indicates which stage is currently active:
signing_authorization: The user is being prompted to sign the EIP-7702 authorization to delegate their EOA to the batch executor. This step is skipped if the EOA is already delegated.
signing_batch: The user is being prompted to sign the EIP-712 typed data for the batched calls.
submitting: The signed batch is being submitted to the Relay API.
polling: The request has been submitted and is being polled for completion.
success: The batch execution completed successfully. The details field contains the full status response.
failure: The batch execution failed or was refunded. The details field contains the full status response.

Was this page helpful?

Yes
No
fastFill
Adapters
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform