# RelayBridge - Relay

Source: https://docs.relay.link/references/protocol/vaults/contracts/RelayBridge

On this page
Solidity API
IRelayBridge
bridge
Parameters
Return Values
RelayBridge
BridgeTransaction
BridgingFailed
Parameters
InsufficientValue
Parameters
FailedFeeRefund
Parameters
transferNonce
ASSET
BRIDGE_PROXY
HYPERLANE_MAILBOX
BridgeInitiated
Parameters
BridgeExecuted
Parameters
BridgeCancelled
Parameters
constructor
Parameters
getFee
Parameters
Return Values
bridge
Parameters
Return Values
Contracts Reference
RelayBridge
Copy page
​
Solidity API
​
IRelayBridge
Interface for the RelayBridge contract
Defines the bridge function for cross-chain asset transfers
​
bridge
function bridge(uint256 amount, address recipient, address poolAsset, uint256 poolGas, bytes extraData) external payable returns (uint256 nonce)

Bridges an asset (ERC20 token or native currency) from the origin chain to a pool chain
​
Parameters
Name	Type	Description
amount	uint256	Amount of asset units to bridge (ERC20 tokens or native currency)
recipient	address	Address on the pool chain to receive the bridged asset
poolAsset	address	Address of the asset on the pool chain to bridge to
poolGas	uint256	Gas limit for the pool chain transaction
extraData	bytes	Extra data passed to the bridge proxy
​
Return Values
Name	Type	Description
nonce	uint256	Unique identifier for this bridge transaction
​
RelayBridge
RelayBridge contract enabling cross-chain bridging via Hyperlane
Bridges assets from an origin chain to a configured pool chain
​
BridgeTransaction
Internal struct capturing parameters for a bridge transaction
struct BridgeTransaction {
  uint256 amount;
  address recipient;
  address poolAsset;
  uint256 poolGas;
  bytes extraData;
  uint256 nonce;
  bytes txParams;
  uint32 poolChainId;
  bytes32 poolId;
}

​
BridgingFailed
error BridgingFailed(uint256 nonce)

Error for failed bridging operations
​
Parameters
Name	Type	Description
nonce	uint256	The nonce of the failed transaction
​
InsufficientValue
error InsufficientValue(uint256 received, uint256 expected)

Error for insufficient native value sent to cover fees or asset
​
Parameters
Name	Type	Description
received	uint256	The amount of native currency received
expected	uint256	The amount of native currency expected
​
FailedFeeRefund
error FailedFeeRefund(uint256 value)

Error when refunding leftover native value fails
​
Parameters
Name	Type	Description
value	uint256	The amount of native currency that failed to refund
​
transferNonce
uint256 transferNonce

Counter for assigning unique nonces to bridge transactions
Incremented with each bridge transaction to ensure uniqueness
​
ASSET
address ASSET

Asset address on the origin chain being bridged (address(0) for native currency)
Immutable to ensure the bridge always handles the same asset
​
BRIDGE_PROXY
contract BridgeProxy BRIDGE_PROXY

BridgeProxy contract handling origin-chain transfer logic
Uses delegatecall to execute custom bridge logic
​
HYPERLANE_MAILBOX
address HYPERLANE_MAILBOX

Hyperlane Mailbox contract for cross-chain messaging
Used to dispatch messages to the pool chain
​
BridgeInitiated
event BridgeInitiated(uint256 nonce, address sender, address recipient, address ASSET, address poolAsset, uint256 amount, contract BridgeProxy BRIDGE_PROXY)

Emitted when a bridge transaction is initiated on the origin chain
​
Parameters
Name	Type	Description
nonce	uint256	Nonce of the transaction
sender	address	Address on the origin chain that initiated the bridge
recipient	address	Address on the pool chain to receive assets
ASSET	address	Asset address on the origin chain (address(0) for native currency)
poolAsset	address	Asset address on the pool chain (address(0) for native currency)
amount	uint256	Amount of asset units bridged
BRIDGE_PROXY	contract BridgeProxy	BridgeProxy used
​
BridgeExecuted
event BridgeExecuted(uint256 nonce)

Emitted after a bridge transaction is executed on the pool chain
This event would be emitted by the pool chain contract
​
Parameters
Name	Type	Description
nonce	uint256	Nonce of the executed transaction
​
BridgeCancelled
event BridgeCancelled(uint256 nonce)

Emitted if a bridge transaction is cancelled prior to execution
This event would be emitted if a bridge is cancelled
​
Parameters
Name	Type	Description
nonce	uint256	Nonce of the cancelled transaction
​
constructor
constructor(address asset, contract BridgeProxy bridgeProxy, address hyperlaneMailbox) public

Initializes the RelayBridge with asset and infrastructure contracts
All parameters are immutable after deployment
​
Parameters
Name	Type	Description
asset	address	Asset address on the origin chain to bridge (0 for native currency)
bridgeProxy	contract BridgeProxy	BridgeProxy contract for origin-chain transfers
hyperlaneMailbox	address	Hyperlane Mailbox address for messaging
​
getFee
function getFee(uint256 amount, address recipient, uint256 poolGas) external view returns (uint256 fee)

Calculates the fee required in native currency to dispatch a cross-chain message
Uses Hyperlane’s quoteDispatch to estimate the cross-chain messaging fee
​
Parameters
Name	Type	Description
amount	uint256	Amount of asset units to bridge
recipient	address	Address on the pool chain that will receive the bridged asset
poolGas	uint256	Gas limit for the pool chain transaction
​
Return Values
Name	Type	Description
fee	uint256	Required fee in native currency for dispatch
​
bridge
function bridge(uint256 amount, address recipient, address poolAsset, uint256 poolGas, bytes extraData) external payable returns (uint256 nonce)

Bridges an asset (ERC20 token or native currency) from the origin chain to a pool chain
_Executes a cross-chain bridge transaction with the following steps:
Validates sufficient payment for fees (and asset amount if native)
Transfers the asset from sender to this contract (if ERC20)
Executes bridge logic via delegatecall to BRIDGE_PROXY
Dispatches cross-chain message via Hyperlane
Refunds any excess native currency to sender_
​
Parameters
Name	Type	Description
amount	uint256	Amount of asset units to bridge (ERC20 tokens or native currency)
recipient	address	Address on the pool chain to receive the bridged asset
poolAsset	address	Address of the asset on the pool chain to bridge to
poolGas	uint256	Gas limit for the pool chain transaction
extraData	bytes	Extra data passed to the bridge proxy
​
Return Values
Name	Type	Description
nonce	uint256	Unique identifier for this bridge transaction

Was this page helpful?

Yes
No
RelayBridgeFactory
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform