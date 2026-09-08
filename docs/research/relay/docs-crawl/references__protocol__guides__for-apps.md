# For Apps - Relay

Source: https://docs.relay.link/references/protocol/guides/for-apps

On this page
Overview
orderId vs. requestId
Protocol Deposits via the API
Tracing an Order
1. Deposit Transaction
2. Settlement on Relay Chain
Example: deriving a Hub order address
3. Fill Transaction
When to Use Direct Protocol Integration
Guides
For Apps
Copy page

How application integrators interact with the settlement protocol

​
Overview
Application developers typically interact with Relay through the Relay API, which abstracts the settlement protocol entirely. However, understanding the protocol flow can help when debugging transactions or building advanced integrations.
This page explains how the protocol surfaces in API responses and how to trace an order through the settlement flow.
​
orderId vs. requestId
Every Relay request has two identifiers, and they serve different purposes.
The requestId is the Relay-level intent identifier. It covers the overall intent — including any origin or destination swaps — and is what most of the API works in: the quote api returns it as steps[].requestId, and status polling, webhooks, and the requests api all key off it. It is not derivable from on-chain data alone.
The orderId is the protocol-level deposit identifier. It is the bytes32 id argument the Depository receives in depositNative / depositErc20 (EVM) and deposit_native / deposit_token (Solana), and it is emitted in the matching deposit event. You can read it directly from on-chain data without an API call, which makes it the right identifier for indexers and merchant-style flows that react to deposits before talking to the Relay API.
If you only have an orderId from on-chain data, look it up via the requests api to find the corresponding Relay request and its requestId.
​
Protocol Deposits via the API
When requesting a quote using the Relay quote api, the response includes a protocol field when the order will be settled through the Relay Settlement protocol:
{
  "steps": [...],
  "protocol": {
    "orderId": "0x1234...abcd",
    "depositChainId": 10,
    "paymentDetails": {
      "recipient": "0xDepositoryAddress...",
      "amount": "1000000",
      "token": "0xUSDCAddress..."
    }
  }
}

The key fields:
orderId — A unique identifier for this order, used to track it through the settlement flow
depositChainId — The chain where the user’s deposit will go
paymentDetails — The Depository address, token, and amount for the deposit
The protocol field only appears when the order uses the settlement protocol. Some routes may use alternative execution paths.
​
Tracing an Order
Once an order is submitted, you can trace it through the settlement flow:
​
1. Deposit Transaction
The user’s deposit transaction is a standard transfer to the Depository contract on the origin chain. You can find it on the origin chain’s block explorer, and you can also read the orderId directly from the deposit transaction without calling the Relay API.
EVM chains — the Depository emits one of two events on every deposit:
event RelayNativeDeposit(address from, uint256 amount, bytes32 id)
event RelayErc20Deposit(address from, address token, uint256 amount, bytes32 id)

Neither event indexes its arguments, so id is read from the log’s data field. The same event fires whether the depositor called the Depository directly or routed through a Relay router (e.g. ERC20Router, Multicaller), making event parsing the universal path. See Contracts Addresses for the Depository address on every supported chain.
Solana — the Depository program encodes the id directly in the instruction data passed to deposit_native / deposit_token. See Contracts Addresses for the program ID. The layout is:
Offset (bytes)	Length	Field
0	8	Anchor discriminator
8	8	amount (u64, little-endian)
16	32	id ([u8; 32])
​
2. Settlement on Relay Chain
After the solver fills the order, the Oracle attests the deposit and fill on the Relay Chain. These attestation transactions are visible on the Relay Chain Explorer.
For application debugging, treat the orderId as the stable correlation key across the whole lifecycle:
Use paymentDetails.recipient and depositChainId to find the origin-chain deposit transaction
Use your destination-chain execution transaction to confirm the solver fill
Use the Relay Chain attestation submitted after the fill to confirm settlement
If you need to trace the Hub’s internal order address directly, note that it is not derived from orderId alone. The settlement SDK derives it from:
chainId as a string
depositor encoded for its VM type
timestamp
depositId
The formula used in the settlement SDK is:
const hash = keccak256(
  encodePacked(
    ["string", "bytes", "uint256", "bytes32"],
    [chainId, encodeAddress(depositor, vmType), timestamp, depositId]
  )
)

const orderAddress = `0x${hash.slice(2).slice(-40)}`

In practice, most app integrators should only rely on this if they already have the full deposit parameters. If you only have orderId, use it as a correlation identifier rather than assuming it can be converted directly into the Hub order address.
​
Example: deriving a Hub order address
For the Relay request 0xd5695a549c7e71a3258f9c07a659231d4852513d7da6e30f0c93079cf4569753, the origin deposit is the Arbitrum transaction 0x693af85007932519865beed409b039ea85a8fe499fa97c537f3bbb264826554c.
The deposit parameters used by the Oracle are:
chainId = "42161"
depositor = "0x710227b881611b30ee794aa63a7da7086888f3c8"
timestamp = 1773954184
depositId = 0xcc7ec6bbf43d40717e5556fa50b232d866ade6c9a3c654434b1124322fbcf414
The depositId above comes from the trailing 32 bytes of the ERC20 transfer calldata into the Depository. For a transaction with a single standard ERC20 transfer into the Depository, this is the same value the Oracle indexes as the deposit id.
Using the settlement SDK formula yields the Hub order address:
const orderAddress = "0xab73c17f93668cda196db73334e5f1f2ba08257a"

You can inspect that balance owner on the Relay Chain Explorer here:
Relay Chain order address: 0xab73c17f93668cda196db73334e5f1f2ba08257a
​
3. Fill Transaction
The solver’s fill transaction is on the destination chain. This is the transaction that delivers the user’s requested action (transfer, swap, etc.).
​
When to Use Direct Protocol Integration
Most applications should use the Relay API. Consider direct protocol integration only if you need to:
Build custom deposit flows outside the standard API
Monitor settlement status at the protocol level
Implement custom order management
For direct integration details, see the Depository component documentation and contract references:
EVM Depository Reference
SVM Depository Reference

Was this page helpful?

Yes
No
For Solvers
Withdrawals
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform