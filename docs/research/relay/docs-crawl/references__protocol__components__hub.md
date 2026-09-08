# Hub - Relay

Source: https://docs.relay.link/references/protocol/components/hub

On this page
Overview
How It Works
Actions
Real-Time Settlement
Token Representation
ERC6909 Interface
Withdrawal Addresses
Source Code
Components
Hub
Copy page

The central ledger tracking all token ownership on the Relay Chain

​
Overview
The Hub is a smart contract on the Relay Chain that serves as the central ledger for the protocol. It tracks the ownership of all funds deposited into Depository contracts across every supported chain.
Implemented as an ERC6909 multi-token contract, the Hub can represent any deposited asset (ETH, USDC, SOL, etc.) from any chain as a token balance. When the Oracle attests that a deposit or fill occurred, the Hub updates balances accordingly.
​
How It Works
The Hub maintains a global balance sheet:
When a user deposits into a Depository, the Oracle attests this, and the Hub mints a corresponding token balance for the user
When a solver fills an order, the Oracle attests this, and the Hub transfers the balance from the user to the solver
When a withdrawal is initiated, an Oracle-signed execution moves the balance to a withdrawal address on the Hub. After funds are claimed from the Depository, the Oracle attests the withdrawal and the Hub burns the corresponding balance
This means the Hub reflects the current state of all finalized funds across all chains, updated as Oracle attestations are processed.
​
Actions
The Hub processes three types of actions, all triggered by the Oracle:
Action	Trigger	Effect
MINT	User deposit attested	Creates token balance for the depositor
TRANSFER	Solver fill attested	Moves balance from user to solver
BURN	Solver withdrawal attested	Removes balance (funds already claimed)
Each action is idempotent — the same attestation cannot be processed twice, preventing double-counting.
​
Real-Time Settlement
A key advantage of the Hub model is real-time, per-order settlement. Every order settles individually as soon as the Oracle attests the fill. There is no batching window or settlement delay.
This is possible because settlement happens on the Relay Chain, where gas is extremely cheap (~$0.005 per settlement). In contrast, protocols that settle on origin chains must batch orders to amortize the high gas costs, forcing solvers to wait hours before they can reclaim capital.
Benefit for solvers: Immediate balance updates mean solvers can track their available capital in real-time and make withdrawal decisions based on current inventory needs, rather than waiting for batch cycles.
​
Token Representation
The Hub uses the ERC6909 standard (multi-token) to represent deposited assets. Each unique combination of asset and origin chain gets a token ID on the Hub.
For example:
ETH deposited on Optimism → token ID X
ETH deposited on Base → token ID Y
USDC deposited on Arbitrum → token ID Z
Token metadata (name, symbol, decimals, origin chain) is stored on-chain, and each Hub token can be viewed through an ERC20-compatible wrapper contract (ERC20View) for standard wallet compatibility.
​
ERC6909 Interface
The Hub implements the full ERC6909 interface, including:
balanceOf(owner, tokenId) — Check a user’s or solver’s balance for a specific token
transfer(receiver, tokenId, amount) — Transfer Hub tokens between addresses
approve(spender, tokenId, amount) — Approve another address to spend tokens
Operator system — Grant an address full control over all token balances
EIP-712 permits — Gasless approval signatures
This pattern keeps the Hub simple — it’s pure ERC6909 with no custom withdrawal logic. The withdrawal semantics are layered on top by convention.
The Hub also uses order addresses — deterministic virtual addresses derived from deposit parameters, not from orderId alone. In the settlement SDK, the order address is derived from the deposit chainId, encoded depositor, timestamp, and depositId. When a user deposits, the Hub tracks the order through these addresses, linking deposits to solver fills using the same address-based convention as withdrawals.
​
Withdrawal Addresses
Withdrawal addresses are deterministic virtual addresses derived from the withdrawal parameters:
Target chain and depository
Currency and amount
Recipient address
Withdrawal nonce
The withdrawal address is computed by hashing these parameters together. It doesn’t correspond to a real contract — it’s a routing alias on the Hub. In the current withdrawal flow, the Oracle returns a signed Hub execution that transfers funds from the owner alias to this withdrawal address. Once that balance is in place, the Oracle can verify it and produce the payload parameters used to obtain a withdrawal proof from the Allocator.
​
Source Code
The Hub contract (RelayHub.sol) is part of the settlement-protocol repository and deployed on the Relay Chain.

Was this page helpful?

Yes
No
Oracle
Allocator
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform