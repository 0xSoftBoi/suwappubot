# SVM Depository Reference - Relay

Source: https://docs.relay.link/references/protocol/contracts/solana-depository

On this page
API
Module relay_depository
Modules
Module program
Types
Struct RelayDepository
Module relay_depository
Functions
Function initialize
Function set_allocator
Function set_owner
Function deposit_native
Function deposit_token
Function execute_transfer
Module instruction
Types
Struct Initialize
Struct SetAllocator
Struct SetOwner
Struct DepositNative
Struct DepositToken
Struct ExecuteTransfer
Module cpi
Modules
Module accounts
Re-exports
Re-export crate::__cpi_client_accounts_set_allocator::*
Re-export crate::__cpi_client_accounts_set_owner::*
Re-export crate::__cpi_client_accounts_initialize::*
Re-export crate::__cpi_client_accounts_deposit_token::*
Re-export crate::__cpi_client_accounts_execute_transfer::*
Re-export crate::__cpi_client_accounts_deposit_native::*
Types
Struct Return
Functions
Function initialize
Function set_allocator
Function set_owner
Function deposit_native
Function deposit_token
Function execute_transfer
Module accounts
Re-exports
Re-export crate::__client_accounts_execute_transfer::*
Re-export crate::__client_accounts_deposit_token::*
Re-export crate::__client_accounts_initialize::*
Re-export crate::__client_accounts_set_owner::*
Re-export crate::__client_accounts_set_allocator::*
Re-export crate::__client_accounts_deposit_native::*
Types
Struct RelayDepository
Fields
Struct UsedRequest
Fields
Struct Initialize
Fields
Struct InitializeBumps
Fields
Struct SetAllocator
Fields
Struct SetAllocatorBumps
Fields
Struct SetOwner
Fields
Struct SetOwnerBumps
Fields
Struct DepositNative
Fields
Struct DepositNativeBumps
Fields
Struct DepositToken
Fields
Struct DepositTokenBumps
Fields
Struct ExecuteTransfer
Fields
Struct ExecuteTransferBumps
Fields
Struct TransferRequest
Fields
Implementations
Struct TransferExecutedEvent
Fields
Struct DepositEvent
Fields
Enum CustomError
Variants
Implementations
Functions
Function check_id
Function id
Function id_const
Function entry
Function get_transfer_fee
Constants and Statics
Static ID
Constant ID_CONST
Contracts
SVM Depository Reference
Copy page

Anchor API reference for the Solana Relay Depository program

​
API
Version: 0.1.0
Format Version: 46
​
Module relay_depository
​
Modules
​
Module program
Module representing the program.
pub mod program { /* ... */ }

​
Types
​
Struct RelayDepository
Type representing the program.
pub struct RelayDepository;

​
Module relay_depository
pub mod relay_depository { /* ... */ }

​
Functions
​
Function initialize
Initialize the relay depository program with owner and allocator
Creates and initializes the relay depository account with the specified owner and allocator.
Parameters
ctx - The context containing the accounts
Returns
Ok(()) on success
pub fn initialize(ctx: Context<''_, ''_, ''_, ''_, Initialize<''_>>) -> Result<()> { /* ... */ }

​
Function set_allocator
Update the allocator public key
Allows the owner to change the authorized allocator that can sign transfer requests.
Parameters
ctx - The context containing the accounts
new_allocator - The public key of the new allocator
Returns
Ok(()) on success
Err(error) if not authorized
pub fn set_allocator(ctx: Context<''_, ''_, ''_, ''_, SetAllocator<''_>>, new_allocator: Pubkey) -> Result<()> { /* ... */ }

​
Function set_owner
Update the owner public key
Allows the current owner to transfer ownership to a new address.
Parameters
ctx - The context containing the accounts
new_owner - The public key of the new owner
Returns
Ok(()) on success
Err(error) if not authorized
pub fn set_owner(ctx: Context<''_, ''_, ''_, ''_, SetOwner<''_>>, new_owner: Pubkey) -> Result<()> { /* ... */ }

​
Function deposit_native
Deposit native SOL tokens into the vault
Transfers SOL from the sender to the vault and emits a deposit event.
Parameters
ctx - The context containing the accounts
amount - The amount of SOL to deposit
id - A unique identifier for the deposit
Returns
Ok(()) on success
pub fn deposit_native(ctx: Context<''_, ''_, ''_, ''_, DepositNative<''_>>, amount: u64, id: [u8; 32]) -> Result<()> { /* ... */ }

​
Function deposit_token
Deposit SPL tokens into the vault
Creates the vault’s token account if needed, transfers tokens from the sender, and emits a deposit event.
Parameters
ctx - The context containing the accounts
amount - The amount of tokens to deposit
id - A unique identifier for the deposit
Returns
Ok(()) on success
pub fn deposit_token(ctx: Context<''_, ''_, ''_, ''_, DepositToken<''_>>, amount: u64, id: [u8; 32]) -> Result<()> { /* ... */ }

​
Function execute_transfer
Execute a transfer with allocator signature
Verifies the allocator’s signature, transfers tokens to the recipient, and marks the request as used.
Parameters
ctx - The context containing the accounts
request - The transfer request details and signature
Returns
Ok(()) on success
Err(error) if signature is invalid or request can’t be processed
pub fn execute_transfer(ctx: Context<''_, ''_, ''_, ''_, ExecuteTransfer<''_>>, request: TransferRequest) -> Result<()> { /* ... */ }

​
Module instruction
An Anchor generated module containing the program’s set of instructions, where each method handler in the #[program] mod is associated with a struct defining the input arguments to the method. These should be used directly, when one wants to serialize Anchor instruction data, for example, when specifying instructions on a client.
pub mod instruction { /* ... */ }

​
Types
​
Struct Initialize
Instruction.
pub struct Initialize;

​
Struct SetAllocator
Instruction.
pub struct SetAllocator {
    pub new_allocator: Pubkey,
}

Fields
Name	Type	Documentation
new_allocator	Pubkey	
​
Struct SetOwner
Instruction.
pub struct SetOwner {
    pub new_owner: Pubkey,
}

Fields
Name	Type	Documentation
new_owner	Pubkey	
​
Struct DepositNative
Instruction.
pub struct DepositNative {
    pub amount: u64,
    pub id: [u8; 32],
}

Fields
Name	Type	Documentation
amount	u64	
id	[u8; 32]	
​
Struct DepositToken
Instruction.
pub struct DepositToken {
    pub amount: u64,
    pub id: [u8; 32],
}

Fields
Name	Type	Documentation
amount	u64	
id	[u8; 32]	
​
Struct ExecuteTransfer
Instruction.
pub struct ExecuteTransfer {
    pub request: TransferRequest,
}

Fields
Name	Type	Documentation
request	TransferRequest	
​
Module cpi
Attributes:
#[<cfg>(feature = "cpi")]
pub mod cpi { /* ... */ }

​
Modules
​
Module accounts
An Anchor generated module, providing a set of structs mirroring the structs deriving Accounts, where each field is an AccountInfo. This is useful for CPI.
pub mod accounts { /* ... */ }

​
Re-exports
​
Re-export crate::__cpi_client_accounts_set_allocator::*
pub use crate::__cpi_client_accounts_set_allocator::*;

​
Re-export crate::__cpi_client_accounts_set_owner::*
pub use crate::__cpi_client_accounts_set_owner::*;

​
Re-export crate::__cpi_client_accounts_initialize::*
pub use crate::__cpi_client_accounts_initialize::*;

​
Re-export crate::__cpi_client_accounts_deposit_token::*
pub use crate::__cpi_client_accounts_deposit_token::*;

​
Re-export crate::__cpi_client_accounts_execute_transfer::*
pub use crate::__cpi_client_accounts_execute_transfer::*;

​
Re-export crate::__cpi_client_accounts_deposit_native::*
pub use crate::__cpi_client_accounts_deposit_native::*;

​
Types
​
Struct Return
pub struct Return<T> {
    // Some fields omitted
}

Fields
Name	Type	Documentation
private fields	…	Some fields have been omitted
​
Functions
​
Function initialize
pub fn initialize<''a, ''b, ''c, ''info>(ctx: anchor_lang::context::CpiContext<''a, ''b, ''c, ''info, crate::cpi::accounts::Initialize<''info>>) -> anchor_lang::Result<()> { /* ... */ }

​
Function set_allocator
pub fn set_allocator<''a, ''b, ''c, ''info>(ctx: anchor_lang::context::CpiContext<''a, ''b, ''c, ''info, crate::cpi::accounts::SetAllocator<''info>>, new_allocator: Pubkey) -> anchor_lang::Result<()> { /* ... */ }

​
Function set_owner
pub fn set_owner<''a, ''b, ''c, ''info>(ctx: anchor_lang::context::CpiContext<''a, ''b, ''c, ''info, crate::cpi::accounts::SetOwner<''info>>, new_owner: Pubkey) -> anchor_lang::Result<()> { /* ... */ }

​
Function deposit_native
pub fn deposit_native<''a, ''b, ''c, ''info>(ctx: anchor_lang::context::CpiContext<''a, ''b, ''c, ''info, crate::cpi::accounts::DepositNative<''info>>, amount: u64, id: [u8; 32]) -> anchor_lang::Result<()> { /* ... */ }

​
Function deposit_token
pub fn deposit_token<''a, ''b, ''c, ''info>(ctx: anchor_lang::context::CpiContext<''a, ''b, ''c, ''info, crate::cpi::accounts::DepositToken<''info>>, amount: u64, id: [u8; 32]) -> anchor_lang::Result<()> { /* ... */ }

​
Function execute_transfer
pub fn execute_transfer<''a, ''b, ''c, ''info>(ctx: anchor_lang::context::CpiContext<''a, ''b, ''c, ''info, crate::cpi::accounts::ExecuteTransfer<''info>>, request: TransferRequest) -> anchor_lang::Result<()> { /* ... */ }

​
Module accounts
An Anchor generated module, providing a set of structs mirroring the structs deriving Accounts, where each field is a Pubkey. This is useful for specifying accounts for a client.
pub mod accounts { /* ... */ }

​
Re-exports
​
Re-export crate::__client_accounts_execute_transfer::*
pub use crate::__client_accounts_execute_transfer::*;

​
Re-export crate::__client_accounts_deposit_token::*
pub use crate::__client_accounts_deposit_token::*;

​
Re-export crate::__client_accounts_initialize::*
pub use crate::__client_accounts_initialize::*;

​
Re-export crate::__client_accounts_set_owner::*
pub use crate::__client_accounts_set_owner::*;

​
Re-export crate::__client_accounts_set_allocator::*
pub use crate::__client_accounts_set_allocator::*;

​
Re-export crate::__client_accounts_deposit_native::*
pub use crate::__client_accounts_deposit_native::*;

​
Types
​
Struct RelayDepository
Relay depository account that stores configuration and state
This account is a PDA derived from the RELAY_DEPOSITORY_SEED and contains the ownership and allocation information.
pub struct RelayDepository {
    pub owner: Pubkey,
    pub allocator: Pubkey,
    pub vault_bump: u8,
}

​
Fields
Name	Type	Documentation
owner	Pubkey	The owner of the relay depository who can update settings
allocator	Pubkey	The authorized allocator that can sign transfer requests
vault_bump	u8	The bump seed for the vault PDA, used for deriving the vault address
​
Struct UsedRequest
Account that tracks whether a transfer request has been used
This account is created for each transfer request to prevent replay attacks.
pub struct UsedRequest {
    pub is_used: bool,
}

​
Fields
Name	Type	Documentation
is_used	bool	Flag indicating whether the request has been processed
​
Struct Initialize
Accounts required for initializing the relay depository
pub struct Initialize<''info> {
    pub relay_depository: Account<''info, RelayDepository>,
    pub vault: UncheckedAccount<''info>,
    pub owner: Signer<''info>,
    pub allocator: UncheckedAccount<''info>,
    pub system_program: Program<''info, System>,
}

​
Fields
Name	Type	Documentation
relay_depository	Account<''info, RelayDepository>	The relay depository account to be initialized
This is a PDA derived from the RELAY_DEPOSITORY_SEED
vault	UncheckedAccount<''info>	PDA that will hold SOL deposits
CHECK: This is a PDA derived from the VAULT_SEED
owner	Signer<''info>	The owner account that pays for initialization
Must match the AUTHORIZED_PUBKEY
allocator	UncheckedAccount<''info>	The allocator account that will be authorized to sign transfer requests
CHECK: Used as public key only
system_program	Program<''info, System>	
​
Struct InitializeBumps
pub struct InitializeBumps {
    pub relay_depository: u8,
    pub vault: u8,
}

​
Fields
Name	Type	Documentation
relay_depository	u8	
vault	u8	
​
Struct SetAllocator
Accounts required for updating the allocator
pub struct SetAllocator<''info> {
    pub relay_depository: Account<''info, RelayDepository>,
    pub owner: Signer<''info>,
}

​
Fields
Name	Type	Documentation
relay_depository	Account<''info, RelayDepository>	The relay depository account to update
owner	Signer<''info>	The owner of the relay depository
​
Struct SetAllocatorBumps
pub struct SetAllocatorBumps {
    pub relay_depository: u8,
}

​
Fields
Name	Type	Documentation
relay_depository	u8	
​
Struct SetOwner
Accounts required for updating the owner
pub struct SetOwner<''info> {
    pub relay_depository: Account<''info, RelayDepository>,
    pub owner: Signer<''info>,
}

​
Fields
Name	Type	Documentation
relay_depository	Account<''info, RelayDepository>	The relay depository account to update
owner	Signer<''info>	The current owner of the relay depository
​
Struct SetOwnerBumps
pub struct SetOwnerBumps {
    pub relay_depository: u8,
}

​
Fields
Name	Type	Documentation
relay_depository	u8	
​
Struct DepositNative
Accounts required for depositing native currency
pub struct DepositNative<''info> {
    pub relay_depository: Account<''info, RelayDepository>,
    pub sender: Signer<''info>,
    pub depositor: UncheckedAccount<''info>,
    pub vault: UncheckedAccount<''info>,
    pub system_program: Program<''info, System>,
}

​
Fields
Name	Type	Documentation
relay_depository	Account<''info, RelayDepository>	The relay depository account
sender	Signer<''info>	The sender of the deposit
depositor	UncheckedAccount<''info>	The account credited for the deposit
CHECK: The account credited for the deposit
vault	UncheckedAccount<''info>	The vault PDA that will receive the SOL
CHECK: The vault PDA that will receive the SOL
system_program	Program<''info, System>	The system program
​
Struct DepositNativeBumps
pub struct DepositNativeBumps {
    pub relay_depository: u8,
}

​
Fields
Name	Type	Documentation
relay_depository	u8	
​
Struct DepositToken
Accounts required for depositing tokens
pub struct DepositToken<''info> {
    pub relay_depository: Account<''info, RelayDepository>,
    pub sender: Signer<''info>,
    pub depositor: UncheckedAccount<''info>,
    pub vault: UncheckedAccount<''info>,
    pub mint: InterfaceAccount<''info, anchor_spl::token_interface::Mint>,
    pub sender_token_account: InterfaceAccount<''info, anchor_spl::token_interface::TokenAccount>,
    pub vault_token_account: UncheckedAccount<''info>,
    pub token_program: Interface<''info, anchor_spl::token_interface::TokenInterface>,
    pub associated_token_program: Program<''info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<''info, System>,
}

​
Fields
Name	Type	Documentation
relay_depository	Account<''info, RelayDepository>	The relay depository account
sender	Signer<''info>	The sender of the deposit
depositor	UncheckedAccount<''info>	The account credited for the deposit
CHECK: The account credited for the deposit
vault	UncheckedAccount<''info>	The vault PDA that will receive the tokens
CHECK: The vault PDA that will receive the tokens
mint	InterfaceAccount<''info, anchor_spl::token_interface::Mint>	The mint of the token being deposited
sender_token_account	InterfaceAccount<''info, anchor_spl::token_interface::TokenAccount>	The sender’s token account
vault_token_account	UncheckedAccount<''info>	CHECK: The vault’s token account
token_program	Interface<''info, anchor_spl::token_interface::TokenInterface>	The token program
associated_token_program	Program<''info, anchor_spl::associated_token::AssociatedToken>	The associated token program
system_program	Program<''info, System>	The system program
​
Struct DepositTokenBumps
pub struct DepositTokenBumps {
    pub relay_depository: u8,
}

​
Fields
Name	Type	Documentation
relay_depository	u8	
​
Struct ExecuteTransfer
Attributes:
#[instruction(request: TransferRequest)]
Accounts required for executing a transfer
pub struct ExecuteTransfer<''info> {
    pub relay_depository: Account<''info, RelayDepository>,
    pub executor: Signer<''info>,
    pub recipient: UncheckedAccount<''info>,
    pub vault: UncheckedAccount<''info>,
    pub mint: Option<InterfaceAccount<''info, anchor_spl::token_interface::Mint>>,
    pub recipient_token_account: Option<InterfaceAccount<''info, anchor_spl::token_interface::TokenAccount>>,
    pub vault_token_account: Option<InterfaceAccount<''info, anchor_spl::token_interface::TokenAccount>>,
    pub used_request: Account<''info, UsedRequest>,
    pub ix_sysvar: AccountInfo<''info>,
    pub token_program: Interface<''info, anchor_spl::token_interface::TokenInterface>,
    pub associated_token_program: Program<''info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<''info, System>,
}

​
Fields
Name	Type	Documentation
relay_depository	Account<''info, RelayDepository>	The relay depository account
CHECK: The relay depository account
executor	Signer<''info>	The executor of the transfer
CHECK: The executor of the transfer
recipient	UncheckedAccount<''info>	The recipient of the transfer
CHECK: The recipient of the transfer
vault	UncheckedAccount<''info>	The vault PDA that will receive the tokens
CHECK: The vault PDA that will receive the tokens
mint	Option<InterfaceAccount<''info, anchor_spl::token_interface::Mint>>	The mint of the token being transferred
recipient_token_account	Option<InterfaceAccount<''info, anchor_spl::token_interface::TokenAccount>>	The recipient’s token account
vault_token_account	Option<InterfaceAccount<''info, anchor_spl::token_interface::TokenAccount>>	The vault’s token account
used_request	Account<''info, UsedRequest>	The account that tracks whether a transfer request has been used

This account is created for each transfer request to prevent replay attacks.
ix_sysvar	AccountInfo<''info>	The instruction sysvar for ed25519 verification
CHECK: The instruction sysvar for ed25519 verification
token_program	Interface<''info, anchor_spl::token_interface::TokenInterface>	The token program
associated_token_program	Program<''info, anchor_spl::associated_token::AssociatedToken>	The associated token program
system_program	Program<''info, System>	The system program
​
Struct ExecuteTransferBumps
pub struct ExecuteTransferBumps {
    pub relay_depository: u8,
    pub used_request: u8,
}

​
Fields
Name	Type	Documentation
relay_depository	u8	
used_request	u8	
​
Struct TransferRequest
Structure representing a transfer request signed by the allocator
pub struct TransferRequest {
    pub recipient: Pubkey,
    pub token: Option<Pubkey>,
    pub amount: u64,
    pub nonce: u64,
    pub expiration: i64,
}

​
Fields
Name	Type	Documentation
recipient	Pubkey	The recipient of the transfer
token	Option<Pubkey>	The token mint (None for native SOL, Some(mint) for SPL tokens)
amount	u64	The amount to transfer
nonce	u64	A unique nonce
expiration	i64	The expiration timestamp for the request
​
Implementations
Methods
pub fn get_hash(self: &Self) -> Hash { /* ... */ }

Computes a hash of the serialized request for signature verification
​
Struct TransferExecutedEvent
Event emitted when a transfer is executed
pub struct TransferExecutedEvent {
    pub request: TransferRequest,
    pub executor: Pubkey,
    pub id: Pubkey,
}

​
Fields
Name	Type	Documentation
request	TransferRequest	The transfer request that was executed
executor	Pubkey	The public key of the executor who processed the transfer
id	Pubkey	The unique identifier for the used request account
​
Struct DepositEvent
Event emitted when a deposit is made
pub struct DepositEvent {
    pub depositor: Pubkey,
    pub token: Option<Pubkey>,
    pub amount: u64,
    pub id: [u8; 32],
}

​
Fields
Name	Type	Documentation
depositor	Pubkey	The public key of the depositor
token	Option<Pubkey>	The token mint (None for native SOL, Some(mint) for SPL tokens)
amount	u64	The amount deposited
id	[u8; 32]	A unique identifier for the deposit
​
Enum CustomError
Attributes:
#[repr(u32)]
Custom error codes for the relay depository program
pub enum CustomError {
    TransferRequestAlreadyUsed,
    InvalidMint,
    Unauthorized,
    AllocatorSignerMismatch,
    MessageMismatch,
    MalformedEd25519Data,
    MissingSignature,
    SignatureExpired,
    InvalidRecipient,
    InvalidVaultTokenAccount,
    InsufficientVaultBalance,
}

​
Variants
TransferRequestAlreadyUsed
Thrown when trying to execute a transfer request that has already been used
InvalidMint
Thrown when the provided mint does not match the expected mint
Unauthorized
Thrown when an account attempts an operation it is not authorized for
AllocatorSignerMismatch
Thrown when the signature’s signer doesn’t match the expected allocator
MessageMismatch
Thrown when the signed message doesn’t match the expected request
MalformedEd25519Data
Thrown when the Ed25519 signature data is malformed
MissingSignature
Thrown when a required signature is missing
SignatureExpired
Thrown when the signature has expired
InvalidRecipient
Thrown when the recipient doesn’t match the expected recipient
InvalidVaultTokenAccount
Thrown when the vault token account doesn’t match the expected address
InsufficientVaultBalance
Thrown when a transfer would leave the vault with insufficient balance for rent
​
Implementations
Methods
pub fn name(self: &Self) -> String { /* ... */ }

Gets the name of this [#enum_name].
​
Functions
​
Function check_id
Confirms that a given pubkey is equivalent to the program ID
pub fn check_id(id: &anchor_lang::solana_program::pubkey::Pubkey) -> bool { /* ... */ }

​
Function id
Returns the program ID
pub fn id() -> anchor_lang::solana_program::pubkey::Pubkey { /* ... */ }

​
Function id_const
Const version of ID
pub const fn id_const() -> anchor_lang::solana_program::pubkey::Pubkey { /* ... */ }

​
Function entry
The Anchor codegen exposes a programming model where a user defines a set of methods inside of a #[program] module in a way similar to writing RPC request handlers. The macro then generates a bunch of code wrapping these user defined methods into something that can be executed on Solana.
These methods fall into one category for now.
Global methods - regular methods inside of the #[program].
Care must be taken by the codegen to prevent collisions between methods in these different namespaces. For this reason, Anchor uses a variant of sighash to perform method dispatch, rather than something like a simple enum variant discriminator.
The execution flow of the generated code can be roughly outlined:
Start program via the entrypoint.
Strip method identifier off the first 8 bytes of the instruction data and invoke the identified method. The method identifier is a variant of sighash. See docs.rs for anchor_lang for details.
If the method identifier is an IDL identifier, execute the IDL instructions, which are a special set of hardcoded instructions baked into every Anchor program. Then exit.
Otherwise, the method identifier is for a user defined instruction, i.e., one of the methods in the user defined #[program] module. Perform method dispatch, i.e., execute the big match statement mapping method identifier to method handler wrapper.
Run the method handler wrapper. This wraps the code the user actually wrote, deserializing the accounts, constructing the context, invoking the user’s code, and finally running the exit routine, which typically persists account changes.
The entry function here, defines the standard entry to a Solana program, where execution begins.
pub fn entry<''info>(program_id: &Pubkey, accounts: &''info [AccountInfo<''info>], data: &[u8]) -> anchor_lang::solana_program::entrypoint::ProgramResult { /* ... */ }

​
Function get_transfer_fee
Calculates the transfer fee for a token
Determines the fee amount for the given mint and transfer amount, taking into account the token extension for transfer fees if present.
Parameters
mint_account - The mint account of the token
pre_fee_amount - The amount to transfer before fees
Returns
The calculated fee amount
pub fn get_transfer_fee(mint_account: &InterfaceAccount<''_, anchor_spl::token_interface::Mint>, pre_fee_amount: u64) -> Result<u64> { /* ... */ }

​
Constants and Statics
​
Static ID
The static program ID
pub static ID: anchor_lang::solana_program::pubkey::Pubkey = _;

​
Constant ID_CONST
Const version of ID
pub const ID_CONST: anchor_lang::solana_program::pubkey::Pubkey = _;


Was this page helpful?

Yes
No
EVM Depository Reference
Overview
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform