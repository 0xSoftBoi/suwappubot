# RelayBridgeFactory - Relay

Source: https://docs.relay.link/references/protocol/vaults/contracts/RelayBridgeFactory

On this page
Solidity API
RelayBridgeFactory
HYPERLANE_MAILBOX
bridgesByAsset
BridgeDeployed
Parameters
constructor
Parameters
deployBridge
Parameters
Return Values
Contracts Reference
RelayBridgeFactory
Copy page
​
Solidity API
​
RelayBridgeFactory
Factory contract for deploying RelayBridge instances for different assets
This factory deploys new RelayBridge contracts and maintains a registry of bridges by asset address
​
HYPERLANE_MAILBOX
address HYPERLANE_MAILBOX

The Hyperlane mailbox address used for cross-chain messaging
Immutable to ensure consistency across all deployed bridges
​
bridgesByAsset
mapping(address => address[]) bridgesByAsset

Mapping from asset address to array of deployed bridge addresses
Multiple bridges can exist for the same asset
​
BridgeDeployed
event BridgeDeployed(address bridge, address asset, contract BridgeProxy proxyBridge)

Emitted when a new bridge is deployed
​
Parameters
Name	Type	Description
bridge	address	The address of the newly deployed RelayBridge contract
asset	address	The address of the asset that the bridge will handle
proxyBridge	contract BridgeProxy	The BridgeProxy contract associated with this bridge
​
constructor
constructor(address hMailbox) public

Initializes the factory with the Hyperlane mailbox address
The mailbox address cannot be changed after deployment
​
Parameters
Name	Type	Description
hMailbox	address	The address of the Hyperlane mailbox contract
​
deployBridge
function deployBridge(address asset, contract BridgeProxy proxyBridge) public returns (address)

Deploys a new RelayBridge for a specific asset
Creates a new RelayBridge instance and adds it to the bridgesByAsset mapping
​
Parameters
Name	Type	Description
asset	address	The address of the asset (token) that the bridge will handle
proxyBridge	contract BridgeProxy	The BridgeProxy contract that will work with this bridge
​
Return Values
Name	Type	Description
[0]	address	The address of the newly deployed RelayBridge contract

Was this page helpful?

Yes
No
RelayPoolNativeGateway
RelayBridge
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform