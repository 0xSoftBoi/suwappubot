# fastFill - Relay

Source: https://docs.relay.link/references/relay-kit/sdk/actions/fastFill

On this page
Parameters
Example
Example with Solver Input Amount
Actions
fastFill
Copy page

Fast fill a request to accelerate the destination fill

The fastFill action allows you to accelerate the filling of a cross-chain request on the destination chain. This is useful when you want to speed up the completion of a bridge or swap operation.
Learn more about the Fast Fill API
​
Parameters
Property	Description	Required
requestId	The unique identifier of the request to fast fill	✅
solverInputCurrencyAmount	The amount of input currency the solver should use for filling. This is useful if you know the finalized input amount which can help to minimize slippage. If not specified, uses the quoted amount.	❌
​
Example
import { getClient } from "@relayprotocol/relay-sdk";

const requestId = "0x..."; // The request ID from a previous quote/execute

const result = await getClient().actions.fastFill({
  requestId,
});

​
Example with Solver Input Amount
import { getClient } from "@relayprotocol/relay-sdk";

const requestId = "0x..."; // The request ID from a previous quote/execute

const result = await getClient().actions.fastFill({
  requestId,
  solverInputCurrencyAmount: "1000000000000000000", // 1 token in wei
});


Was this page helpful?

Yes
No
claimAppFees
executeGaslessBatch
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform