# Fee Sponsorship - Relay

Source: https://docs.relay.link/features/fee-sponsorship

On this page
What is Fee Sponsorship?
Requirements
Funding Your App Balance
Option 1: Use the Relay App UI
Option 2: Direct On-Chain Deposit
How It Works
Examples
Solver Address
TypeScript Example
Checking Your App Balance
Sponsoring Transactions
Required Header
Sponsorship Parameters
Example Request
How maxSubsidizationAmount Works
How subsidizationBps Works
Solana Fee Sponsorship
Understanding Solana Rent
Sponsoring Destination Rent with subsidizeRent
Example Request
Sponsoring Origin Deposits with depositFeePayer
Example Request
Solana Sponsorship Summary
What Fee Sponsorship Does Not Cover
Fees Object
Best Practices
Related Resources
Features
Fee Sponsorship
Copy page

Sponsor your users’ transaction fees to improve UX and reduce friction

​
What is Fee Sponsorship?
Fee Sponsorship allows you to cover the destination chain fees for your users’ Relay transactions. By sponsoring these fees, you can reduce costs for your users and create a more seamless experience. This is particularly valuable for onboarding new users or providing a premium experience for your application.
Fee sponsorship covers all destination chain fees (including gas topup amounts), but not the origin chain gas fee. Users will still need to pay the gas required to submit their transaction on the origin chain.
​
Requirements
Before you can sponsor transactions, you need:
An API key — Required to authenticate your sponsorship requests and associate them with your app balance. Create one in the Relay Dashboard; see API keys and Rate Limits for details.
A Fee Sponsorship Wallet — A wallet linked to your API key that funds your app balance. Link one from the App Balance page in the Relay Dashboard by signing a message to prove ownership — no gas required.
Sufficient App Balance — Your app balance must have enough funds to cover the fees you wish to sponsor.
Once you’re set up, you can begin depositing funds and sponsoring transactions.
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
Sponsoring Transactions
Once your app balance is funded, you can sponsor transactions by including specific parameters in your quote requests.
​
Required Header
Header	Type	Description
x-api-key	string	Your API key, required to authenticate sponsorship requests and associate them with your app balance.
​
Sponsorship Parameters
Add these parameters to your Get Quote API request:
Parameter	Type	Description
subsidizeFees	boolean	Set to true to have the sponsor pay for all fees associated with the request, including gas topup amounts.
maxSubsidizationAmount	string	(Optional) The maximum amount to subsidize in USDC with 6 decimal places (e.g., "1000000" = $1.00). If the total fees exceed this threshold, the sponsor pays up to the cap and the user pays the remainder.
subsidizationBps	integer	(Optional) The share of each selected fee bucket the sponsor covers, in basis points from 0 to 10000 (e.g., 10000 = 100%, 2500 = 25%). Requires subsidizeFees: true. Defaults to full coverage when omitted; the user pays the remainder. Applied per bucket before maxSubsidizationAmount, which still caps the sponsor’s total. Only supported on swap execution flows. See How subsidizationBps Works.
subsidizeRent	boolean	(Optional) Set to true to sponsor Solana ATA rent fees. Requires subsidizeFees to also be enabled. See Solana Fee Sponsorship.
depositFeePayer	string	(Optional) A Solana address to pay deposit transaction fees for Solana origin transactions. See Solana Fee Sponsorship.
sponsoredFeeComponents	string[]	(Optional) You can also choose to sponsor specific Relay fees for your users using the sponsoredFeeComponents parameter. This allows integrators to selectively cover different fee types (such as gas fees or relayer fees) while still collecting app fees.
Deposit addresses do not support sponsoredFeeComponents or subsidizationBps. maxSubsidizationAmount is supported by deposit addresses but if the amount exceeds the maximum the user pays all fees and nothing is subsidized.
​
Example Request
cURL
curl -X POST \
  'https://api.relay.link/quote' \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: your-api-key' \
  -d '{
    "user": "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd",
    "originChainId": 8453,
    "originCurrency": "0x0000000000000000000000000000000000000000",
    "destinationChainId": 10,
    "destinationCurrency": "0x0000000000000000000000000000000000000000",
    "tradeType": "EXACT_INPUT",
    "recipient": "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd",
    "amount": "100000000000000000",
    "subsidizeFees": true,
    "maxSubsidizationAmount": "5000000"
  }'

In this example:
x-api-key header authenticates your sponsorship request
subsidizeFees: true enables fee sponsorship
maxSubsidizationAmount: "5000000" caps sponsorship at $5.00 USDC
​
How maxSubsidizationAmount Works
The maxSubsidizationAmount parameter acts as a spending cap for fee sponsorship:
If the total fees are at or below this amount, the sponsor covers the full cost
If the total fees exceed this amount, the sponsor pays up to the cap and the user pays the remainder
This protects you from unexpectedly high costs during network congestion or volatile market conditions, while still providing partial sponsorship benefit to your users.
With partial fee sponsorship, users always receive some benefit from your sponsorship even when fees spike. For example, if you set a 
5.00
𝑐
𝑎
𝑝
𝑎
𝑛
𝑑
𝑓
𝑒
𝑒
𝑠
𝑡
𝑜
𝑡
𝑎
𝑙
5.00capandfeestotal7.00, you pay 
5.00
𝑎
𝑛
𝑑
𝑡
ℎ
𝑒
𝑢
𝑠
𝑒
𝑟
𝑝
𝑎
𝑦
𝑠
5.00andtheuserpays2.00.
Partial fee sponsorship is not supported for deposit addresses, if the fees exceed the maxSubsidizationAmount the user will cover the fees completely and nothing will be sponsored.
​
How subsidizationBps Works
The subsidizationBps parameter controls the share of each selected fee bucket the sponsor covers, expressed in basis points where 10000 equals 100%. Use it when you want to co-fund fees with your user at a fixed ratio instead of covering everything up to a USD cap.
10000 — the sponsor covers the full bucket (same as omitting the parameter).
Values between 0 and 10000 — the sponsor covers that share of each selected bucket, and the user pays the remainder.
0 — the sponsor covers nothing on selected buckets.
The share is applied to every bucket named in sponsoredFeeComponents (or every eligible bucket when sponsoredFeeComponents is omitted). Unselected buckets remain fully user-paid, as they would without a bps share.
Interaction with maxSubsidizationAmount. The bps share is applied to each bucket first, then the USD cap bounds the resulting sponsor total. maxSubsidizationAmount continues to limit the sponsor’s exposure even when a bps share is set — if the bps-scaled sponsored amount would exceed the cap, the sponsor still pays only up to the cap and the user pays the remainder.
Example. With sponsoredFeeComponents: ["execution", "swap"] and subsidizationBps: 5000, the sponsor covers 50% of the execution bucket and 50% of the swap bucket; the user pays the other 50% of each plus any unselected buckets. Adding maxSubsidizationAmount: "3000000" on top caps the sponsor’s total contribution at $3.00 regardless of the bps calculation.
subsidizationBps is currently supported only on swap execution flows. Bridge and deposit address flows return 400 when the field is set — use maxSubsidizationAmount for those flows instead.
Rounding is truncated per bucket, so the sponsor’s share is always at or below the requested percentage — any single-unit remainder is user-paid.
​
Solana Fee Sponsorship
Solana transactions involve unique cost structures that differ from EVM chains. In addition to standard transaction fees, Solana requires rent payments for creating new accounts, such as Associated Token Accounts (ATAs). Relay provides specific parameters to handle these costs.
​
Understanding Solana Rent
When a user receives a token on Solana for the first time, an Associated Token Account must be created to hold that token. This account creation requires a rent payment (approximately 0.002 SOL). Without sponsorship, this cost falls on the user.
​
Sponsoring Destination Rent with subsidizeRent
The subsidizeRent parameter allows you to sponsor the rent fees for ATA creation on Solana destination transactions.
Parameter	Type	Description
subsidizeRent	boolean	Set to true to have the sponsor pay for Solana rent fees associated with ATA creation on the destination chain.
The subsidizeRent parameter must be used in conjunction with subsidizeFees. There is currently no system for separating destination gas and rent fees. If you enable subsidizeRent without subsidizeFees, the rent will not be sponsored.
Important considerations:
When subsidizeFees is enabled but subsidizeRent is not, requests involving ATA creation will automatically fall back to user-paid fees. This is because rent sponsorship without explicit opt-in presents an exploitation vector.
The exploitation risk stems from the fact that users can close their ATA after the transaction completes and reclaim the rent. This effectively converts sponsored rent into a direct transfer of funds to the user.
Only enable subsidizeRent when you have a trusted relationship with your users or have implemented safeguards against abuse.
​
Example Request
cURL
curl -X POST \
  'https://api.relay.link/quote' \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: your-api-key' \
  -d '{
    "user": "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd",
    "originChainId": 8453,
    "originCurrency": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "destinationChainId": 792703809,
    "destinationCurrency": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "tradeType": "EXACT_INPUT",
    "recipient": "9aUn5swQzUTRanaaTwmszxiv89cvFwUCjEBv1vZCoT1u",
    "amount": "10000000",
    "subsidizeFees": true,
    "subsidizeRent": true,
    "maxSubsidizationAmount": "5000000"
  }'

In this example, a user bridges USDC from Base to Solana. Both subsidizeFees and subsidizeRent are enabled, ensuring the sponsor covers all destination fees including any ATA rent required for the recipient to receive USDC on Solana.
​
Sponsoring Origin Deposits with depositFeePayer
For transactions originating from Solana, you can designate an alternative account to pay the transaction fees and rent for the deposit transaction using depositFeePayer.
Parameter	Type	Description
depositFeePayer	string	A Solana address that will pay the transaction fees and rent for deposit transactions on Solana. This account must have sufficient SOL to cover these costs. Must be different from the user address.
The depositFeePayer parameter operates independently from the subsidizeFees and subsidizeRent parameters. It applies specifically to Solana origin transactions and does not draw from your app balance.
Important restrictions and security considerations for depositFeePayer:
The depositFeePayer and user addresses must be different. You cannot use the same wallet address for both parameters.
Signing order is critical. Relay returns a transaction that requires the integrator’s sponsoring wallet to sign first. The integrator must sign the transaction before passing it to the user. If the user receives an unsigned transaction, they could potentially modify it to drain the sponsoring wallet.
Avoid same-chain swaps with untrusted users. The depositFeePayer parameter is exploitable when used for same-chain swaps on Solana. Only use it for same-chain operations when the wallet is under your control.
When to use depositFeePayer:
When you want to provide a gasless experience for users depositing from Solana
When your application maintains a dedicated fee-paying wallet for Solana transactions
When you want to abstract away the complexity of SOL requirements from your users
​
Example Request
cURL
curl -X POST \
  'https://api.relay.link/quote' \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: your-api-key' \
  -d '{
    "user": "9aUn5swQzUTRanaaTwmszxiv89cvFwUCjEBv1vZCoT1u",
    "originChainId": 792703809,
    "originCurrency": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "destinationChainId": 8453,
    "destinationCurrency": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "tradeType": "EXACT_INPUT",
    "recipient": "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd",
    "amount": "10000000",
    "depositFeePayer": "YourFeePayerSolanaAddressHere"
  }'

In this example, a user bridges USDC from Solana to Base. The depositFeePayer address will cover the Solana transaction fees for the deposit, allowing the user to transact without holding SOL.
​
Solana Sponsorship Summary
Parameter	Direction	Funding Source	Use Case
subsidizeFees + subsidizeRent	To Solana (destination)	App Balance	Sponsor destination gas and ATA rent when users receive tokens on Solana
depositFeePayer	From Solana (origin)	Specified Solana wallet	Sponsor origin transaction fees when users deposit from Solana
​
What Fee Sponsorship Does Not Cover
Fee sponsorship is designed to cover relay and execution costs, but certain fees remain outside its scope:
Origin chain gas fees — Users must pay the gas required to submit their transaction on the origin chain (unless using depositFeePayer for Solana origins).
App fees — Fees configured via the appFees parameter are not deducted from your sponsor balance. These are separate charges that accrue to the specified recipient addresses.
First-time approval transactions when using usePermit — The initial approval transaction required for permit-based flows is not covered by fee sponsorship. However, all subsequent requests after the approval will be sponsored.
​
Fees Object
When you sponsor transactions, the quote response includes a fees object with a subsidized field showing the fees covered by your sponsorship:
{
  "fees": {
    "relayerService": "...",
    "relayerGas": "...",
    "relayer": "...",
    "app": "...",
    "subsidized": {
      "amount": "500000",
      "amountUsd": "0.50"
    }
  }
}

For more details on the fee structure, see Cost & Fee Structure.
​
Best Practices
Monitor Your Balance — Set up alerts or automated checks to ensure your app balance doesn’t run dry during high-traffic periods.
Use maxSubsidizationAmount — Always set a reasonable cap to protect against unexpected fee spikes.
Consider Auto-Topup — For production applications, consider implementing an auto-topup system using the direct onchain deposit method.
Track Sponsored Transactions — Use the Get Requests API to monitor your sponsored transaction history and costs.
​
Related Resources
App Fees — Learn how to collect fees from your users
Get App Fee Balances — API reference for checking balances
Get Quote — API reference for quote requests
Cost & Fee Structure — Understanding Relay’s fee structure
Solana Support — Guide to depositing and withdrawing on Solana

Was this page helpful?

Yes
No
App Fees
Deposit Addresses
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform