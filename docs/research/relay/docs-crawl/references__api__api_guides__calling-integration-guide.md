# Call Execution Integration Guide - Relay

Source: https://docs.relay.link/references/api/api_guides/calling-integration-guide

On this page
Before you start
Get a Quote
Using EXACT_INPUT with proxy contracts
Contract Compatibility
Contract Interaction with Web3
ERC20 Contract Calls
ERC20 Approval + Contract Call Pattern
Sweeping ERC20 Balance
ERC20 Troubleshooting Guide
ERC20 Best Practices
Quote Parameters for Cross-Chain Calls
Execute the Call
Monitor Cross-Chain Call Status
Preflight Checklist
Common Use Cases
See Also
Integration Guides
Call Execution Integration Guide
Copy page

How to execute cross-chain calls using Relay

New to Relay? Start with the Quickstart Guide and work your way through your first cross-chain transaction.
You can use Relay cross-chain execution to perform any action (tx) on any chain. This works by specifying the transaction data you wish to execute on the destination chain as part of the initial quoting process.
​
Before you start
Origin chain gas required: The user must have a small amount of native gas token (e.g., ETH) on the origin chain to submit the deposit transaction. While Relay handles destination chain execution and deducts fees from the user’s tokens, the initial onchain deposit still requires native gas — this is an EVM-level requirement. If your users have zero native tokens, see Gasless Swaps to find the right approach, or use Smart Accounts (EIP-7702 or ERC-4337) / Gasless Execution for a fully gasless flow.
While not mandatory for integration, doing the following will improve the UX for your users considerably:
Verify user balance - Confirm user has sufficient funds for amount + fees, including native gas on the origin chain for the deposit transaction
Check chain support - Confirm both origin and destination chains are supported
Validate quote - Quotes are revalidated when being filled, keep your quotes as fresh as possible.
Handle errors - Implement proper error handling for API requests and transaction failures
1

Get a Quote

To execute a cross-chain transaction, you need to specify the origin chain for payment, the destination chain where the contract is deployed, and the transaction data to execute. Use the quote endpoint with specific parameters for cross-chain calling.
Cross-chain calls support both EXACT_INPUT and EXACT_OUTPUT. Use EXACT_OUTPUT when the destination call requires a precise output amount. Use EXACT_INPUT when you want to cap how much the user spends and can tolerate variable output.
​
Using EXACT_INPUT with proxy contracts
For EXACT_INPUT calls, integrators usually need their own proxy contract on the destination chain. Because Relay delivers a variable output amount, you cannot always precompute the final calldata at quote time.
Depositing into Aave is a good example. With EXACT_OUTPUT, the request can include two calls directly: approve the Aave pool, then call supply() with a fixed amount. With EXACT_INPUT, the destination amount is variable, so route the calls through your own Aave-specific proxy contract instead.
A simple proxy contract can:
pull the full approved token balance from the caller that initiated execution, such as Relay’s router in a Relay deposit flow
approve the Aave pool contract
call supply() using its full current balance
In that flow, your Relay request should include:
an approval to your proxy contract, usually for MAX_UINT256
a call to your proxy contract, such as execute()
Your proxy contract then reads its live balance at execution time and builds the final Aave interaction from that balance.
The request below is schematic. In practice, txs[].data must contain ABI-encoded calldata.
curl -X POST "https://api.relay.link/quote/v2" \
  -H "Content-Type: application/json" \
  -d '{
    "user": "WALLET",
    "originChainId": 42161,
    "destinationChainId": 137,
    "originCurrency": "0x0000000000000000000000000000000000000000",
    "destinationCurrency": "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    "amount": "100000000000000",
    "tradeType": "EXACT_INPUT",
    "txs": [
      {
        "to": "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
        "data": "approve(PROXY_CONTRACT, MAX_UINT256)",
        "value": "0"
      },
      {
        "to": "PROXY_CONTRACT",
        "data": "execute()",
        "value": "0"
      }
    ]
  }'

In execute(), your proxy can read its token balance, approve the Aave pool, and call supply(asset, balance, onBehalfOf, referralCode) with the live balance.
Request
Response
curl -X POST "https://api.relay.link/quote/v2" \
  -H "Content-Type: application/json" \
  -d '{
    "user": "0x03508bb71268bba25ecacc8f620e01866650532c",
    "originChainId": 1,
    "destinationChainId": 8453,
    "originCurrency": "0x0000000000000000000000000000000000000000",
    "destinationCurrency": "0x0000000000000000000000000000000000000000",
    "amount": "100000000000000000",
    "tradeType": "EXACT_OUTPUT", // use EXACT_INPUT to cap spend and accept variable output
    "txs": [
      {
        "to": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
        "value": "100000000000000000",
        "data": "0xd0e30db0"
      }
    ]
  }'

Create an API key in the Relay Dashboard.
​
Contract Compatibility
Before integrating cross-chain calls, ensure your contract is compatible with Relay. Review our Contract Compatibility overview to make any necessary changes to your smart contracts.​
​
Contract Interaction with Web3
When calling smart contracts, you’ll need to encode the function call data. Here’s how to do it with popular libraries:
Important for ERC20 transactions: If your contract call involves spending ERC20 tokens, you must include an approval transaction in your txs array before the actual contract call. See the ERC20 examples below.
JavaScript/ethers.js
JavaScript/viem
Python/web3.py
import { ethers } from "ethers";

// Contract ABI for the function you want to call
const contractABI = [
  "function mint(address to, uint256 amount) external payable",
];

// Create interface to encode function data
const iface = new ethers.Interface(contractABI);
const callData = iface.encodeFunctionData("mint", [
  "0x03508bb71268bba25ecacc8f620e01866650532c", // recipient
  1, // amount to mint
]);

// Use this callData in your quote request
const quoteRequest = {
  user: "0x03508bb71268bba25ecacc8f620e01866650532c",
  originChainId: 1,
  destinationChainId: 8453,
  originCurrency: "eth",
  destinationCurrency: "eth",
  amount: "100000000000000000",
  tradeType: "EXACT_OUTPUT",
  txs: [
    {
      to: "0xContractAddress",
      value: "100000000000000000",
      data: callData,
    },
  ],
};

See all 31 lines
​
ERC20 Contract Calls
Critical: When your contract call involves spending ERC20 tokens, you must include an approval transaction in your txs array. The approval must come before the actual contract call.
​
ERC20 Approval + Contract Call Pattern
JavaScript/ethers.js
JavaScript/viem
Python/web3.py
import { ethers } from "ethers";

// ERC20 ABI for approval
const erc20ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
];

// Contract ABI for the function you want to call
const contractABI = [
  "function purchaseWithUSDC(address to, uint256 usdcAmount) external",
];

// Encode approval transaction
const erc20Interface = new ethers.Interface(erc20ABI);
const approvalData = erc20Interface.encodeFunctionData("approve", [
  "0xContractAddress", // Contract that will spend tokens
  "1000000000", // Amount to approve (1000 USDC with 6 decimals)
]);

// Encode contract call transaction
const contractInterface = new ethers.Interface(contractABI);
const contractCallData = contractInterface.encodeFunctionData(
  "purchaseWithUSDC",
  [
    "0x742d35Cc6634C0532925a3b8D9d4DB0a2D7DD5B3", // recipient
    "1000000000", // 1000 USDC
  ]
);

const quoteRequest = {
  user: "0x742d35Cc6634C0532925a3b8D9d4DB0a2D7DD5B3",
  originChainId: 1,
  destinationChainId: 8453,
  originCurrency: "usdc",
  destinationCurrency: "usdc",
  amount: "1000000000", // Amount required for call (1000 USDC with 6 decimals)
  tradeType: "EXACT_OUTPUT",
  txs: [
    {
      to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC contract address
      value: "0",
      data: approvalData,
    },
    {
      to: "0xContractAddress",
      value: "0",
      data: contractCallData,
    },
  ],
};

See all 50 lines
​
Sweeping ERC20 Balance
Relay’s router contract has a useful function that you can call to transfer out full balance of an ERC20 token, even if you don’t know the full balance. There are currently two methods for doing this:
cleanupErc20s
cleanupNative
You can use these by passing in the txs field as follows:
{
  "to": "0xRouterContractAddress",
  "data": "0xEncodedCalldata", // encoded calldata for cleanupErc20s or cleanupNative
  "value": 0
}

​
ERC20 Troubleshooting Guide
Problem: “ERC20: transfer amount exceeds allowance” error Solution: Ensure you include the approval transaction before your contract call
Problem: Transaction reverts with “ERC20: insufficient allowance” Solution: Check that the approval amount is sufficient for your contract call
Problem: Approval transaction succeeds but contract call fails Solution: Verify the contract address in the approval matches the contract you’re calling
​
ERC20 Best Practices
Always approve before spending: Include approval as the first transaction
Use exact amounts: Approve the exact amount your contract will spend
Check token decimals: USDC uses 6 decimals, most others use 18
Verify contract addresses: Use the correct token contract for each chain
Handle allowances: Some tokens require setting allowance to 0 before setting a new amount
​
Quote Parameters for Cross-Chain Calls
Parameter	Type	Description
amount	string	Total value of all txs combined
tradeType	string	EXACT_INPUT (quote by input amount) or EXACT_OUTPUT (quote by required output)
txs	array	Array of transaction objects
txs[].to	string	Contract address to call
txs[].value	string	ETH value to send with call
txs[].data	string	Encoded function call data
You can learn more about quote request parameters and response data here.
2

Execute the Call

After receiving a call quote, execute it by processing each step in the response. The execution handles both the origin chain transaction and destination chain fulfillment.

Learn more about step execution using the API here.
3

Monitor Cross-Chain Call Status

Track the progress of your cross-chain call using the status endpoint:
Request
Response
curl "https://api.relay.link/intents/status/v3?requestId=0xed42e2e48c56b06f8f384d66d5f3e6c450fc3a2c7cba19d92a01a649a31a0e94"

Learn more about how to check the status of the fill here.
Learn more about the status lifecycle, see the status lifecycle diagram.
​
Preflight Checklist
 Contract compatibility - Before integrating cross-chain calls, ensure your contract is compatible with Relay. Review our Contract Compatibility overview to make any necessary changes to your smart contracts.
 ERC20 approvals - Include approval transactions before any ERC20 spending calls
 Verify transaction data - Confirm amount equals the sum of all txs[].value fields
 Check tradeType - Use "EXACT_OUTPUT" for a precise output, or "EXACT_INPUT" to cap spend
 Plan for EXACT_INPUT execution - Use a destination proxy contract that reads the delivered balance and builds follow-up calldata at runtime
 Validate call data - Ensure contract function calls are properly encoded
 Test contract calls - Verify contract functions work as expected on destination chain
 Gas estimation - Account for potential gas usage variations in contract calls
​
Common Use Cases
Below are some common use cases for cross-chain calls.
NFT Minting with ETH: Mint NFTs on L2s while paying from L1
NFT Minting with ERC20: Mint NFTs using USDC
DeFi Operations: Execute swaps, provide liquidity, or claim rewards on other chains
Gaming: Execute game actions, purchase items, or claim rewards across chains
NFT Minting with ETH
NFT Minting with ERC20
DeFi Operations
Gaming
// Mint NFT cross-chain with ETH
const mintTx = {
  to: "0xNFTContract",
  value: "50000000000000000", // 0.05 ETH mint price
  data: encodeFunctionData({
    abi: nftABI,
    functionName: "mint",
    args: [userAddress, tokenId],
  }),
};

​
See Also
Gasless Swaps: Find the right gasless approach for your app — permit-based, ERC-4337, or EIP-7702.
Smart Accounts: Enable fully gasless transactions where users hold zero native tokens, using EIP-7702 or ERC-4337.
Gasless Execution: Execute gasless transactions where the transaction signer and gas payer are different addresses.
App Fees: Monetize your integration by adding a fee (in bps) to every quote.
Fee Sponsorship: Sponsor fees for your users to reduce friction and improve the user experience.
Handling Errors: Handle quote errors when using the Relay API.
Cost & Fee Structure: Understand the fees associated with using the Relay API.

Was this page helpful?

Yes
No
Bridging Integration Guide
Transaction Indexing
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform