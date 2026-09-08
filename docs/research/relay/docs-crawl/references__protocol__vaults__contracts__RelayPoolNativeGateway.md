# RelayPoolNativeGateway - Relay

Source: https://docs.relay.link/references/protocol/vaults/contracts/RelayPoolNativeGateway

On this page
Solidity API
RelayPoolNativeGateway
EthTransferFailed
OnlyWethCanSendEth
RemainingEth
SlippageExceeded
WETH
constructor
Parameters
deposit
Parameters
Return Values
mint
Parameters
Return Values
withdraw
Parameters
Return Values
redeem
Parameters
Return Values
safeTransferETH
Parameters
receive
Contracts Reference
RelayPoolNativeGateway
Copy page
​
Solidity API
​
RelayPoolNativeGateway
Gateway contract for depositing and withdrawing native ETH to/from WETH-based RelayPools
Handles wrapping/unwrapping of ETH and provides slippage protection for all operations
​
EthTransferFailed
error EthTransferFailed()

Error when ETH transfer fails
​
OnlyWethCanSendEth
error OnlyWethCanSendEth()

Error when contract receives ETH from non-WETH address
​
RemainingEth
error RemainingEth()

Error when ETH remains in contract after operation
​
SlippageExceeded
error SlippageExceeded()

Error when slippage protection is triggered
​
WETH
contract IWETH WETH

The Wrapped ETH (WETH) contract
Used to wrap/unwrap native ETH for pool operations
​
constructor
constructor(address wethAddress) public

Initializes the gateway with the WETH contract address
​
Parameters
Name	Type	Description
wethAddress	address	Address of the Wrapped Native token contract
​
deposit
function deposit(address pool, address receiver, uint256 minSharesOut) external payable returns (uint256 shares)

Deposits native ETH into a WETH-based pool
Wraps ETH to WETH, then deposits to the pool with slippage protection
​
Parameters
Name	Type	Description
pool	address	The address of the ERC4626 pool to deposit into
receiver	address	The address that will receive the pool shares
minSharesOut	uint256	Minimum amount of shares to receive (slippage protection)
​
Return Values
Name	Type	Description
shares	uint256	The amount of pool shares minted to the receiver
​
mint
function mint(address pool, address receiver, uint256 minSharesOut) external payable returns (uint256 shares)

Mints pool shares by depositing native ETH
Wraps ETH, calculates shares, then mints with slippage protection
​
Parameters
Name	Type	Description
pool	address	The address of the ERC4626 pool to mint shares from
receiver	address	The address that will receive the pool shares
minSharesOut	uint256	Minimum amount of shares to receive (slippage protection)
​
Return Values
Name	Type	Description
shares	uint256	The amount of pool shares minted to the receiver
​
withdraw
function withdraw(address pool, uint256 assets, address receiver, uint256 maxSharesIn) external virtual returns (uint256 shares)

Withdraws a specific amount of native ETH from a WETH-based pool
Withdraws WETH from pool, unwraps to ETH, with slippage protection
​
Parameters
Name	Type	Description
pool	address	The address of the ERC4626 pool to withdraw from
assets	uint256	Amount of native ETH to withdraw
receiver	address	The address that will receive the native ETH
maxSharesIn	uint256	Maximum amount of shares to burn (slippage protection)
​
Return Values
Name	Type	Description
shares	uint256	The amount of pool shares burned
​
redeem
function redeem(address pool, uint256 shares, address receiver, uint256 minAssetsOut) external virtual returns (uint256 assets)

Redeems pool shares for native ETH
Redeems shares for WETH, unwraps to ETH, with slippage protection
​
Parameters
Name	Type	Description
pool	address	The address of the ERC4626 pool to redeem from
shares	uint256	Amount of pool shares to redeem
receiver	address	The address that will receive the native ETH
minAssetsOut	uint256	Minimum amount of ETH to receive (slippage protection)
​
Return Values
Name	Type	Description
assets	uint256	The amount of native ETH sent to receiver
​
safeTransferETH
function safeTransferETH(address to, uint256 value) internal

Safely transfers ETH to an address
Reverts if the ETH transfer fails
​
Parameters
Name	Type	Description
to	address	Recipient of the ETH transfer
value	uint256	Amount of ETH to transfer
​
receive
receive() external payable

Receives ETH only from WETH contract
Required for WETH unwrapping operations

Was this page helpful?

Yes
No
RelayPool
RelayBridgeFactory
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform