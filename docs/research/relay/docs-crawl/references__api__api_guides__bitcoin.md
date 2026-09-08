# Bitcoin Support - Relay

Source: https://docs.relay.link/references/api/api_guides/bitcoin

On this page
Required Information
SDK Properties
Bitcoin Currency
PSBT Signing
UTXOs and Bitcoin Balance
API
Params
Execution
Example: Withdraw from Bitcoin to Base
Example: Deposit to Bitcoin from Base
SDK
Deposit Addresses (Optional)
Block Confirmations
Manually Reindexing a Bitcoin Deposit
Quote Requirements for Deposit Addresses
Chain Support Guides
Bitcoin Support
Copy page

How to deposit and withdraw on Bitcoin from any Relay chain

Relay supports deposits to and withdrawals from Bitcoin across any supported chain. This guide covers the Bitcoin-specific parameters, PSBT signing, balance calculation, and API/SDK usage required for integration.
​
Required Information
Bitcoin transactions differ from EVM chains in several ways. The sections below highlight the Bitcoin-specific parameters and requirements for your integration.
Bitcoin addresses are case-sensitive.
​
SDK Properties
Action	Parameter	Input	Description
Deposit to Bitcoin	toChainId	8253038	Chain ID assigned to Bitcoin in Relay.
	recipient	User’s Bitcoin Address	Valid Bitcoin address.
	toCurrency	bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8	Native BTC identifier.
Withdraw from Bitcoin	chainId	8253038	Chain ID assigned to Bitcoin in Relay.
	currency	bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8	Native BTC identifier.
​
Bitcoin Currency
Token	Currency Address	Symbol	Decimals
BTC	bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8	BTC	8
​
PSBT Signing
Bitcoin transactions use Partially Signed Bitcoin Transactions (PSBT) for signing. When withdrawing from Bitcoin, the quote response returns a PSBT instead of standard EVM calldata.
The Bitcoin wallet adapter handles PSBT parsing, finalization, and broadcasting. Provide a signPsbt callback that signs the PSBT and returns the signed result in base64 format.
​
UTXOs and Bitcoin Balance
Unlike EVM chains that track account balances directly, Bitcoin uses a UTXO (Unspent Transaction Output) model. Each address balance equals the sum of unspent outputs it has received minus outputs it has spent.
To calculate a Bitcoin address balance, query the mempool.space API and compute the difference between funded and spent transaction outputs:
async function getBitcoinBalance(address: string) {
	const response = await fetch(
		`https://mempool.space/api/address/${address}`
	);
	const data = await response.json();

	const fundedTxo = data.chain_stats.funded_txo_sum;
	const spentTxo = data.chain_stats.spent_txo_sum;
	const pendingSpent = data.mempool_stats.spent_txo_sum;

	// Balance in satoshis
	const balance =
		BigInt(fundedTxo) - BigInt(spentTxo) - BigInt(pendingSpent);

	return {
		balance, // Confirmed balance in satoshis
		pendingBalance: BigInt(pendingSpent), // Pending outgoing
	};
}

Balance values are returned in satoshis (1 BTC = 100,000,000 satoshis).
​
API
​
Params
Action	Parameter	Input	Description
Deposit to Bitcoin	recipient	User’s Bitcoin Address	Valid Bitcoin address.
	destinationChainId	8253038	Chain ID assigned to Bitcoin in Relay.
	destinationCurrency	bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8	Native BTC identifier.
Withdraw from Bitcoin	user	User’s Bitcoin Address	Valid Bitcoin address.
	originChainId	8253038	Chain ID assigned to Bitcoin in Relay.
	originCurrency	bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8	Native BTC identifier.
​
Execution
Bitcoin uses the standard Relay API flow. Review the execution steps documentation, then use the Get Quote endpoint.
For Bitcoin origin deposits, the request transitions to pending as soon as the deposit appears in the Bitcoin mempool — earlier than the equivalent transition on EVM origins. Block-confirmation policy still governs the move to submitted/success.
​
Example: Withdraw from Bitcoin to Base
Request
Response
curl -X POST "https://api.relay.link/quote/v2" \
  -H "Content-Type: application/json" \
  -d '{
    "user": "bc1q4vxn43l44h30nkluqfxd9eckf45vr2awz38lwa",
    "originChainId": 8253038,
    "originCurrency": "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8",
    "destinationChainId": 8453,
    "destinationCurrency": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "recipient": "0x03508bb71268bba25ecacc8f620e01866650532c",
    "tradeType": "EXACT_INPUT",
    "amount": "100000"
  }'

​
Example: Deposit to Bitcoin from Base
Request
Response
curl -X POST "https://api.relay.link/quote/v2" \
  -H "Content-Type: application/json" \
  -d '{
    "user": "0x03508bb71268bba25ecacc8f620e01866650532c",
    "originChainId": 8453,
    "originCurrency": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "destinationChainId": 8253038,
    "destinationCurrency": "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8",
    "recipient": "bc1q4vxn43l44h30nkluqfxd9eckf45vr2awz38lwa",
    "tradeType": "EXACT_INPUT",
    "amount": "10000000"
  }'

Amounts are specified in the smallest unit of the currency. For BTC, this is satoshis (100000 satoshis = 0.001 BTC). For USDC, this is 6 decimal places (10000000 = 10 USDC).
​
SDK
To use the SDK with Bitcoin, install and configure the Bitcoin wallet adapter. The adapter handles PSBT signing and transaction broadcasting.
npm install @relayprotocol/relay-bitcoin-wallet-adapter

For implementation details and code samples, see the Adapters documentation.
​
Deposit Addresses (Optional)
Relay also supports the deposit address flow, which allows bridging without wallet connection or PSBT signing. When using deposit addresses, there are additional considerations:
​
Block Confirmations
When using deposit addresses, Relay waits for 1 block confirmation before processing in the typical case. For high-value deposits — those whose origin amount exceeds a per-currency threshold — Relay waits for 2 block confirmations instead, to reduce the risk of a reorg invalidating the fill. Bitcoin’s block time averages ~10 minutes but varies significantly; blocks can arrive within minutes of each other or take 30-50 minutes.
The timeEstimate field on the quote response reflects whichever rule applies — expect roughly one block of wait time for standard deposits and roughly two for high-value ones.
When polling for deposit address transactions, allow for at least 2-3 blocks worth of time (3-4 for high-value deposits) before considering a transaction stalled. You can monitor block times at mempool.space.
​
Manually Reindexing a Bitcoin Deposit
If a Bitcoin deposit is not picked up by automatic indexing, you can trigger a manual reindex by calling POST /transactions/index with chainId: 8253038 and the Bitcoin txHash. Relay verifies the transaction is included in a block before reindexing — calls for transactions that have not yet been confirmed in a block return 404. See the Transaction Indexing guide for the full request shape.
​
Quote Requirements for Deposit Addresses
When using useDepositAddress: true with Bitcoin as origin:
The user address must be a valid Bitcoin address
The user address balance must exceed the quoted amount (otherwise returns INSUFFICIENT_FUNDS)
For indicative quotes, use a known high-balance address (“whale address”). The actual deposit can originate from any address.
Request
Response
curl -X POST "https://api.relay.link/quote/v2" \
  -H "Content-Type: application/json" \
  -d '{
    "user": "bc1q4vxn43l44h30nkluqfxd9eckf45vr2awz38lwa",
    "originChainId": 8253038,
    "originCurrency": "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8",
    "destinationChainId": 8453,
    "destinationCurrency": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "recipient": "0x03508bb71268bba25ecacc8f620e01866650532c",
    "tradeType": "EXACT_INPUT",
    "amount": "100000",
    "useDepositAddress": true,
    "refundTo": "bc1q4vxn43l44h30nkluqfxd9eckf45vr2awz38lwa"
  }'


Was this page helpful?

Yes
No
Solana Support
Hyperliquid Support
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform