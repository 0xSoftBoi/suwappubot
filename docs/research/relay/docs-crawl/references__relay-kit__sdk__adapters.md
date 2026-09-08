# Adapters - Relay

Source: https://docs.relay.link/references/relay-kit/sdk/adapters

On this page
What is an adapter anyway?
What adapters are available out of the box?
How can I use an adapter?
Viem adapter options
SDK
Adapters
Copy page

An introduction to adapters and how to use them

​
What is an adapter anyway?
An adapter is a function that takes parameters and returns an object that adheres to this interface. Let’s review the interface in depth:
Property	Description	Required
vmType	A string representing a supported vmType (evm svm bvm tvm lvm tonvm)	✅
getChainId	An async function that returns a chain id	✅
handleSignMessageStep	An async function that given a signature step item and a step generates a signature	✅
handleSendTransactionStep	An async function that given a chain id, a transaction step item and a step returns a transaction hash	✅
handleConfirmTransactionStep	An async function that given a transaction hash, a chain id, an onReplaced function and an onCancelled function returns a promise with either an evm receipt or an svm receipt	✅
address	An async function that returns the currently connected to address, an address that can sign messages and submit transactions	✅
switchChain	An async function that given a chain id switches to that chain, either by prompting the user or automatically switching chains	✅
transport	An optional transport to use when making rpc calls.	❌
getBalance	An optional method to override the default balance fetching logic for selected tokens in the ui kit.	❌
supportsAtomicBatch	An optional async function that takes a chain ID and returns whether the wallet supports EIP-5792’s atomic batch capability. EVM wallets only.	❌
handleBatchTransactionStep	An optional async function that takes a chain ID and an array of transaction step items, returning a call bundle identifier for batch processing. Only available for EVM wallets that support atomic batching.	❌
isEOA	An optional boolean that indicates if the wallet is an EOA (Externally Owned Account). This is used to determine if the wallet is an EOA or a contract account.	❌
​
What adapters are available out of the box?
The following adapters are officially maintained and developed by the Relay team:
SVM Adapter: This adapter gives the sdk the ability to submit transactions on SVM (Solana Virtual Machine) networks. It does not support signing messages and under the hood it uses the solana web3 sdk.
Bitcoin Adapter: This adapter gives the sdk the ability to submit transaction to the Bitcoin blockchain. Under the hood it uses bitcoinjs-lib to sign and submit transactions. Note that bitcoin transactions have a long finalization period and unlike quicker vms are not polled in real time for confirmation.
Viem Adapter: This adapter is the default one used when no adapter is provided. You can also import it yourself to convert any viem wallet client into an adapted wallet ready to be used in the sdk.
Ethers Adapter: If your application uses ethers then you’ll need this adapter to use the SDK. You’ll still need to install viem as that’s required for polling transactions but you can pass in your ethers signer to submit transactions and sign messages.
Tron Adapter: This adapter gives the sdk the ability to submit transactions to the Tron blockchain. Under the hood it uses the tronweb sdk.
Lighter Adapter: This adapter gives the SDK the ability to deposit to Lighter from any Relay-supported chain. It owns the full Lighter session lifecycle — resolving the user’s Lighter account index, generating an in-memory API key, and registering it via changeApiKey on first transfer. Integrators who already run their own Lighter session (backend-provisioned key, wallet-level integration) can pass a pre-built signerClient to bypass the bootstrap entirely.
TON Adapter: This adapter gives the SDK the ability to submit transactions on the TON blockchain. The user’s key stays in their wallet, so the adapter never signs — you pass a sendTransaction callback (for example wrapping Dynamic’s TON connector or TonConnect UI) that signs and broadcasts the request, while the adapter handles request building and on-chain confirmation. Confirmation reads use a read-only @ton/ton TonClient pointed at the TON chain’s httpRpcUrl from the Relay client’s chain configuration; to use a custom endpoint (e.g. a keyed provider in production), override that chain’s httpRpcUrl when configuring the SDK client rather than passing it to the adapter. TON support requires the @ton/core and @ton/ton peer dependencies in addition to viem and @relayprotocol/relay-sdk.
​
How can I use an adapter?
You can either make your own adapter, as long as it adheres to the interface above or you can use one of the officials adapters developed and maintained by the Relay team. All of our sdk methods handle a viem wallet or adapted wallet. The viem wallet adapter is used by default when a viem wallet is passed in for convenience. Refer below for implementation details:
Solana
Viem
Bitcoin
Ethers
Tron
Lighter
TON
import { getClient, Execute, getQuote } from "@relayprotocol/relay-sdk";
import { adaptSolanaWallet } from '@relayprotocol/relay-solana-wallet-adapter'
import { Connection, Keypair, clusterApiUrl, SystemProgram, Transaction } from '@solana/web3.js';
...

//In this example we are loading a keypair as the wallet, but if you have a connector like dynamic you can just fetch the connection from that library
const wallet = Keypair.generate();
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
const walletAddress = wallet.publicKey.toString()

const adaptedWallet = adaptSolanaWallet(
  walletAddress,
  792703809, // Chain ID that Relay uses to identify Solana 
  connection, // The Solana web3.js Connection instance for interacting with the network
  connection.sendTransaction // Function to sign and send a transaction, returning a promise with a base58 encoded transaction signature
)

const options = ... // define this based on getQuote options

const quote = await getClient().actions.getQuote(options)

getClient().actions.execute({
  quote,
  wallet: adaptedWallet,
  onProgress: ({steps, fees, breakdown, currentStep, currentStepItem, txHashes, details}) => {
        // custom handling
  },
  ...
})

​
Viem adapter options
adaptViemWallet accepts an optional second argument for adapter-level configuration:
Property	Description
disableCapabilitiesCheck	Skip wallet.getCapabilities calls used for EIP-5792 atomic-batch detection and smart-wallet detection. Set this for wallets with a broken getCapabilities implementation that hangs or never resolves. When true, execution falls back to sequential transactions.
import { adaptViemWallet } from "@relayprotocol/relay-sdk";

const adaptedWallet = adaptViemWallet(walletClient, {
  disableCapabilitiesCheck: true,
});

The same flag is available directly on getQuote, execute, and claimAppFees when you pass a raw viem WalletClient — the SDK forwards it to adaptViemWallet internally.

Was this page helpful?

Yes
No
executeGaslessBatch
Typescript API Typings
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform