"""Browser transport: Pyodide worker <-> main thread <-> wallet connector."""

from __future__ import annotations

import asyncio
import contextlib
import sys
from collections.abc import Callable
from typing import Any

from . import settings
from .base import RpcError, WalletError, WalletProvider, WalletUnavailable

#: Same string as in assets/wallet_bridge.js. Both sides must agree.
CHANNEL_NAME = "flet-wallet"
PROTOCOL_VERSION = 1

#: How long to wait for the main-thread bridge to answer a handshake.
HANDSHAKE_TIMEOUT = 10.0
#: Requests that wait on a human get no deadline at all.
REQUEST_TIMEOUT = 120.0
_INTERACTIVE = frozenset(
    {
        "eth_requestAccounts",
        "eth_sendTransaction",
        "personal_sign",
        "eth_signTypedData_v4",
        "wallet_addEthereumChain",
        "wallet_switchEthereumChain",
        "wallet_connect",
    }
)

#: Picking a wallet is interactive too, and not only for a click: the
#: WalletConnect connector opens a QR modal here and waits for the user to
#: scan it with a phone.
CONNECT_TIMEOUT = 180.0


def is_browser() -> bool:
    """True when this interpreter is Pyodide running in a browser."""
    return sys.platform == "emscripten"


class BrowserWalletProvider(WalletProvider):
    """EIP-1193 tunnelled over BroadcastChannel to a main-thread connector."""

    kind = "browser"

    def __init__(self) -> None:
        import js
        from pyodide.ffi import create_proxy

        self._js = js
        self._channel = js.BroadcastChannel.new(CHANNEL_NAME)
        self._on_message_proxy = create_proxy(self._on_message)
        self._channel.onmessage = self._on_message_proxy

        self._client = f"{js.Math.floor(js.Math.random() * 1e12):.0f}"
        self._pending: dict[str, asyncio.Future] = {}
        self._handlers: dict[str, list[Callable[[Any], None]]] = {}
        self._counter = 0
        self._closed = False
        self.name = "Browser wallet"
        self.wallets: list[dict[str, Any]] = []
        self.remembered: dict[str, Any] | None = None

    # -- plumbing ----------------------------------------------------------

    def _to_js(self, value: Any):
        from pyodide.ffi import to_js

        return to_js(value, dict_converter=self._js.Object.fromEntries)

    def _on_message(self, event) -> None:
        try:
            message = event.data.to_py()
        except AttributeError:
            message = event.data
        if not isinstance(message, dict) or message.get("v") != PROTOCOL_VERSION:
            return

        client = message.get("client")
        if client is not None and client != self._client:
            return

        direction = message.get("dir")
        if direction == "evt":
            for handler in self._handlers.get(message.get("event", ""), []):
                with contextlib.suppress(Exception):
                    handler(message.get("data"))
            return

        if direction != "res":
            return  # our own requests echo nowhere, but be defensive

        future = self._pending.pop(str(message.get("id")), None)
        if future is None or future.done():
            return
        error = message.get("error")
        if error:
            future.set_exception(
                RpcError(
                    int(error.get("code", -32603)),
                    str(error.get("message", "Unknown wallet error")),
                    error.get("data"),
                )
            )
        else:
            future.set_result(message.get("result"))

    async def request(self, method: str, params: list[Any] | None = None) -> Any:
        self._counter += 1
        request_id = str(self._counter)
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future

        self._channel.postMessage(
            self._to_js(
                {
                    "v": PROTOCOL_VERSION,
                    "dir": "req",
                    "id": request_id,
                    "client": self._client,
                    "method": method,
                    "params": params if params is not None else [],
                }
            )
        )

        if method == "bridge_selectWallet":
            timeout = CONNECT_TIMEOUT
        elif method in _INTERACTIVE:
            timeout = None
        else:
            timeout = REQUEST_TIMEOUT

        try:
            return await asyncio.wait_for(future, timeout)
        except asyncio.CancelledError:
            self._pending.pop(request_id, None)
            raise
        except TimeoutError:
            self._pending.pop(request_id, None)
            if method == "bridge_selectWallet":
                raise WalletUnavailable(
                    "The wallet did not finish connecting.\n\n"
                    "If you were scanning a WalletConnect QR code, close the "
                    "dialog and try again."
                ) from None
            raise WalletUnavailable(
                f"The wallet bridge did not answer '{method}' in time."
            ) from None

    def on(self, event: str, handler: Callable[[Any], None]) -> None:
        self._handlers.setdefault(event, []).append(handler)

    async def close(self) -> None:
        # Idempotent per the base-class contract: disconnect can
        # arrive twice (a click plus an empty `accountsChanged`), and
        # destroying an already-destroyed JsProxy raises.
        if self._closed:
            return
        self._closed = True
        try:
            self._channel.close()
        finally:
            self._on_message_proxy.destroy()

    # -- bridge-only methods -----------------------------------------------
    # These never reach a wallet; assets/wallet_bridge.js answers them.

    async def handshake(self) -> dict[str, Any]:
        """Confirm the bridge is loaded and list the wallets it discovered."""
        self._counter += 1
        request_id = str(self._counter)
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        self._channel.postMessage(
            self._to_js(
                {
                    "v": PROTOCOL_VERSION,
                    "dir": "req",
                    "id": request_id,
                    "client": self._client,
                    "method": "bridge_hello",
                    "params": [],
                }
            )
        )
        try:
            return await asyncio.wait_for(future, HANDSHAKE_TIMEOUT)
        except TimeoutError:
            self._pending.pop(request_id, None)
            raise WalletUnavailable(
                "The page loaded without the wallet bridge.\n\n"
                "assets/wallet_bridge.js must be included by index.html -- "
                "`flet publish` copies both out of src/assets/ for you, so "
                "this usually means the page is being served from a stale "
                "dist/ directory."
            ) from None

    async def configure(self, values: dict[str, Any]) -> None:
        """Hand local settings to the bridge before discovery."""
        if values:
            await self.request("bridge_configure", [values])

    async def forget(self) -> None:
        """Stop remembering the last wallet. Called on an explicit disconnect."""
        with contextlib.suppress(WalletError):
            await self.request("bridge_forget")

    async def select_wallet(self, uuid: str, *, silent: bool = False) -> dict[str, Any]:
        """Choose which discovered wallet subsequent requests go to."""
        info = await self.request("bridge_selectWallet", [uuid, {"silent": silent}])
        if isinstance(info, dict):
            self.name = info.get("name") or self.name
            self.connector = info.get("connector") or ""
        return info or {}


async def discover() -> BrowserWalletProvider:
    """Return a browser provider whose bridge answered, or raise."""
    if not is_browser():
        raise WalletUnavailable("Not running in a browser.")

    provider = BrowserWalletProvider()
    print(f"[wallet] {settings.describe()}")
    await provider.configure(settings.bridge_config())
    hello = await provider.handshake()
    provider.wallets = hello.get("wallets") or []
    provider.remembered = hello.get("remembered") or None
    if not provider.wallets:
        await provider.close()
        raise WalletUnavailable(
            "No EIP-1193 wallet found in this browser.\n\n"
            "Install MetaMask, Rabby, Frame's extension, or any wallet that "
            "announces itself via EIP-6963, then reload."
        )
    if len(provider.wallets) == 1 and not provider.wallets[0].get("deliberate"):
        await provider.select_wallet(provider.wallets[0]["uuid"])
    return provider
