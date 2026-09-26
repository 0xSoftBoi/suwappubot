"""The API the app actually uses."""

from __future__ import annotations

import contextlib
from collections.abc import Awaitable, Callable
from typing import Any

from . import chains, consent, erc20, icons
from .base import RpcError, WalletError, WalletProvider, WalletUnavailable
from .browser import is_browser
from .chains import Chain, Token


class InvalidRecipient(WalletError):
    """The destination address is missing, malformed, or fails EIP-55."""


class InvalidAmount(WalletError):
    """The amount is not a number, is out of range, or exceeds the balance."""


class InvalidToken(WalletError):
    """The address given for a custom token is not a readable ERC-20."""


class ConnectionCancelled(WalletError):
    """The user dismissed wallet selection."""

    @property
    def rejected_by_user(self) -> bool:
        return True

    def __init__(self) -> None:
        super().__init__("Wallet selection cancelled.")


def _safe_icon(icon: object) -> str | None:
    """Accept `data:image/…` URIs and nothing else."""
    if isinstance(icon, str) and icon.startswith("data:image/"):
        return icon
    return None


class WalletChoice:
    """One option offered when a platform found several wallets."""

    __slots__ = ("icon", "name", "rdns", "uuid")

    def __init__(self, uuid: str, name: str, rdns: str = "", icon: str | None = None):
        self.uuid = uuid
        self.name = name
        self.rdns = rdns
        self.icon = _safe_icon(icon)

    @property
    def initial(self) -> str:
        """Fallback avatar letter for a wallet that announced no icon."""
        return (self.name or "?").strip()[:1].upper() or "?"


#: Given the choices, return the uuid to use -- or None to cancel.
Chooser = Callable[[list[WalletChoice]], Awaitable[str | None]]


def autoconnect() -> bool:
    """Should the app connect at startup, without waiting for a click?"""
    return not is_browser() and consent.autoconnect_allowed()


class Wallet:
    """A connected wallet: an account, on a chain, that can send tokens."""

    def __init__(
        self,
        provider: WalletProvider,
        address: str,
        chain: Chain,
        icon: str | None = None,
    ) -> None:
        self.provider = provider
        self.address = address
        self.chain = chain
        self.icon = _safe_icon(icon)
        self._change_handlers: list[Callable[[], Any]] = []
        self._disconnect_handlers: list[Callable[[], Any]] = []
        provider.on("accountsChanged", self._accounts_changed)
        provider.on("chainChanged", self._chain_changed)
        provider.on("disconnect", lambda _data: self._fire(self._disconnect_handlers))

    # -- lifecycle --------------------------------------------------------

    @classmethod
    async def connect(
        cls, choose: Chooser | None = None, *, always_choose: bool = False
    ) -> Wallet:
        """Find a wallet, authorise an account, and return a live session."""
        provider = await connect_provider()

        options = [
            WalletChoice(
                w["uuid"],
                w.get("name", "Wallet"),
                w.get("rdns", ""),
                w.get("icon") or icons.for_connector(w.get("connector")),
            )
            for w in getattr(provider, "wallets", [])
        ]
        uuid = options[0].uuid if options else ""
        if len(options) > 1 or (always_choose and options and choose):
            uuid = (await choose(options) if choose else options[0].uuid) or ""
            if not uuid:
                await provider.close()
                raise ConnectionCancelled()
            await provider.select_wallet(uuid)  # type: ignore[attr-defined]

        accounts = await provider.request_accounts()
        if not accounts:
            raise WalletUnavailable(
                "The wallet returned no accounts. Is it unlocked?"
            )

        chosen = next(
            (o for o in options if o.uuid == uuid), options[0] if options else None
        )
        consent.record_connect()
        chain = chains.get_chain(await provider.chain_id())
        return cls(
            provider,
            erc20.to_checksum_address(accounts[0]),
            chain,
            icon=chosen.icon if chosen else None,
        )

    async def close(self) -> None:
        """Let go of the transport, without calling it a disconnection."""
        await self.provider.close()

    async def disconnect(self) -> None:
        """End the session because the user said so."""
        consent.record_disconnect()
        forget = getattr(self.provider, "forget", None)
        if forget is not None:
            await forget()
        await self.close()

    @classmethod
    async def restore(cls) -> Wallet | None:
        """Reconnect to the wallet used last time, or return None."""
        provider = await connect_provider()
        wanted = getattr(provider, "remembered", None)
        options = getattr(provider, "wallets", [])
        if not wanted or not options:
            await provider.close()
            return None

        def is_the_one(entry: dict[str, Any]) -> bool:
            if wanted.get("rdns"):
                return bool(entry.get("rdns")) and entry["rdns"] == wanted["rdns"]
            return bool(wanted.get("connector")) and (
                entry.get("connector") == wanted["connector"]
            )

        match = next((w for w in options if is_the_one(w)), None)
        if match is None:
            await provider.close()
            return None

        try:
            await provider.select_wallet(  # type: ignore[attr-defined]
                match["uuid"], silent=True
            )
            accounts = await provider.accounts()
        except WalletError:
            await provider.close()
            return None
        if not accounts:
            await provider.close()
            return None

        consent.record_connect()
        chain = chains.get_chain(await provider.chain_id())
        return cls(
            provider,
            erc20.to_checksum_address(accounts[0]),
            chain,
            icon=_safe_icon(
                match.get("icon") or icons.for_connector(match.get("connector"))
            ),
        )

    # -- identity ---------------------------------------------------------

    @property
    def name(self) -> str:
        """Human-readable name of the wallet that answered."""
        return self.provider.name

    @property
    def short_address(self) -> str:
        return f"{self.address[:6]}…{self.address[-4:]}"

    @property
    def may_wait_on_cosigners(self) -> bool:
        """See `WalletProvider.may_wait_on_cosigners`."""
        return self.provider.may_wait_on_cosigners

    # -- events -----------------------------------------------------------

    def on_change(self, handler: Callable[[], Any]) -> None:
        """Called after the account or chain changed wallet-side."""
        self._change_handlers.append(handler)

    def on_disconnect(self, handler: Callable[[], Any]) -> None:
        """Called when the wallet drops the connection."""
        self._disconnect_handlers.append(handler)

    def _fire(self, handlers: list[Callable[[], Any]]) -> None:
        for handler in handlers:
            with contextlib.suppress(Exception):
                handler()

    def _accounts_changed(self, accounts: Any) -> None:
        if isinstance(accounts, list) and accounts:
            self.address = erc20.to_checksum_address(accounts[0])
            self._fire(self._change_handlers)
        else:
            self._fire(self._disconnect_handlers)

    def _chain_changed(self, chain_id: Any) -> None:
        try:
            resolved = int(chain_id, 16) if isinstance(chain_id, str) else int(chain_id)
        except (TypeError, ValueError):
            return
        self.chain = chains.get_chain(resolved)
        self._fire(self._change_handlers)

    # -- tokens -----------------------------------------------------------

    def known_tokens(self) -> list[Token]:
        """The chain's native asset first, then its curated ERC-20s."""
        return [chains.native_token(self.chain), *self.chain.tokens]

    async def token_at(self, address: str) -> Token:
        """Read `symbol()`/`decimals()` off an arbitrary ERC-20."""
        if not erc20.is_address(address):
            raise InvalidToken("That is not a valid contract address.")
        try:
            decimals = erc20.decode_uint(
                await self.provider.call(address, erc20.encode_decimals())
            )
            symbol = erc20.decode_string(
                await self.provider.call(address, erc20.encode_symbol())
            )
        except RpcError as exc:
            raise InvalidToken(f"Could not read that token: {exc.message}") from exc
        return Token(symbol or "TOKEN", erc20.to_checksum_address(address), decimals)

    async def balance_of(self, token: Token) -> int:
        """Balance in the token's smallest unit. Native and ERC-20 alike."""
        if token.is_native:
            return await self.provider.get_balance(self.address)
        return erc20.decode_uint(
            await self.provider.call(token.address, erc20.encode_balance_of(self.address))
        )

    @staticmethod
    def format(value: int, token: Token, precision: int = 6) -> str:
        return erc20.format_units(value, token.decimals, precision)

    @staticmethod
    def parse(amount: str, token: Token) -> int:
        try:
            return erc20.parse_units(amount, token.decimals)
        except ValueError as exc:
            raise InvalidAmount(str(exc)) from exc

    # -- sending ----------------------------------------------------------

    async def send(self, *, token: Token, to: str, amount: str, balance: int | None = None) -> str:
        """Validate, build and submit a transfer. Returns the transaction hash."""
        recipient = (to or "").strip()
        if not erc20.is_address(recipient):
            raise InvalidRecipient("Enter a valid 0x address")
        if erc20.has_checksum_case(recipient) and not erc20.is_checksum_address(recipient):
            raise InvalidRecipient("Address checksum is invalid — check for typos")
        recipient = erc20.to_checksum_address(recipient)

        value = self.parse(amount, token)
        if value == 0:
            raise InvalidAmount("Amount must be greater than zero")
        if balance is not None and value > balance:
            raise InvalidAmount("More than your balance")

        if token.is_native:
            tx = {"from": self.address, "to": recipient, "value": hex(value)}
        else:
            tx = {
                "from": self.address,
                "to": token.address,
                "value": "0x0",
                "data": erc20.encode_transfer(recipient, value),
            }
        return await self.provider.send_transaction(tx)

    # -- links ------------------------------------------------------------

    def tx_url(self, tx_hash: str) -> str:
        return self.chain.tx_url(tx_hash)


async def connect_provider() -> WalletProvider:
    """Pick the transport for this platform. See `wallet/__init__.py`."""
    from . import connect_wallet

    return await connect_wallet()
