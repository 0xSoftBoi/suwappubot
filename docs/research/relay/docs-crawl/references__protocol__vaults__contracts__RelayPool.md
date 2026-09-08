# RelayPool - Relay

Source: https://docs.relay.link/references/protocol/vaults/contracts/RelayPool

On this page
Solidity API
RelayPool
OriginSettings
Parameters
OriginParam
Parameters
UnauthorizedCaller
Parameters
UnauthorizedSwap
Parameters
UnauthorizedOrigin
Parameters
MessageAlreadyProcessed
Parameters
TooMuchDebtFromOrigin
Parameters
FailedTransfer
Parameters
InsufficientFunds
Parameters
NotAWethPool
MessageTooRecent
Parameters
SharePriceTooLow
Parameters
SharePriceTooHigh
Parameters
HYPERLANE_MAILBOX
WETH
FRACTIONAL_BPS_DENOMINATOR
outstandingDebt
authorizedOrigins
messages
yieldPool
tokenSwapAddress
pendingBridgeFees
totalAssetsToStream
lastAssetsCollectedAt
endOfStream
streamingPeriod
LoanEmitted
Parameters
BridgeCompleted
Parameters
OutstandingDebtChanged
Parameters
AssetsDepositedIntoYieldPool
Parameters
AssetsWithdrawnFromYieldPool
Parameters
TokenSwapChanged
Parameters
YieldPoolChanged
Parameters
StreamingPeriodChanged
Parameters
OriginAdded
Parameters
OriginDisabled
Parameters
constructor
Parameters
updateStreamingPeriod
Parameters
updateYieldPool
Parameters
addOrigin
Parameters
disableOrigin
Parameters
increaseOutstandingDebt
Parameters
decreaseOutstandingDebt
Parameters
maxDeposit
Parameters
Return Values
maxWithdraw
Parameters
Return Values
maxMint
Parameters
Return Values
maxRedeem
Parameters
Return Values
totalAssets
Return Values
depositAssetsInYieldPool
Parameters
withdrawAssetsFromYieldPool
Parameters
handle
Parameters
remainsToStream
Return Values
updateStreamedAssets
Return Values
addToStreamingAssets
Parameters
Return Values
claim
Parameters
Return Values
sendFunds
Parameters
setTokenSwap
Parameters
swapAndDeposit
Parameters
collectNonDepositedAssets
beforeWithdraw
Parameters
afterDeposit
Parameters
processFailedHandler
Parameters
receive
Contracts Reference
RelayPool
Copy page
​
Solidity API
​
RelayPool
ERC4626 vault that enables cross-chain asset bridging and yield generation
Receives bridged assets via Hyperlane, provides instant liquidity, and deposits idle funds into yield pools
​
OriginSettings
Configuration for an authorized origin chain and bridge
​
Parameters
Name	Type	Description
struct OriginSettings {
  uint32 chainId;
  address bridge;
  address curator;
  uint256 maxDebt;
  uint256 outstandingDebt;
  address proxyBridge;
  uint32 bridgeFee;
  uint32 coolDown;
}

​
OriginParam
Parameters for adding a new origin
​
Parameters
Name	Type	Description
struct OriginParam {
  address curator;
  uint32 chainId;
  address bridge;
  address proxyBridge;
  uint256 maxDebt;
  uint32 bridgeFee;
  uint32 coolDown;
}

​
UnauthorizedCaller
error UnauthorizedCaller(address sender)

Error when caller is not authorized for the operation
​
Parameters
Name	Type	Description
sender	address	The address that attempted the unauthorized call
​
UnauthorizedSwap
error UnauthorizedSwap(address token)

Error when attempting to swap the pool’s underlying asset
​
Parameters
Name	Type	Description
token	address	The token address that was attempted to be swapped
​
UnauthorizedOrigin
error UnauthorizedOrigin(uint32 chainId, address bridge)

Error when message is from an unauthorized origin
​
Parameters
Name	Type	Description
chainId	uint32	The chain ID of the unauthorized origin
bridge	address	The bridge address of the unauthorized origin
​
MessageAlreadyProcessed
error MessageAlreadyProcessed(uint32 chainId, address bridge, uint256 nonce)

Error when attempting to process an already processed message
​
Parameters
Name	Type	Description
chainId	uint32	The chain ID of the message origin
bridge	address	The bridge address of the message origin
nonce	uint256	The nonce of the already processed message
​
TooMuchDebtFromOrigin
error TooMuchDebtFromOrigin(uint32 chainId, address bridge, uint256 maxDebt, uint256 nonce, address recipient, uint256 amount)

Error when origin would exceed its maximum allowed debt
​
Parameters
Name	Type	Description
chainId	uint32	The chain ID of the origin
bridge	address	The bridge address of the origin
maxDebt	uint256	The maximum allowed debt for this origin
nonce	uint256	The nonce of the rejected transaction
recipient	address	The intended recipient of the funds
amount	uint256	The amount that would exceed the debt limit
​
FailedTransfer
error FailedTransfer(address recipient, uint256 amount)

Error when native currency transfer fails
​
Parameters
Name	Type	Description
recipient	address	The intended recipient of the transfer
amount	uint256	The amount that failed to transfer
​
InsufficientFunds
error InsufficientFunds(uint256 amount, uint256 balance)

Error when insufficient funds are available
​
Parameters
Name	Type	Description
amount	uint256	The amount available
balance	uint256	The balance required
​
NotAWethPool
error NotAWethPool()

Error when native currency is sent to a non-WETH pool
​
MessageTooRecent
error MessageTooRecent(uint32 chainId, address bridge, uint256 nonce, uint256 timestamp, uint32 coolDown)

Error when message timestamp is too recent based on cooldown period
​
Parameters
Name	Type	Description
chainId	uint32	The chain ID of the message origin
bridge	address	The bridge address of the message origin
nonce	uint256	The nonce of the message
timestamp	uint256	The timestamp of the message
coolDown	uint32	The required cooldown period
​
SharePriceTooLow
error SharePriceTooLow(uint256 actualPrice, uint256 minPrice)

Error when share price is below minimum acceptable threshold
​
Parameters
Name	Type	Description
actualPrice	uint256	The actual share price
minPrice	uint256	The minimum acceptable share price
​
SharePriceTooHigh
error SharePriceTooHigh(uint256 actualPrice, uint256 maxPrice)

Error when share price is above maximum acceptable threshold
​
Parameters
Name	Type	Description
actualPrice	uint256	The actual share price
maxPrice	uint256	The maximum acceptable share price
​
HYPERLANE_MAILBOX
address HYPERLANE_MAILBOX

The address of the Hyperlane mailbox
Used to receive cross-chain messages
​
WETH
address WETH

The address of the WETH contract (used for native pools)
Set to WETH address for native currency pools, otherwise can be address(0)
​
FRACTIONAL_BPS_DENOMINATOR
uint256 FRACTIONAL_BPS_DENOMINATOR

Denominator for fractional basis points calculations (1 = 0.0000001 bps)
​
outstandingDebt
uint256 outstandingDebt

Keeping track of the outstanding debt for ERC4626 computations
Represents funds that have been sent but not yet claimed from bridges
​
authorizedOrigins
mapping(uint32 => mapping(address => struct RelayPool.OriginSettings)) authorizedOrigins

Mapping of origins to their settings
[chainId][bridgeAddress] => OriginSettings
​
messages
mapping(uint32 => mapping(address => mapping(uint256 => bytes))) messages

Mapping of messages by origin
[chainId][bridgeAddress][nonce] => message data
​
yieldPool
address yieldPool

The address of the yield pool where funds are deposited
Must be an ERC4626 vault for the same underlying asset
​
tokenSwapAddress
address tokenSwapAddress

UniswapV3 wrapper contract for token swaps
​
pendingBridgeFees
uint256 pendingBridgeFees

Keeping track of the total fees collected
Fees are held in the yield pool until they finish streaming
​
totalAssetsToStream
uint256 totalAssetsToStream

All incoming assets are streamed (even though they are instantly deposited in the yield pool)
Total amount of assets currently being streamed
​
lastAssetsCollectedAt
uint256 lastAssetsCollectedAt

Timestamp when assets were last collected for streaming
​
endOfStream
uint256 endOfStream

Timestamp when current streaming period ends
​
streamingPeriod
uint256 streamingPeriod

Duration over which collected assets are streamed
​
LoanEmitted
event LoanEmitted(uint256 nonce, address recipient, contract ERC20 asset, uint256 amount, struct RelayPool.OriginSettings origin, uint256 fees)

Emitted when a loan is provided to a bridge recipient
​
Parameters
Name	Type	Description
nonce	uint256	The unique identifier of the transaction
recipient	address	The address receiving the funds
asset	contract ERC20	The asset being transferred
amount	uint256	The total amount including fees
origin	struct RelayPool.OriginSettings	The origin settings for this bridge
fees	uint256	The fee amount collected
​
BridgeCompleted
event BridgeCompleted(uint32 chainId, address bridge, uint256 amount, uint256 fees)

Emitted when bridged funds are claimed and deposited
​
Parameters
Name	Type	Description
chainId	uint32	The chain ID of the bridge origin
bridge	address	The bridge address on the origin chain
amount	uint256	The total amount claimed
fees	uint256	The fee amount collected
​
OutstandingDebtChanged
event OutstandingDebtChanged(uint256 oldDebt, uint256 newDebt, struct RelayPool.OriginSettings origin, uint256 oldOriginDebt, uint256 newOriginDebt)

Emitted when outstanding debt changes
​
Parameters
Name	Type	Description
oldDebt	uint256	Previous total outstanding debt
newDebt	uint256	New total outstanding debt
origin	struct RelayPool.OriginSettings	The origin settings involved
oldOriginDebt	uint256	Previous outstanding debt for the origin
newOriginDebt	uint256	New outstanding debt for the origin
​
AssetsDepositedIntoYieldPool
event AssetsDepositedIntoYieldPool(uint256 amount, address yieldPool)

Emitted when assets are deposited into the yield pool
​
Parameters
Name	Type	Description
amount	uint256	The amount deposited
yieldPool	address	The yield pool address
​
AssetsWithdrawnFromYieldPool
event AssetsWithdrawnFromYieldPool(uint256 amount, address yieldPool)

Emitted when assets are withdrawn from the yield pool
​
Parameters
Name	Type	Description
amount	uint256	The amount withdrawn
yieldPool	address	The yield pool address
​
TokenSwapChanged
event TokenSwapChanged(address prevAddress, address newAddress)

Emitted when the token swap address is changed
​
Parameters
Name	Type	Description
prevAddress	address	The previous swap contract address
newAddress	address	The new swap contract address
​
YieldPoolChanged
event YieldPoolChanged(address oldPool, address newPool)

Emitted when the yield pool is changed
​
Parameters
Name	Type	Description
oldPool	address	The previous yield pool address
newPool	address	The new yield pool address
​
StreamingPeriodChanged
event StreamingPeriodChanged(uint256 oldPeriod, uint256 newPeriod)

Emitted when the streaming period is changed
​
Parameters
Name	Type	Description
oldPeriod	uint256	The previous streaming period
newPeriod	uint256	The new streaming period
​
OriginAdded
event OriginAdded(struct RelayPool.OriginParam origin)

Emitted when a new origin is added
​
Parameters
Name	Type	Description
origin	struct RelayPool.OriginParam	The origin parameters
​
OriginDisabled
event OriginDisabled(uint32 chainId, address bridge, uint256 maxDebt, uint256 outstandingDebt, address proxyBridge)

Emitted when an origin is disabled
​
Parameters
Name	Type	Description
chainId	uint32	The chain ID of the disabled origin
bridge	address	The bridge address of the disabled origin
maxDebt	uint256	The previous maximum debt limit
outstandingDebt	uint256	The outstanding debt at time of disabling
proxyBridge	address	The proxy bridge address
​
constructor
constructor(address hyperlaneMailbox, contract ERC20 asset, string name, string symbol, address baseYieldPool, address weth, address curator) public

Initializes the RelayPool with core parameters
Warning: the owner should always be a timelock with significant delay
​
Parameters
Name	Type	Description
hyperlaneMailbox	address	The Hyperlane mailbox contract address
asset	contract ERC20	The underlying asset for this vault
name	string	The name of the vault token
symbol	string	The symbol of the vault token
baseYieldPool	address	The initial yield pool for depositing assets
weth	address	The WETH contract address (for native currency pools)
curator	address	The address that will own the pool after deployment
​
updateStreamingPeriod
function updateStreamingPeriod(uint256 newPeriod) public

Updates the streaming period for fee accrual
Updates streamed assets before changing the period
​
Parameters
Name	Type	Description
newPeriod	uint256	The new streaming period in seconds
​
updateYieldPool
function updateYieldPool(address newPool, uint256 minSharePriceFromOldPool, uint256 maxSharePricePriceFromNewPool) public

Updates the yield pool, moving all assets from the old pool to the new one
Implements share price-based slippage protection to ensure fair value transfer
​
Parameters
Name	Type	Description
newPool	address	The address of the new yield pool
minSharePriceFromOldPool	uint256	The minimum acceptable share price when withdrawing from the old pool
maxSharePricePriceFromNewPool	uint256	The maximum acceptable share price when depositing into the new pool
​
addOrigin
function addOrigin(struct RelayPool.OriginParam origin) public

Adds a new authorized origin for bridging
Only callable by owner, typically a timelock contract
​
Parameters
Name	Type	Description
origin	struct RelayPool.OriginParam	The origin parameters including chain ID, addresses, and limits
​
disableOrigin
function disableOrigin(uint32 chainId, address bridge) public

Disables an origin by setting its max debt to zero
Only callable by the origin’s curator for emergency response
​
Parameters
Name	Type	Description
chainId	uint32	The chain ID of the origin to disable
bridge	address	The bridge address of the origin to disable
​
increaseOutstandingDebt
function increaseOutstandingDebt(uint256 amount, struct RelayPool.OriginSettings origin) internal

Increases outstanding debt for an origin
Updates both origin-specific and total outstanding debt
​
Parameters
Name	Type	Description
amount	uint256	The amount to increase debt by
origin	struct RelayPool.OriginSettings	The origin settings to update
​
decreaseOutstandingDebt
function decreaseOutstandingDebt(uint256 amount, struct RelayPool.OriginSettings origin) internal

Decreases outstanding debt for an origin
Updates both origin-specific and total outstanding debt
​
Parameters
Name	Type	Description
amount	uint256	The amount to decrease debt by
origin	struct RelayPool.OriginSettings	The origin settings to update
​
maxDeposit
function maxDeposit(address) public view returns (uint256 maxAssets)

Returns the maximum assets that can be deposited
Limited by the yield pool’s capacity
​
Parameters
Name	Type	Description
	address	
​
Return Values
Name	Type	Description
maxAssets	uint256	The maximum amount of assets that can be deposited
​
maxWithdraw
function maxWithdraw(address owner) public view returns (uint256 maxAssets)

Returns the maximum assets that can be withdrawn by an owner
Limited to the owner’s share balance converted to assets
​
Parameters
Name	Type	Description
owner	address	The address to check withdrawal capacity for
​
Return Values
Name	Type	Description
maxAssets	uint256	The maximum amount of assets that can be withdrawn
​
maxMint
function maxMint(address receiver) public view returns (uint256 maxShares)

Returns the maximum shares that can be minted
Limited by the yield pool’s deposit capacity
​
Parameters
Name	Type	Description
receiver	address	The address that would receive the shares
​
Return Values
Name	Type	Description
maxShares	uint256	The maximum amount of shares that can be minted
​
maxRedeem
function maxRedeem(address owner) public view returns (uint256 maxShares)

Returns the maximum shares that can be redeemed by an owner
Limited by the owner’s share balance and yield pool’s withdrawal capacity
​
Parameters
Name	Type	Description
owner	address	The address to check redemption capacity for
​
Return Values
Name	Type	Description
maxShares	uint256	The maximum amount of shares that can be redeemed
​
totalAssets
function totalAssets() public view returns (uint256)

Returns the total assets controlled by the pool
Includes yield pool balance, outstanding debt, minus pending fees and streaming assets
​
Return Values
Name	Type	Description
[0]	uint256	The total assets under management
​
depositAssetsInYieldPool
function depositAssetsInYieldPool(uint256 amount) internal

Deposits assets into the yield pool
Internal function that approves and deposits to yield pool
​
Parameters
Name	Type	Description
amount	uint256	The amount of assets to deposit
​
withdrawAssetsFromYieldPool
function withdrawAssetsFromYieldPool(uint256 amount, address recipient) internal

Withdraws assets from the yield pool
Internal function that withdraws from yield pool to recipient
​
Parameters
Name	Type	Description
amount	uint256	The amount of assets to withdraw
recipient	address	The address to receive the withdrawn assets
​
handle
function handle(uint32 chainId, bytes32 bridgeAddress, bytes data) external payable

Handles incoming cross-chain messages from Hyperlane
Only callable by Hyperlane mailbox, provides instant liquidity to recipients
​
Parameters
Name	Type	Description
chainId	uint32	The origin chain ID
bridgeAddress	bytes32	The origin bridge address (as bytes32)
data	bytes	The encoded message data
​
remainsToStream
function remainsToStream() internal view returns (uint256)

Calculates remaining assets to be streamed
Returns zero if streaming period has ended
​
Return Values
Name	Type	Description
[0]	uint256	The amount of assets remaining to be streamed
​
updateStreamedAssets
function updateStreamedAssets() public returns (uint256)

Updates the streamed assets calculation
Resets the streaming calculation to current timestamp
​
Return Values
Name	Type	Description
[0]	uint256	The new total assets to stream
​
addToStreamingAssets
function addToStreamingAssets(uint256 amount) internal returns (uint256)

Adds assets to be accounted for in a streaming fashion
Adjusts streaming end time based on weighted average
​
Parameters
Name	Type	Description
amount	uint256	The amount of assets to add to streaming
​
Return Values
Name	Type	Description
[0]	uint256	The new total assets to stream
​
claim
function claim(uint32 chainId, address bridge) public returns (uint256 amount)

Claims funds from a bridge after they arrive
Decreases outstanding debt and deposits funds into yield pool
​
Parameters
Name	Type	Description
chainId	uint32	The origin chain ID
bridge	address	The origin bridge address
​
Return Values
Name	Type	Description
amount	uint256	The amount of assets claimed
​
sendFunds
function sendFunds(uint256 amount, address recipient) internal

Sends funds to a recipient
Handles both ERC20 and native currency transfers
​
Parameters
Name	Type	Description
amount	uint256	The amount to send
recipient	address	The address to receive the funds
​
setTokenSwap
function setTokenSwap(address newTokenSwapAddress) external

Sets the token swap contract address
Used for swapping non-asset tokens received by the pool
​
Parameters
Name	Type	Description
newTokenSwapAddress	address	The new token swap contract address
​
swapAndDeposit
function swapAndDeposit(address token, uint256 amount, uint24 uniswapWethPoolFeeToken, uint24 uniswapWethPoolFeeAsset, uint48 deadline, uint256 amountOutMinimum) public

Swaps tokens and deposits resulting assets
Swaps via Uniswap V3 through the token swap contract
​
Parameters
Name	Type	Description
token	address	The token to swap from
amount	uint256	The amount of tokens to swap
uniswapWethPoolFeeToken	uint24	The fee tier for token-WETH pool
uniswapWethPoolFeeAsset	uint24	The fee tier for WETH-asset pool
deadline	uint48	The deadline for the swap
amountOutMinimum	uint256	The minimum amount of assets to receive
​
collectNonDepositedAssets
function collectNonDepositedAssets() public

Collects any assets not yet deposited and starts streaming them
Can be called by anyone to ensure timely asset collection
​
beforeWithdraw
function beforeWithdraw(uint256 assets, uint256) internal

Hook called before withdrawing assets from the vault
Withdraws assets from yield pool before processing withdrawal
​
Parameters
Name	Type	Description
assets	uint256	The amount of assets to withdraw
	uint256	
​
afterDeposit
function afterDeposit(uint256 assets, uint256) internal

Hook called after depositing assets to the vault
Deposits assets into yield pool after receiving them
​
Parameters
Name	Type	Description
assets	uint256	The amount of assets deposited
	uint256	
​
processFailedHandler
function processFailedHandler(uint32 chainId, address bridge, bytes data) public

Processes failed Hyperlane messages manually
Only callable by owner, typically after slow bridge resolution
​
Parameters
Name	Type	Description
chainId	uint32	The origin chain ID
bridge	address	The origin bridge address
data	bytes	The encoded message data
​
receive
receive() external payable

Receives native currency
Required for WETH unwrapping in native currency pools

Was this page helpful?

Yes
No
RelayPoolFactory
RelayPoolNativeGateway
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform