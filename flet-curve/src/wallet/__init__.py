"""A wallet, on whatever platform this app happens to be running on."""

from __future__ import annotations

from .base import RpcError, WalletError, WalletProvider, WalletUnavailable
from .browser import is_browser
from .chains import Chain, Token
from .session import (
    ConnectionCancelled,
    InvalidAmount,
    InvalidRecipient,
    InvalidToken,
    Wallet,
    WalletChoice,
    autoconnect,
)

__all__ = [
    # the app-facing API
    "Wallet",
    "WalletChoice",
    "autoconnect",
    "Token",
    "Chain",
    # errors -- all of them WalletError, so one `except` covers everything
    "WalletError",
    "WalletUnavailable",
    "RpcError",
    "InvalidRecipient",
    "InvalidAmount",
    "InvalidToken",
    "ConnectionCancelled",
    # the layer underneath, for anyone who needs raw EIP-1193
    "WalletProvider",
    "connect_wallet",
    "is_browser",
    "platform_name",
]


async def connect_wallet() -> WalletProvider:
    """Return a raw EIP-1193 provider for this platform."""
    if is_browser():
        from . import browser

        return await browser.discover()

    from . import desktop

    return await desktop.discover()


def platform_name() -> str:
    return "browser" if is_browser() else "desktop"
