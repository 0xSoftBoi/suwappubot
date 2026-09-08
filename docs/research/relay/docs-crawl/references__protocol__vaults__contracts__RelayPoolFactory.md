# RelayPoolFactory - Relay

Source: https://docs.relay.link/references/protocol/vaults/contracts/RelayPoolFactory

On this page
Solidity API
RelayPoolTimelock
initialize
Parameters
RelayPoolFactory
HYPERLANE_MAILBOX
WETH
TIMELOCK_TEMPLATE
MIN_TIMELOCK_DELAY
poolsByAsset
UnauthorizedCaller
Parameters
InsufficientInitialDeposit
Parameters
InsufficientTimelockDelay
Parameters
PoolDeployed
Parameters
constructor
Parameters
deployPool
Parameters
Return Values
Contracts Reference
RelayPoolFactory
Copy page
​
Solidity API
​
RelayPoolTimelock
Interface for initializing timelock contracts
Used to initialize cloned timelock instances with proper access control
​
initialize
function initialize(uint256 minDelay, address[] proposers, address[] executors, address admin) external

Initializes a timelock contract with the specified parameters
​
Parameters
Name	Type	Description
minDelay	uint256	The minimum delay in seconds for timelock operations
proposers	address[]	Array of addresses that can propose operations
executors	address[]	Array of addresses that can execute operations
admin	address	The admin address (use address(0) for no admin)
​
RelayPoolFactory
Factory contract for deploying RelayPool instances with associated timelocks
Deploys pools with timelock governance and tracks pools by asset
​
HYPERLANE_MAILBOX
address HYPERLANE_MAILBOX

The Hyperlane mailbox address used by all deployed pools
Immutable to ensure consistency across all pools
​
WETH
address WETH

The WETH contract address for native currency pools
Used when creating pools that handle native currency
​
TIMELOCK_TEMPLATE
address TIMELOCK_TEMPLATE

The timelock template contract to be cloned
Each pool gets its own timelock instance cloned from this template
​
MIN_TIMELOCK_DELAY
uint256 MIN_TIMELOCK_DELAY

The minimum timelock delay enforced for non-owner deployments
Owner can deploy with shorter delays for testing/special cases
​
poolsByAsset
mapping(address => address[]) poolsByAsset

Mapping from asset address to array of deployed pool addresses
Multiple pools can exist for the same asset
​
UnauthorizedCaller
error UnauthorizedCaller(address sender)

Error when unauthorized address attempts restricted operation
​
Parameters
Name	Type	Description
sender	address	The address that attempted the unauthorized action
​
InsufficientInitialDeposit
error InsufficientInitialDeposit(uint256 deposit)

Error when initial deposit is insufficient
​
Parameters
Name	Type	Description
deposit	uint256	The insufficient deposit amount provided
​
InsufficientTimelockDelay
error InsufficientTimelockDelay(uint256 delay)

Error when timelock delay is below minimum requirement
​
Parameters
Name	Type	Description
delay	uint256	The insufficient delay provided
​
PoolDeployed
event PoolDeployed(address pool, address creator, address asset, string name, string symbol, address thirdPartyPool, address timelock)

Emitted when a new pool is deployed
​
Parameters
Name	Type	Description
pool	address	The address of the deployed RelayPool
creator	address	The address that deployed the pool
asset	address	The underlying asset of the pool
name	string	The name of the pool’s share token
symbol	string	The symbol of the pool’s share token
thirdPartyPool	address	The yield pool where assets will be deposited
timelock	address	The timelock contract governing the pool
​
constructor
constructor(address hMailbox, address weth, address timelock, uint256 minTimelockDelay) public

Initializes the factory with required infrastructure addresses
​
Parameters
Name	Type	Description
hMailbox	address	The Hyperlane mailbox contract address
weth	address	The WETH contract address
timelock	address	The timelock template to be cloned for each pool
minTimelockDelay	uint256	The minimum delay for timelock operations
​
deployPool
function deployPool(contract ERC20 asset, string name, string symbol, address thirdPartyPool, uint256 timelockDelay, uint256 initialDeposit, address curator) public returns (address)

Deploys a new RelayPool with associated timelock governance
Requires initial deposit to prevent inflation attacks, creates dedicated timelock
​
Parameters
Name	Type	Description
asset	contract ERC20	The ERC20 asset for the pool
name	string	The name for the pool’s share token
symbol	string	The symbol for the pool’s share token
thirdPartyPool	address	The yield pool where idle assets will be deposited
timelockDelay	uint256	The delay in seconds for timelock operations
initialDeposit	uint256	The initial deposit amount (must be at least 1 unit of asset)
curator	address	The address that will control the pool through the timelock
​
Return Values
Name	Type	Description
[0]	address	The address of the newly deployed RelayPool

Was this page helpful?

Yes
No
Interacting
RelayPool
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform