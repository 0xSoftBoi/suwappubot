# getQuote - Relay

Source: https://docs.relay.link/references/relay-kit/sdk/actions/getQuote

On this page
Arguments
Quote Parameters
Native Bridge Example
Cross-Chain Swap Example
Wrap/Unwrap Example
Send Example
Server-Side Example with API key
Actions
getQuote
Copy page

Get a quote for a cross-chain relay (bridge, swap, call, etc)

​
Arguments
Property	Description	Required
parameters	Quote parameters defined below	✅
includeDefaultParameters	Setting this to true will include default parameters, which include user and recipient. These parameters are based on the wallet and fallback to the dead address if the wallet is missing.	❌
headers	Custom headers to pass along with the quote request, such as x-api-key for authentication.	❌
Warning: Never pass x-api-key in headers from client-side code. Only use the headers parameter with API keys when calling getQuote entirely on the server.
​
Quote Parameters
Property	Description	Required
chainId	The chain id to deposit funds on	✅
toChainId	The chain id to execute the txs on	✅
currency	Address for a supported native currency or valid erc20	✅
toCurrency	Address for a supported native currency or valid erc20	✅
user	The user or sender of the bridge. This must be defined if not using includeDefaultParameters.	✅ (❌ if includeDefaultParameters is true)
recipient	The recipient of the bridge. This must be defined if not using includeDefaultParameters.	✅ (❌ if includeDefaultParameters is true)
tradeType	Either EXACT_INPUT for quoting via an input amount, or EXPECTED_OUTPUT/EXACT_OUTPUT for quoting via an output amount.	✅
amount	Amount in wei, in the supplied currency	❌
wallet	A valid WalletClient from viem or an adapted wallet generated from an adapter that meets this interface.	❌
txs	An array of either transaction objects (made up of a to, data and value properties) or viem request objects returned from viem’s simulateContract function.	❌
options	Additional options that map directly to the quote API.	❌
disableCapabilitiesCheck	Skip wallet.getCapabilities calls used for EIP-5792 atomic-batch detection and smart-wallet detection. Set this for wallets with a broken getCapabilities implementation that hangs or never resolves. When true, execution falls back to sequential transactions.	❌
​
Native Bridge Example
import { getClient } from "@relayprotocol/relay-sdk";
import { useWalletClient } from "wagmi";

const { data: wallet } = useWalletClient();

const quote = await getClient()?.actions.getQuote({
  chainId: 1,
  toChainId: 10,
  currency: "0x0000000000000000000000000000000000000000",
  toCurrency: "0x0000000000000000000000000000000000000000",
  amount: "10000000000000000", // 0.01 ETH
  wallet,
  user: "WALLET_ADDRESS", //Replace with your wallet address
  recipient: "RECIPIENT_ADDRESS", //Replace with the recipient address
});

​
Cross-Chain Swap Example
// Cross-Chain Swap from USDC on Ethereum to DAI on Optimism
const quote = await getClient()?.actions.getQuote({
  chainId: 1,
  toChainId: 10,
  currency: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC on Ethereum
  toCurrency: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", // DAI on Optimism
  amount: "100000", // 100 USDC
  wallet,
  user: "WALLET_ADDRESS", //Replace with your wallet address
  recipient: "RECIPIENT_ADDRESS", //Replace with the recipient address
});

​
Wrap/Unwrap Example
// Unwrap ETH
const quote = await getClient()?.actions.getQuote({
  chainId: 1,
  toChainId: 1,
  currency: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
  toCurrency: "0x0000000000000000000000000000000000000000",
  amount: "10000000000000000", // 0.01 ETH
  wallet,
  user: "WALLET_ADDRESS", //Replace with your wallet address
  recipient: "RECIPIENT_ADDRESS", //Replace with the recipient address
});

​
Send Example
// Send ERC20 / Native Currency to another address on the same chain
// Note: The recipient address must be specified for send transactions and be different from the wallet address
const quote = await getClient()?.actions.getQuote({
  chainId: 1,
  toChainId: 1,
  currency: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
  toCurrency: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  amount: "100000", // 100 USDC
  wallet,
  user: "WALLET_ADDRESS", //Replace with your wallet address
  recipient: "0x0000c3caa36e2d9a8cd5269c976ede05018f0000",
});

​
Server-Side Example with API key
// Server-side only - pass API key via headers
const quote = await getClient()?.actions.getQuote(
  {
    chainId: 1,
    toChainId: 10,
    currency: "0x0000000000000000000000000000000000000000",
    toCurrency: "0x0000000000000000000000000000000000000000",
    amount: "10000000000000000", // 0.01 ETH
    user: "WALLET_ADDRESS",
    recipient: "RECIPIENT_ADDRESS",
  },
  false,
  { "x-api-key": process.env.RELAY_API_KEY }
);

Note - Quotes are revalidated when being filled, clients should regularly fetch fresh quotes so that users are always submitting up to date quotes. See Getting a quote for more information on how quotes work.

Was this page helpful?

Yes
No
createClient
execute
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform