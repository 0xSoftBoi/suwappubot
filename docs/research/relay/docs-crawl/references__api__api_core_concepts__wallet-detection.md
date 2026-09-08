# Wallet Detection - Relay

Source: https://docs.relay.link/references/api/api_core_concepts/wallet-detection

On this page
Wallet Detection
Understanding Wallet Types
The Problem
The Solution
When to Use Wallet Detection
Detection Methods
1. Smart Wallet Capabilities (EIP-5792)
2. Contract Code Detection
3. EIP-7702 Delegation Detection
Final Determination
Safety Checks
Zero Native Balance Check
Low Transaction Count Check
Implementation Example
Example Scenarios
API Usage
Expected User Experience
For EOA Users (explicitDeposit: false)
For Smart Wallet Users (explicitDeposit: true)
Best Practices
Troubleshooting
Detection Returns Incorrect Results
Quote Requests Failing
Core Concepts
Wallet Detection
Copy page

How to detect wallet types and set the explicitDeposit parameter for optimal user experience

​
Wallet Detection
When using Protocol v2 on EVM chains, you need to detect whether your user’s wallet is an EOA (Externally Owned Account) or a Smart Wallet to properly set the explicitDeposit parameter in your quote requests.
​
Understanding Wallet Types
EOAs (Externally Owned Accounts) are regular wallets controlled by a private key, like MetaMask, Coinbase Wallet, and hardware wallets. These wallets can only execute one transaction at a time and cannot batch multiple operations together.
Smart Wallets are contract-based wallets that can execute multiple operations in a single transaction. Examples include Gnosis Safe, Argent, and ERC-4337 compatible wallets. Smart wallets can batch approvals and deposits atomically, making multi-step flows more user-friendly.
​
The Problem
Protocol v2 uses the Relay Depository contracts to enable trustless cross-chain payments. For ERC20 token deposits, there are two possible transaction flows:
Explicit Deposits (2 transactions):
User approves the Relay Depository contract to spend their tokens
User calls the depositErc20 function to transfer tokens with an order ID
Implicit Deposits (1 transaction):
User transfers tokens directly to the solver with order ID encoded in transaction calldata
The challenge is that implicit deposits only work reliably for EOAs, while explicit deposits work for all wallet types but create poor UX for EOAs who must execute two separate transactions.
​
The Solution
By detecting wallet type, you can set the explicitDeposit parameter to choose the optimal flow:
explicitDeposit: false - Enables implicit deposits for EOAs (1 transaction)
explicitDeposit: true - Uses explicit approval flow for smart wallets (2 transactions, can be batched)
Default: true (safe fallback for all wallet types)
​
When to Use Wallet Detection
You should implement wallet detection when:
Using protocolVersion: "v2" or "preferV2"
User is on an EVM chain
User is depositing ERC20 tokens (not native ETH)
You want to optimize transaction flow for your users
For native ETH deposits, wallet detection is not necessary since no approval is required.
​
Detection Methods
​
1. Smart Wallet Capabilities (EIP-5792)
Check if the wallet advertises smart wallet capabilities:
const capabilities = await wallet.getCapabilities({
	account: wallet.account,
	chainId,
});

const hasSmartWalletCapabilities = Boolean(
	capabilities?.atomicBatch?.supported ||
		capabilities?.paymasterService?.supported ||
		capabilities?.auxiliaryFunds?.supported ||
		capabilities?.sessionKeys?.supported
);

​
2. Contract Code Detection
Check if the wallet address has deployed contract code:
const code = await publicClient.getCode({
	address: walletAddress,
});

const hasCode = Boolean(code && code !== "0x");

​
3. EIP-7702 Delegation Detection
Check if the wallet uses EIP-7702 delegation (code starts with 0xef01):
const isEIP7702Delegated = Boolean(
	code && code.toLowerCase().startsWith("0xef01")
);

Note: EIP-7702 delegated accounts are technically EOAs but gain smart wallet capabilities through authorization signatures. They require explicitDeposit: true for reliable batching and execution.
​
Final Determination
const isSmartWallet =
	hasSmartWalletCapabilities || hasCode || isEIP7702Delegated;
const isEOA = !isSmartWallet;

// Set explicitDeposit based on wallet type
const explicitDeposit = !isEOA || isEIP7702Delegated;

​
Safety Checks
​
Zero Native Balance Check
If the user has zero native currency (ETH, MATIC, etc.), force explicitDeposit: true to avoid failed transactions due to insufficient gas:
if (nativeBalance === 0n) {
	explicitDeposit = true;
}

​
Low Transaction Count Check
If the wallet has 1 or fewer transactions on the source chain, force explicitDeposit: true as this may indicate a new wallet requiring explicit handling:
if (transactionCount <= 1) {
	explicitDeposit = true;
}

​
Implementation Example
Here’s a complete implementation for detecting wallet types:
export const detectWalletType = async (
	wallet: WalletClient,
	chainId: number
) => {
	if (!wallet.account) {
		return { isEOA: false, isEIP7702Delegated: false };
	}

	try {
		// Check 1: Smart wallet capabilities
		let hasSmartWalletCapabilities = false;
		try {
			const capabilities = await wallet.getCapabilities({
				account: wallet.account,
				chainId,
			});

			hasSmartWalletCapabilities = Boolean(
				capabilities?.atomicBatch?.supported ||
					capabilities?.paymasterService
						?.supported ||
					capabilities?.auxiliaryFunds
						?.supported ||
					capabilities?.sessionKeys?.supported
			);
		} catch (capabilitiesError) {
			// Wallet doesn't support capabilities API
		}

		// Check 2 & 3: Contract code detection
		const publicClient = createPublicClient({
			chain: getChainById(chainId),
			transport: http(),
		});

		const code = await publicClient.getCode({
			address: wallet.account.address,
		});

		const hasCode = Boolean(code && code !== "0x");
		const isEIP7702Delegated = Boolean(
			code && code.toLowerCase().startsWith("0xef01")
		);

		const isSmartWallet =
			hasSmartWalletCapabilities ||
			hasCode ||
			isEIP7702Delegated;
		const isEOA = !isSmartWallet;

		return { isEOA, isEIP7702Delegated };
	} catch (error) {
		// On error, assume not EOA (safer default)
		return { isEOA: false, isEIP7702Delegated: false };
	}
};

See all 56 lines
​
Example Scenarios
Wallet Type	Detection Result	explicitDeposit	User Experience
Regular EOA (MetaMask, Coinbase)	EOA detected	false	1 transaction
Smart Wallet (Gnosis Safe, Argent)	Smart wallet detected	true	2 transactions (can be batched)
EIP-7702 Delegated EOA	Smart wallet detected	true	2 transactions (can be batched)
Detection Error	Unknown	true	2 transactions (safe fallback)
​
API Usage
Include the explicitDeposit parameter in your quote requests:
const quoteRequest = {
	user: userAddress,
	originChainId: sourceChainId,
	destinationChainId: targetChainId,
	originCurrency: sourceCurrencyAddress,
	destinationCurrency: targetCurrencyAddress,
	recipient: recipientAddress,
	amount: amountInWei,
	tradeType: "EXACT_INPUT",
	protocolVersion: "preferV2",
	explicitDeposit: explicitDepositValue, // Based on your detection
};

​
Expected User Experience
​
For EOA Users (explicitDeposit: false)
✅ Step 1: Transfer USDC directly to solver with order ID encoded in calldata
✅ One wallet confirmation
✅ Faster execution and lower cost
✅ Simpler, more intuitive user experience

​
For Smart Wallet Users (explicitDeposit: true)
✅ Step 1: Approve Relay Depository contract to spend USDC
✅ Step 2: Call depositErc20() to deposit USDC
✅ Steps can be batched into single confirmation (ERC-4337/EIP-5792)
✅ Reliable, predictable execution through Depository architecture
✅ Full smart wallet capabilities (fee sponsorship, session keys, etc.)

​
Best Practices
Handle errors gracefully - Return { isEOA: false, isEIP7702Delegated: false } on errors (safer default)
Add timeout - Detection should timeout after ~1 second to avoid blocking UX
Cache results - Cache detection results per wallet/chain combination to avoid repeated calls
Include safety checks - Always check native balance and transaction count as additional safety measures
Only use with Protocol v2 - The explicitDeposit parameter is only relevant for Protocol v2
​
Troubleshooting
​
Detection Returns Incorrect Results
Ensure you’re using the correct chain ID
Verify the RPC endpoint is returning accurate data
Check that wallet capabilities API is properly supported
​
Quote Requests Failing
Verify explicitDeposit is only included when using v2 protocol
Ensure user has sufficient native currency for gas
Check that the wallet address is valid
By implementing proper wallet detection, you can provide optimal user experience for both EOA and smart wallet users while ensuring transaction reliability.

Was this page helpful?

Yes
No
Understanding Step Execution
Cost & Fee Structure
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform