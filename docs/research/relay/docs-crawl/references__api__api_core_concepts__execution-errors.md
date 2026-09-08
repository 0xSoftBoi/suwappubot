# Handling Execution Errors - Relay

Source: https://docs.relay.link/references/api/api_core_concepts/execution-errors

On this page
Fill Errors
Deposit & Validation Errors
Solver Capacity & Balance Errors
Swap Routing & Pricing Errors
Transaction Construction & Gas Errors
Onchain Execution & Revert Errors
Order & Signature Errors
Account Abstraction Errors
NFT Minting Errors
Other
Refund Errors
Core Concepts
Handling Execution Errors
Copy page

Interpret fill and refund failure reasons returned after a request has been submitted

Once a request is submitted, execution can still fail during the fill or, if a fill isn’t possible, during the refund. These failures are surfaced as failReason (fill) and refundFailReason (refund) on the request object, distinct from the quote errors returned before a request is ever submitted. This guide outlines the possible fill and refund failure reasons and what each one means.
​
Fill Errors
failReason explains why a fill did not complete after a request was submitted.
​
Deposit & Validation Errors
Error Code	Description
DEPOSIT_CHAIN_MISMATCH	For strict deposit addresses, the deposit landed on a different chain than the one the address was registered for.
INCORRECT_DEPOSIT_CURRENCY	For strict deposit addresses, the token received doesn’t match the currency quoted for this request.
DOUBLE_SPEND	A second deposit was detected at an address whose first deposit was already processed.
DEPOSITED_AMOUNT_TOO_LOW_TO_FILL	The amount deposited is less than the quoted amount needed to complete the swap.
ORIGIN_CURRENCY_MISMATCH	The currency detected on origin doesn’t match the origin currency specified in the request.
TTL_EXPIRED	The request’s time-to-live window passed before it could be filled.
DEPOSIT_CONFIRMATION_TIMEOUT	The deposit transaction wasn’t confirmed within the expected window, so the request timed out and was routed to a refund.
DEPOSIT_REORGED	The deposit transaction was removed from the canonical chain by a block reorganization, so the request was failed.
ORPHANED_DEPOSIT_REFUND	A deposit at a deposit address couldn’t be matched to a fillable request, so the funds were refunded to the depositor.
BLOCKED_WALLET	An address associated with the request was flagged by wallet screening at fill time, so the fill was blocked. Funds are not automatically refunded and are subject to compliance review.
​
Solver Capacity & Balance Errors
Error Code	Description
SOLVER_CAPACITY_EXCEEDED	The solver’s available capacity for this route has been exceeded.
SOLVER_BALANCE_TOO_LOW	The solver doesn’t have enough native tokens or balance to construct the fill transaction.
SPONSOR_BALANCE_TOO_LOW	The sponsor covering transaction fees doesn’t have sufficient balance.
INSUFFICIENT_FUNDS_FOR_RENT	The user’s balance isn’t enough to cover rent/storage fees (Solana).
NEGATIVE_NEW_AMOUNT_AFTER_FEES	After deducting fees, the resulting amount is zero or negative.
AMOUNT_TOO_LOW_TO_REFUND	The amount to refund is zero or negative, or below the chain’s minimum transfer threshold, so no refund could be issued.
GASLESS_PERMIT_BALANCE_TOO_LOW	The balance available from a gasless permit wasn’t enough to complete the request, so the funds were refunded.
​
Swap Routing & Pricing Errors
Error Code	Description
NO_QUOTES	No liquidity providers returned a valid quote for this swap at fill time.
NO_INTERNAL_SWAP_ROUTES_FOUND	No internal DEX route was found between the specified currencies on this chain.
SWAP_IMPACT_TOO_HIGH	The swap’s price impact at fill time exceeds the acceptable threshold.
INSUFFICIENT_POOL_LIQUIDITY	The DEX pool doesn’t have enough reserves to complete the swap at any price.
SLIPPAGE	The swap couldn’t complete within the given slippage tolerance.
TOO_LITTLE_RECEIVED	The onchain swap executed, but the output amount was below the guaranteed minimum.
GENERATE_SWAP_FAILED	Generating the swap transaction (routing, calldata) failed before execution.
REVERSE_SWAP_FAILED	The reversal swap used to return funds to the user for a refund failed to execute or quote.
​
Transaction Construction & Gas Errors
Error Code	Description
TRANSACTION_TOO_LARGE	The serialized transaction exceeds the maximum payload size for the origin chain or RPC.
SWAP_USES_TOO_MUCH_GAS	The swap transaction would consume more gas than a single block allows.
NEW_CALLDATA_INCLUDES_HIGHER_RENT_FEE	A refreshed permit increased the rent/storage fee beyond the acceptable limit (Solana).
INVALID_GAS_PRICE	The submitted gas price is outside acceptable bounds.
QUOTED_GAS_LIMIT_EXCEEDED	The gas limit required at fill time was significantly higher than the gas limit quoted, so the fill was aborted.
JUPITER_INVALID_TOKEN_ACCOUNT	The token account required for the swap doesn’t exist or is invalid (Solana/Jupiter).
TRANSACTION_SUBMISSION_FAILED	The fill transaction could not be broadcast to the network — for example, the RPC was unavailable, the signer was unavailable, or the transaction was rejected before broadcast (nonce or fee issue). No transaction hash exists for this failure.
TRANSACTION_NOT_INCLUDED	The fill transaction was broadcast successfully and a transaction hash was recorded, but the transaction was not included onchain before Relay’s retry and gas-bump window elapsed. The transaction may still confirm afterwards, so the recorded hash is worth checking.
​
Onchain Execution & Revert Errors
Error Code	Description
EXECUTION_REVERTED	The swap contract call reverted during execution.
TRANSACTION_REVERTED	The transaction reverted at the blockchain level.
MISSING_REVERT_DATA	The transaction reverted, but the reason couldn’t be decoded from the returned data.
CONTRACT_PAUSED	The target contract is currently paused and not accepting calls.
TOKEN_NOT_TRANSFERABLE	The token enforces a non-transferable restriction (for example, a soulbound token).
TRANSFER_FAILED	A token transfer reverted at the contract level.
TRANSFER_FROM_FAILED	Transferring tokens from the user to the contract failed (for example, insufficient allowance).
TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE	The approved allowance is less than the amount being transferred.
TRANSFER_AMOUNT_EXCEEDS_BALANCE	The sender’s token balance is less than the amount being transferred.
INSUFFICIENT_NATIVE_TOKENS_SUPPLIED	The native token value supplied with the transaction is less than required.
INCORRECT_PAYMENT	The value or amount sent doesn’t match what the swap requires.
ZERO_SELL_AMOUNT	The swap was attempted with a zero input amount.
INVALID_SENDER	The address executing the swap isn’t authorized to do so.
INVALID_SIGNER	The signer on the order doesn’t match the address expected by the contract.
DESTINATION_TOKEN_TRANSFER_REJECTED	A token transfer reverted during the destination-side swap — typically the token itself rejecting the transfer (transfer tax, max wallet/transaction limits, or a blacklist).
​
Order & Signature Errors
Error Code	Description
ORDER_EXPIRED	The order’s expiration timestamp passed before it could be executed.
ORDER_IS_CANCELLED	The order was cancelled onchain before it could be filled.
ORDER_ALREADY_FILLED	The order was already fully executed and can’t be filled again.
SIGNATURE_EXPIRED	The signature used for token approval expired before execution.
INVALID_SIGNATURE	The provided signature is invalid or doesn’t match the expected signer.
INVALID_NONCE	The nonce provided has already been used or isn’t valid for this signer.
SEAPORT_INEXACT_FRACTION	The Seaport order specifies a fractional amount that can’t be fulfilled exactly.
SEAPORT_INVALID_FULFILLER	The caller isn’t an authorized fulfiller for this Seaport order.
PROTOCOL_DEADLINE_EXPIRED	The protocol order’s deadline expired before the fill could complete, so a no-fill-or-refund was submitted onchain.
​
Account Abstraction Errors
Error Code	Description
ACCOUNT_ABSTRACTION_INVALID_NONCE	The nonce in the account abstraction user operation is invalid or stale.
ACCOUNT_ABSTRACTION_SIGNATURE_ERROR	The account abstraction user operation’s signature is invalid.
ACCOUNT_ABSTRACTION_GAS_LIMIT	The gas required for account abstraction verification exceeds the allowed limit.
​
NFT Minting Errors
Error Code	Description
MINT_NOT_ACTIVE	The NFT mint phase isn’t currently active.
ERC_1155_TOO_MANY_REQUESTED	The quantity requested exceeds the contract’s allowed batch size.
MINT_QUANTITY_EXCEEDS_MAX_PER_WALLET	The wallet has already minted the maximum quantity allowed.
MINT_QUANTITY_EXCEEDS_MAX_SUPPLY	The requested quantity would exceed the collection’s maximum supply.
​
Other
Error Code	Description
FLUID_DEX_ERROR	The Fluid DEX protocol returned an error during the swap.
MANUAL_ADMIN_REFUND	The request was manually refunded by the Relay team via an admin action.
UNKNOWN	The fill failed for a reason that didn’t match a known error pattern.
N/A	The fill completed without failure.
​
Refund Errors
refundFailReason explains why a refund could not be completed after a fill failed. This field defaults to N/A when no refund failure has occurred.
Error Code	Description
AMOUNT_TOO_LOW_TO_REFUND	The amount to refund is zero or negative, or below the chain’s minimum transfer threshold, so no refund could be issued.
NEGATIVE_NEW_AMOUNT_AFTER_FEES	After deducting fees, the resulting amount is zero or negative.
SWAP_CURRENCY_NOT_ON_ORIGIN	The swap’s output currency isn’t available to bridge back to the origin chain, so the refund can’t be issued in the original currency.
REFUND_RECIPIENT_IS_VASP	The refund recipient was identified as a Virtual Asset Service Provider (VASP), which requires manual review before the refund can be issued.
N/A	No refund failure has occurred.

Was this page helpful?

Yes
No
Handling Rate Limits
Contract Compatibility
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform