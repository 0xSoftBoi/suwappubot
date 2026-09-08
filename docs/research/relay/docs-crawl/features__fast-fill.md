# Fast Fill - Relay

Source: https://docs.relay.link/features/fast-fill

On this page
Requirements
How to use it?
If the origin deposit never lands
Example
Funding Your App Balance
Option 1: Use the Relay App UI
Option 2: Direct On-Chain Deposit
How It Works
Examples
Solver Address
TypeScript Example
Checking Your App Balance
Caveats
Features
Fast Fill
Copy page

Accelerate the destination fill of a cross-chain request

Fast Fill is a feature that allows you to accelerate the destination fill of a cross-chain request. This is useful if you want to speed up the completion of a bridge or swap operation before it’s landed onchain.
​
Requirements
Before you can start fast filling requests, you need:
An API key — Required to authenticate your fast fill requests. Create one in the Relay Dashboard; see API keys and Rate Limits for details.
A Fee Sponsorship Wallet — A wallet linked to your API key that funds your app balance. Link one from the App Balance page in the Relay Dashboard by signing a message to prove ownership — no gas required.
Sufficient App Balance — Your app balance must have enough funds to cover fast fills and fee sponsorship. When a fast fill is triggered, a hold is placed against your app balance for the fill amount. This hold is released once the user’s deposit lands onchain. While holds are active, they reduce the balance available for new fast fills and claims, but do not block fee sponsorship deductions.
Once you’re set up, you can begin fast filling requests.
​
How to use it?
To Fast Fill a request you simply need to call the Fast Fill API with the request ID of the request you want to fast fill after you’ve submitted it onchain but before it finalizes. When a fast fill is triggered, the transaction is instantly filled on the destination chain and a hold is placed against your app balance for the fill amount. Once the user’s deposit lands onchain and Relay indexes it, the hold is released.
​
If the origin deposit never lands
Fast Fill advances the destination funds before Relay confirms the origin deposit. If the deposit never lands, Relay does not release the hold. The sponsoring app bears the loss, and the held amount becomes a permanent debit against its app balance.
​
Example
This example demonstrates the full fast fill flow: getting a quote, submitting the transaction onchain, calling the fast fill API, and monitoring the status.
SDK
API
import { getClient, createClient } from "@relayprotocol/relay-sdk";
import { createWalletClient, createPublicClient, http } from "viem";
import { base } from "viem/chains";

// 1. Setup Wallet - Initialize your wallet using your preferred method
const account = {}; // Your wallet account (e.g., privateKeyToAccount, or injected wallet)
const wallet = createWalletClient({
  account,
  chain: base,
  transport: http(),
});

const publicClient = createPublicClient({
  chain: base,
  transport: http(),
});

// 2. Initialize the Relay client
createClient({
  baseApiUrl: "https://api.relay.link",
  source: "YOUR_APP_NAME",
});

// 3. Get a quote using the SDK
const quote = await getClient().actions.getQuote({
  chainId: 8453, // Base
  toChainId: 42161, // Arbitrum
  currency: "0x0000000000000000000000000000000000000000", // ETH
  toCurrency: "0x0000000000000000000000000000000000000000", // ETH
  amount: "100000000000000", // 0.0001 ETH
  tradeType: "EXACT_INPUT",
  wallet,
});

const requestId = quote.steps[0].requestId;
console.log(`Request ID: ${requestId}`);

// 4. Execute the quote and fast fill once the transaction is submitted
let txHash: string;

await getClient().actions.execute({
  quote,
  wallet,
  onProgress: async ({ currentStep, currentStepItem, txHashes }) => {
    // Once transaction is submitted, trigger fast fill immediately
    if (txHashes && txHashes.length > 0 && !txHash) {
      txHash = txHashes[0];
      console.log(`Transaction submitted: ${txHash}`);

      // 5. Call Fast Fill immediately after submitting (before waiting for confirmation)
      const fastFillResult = await getClient().actions.fastFill({
        requestId,
      });
      console.log("Fast fill initiated:", fastFillResult);
    }

    // Monitor progress
    if (currentStep && currentStepItem) {
      console.log(`Step: ${currentStep.action}, Status: ${currentStepItem.status}`);
    }
  },
});

console.log("Bridge completed successfully!");

See all 64 lines
You can use the maxFillAmountUsd parameter to set a maximum USD value for a fast fill request. If the request’s value exceeds this limit, the fast fill will not be executed. This is useful for managing risk and controlling exposure, especially when dealing with volatile assets or large transaction volumes.
​
Funding Your App Balance
There are two ways to deposit funds to your app balance:
​
Option 1: Use the Relay App UI
The simplest way to deposit funds is through the Relay App Balance UI. This provides a user-friendly interface for managing your balance.
​
Option 2: Direct On-Chain Deposit
You can programmatically deposit to your app balance by sending a transaction on Base to the Relay solver. This method involves appending specific calldata in place of the request ID to identify the deposit.
​
How It Works
When you transfer funds to the solver using specific calldata, Relay treats it as a deposit to your app balance. This method uses a fixed 12-character prefix and suffix (012345abcdef) with the middle portion specifying which address to credit:
Calldata Format:
0x[prefix][address-to-credit][suffix]

Prefix: 012345abcdef
Address to Credit: The wallet address to deposit funds for (use 0000000000000000000000000000000000000000 for msg.sender)
Suffix: 012345abcdef
​
Examples
Calldata	Behavior
0x012345abcdef0000000000000000000000000000000000000000012345abcdef	Credits msg.sender
0x012345abcdefd5c0d17ccb9071d27a4f7ed8255f59989b9aee0d012345abcdef	Credits 0xd5c0d17ccb9071d27a4f7ed8255f59989b9aee0d
The ability to specify a different address is useful for building auto-topup systems or having more granular control over which accounts receive deposits.
​
Solver Address
Deposits should be sent to the Relay solver on Base:
Network	Address
Base	0xf70da97812cb96acdf810712aa562db8dfa3dbef
​
TypeScript Example
import { erc20Abi, encodeFunctionData, createWalletClient } from 'viem'
import { base } from 'viem/chains'

const BASE_USDC_ADDRESS = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as const
const RELAY_BASE_SOLVER_ADDRESS = '0xf70da97812cb96acdf810712aa562db8dfa3dbef' as const
const REQUEST_ID_PREFIX = '012345abcdef'

const walletClient = createWalletClient({
  chain: base,
  transport: custom(window.ethereum!),
})

const [userAddress] = await walletClient.getAddresses()

const amountInWei = '100000000' // 100 USDC

// Encode the transfer function call
const transferData = encodeFunctionData({
  abi: erc20Abi,
  functionName: 'transfer',
  args: [RELAY_BASE_SOLVER_ADDRESS, amountInWei]
})

// Add custom calldata to credit the wallet address
const customCalldata =
  `${REQUEST_ID_PREFIX}${userAddress.slice(2)}${REQUEST_ID_PREFIX}` as `0x${string}`

const hash = await walletClient.sendTransaction({
  to: BASE_USDC_ADDRESS,
  data: `${transferData}${customCalldata}`,
  account: userAddress,
  chain: base
})

See all 33 lines
​
Checking Your App Balance
Verify your available balance using the Get App Fee Balances API:
Request
Response
curl --location 'https://api.relay.link/app-fees/{your-wallet-address}/balances'

​
Caveats
Slippage may lead to a surplus or shortage in your app balance. If you have a good estimate of the final amount you can use the solverInputCurrencyAmount parameter to specify the exact amount of input currency you want to use for the fill, thus minimizing slippage.
We recommend protecting your API key on the backend by not exposing it to the client.
Fast Fill holds, outstanding fast fills that are waiting to be indexed on the destination chain, reduce the balance available for new fast fills and claims, but do not block fee sponsorship.

Was this page helpful?

Yes
No
Gasless Execution
Gasless Swaps
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform