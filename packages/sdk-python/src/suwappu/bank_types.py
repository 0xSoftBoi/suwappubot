"""Types for `client.bank.*`, mirroring the "Bank" section of packages/sdk/src/types.ts.

Money is ALWAYS a minor-unit integer string (e.g. "1500000" = 1.50 USDC at 6
decimals) and is never converted to float. Response payloads are plain dicts
(JSON as returned by the API, camelCase keys); the TypedDicts below describe the
shapes the TypeScript SDK mirrors field-by-field. Payloads the TypeScript SDK
types as `BankRecord` (invoice, escrow, stream, remittance, vault, position,
credit line, quote, mandate, resource, ops alert, ...) are `BankRecord` here too:
their service return types are not mirrored, so no fields are invented.
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict

from typing_extensions import NotRequired

BankRecord = dict[str, Any]
"""Response payload whose service return type is not mirrored field-by-field."""

BankOwnerType = Literal["user", "agent", "org", "partner_customer", "system"]
BankAccountKind = Literal["checking", "savings", "credit", "escrow", "pool", "treasury"]
BankAccountStatus = Literal["active", "frozen", "closed"]
BankTransferStatus = Literal["pending", "submitted", "confirmed", "failed", "reversed"]
BankRail = Literal["ach", "wire", "fednow", "sepa", "spei", "pix", "upi", "vietqr", "bre_b", "swift"]
BankRampProvider = Literal["bridge", "due"]
BankOrgRole = Literal["owner", "admin", "approver", "accountant", "member", "viewer"]

# Terminal transfer states: stop polling when `status` is one of these.
TERMINAL_TRANSFER_STATUSES: frozenset[str] = frozenset({"confirmed", "failed", "reversed"})


class BankOwnerRef(TypedDict):
    ownerType: Literal["user", "agent", "org", "partner_customer"]
    ownerId: str


class BankAccount(TypedDict):
    id: str
    ownerType: BankOwnerType
    ownerId: str
    kind: BankAccountKind
    currency: str
    asset: str
    chain: str
    walletId: int | None
    walletUserId: int | None
    address: str | None
    status: BankAccountStatus
    segmentProfile: str | None
    balanceMinor: str
    label: str | None
    metadata: dict[str, Any]
    createdAt: str
    updatedAt: str
    balance: str | None
    decimals: int | None


class BankTransfer(TypedDict, total=False):
    id: str
    ownerType: BankOwnerType
    ownerId: str
    idempotencyKey: str
    requestHash: str
    type: str
    fromAccount: str | None
    toAccount: str | None
    toExternal: dict[str, str] | None
    amountMinor: str
    asset: str
    chain: str
    status: BankTransferStatus
    txHash: str | None
    failureReason: str | None
    memo: str | None
    metadata: dict[str, Any]
    createdAt: str
    updatedAt: str
    confirmedAt: str | None


class BankLedgerEntry(TypedDict):
    """Statement entry (a ledger entry plus its pagination cursor)."""

    id: str
    transferId: str
    accountId: str
    direction: Literal["debit", "credit"]
    amountMinor: str
    asset: str
    balanceAfter: str | None
    phase: str
    createdAt: str
    cursor: str


class BankStatementPage(TypedDict):
    entries: list[BankLedgerEntry]
    nextCursor: str | None


class BankReconcileComponents(TypedDict):
    walletMinor: str
    vaultPositionMinor: str
    collateralPostedMinor: str
    unrealizedYieldMinor: str


class BankReconcileReport(TypedDict):
    accountId: str
    chain: str
    asset: str
    address: str | None
    accountsInGroup: list[str]
    ledgerMinor: str
    onchainMinor: str
    components: BankReconcileComponents
    deltaMinor: str
    inFlightTransfers: int
    status: Literal["in_sync", "pending_settlement", "drift"]


class BankAsset(TypedDict, total=False):
    symbol: str
    chain: str
    decimals: int
    family: Literal["evm", "solana"]


# ---- request-side shapes (nested values are passed as camelCase dicts) ----


class BankCollateral(TypedDict):
    amountMinor: str
    source: NotRequired[Literal["wallet", "vault_shares"]]
    savingsAccountId: NotRequired[str]


class BankToExternal(TypedDict):
    address: str


class BankRemitRecipient(TypedDict, total=False):
    """`kind` is one of user | address | claim | payout; other keys per kind."""

    kind: Literal["user", "address", "claim", "payout"]
    telegramId: int
    username: str
    address: str
    label: str
    rail: BankRail
    externalAccountId: str


class BankInvoiceLineItem(TypedDict):
    description: str
    quantity: int | float
    unitAmountMinor: str


class BankEscrowMilestone(TypedDict):
    amountMinor: str
    description: NotRequired[str]
    deliverBy: NotRequired[str]


class BankAgentMandate(TypedDict):
    perCallMaxMinor: str
    dailyCapMinor: str
    allowedAssets: list[str]
    allowedHosts: NotRequired[list[str]]
    allowedPayees: NotRequired[list[str]]
    expiresAt: NotRequired[str]


class BankPayrollRunItem(TypedDict, total=False):
    payeeId: str
    memo: str
    amountMinor: str
    amount: str


class BankPayrollScheduleItem(TypedDict):
    payeeId: str
    amountMinor: str
    memo: NotRequired[str]
    ewaBps: NotRequired[int]
