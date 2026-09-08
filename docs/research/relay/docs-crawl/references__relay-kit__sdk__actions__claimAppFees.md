# claimAppFees - Relay

Source: https://docs.relay.link/references/relay-kit/sdk/actions/claimAppFees

On this page
Parameters
Example
Actions
claimAppFees
Copy page

Claim app fees for a wallet

What are app fees?
​
Parameters
Property	Description	Required
wallet	A valid WalletClient from viem or an adapted wallet generated from an adapter that meets this interface.	✅
chainId	Chain ID to claim fees on	✅
currency	Token address to claim	✅
recipient	Address to receive claimed fees (defaults to wallet address)	❌
amount	The amount to be claimed in the currency specified.	❌
onProgress	Callback to update UI state as execution progresses. Can also be used to get the transaction hash for a given step item. The following data points are returned: steps, fees, breakdown, txHashes, currentStep, currentStepItem, details	❌
disableCapabilitiesCheck	Skip wallet.getCapabilities calls used for EIP-5792 atomic-batch detection and smart-wallet detection. Set this for wallets with a broken getCapabilities implementation that hangs or never resolves. When true, execution falls back to sequential transactions.	❌
​
Example
import { getClient } from "@relayprotocol/relay-sdk";
import { useWalletClient } from "wagmi";

const { data: wallet } = useWalletClient();

const { data } = await getClient().actions.claimAppFees({
  wallet,
  chainId: 8453, // Base
  currency: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
  recipient: "0x...", // Optional
  amount: "10000000", // Optional (10 USDC)
  onProgress: ({steps, fees, breakdown, currentStep, currentStepItem, txHashes, details}) => {
    // custom handling
  },
});


Was this page helpful?

Yes
No
getAppFees
fastFill
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform