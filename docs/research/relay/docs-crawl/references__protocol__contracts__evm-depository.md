# EVM Depository Reference - Relay

Source: https://docs.relay.link/references/protocol/contracts/evm-depository

On this page
Solidity API
EVM Relay Depository
AddressCannotBeZero
InvalidSignature
CallRequestExpired
CallRequestAlreadyUsed
CallFailed
Parameters
RelayNativeDeposit
Parameters
RelayErc20Deposit
Parameters
RelayCallExecuted
Parameters
_CALL_TYPEHASH
_CALL_REQUEST_TYPEHASH
callRequests
allocator
constructor
Parameters
setAllocator
Parameters
depositNative
Parameters
depositErc20
Parameters
depositErc20
Parameters
execute
Parameters
Return Values
_executeCalls
Parameters
Return Values
_hashCallRequest
Parameters
Return Values
_domainNameAndVersion
Return Values
Call
Parameters
CallRequest
Parameters
CallResult
Parameters
Contracts
EVM Depository Reference
Copy page

Solidity API reference for the EVM Relay Depository contract

​
Solidity API
​
EVM Relay Depository
Provides secure deposit functionality and execution of allocator-signed requests for EVM chains
EVM implementation using EIP-712 for structured data signing, supporting native ETH and ERC20 tokens
​
AddressCannotBeZero
error AddressCannotBeZero()

Revert if the address is zero
​
InvalidSignature
error InvalidSignature()

Revert if the signature is invalid
​
CallRequestExpired
error CallRequestExpired()

Revert if the call request is expired
​
CallRequestAlreadyUsed
error CallRequestAlreadyUsed()

Revert if the call request has already been used
​
CallFailed
error CallFailed(bytes returnData)

Revert if a call fails
​
Parameters
Name	Type	Description
returnData	bytes	The data returned from the failed call
​
RelayNativeDeposit
event RelayNativeDeposit(address from, uint256 amount, bytes32 id)

Emit event when a native deposit is made
​
Parameters
Name	Type	Description
from	address	The address that made the deposit
amount	uint256	The amount of native currency deposited
id	bytes32	The unique identifier associated with the deposit
​
RelayErc20Deposit
event RelayErc20Deposit(address from, address token, uint256 amount, bytes32 id)

Emit event when an erc20 deposit is made
​
Parameters
Name	Type	Description
from	address	The address that made the deposit
token	address	The address of the ERC20 token
amount	uint256	The amount of tokens deposited
id	bytes32	The unique identifier associated with the deposit
​
RelayCallExecuted
event RelayCallExecuted(bytes32 id, struct Call call)

Emit event when a call is executed
​
Parameters
Name	Type	Description
id	bytes32	The identifier of the call request
call	struct Call	The call details that were executed
​
_CALL_TYPEHASH
bytes32 _CALL_TYPEHASH

The EIP-712 typehash for the Call struct
Used in structured data hashing for signature verification
​
_CALL_REQUEST_TYPEHASH
bytes32 _CALL_REQUEST_TYPEHASH

The EIP-712 typehash for the CallRequest struct
Used in structured data hashing for signature verification
​
callRequests
mapping(bytes32 => bool) callRequests

Set of executed call requests
Maps the hash of a call request to whether it has been executed
​
allocator
address allocator

The allocator address
Must be set to a secure and trusted entity
​
constructor
constructor(address _owner, address _allocator) public

Initializes the contract with an owner and allocator
​
Parameters
Name	Type	Description
_owner	address	The address that will own the contract
_allocator	address	The address authorized to sign withdrawal requests
​
setAllocator
function setAllocator(address _allocator) external

Set the allocator address
Only callable by the contract owner
​
Parameters
Name	Type	Description
_allocator	address	The new allocator address
​
depositNative
function depositNative(address depositor, bytes32 id) external payable

Deposit native tokens and emit a RelayNativeDeposit event
Emits a RelayNativeDeposit event with the deposit details
​
Parameters
Name	Type	Description
depositor	address	The address of the depositor - set to address(0) to credit msg.sender
id	bytes32	The identifier associated with the deposit
​
depositErc20
function depositErc20(address depositor, address token, uint256 amount, bytes32 id) public

Deposit erc20 tokens and emit an RelayErc20Deposit event
Transfers tokens from msg.sender to this contract and emits a RelayErc20Deposit event
​
Parameters
Name	Type	Description
depositor	address	The address of the depositor - set to address(0) to credit msg.sender
token	address	The erc20 token to deposit
amount	uint256	The amount to deposit
id	bytes32	The identifier associated with the deposit
​
depositErc20
function depositErc20(address depositor, address token, bytes32 id) external

Deposit erc20 tokens and emit an RelayErc20Deposit event
Uses the full allowance granted to this contract and calls depositErc20
​
Parameters
Name	Type	Description
depositor	address	The address of the depositor - set to address(0) to credit msg.sender
token	address	The erc20 token to deposit
id	bytes32	The identifier associated with the deposit
​
execute
function execute(struct CallRequest request, bytes signature) external returns (struct CallResult[] results)

Execute a CallRequest signed by the allocator
Verifies the signature, expiration, and uniqueness before execution
​
Parameters
Name	Type	Description
request	struct CallRequest	The CallRequest to execute
signature	bytes	The signature from the allocator
​
Return Values
Name	Type	Description
results	struct CallResult[]	The results of the calls
​
_executeCalls
function _executeCalls(bytes32 id, struct Call[] calls) internal returns (struct CallResult[] returnData)

Internal function to execute a list of calls
Handles multiple calls and properly manages failures based on allowFailure flag
​
Parameters
Name	Type	Description
id	bytes32	The identifier of the call request
calls	struct Call[]	The array of calls to execute
​
Return Values
Name	Type	Description
returnData	struct CallResult[]	The results of each executed call
​
_hashCallRequest
function _hashCallRequest(struct CallRequest request) internal view returns (bytes32 structHash, bytes32 eip712Hash)

Helper function to hash a CallRequest and return the EIP-712 digest
Implements EIP-712 structured data hashing for the complex CallRequest type
​
Parameters
Name	Type	Description
request	struct CallRequest	The CallRequest to hash
​
Return Values
Name	Type	Description
structHash	bytes32	The struct hash
eip712Hash	bytes32	The EIP712 hash
​
_domainNameAndVersion
function _domainNameAndVersion() internal pure returns (string name, string version)

Returns the domain name and version of the contract to be used in the domain separator
Implements required function from EIP712 base contract
​
Return Values
Name	Type	Description
name	string	The domain name
version	string	The version
​
Call
A structure representing a single call to be executed
​
Parameters
Name	Type	Description
struct Call {
  address to;
  bytes data;
  uint256 value;
  bool allowFailure;
}

​
CallRequest
A request containing multiple calls to be executed after signature verification
​
Parameters
Name	Type	Description
struct CallRequest {
  struct Call[] calls;
  uint256 nonce;
  uint256 expiration;
}

​
CallResult
The result of an executed call
​
Parameters
Name	Type	Description
struct CallResult {
  bool success;
  bytes returnData;
}


Was this page helpful?

Yes
No
Addresses
SVM Depository Reference
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform