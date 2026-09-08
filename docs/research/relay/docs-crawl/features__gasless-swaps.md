# Gasless Swaps - Relay

Source: https://docs.relay.link/features/gasless-swaps

On this page
What solution is right for me?
Permit-based Gasless
How it works
Fees
ERC-4337 Gasless
originGasOverhead
How it works
Fees
7702 BatchExecutor
originGasOverhead
How it works
Fees
Features
Gasless Swaps
Copy page

Remove gas friction from swaps so users only pay with the input token

Gas fees add layers of complexity to swapping. Holding the native token, on the right network, at the right time to pay for gas adds friction for users. A gasless swap means that the user only pays with the input token, and this covers all fees. This means someone else is executing the transaction and paying the gas.
​
What solution is right for me?
There are many different solutions when it comes to implementing a gasless swap experience. We’ve put together a decision tree below to help you arrive at the solution that best fits your application.

No — BYO wallet

Yes — embedded or custodial

Yes

No

Which gasless flow should I use?

Does your app control
the user's wallet?

**Permit-based Gasless**

_Limitation: not all ERC-20s support permit_

Are you already
using ERC-4337?

**ERC-4337 Gasless**

**7702 BatchExecutor**

Same-chain gasless swaps are only supported if you sponsor the fees. Same-chain swaps route directly through DEXes, due to this the solver never has an opportunity to deduct the gas fees before the user gets the destination token.
​
Permit-based Gasless
Use this approach when your app does not control the user’s wallet (e.g. MetaMask, Rainbow, or any external EOA). The user signs an off-chain EIP-3009 or Permit2 message, and Relay’s solver handles everything else — no approval transaction, no gas.
USDC is fully gasless. Other ERC20 tokens require a one-time approval transaction.
​
How it works
1

Get a quote

Call /quote/v2 with usePermit: true
2

Sign the permit

Prompt the user to sign an EIP-712 typed-data permit message (off-chain, no gas)
3

Submit to Relay

Submit the signed permit to Relay
4

Fulfillment

Relay’s solver withdraws tokens from the user’s EOA and fulfills the destination transaction
​
Fees
You can choose to subsidize all destination fees by passing subsidizeFees: true to the quote api (this effectively subsidizes the first time approval). The user still needs to pay for the origin gas fee. For subsidizing fees you’ll need to make sure you have fee sponsorship set up.
See the full working example:  byo-eoa-permit
​
ERC-4337 Gasless
Use this approach if your app already uses ERC-4337 smart accounts. ERC-4337 UserOperations normally require gas fees, either paid by the sender or a paymaster. With Relay, you set all gas fee fields to 0 and submit the handleOps call via Relay’s /execute endpoint instead of directly to the EntryPoint. Relay’s relayer submits the transaction and covers the gas.
​
originGasOverhead
Pass originGasOverhead: 300000 in the /quote/v2 request. This tells Relay how much additional gas the UserOperation adds over a normal EOA transaction, used during simulation to accurately price the fee.
​
How it works
1

Get a quote

Call /quote/v2 with originGasOverhead: 300000 to get deposit transaction details
2

Build the UserOperation

Build a UserOperation that batches approve + deposit calls via executeBatch
3

Zero out gas fields

Set maxFeePerGas and maxPriorityFeePerGas to 0
4

Sign the UserOperation

Sign the UserOperation with the account owner key
5

Submit via Relay

Encode an EntryPoint.handleOps() call and submit it via POST /execute with subsidizeFees: true
6

Monitor

Poll /intents/status/v3 until the bridge completes
​
Fees
You can choose to subsidize origin fees: pass subsidizeFees: true to the execute api executionOptions.
You can choose to subsidize destination fees: pass subsidizeFees: true to the quote api.
You can choose to subsidize both or none of these. If not subsidized the user pays from the output token.
For subsidizing fees you’ll need to make sure you have fee sponsorship set up.
See the full working example:  4337-gasless
​
7702 BatchExecutor
Use this approach when your app controls an embedded or custodial wallet and you want gasless execution with any ERC-20 token — not just permit-compatible ones. This leverages EIP-7702 to delegate the user’s EOA to a BatchExecutor contract (Calibur or similar), enabling atomic approve + deposit in a single call.
​
originGasOverhead
Pass originGasOverhead: 80000 in the /quote/v2 request. This tells Relay how much additional gas the Calibur execute() wrapper adds over the raw inner calls (EIP-712 signature verification, batch dispatch, nonce check). This is lower than ERC-4337’s 300000 because there’s no EntryPoint or UserOp validation overhead.
The 80000 value is specific to Calibur. Different BatchExecutor contracts may have different gas overheads — adjust this value based on the implementation you use.
​
How it works
1

Check delegation

Check if the user’s EOA is already delegated to the BatchExecutor via EIP-7702
2

Get a quote

Call /quote/v2 with originGasOverhead: 80000 to get deposit transaction details
3

Build the batch

Build a BatchedCall that atomically combines approve() and deposit()
4

Sign the authorization

Sign an EIP-7702 authorization (off-chain, no gas) delegating the EOA to the BatchExecutor
5

Submit via Relay

Submit via POST /execute targeting the user’s EOA
​
Fees
You can choose to subsidize origin fees: pass subsidizeFees: true to the execute api executionOptions.
You can choose to subsidize destination fees: pass subsidizeFees: true to the quote api.
You can choose to subsidize both or none of these. If not subsidized the user pays from the output token.
For subsidizing fees you’ll need to make sure you have fee sponsorship set up.
See the full working example:  7702-batch-executor

Was this page helpful?

Yes
No
Fast Fill
Price Stabilization
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform