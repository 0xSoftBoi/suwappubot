# Gasless Execution - Relay

Source: https://docs.relay.link/features/gasless-execution

On this page
How does it work?
How to use it?
Executing a gasless quote
Handling simulation errors
More Use Cases
Caveats
Features
Gasless Execution
Copy page

Submit arbitrary transactions for gasless execution

​
How does it work?
Gasless transactions on EVM are regular transactions where the transaction signer and the gas payer are two different addresses. Rather than signing with the same address and then submitting their transaction and paying gas, a user can simply sign a transaction payload, and other entities (relayers, solvers, etc.) can submit the transaction on their behalf and sponsor the gas costs.
This is not natively possible, so there are custom transaction payloads to enable this: Permit2, EIP-3009, ERC-2771 payloads, ERC-4337 user operations, etc. The core concept is that as long as the transaction execution does not rely on tx.origin (the transaction submitter), any user can sign permit payloads or Smart Account actions (EIP-7702, ERC-4337 user operations etc.) and a relayer can post those payloads on chain by wrapping them in a transaction.
This is where the /execute API comes in. The API allows users to submit raw calls (the partial payload of a regular EVM transaction). It includes the to, data, value and an optional EIP-7702 authorizationList.
​
How to use it?
To use gasless execution you’ll need an API key with a linked funding address and a funded app balance. Create an API key in the Relay Dashboard, then see Fee Sponsorship for details on linking a funding address and funding your app balance.
​
Executing a gasless quote
In this example use case you want to execute a gasless Relay quote with the execute API.
1

Get a quote

This flow assumes that the user is using a smart wallet. Use the quote endpoint to get a quote for the transaction you want to execute. The originGasOverhead indicates how much additional gas overhead will be necessary to include the user operation on the chain as compared to a normal EOA transaction.
cURL
Response
 curl -X POST "https://api.relay.link/quote/v2" \
 -H "Content-Type: application/json" \
 -d '{
   "user": "YOUR_WALLET_ADDRESS",
   "originChainId": 8453,
   "destinationChainId": 42161,
   "originCurrency": "0x0000000000000000000000000000000000000000",
   "destinationCurrency": "0x0000000000000000000000000000000000000000",
   "amount": "100000000000000",
   "tradeType": "EXACT_INPUT",
   "originGasOverhead": "300000" //This is the overhead gas cost of the smart wallet, this will be used when simulating the transaction
 }'

2

Execute the transaction

With the quote in hand, you can now execute the transaction. You’ll need to pass the data from previous steps to the api.
  const options = {
    method: 'POST',
    headers: {'x-api-key': 'YOUR_API_KEY', 'Content-Type': 'application/json'},
    body: JSON.stringify({
      requestId: steps[0].requestId, //Quote requestId from previous step
      executionKind: 'rawCalls',
      data: {
        chainId: 8453,
        to: 'YOUR_WALLET_ADDRESS',
        data: steps[0].items[0].data.data, //Quote data from previous step
        value: steps[0].items[0].data.value, //Quote value from previous step
      },
      executionOptions: {
        //Optional execution options
      }
    })
  };

  fetch('https://api.relay.link/execute', options)
    .then(res => res.json())
    .then(res => console.log(res))
    .catch(err => console.error(err));

3

Monitor

Now that the transaction has been submitted, you can monitor the status of the transaction using the requestId from the quote data and the status endpoint.
  const response = await fetch(`https://api.relay.link/intents/status/v3?requestId=${requestId}`);
  const data = await response.json();
  console.log(data);

​
Handling simulation errors
Relay simulates /execute raw calls before submission. If the simulation reverts, the API returns 400 with a decoded error label, a message, the requestId, and trace details when Relay can decode the revert path.
type ExecuteSimulationErrorResponse = {
  error: string;
  message: string;
  requestId: string;
  details?: SimulationErrorDetails;
};

type SimulationErrorDetails = {
  topLevel: SimulationErrorFrame;
  innermost: SimulationErrorFrame;
  path: SimulationErrorFrame[];
  revert: {
    type: "errorString" | "panic" | "customError" | "unknownCustomError" | "empty";
    label: string;
    message: string;
    selector?: string;
    name?: string;
    args?: Record<string, string>;
    rawArgsHex?: string;
  };
};

type SimulationErrorFrame = {
  type: string;
  address?: string;
  contract?: string;
  function?: string;
  selector?: string;
  error?: string;
  revertReason?: string;
  gasUsed?: string;
};

Use error and message for integration handling, and include requestId when contacting Relay support. Use details.innermost and details.revert to identify the contract, function selector, and revert data that caused the simulation failure.
Response
{
  "error": "INVALID_SIGNATURE",
  "message": "Invalid signature",
  "requestId": "0x887091202256e66960493eb09c410188307cc734c919e89696b3ae9993a7fa1d",
  "details": {
    "topLevel": {
      "type": "CALL",
      "address": "0xca11bde05977b3631167028862be2a173976ca11",
      "contract": "Multicall3",
      "function": "Multicall3.aggregate3Value"
    },
    "innermost": {
      "type": "CALL",
      "address": "0x000000000022d473030f116ddee9f6b43ac78ba3",
      "contract": "Permit2",
      "selector": "0xda9c8680",
      "error": "execution reverted"
    },
    "path": [
      {
        "type": "CALL",
        "contract": "Multicall3",
        "function": "Multicall3.aggregate3Value"
      },
      {
        "type": "CALL",
        "contract": "Permit2",
        "selector": "0xda9c8680",
        "error": "execution reverted"
      }
    ],
    "revert": {
      "type": "customError",
      "label": "INVALID_SIGNATURE",
      "message": "Invalid signature",
      "selector": "0x8baa579f",
      "name": "InvalidSignature"
    }
  }
}

If Relay cannot map a custom error selector to a known contract error, the response uses a label of the form UNKNOWN_CUSTOM_ERROR_<selector> and includes rawArgsHex when encoded revert arguments are available.
​
More Use Cases

Gasless ERC-20 transfer from ERC-4337 Smart Account

Gasless upgrade to an EIP-7702 Smart Account

​
Caveats
Only EVM chains are supported currently.
Partial sponsorship is not yet supported. Should the fees amount to more than the app balance, the transaction will not be sponsored.
If the transaction relies on msg.sender, the transaction signer must be a smart wallet (EIP-7702, ERC-4337, etc).
The API won’t work if the transaction relies on tx.origin.

Was this page helpful?

Yes
No
Gas Top-Up
Fast Fill
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform