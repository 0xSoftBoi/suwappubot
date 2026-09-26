"""The seam that makes this app cross-platform: EIP-1193."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Any

# EIP-1193 standard error codes we actually care about.
USER_REJECTED_REQUEST = 4001
UNAUTHORIZED = 4100
UNSUPPORTED_METHOD = 4200
DISCONNECTED = 4900
CHAIN_DISCONNECTED = 4901
UNRECOGNIZED_CHAIN = 4902


class WalletError(Exception):
    """Base for everything this package raises."""

    @property
    def rejected_by_user(self) -> bool:
        """Did the human say no, or did something break?

        A property rather than a class attribute because `RpcError`
        answers it by reading its own code, and a subclass cannot narrow
        a writeable attribute into a read-only one.
        """
        return False


def quantity(value: Any, what: str) -> int:
    """A number from a wallet, whatever shape it arrived in."""
    if isinstance(value, str):
        return int(value, 16) if value[:2].lower() == "0x" else int(value)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value)
    raise WalletError(f"The wallet did not say what {what} is.")


class RpcError(WalletError):
    """An error the wallet (or the node behind it) returned."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data

    def __str__(self) -> str:
        return "Rejected in the wallet." if self.rejected_by_user else self.message

    @property
    def rejected_by_user(self) -> bool:
        """True when the human clicked "reject" rather than something breaking."""
        if self.code == USER_REJECTED_REQUEST:
            return True
        return self.code == -32000 and any(
            word in self.message.lower() for word in ("cancel", "reject", "denied")
        )


class WalletUnavailable(WalletError):
    """No wallet transport could be reached on this platform."""


class WalletProvider(ABC):
    """An EIP-1193 provider. Subclasses implement exactly one method."""

    #: Human-readable transport name, shown in the UI.
    name: str = "wallet"
    #: "browser" or "desktop" -- used only for wording in the UI.
    kind: str = "unknown"
    #: Which connector answered, when the transport has several
    #: ("injected", "walletconnect").
    connector: str = ""

    @property
    def may_wait_on_cosigners(self) -> bool:
        """True when a send can legitimately stay pending for a very long time."""
        return self.connector == "walletconnect"

    @abstractmethod
    async def request(self, method: str, params: list[Any] | None = None) -> Any:
        """Send an EIP-1193 request. Raise `RpcError` on a wallet/node error."""

    async def close(self) -> None:
        """Release transport resources. Safe to call more than once."""

    # -- event subscription ------------------------------------------------
    # Browser wallets push `accountsChanged`/`chainChanged`; qeth pushes
    # the same over its WebSocket.

    def on(self, event: str, handler: Callable[[Any], None]) -> None:
        """Subscribe to a wallet event (`accountsChanged`, `chainChanged`)."""

    # -- conveniences ------------------------------------------------------
    # Everything below is written once, in terms of `request`, and is
    # therefore shared by every platform.

    async def request_accounts(self) -> list[str]:
        """Prompt for connection. Returns the authorised accounts."""
        return await self.request("eth_requestAccounts") or []

    async def accounts(self) -> list[str]:
        """Already-authorised accounts. Does not prompt."""
        return await self.request("eth_accounts") or []

    async def chain_id(self) -> int:
        return quantity(await self.request("eth_chainId"), "the network")

    async def get_balance(self, address: str) -> int:
        """Native-token balance in wei."""
        return quantity(
            await self.request("eth_getBalance", [address, "latest"]), "a balance"
        )

    async def call(self, to: str, data: str) -> str:
        """`eth_call` against the latest block. Returns hex-encoded return data."""
        return await self.request("eth_call", [{"to": to, "data": data}, "latest"])

    async def block_number(self) -> int:
        """The chain head, as this endpoint currently sees it."""
        return quantity(await self.request("eth_blockNumber"), "the block number")

    async def transaction_receipt(self, tx_hash: str) -> dict[str, Any] | None:
        """The receipt, or None while the transaction is still pending."""
        return await self.request("eth_getTransactionReceipt", [tx_hash])

    async def send_transaction(self, tx: dict[str, Any]) -> str:
        """Ask the wallet to sign+broadcast. Returns the transaction hash."""
        return await self.request("eth_sendTransaction", [tx])

    async def switch_chain(self, chain_id: int) -> None:
        await self.request("wallet_switchEthereumChain", [{"chainId": hex(chain_id)}])

    async def add_chain(self, params: dict[str, Any]) -> None:
        """Teach the wallet a network it does not know (EIP-3085)."""
        await self.request("wallet_addEthereumChain", [params])
