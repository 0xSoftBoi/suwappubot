"""Desktop transport: JSON-RPC over localhost to Frame / qeth."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

from .base import RpcError, WalletProvider, WalletUnavailable

#: Frame's port, which qeth reuses so the same dapps work unchanged.
DEFAULT_ENDPOINT = os.environ.get("FLET_PAY_RPC", "http://127.0.0.1:1248")

#: How the wallet identifies us in its approval dialog.
ORIGIN = "http://flet-pay-example.localhost"

#: How often to ask the wallet whether the account or chain moved.
POLL_INTERVAL = 4.0

#: A read should fail fast; a signature waits on a human.
READ_TIMEOUT = 30.0
SIGNING_TIMEOUT = 600.0
PROBE_TIMEOUT = 1.5

#: Methods that park until the user clicks approve/reject in the wallet.
_INTERACTIVE = frozenset(
    {
        "eth_requestAccounts",
        "eth_sendTransaction",
        "eth_signTransaction",
        "personal_sign",
        "eth_signTypedData",
        "eth_signTypedData_v3",
        "eth_signTypedData_v4",
        "wallet_addEthereumChain",
    }
)


class DesktopWalletProvider(WalletProvider):
    """EIP-1193 over localhost HTTP JSON-RPC."""

    kind = "desktop"

    def __init__(self, endpoint: str = DEFAULT_ENDPOINT, name: str = "") -> None:
        self.endpoint = endpoint
        self.name = name or f"Local wallet ({endpoint})"
        self._id = 0
        self._handlers: dict[str, list[Callable[[Any], None]]] = {}
        self._watch: asyncio.Task[None] | None = None
        self._closed = False
        self._seen: tuple[tuple[str, ...], str] | None = None

    # -- transport ---------------------------------------------------------

    def _post(self, payload: dict, timeout: float) -> dict:
        """Blocking POST. Runs on a worker thread via `asyncio.to_thread`."""
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "Origin": ORIGIN,
                "User-Agent": "flet-pay-example/0.1",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            try:
                return json.loads(exc.read())
            except Exception:
                raise WalletUnavailable(
                    f"Wallet at {self.endpoint} returned HTTP {exc.code}."
                ) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise WalletUnavailable(
                f"No wallet is listening on {self.endpoint}.\n"
                "Start Frame (frame.sh) or qeth, unlock it, and try again."
            ) from exc

    async def request(self, method: str, params: list[Any] | None = None) -> Any:
        self._id += 1
        payload = {
            "jsonrpc": "2.0",
            "id": self._id,
            "method": method,
            "params": params if params is not None else [],
        }
        timeout = SIGNING_TIMEOUT if method in _INTERACTIVE else READ_TIMEOUT
        response = await asyncio.to_thread(self._post, payload, timeout)

        if isinstance(response, dict) and "error" in response and response["error"]:
            error = response["error"]
            if isinstance(error, dict):
                raise RpcError(
                    int(error.get("code", -32603)),
                    str(error.get("message", "Unknown wallet error")),
                    error.get("data"),
                )
            raise RpcError(-32603, str(error))
        return response.get("result") if isinstance(response, dict) else None

    # -- events ------------------------------------------------------------
    # There is no push channel here, so these are synthesised by polling.

    def on(self, event: str, handler: Callable[[Any], None]) -> None:
        self._handlers.setdefault(event, []).append(handler)
        self._start_watching()

    def _start_watching(self) -> None:
        """Begin polling, if there is a loop to poll on."""
        if self._watch is not None or self._closed:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self._watch = loop.create_task(self._poll())

    def _emit(self, event: str, data: Any) -> None:
        for handler in list(self._handlers.get(event, [])):
            with contextlib.suppress(Exception):
                handler(data)

    async def _poll(self) -> None:
        # Reads first, sleeps after: the opening pass seeds the
        # baseline, so a switch made in the first few seconds is
        # still caught.
        while not self._closed:
            try:
                accounts = await self.request("eth_accounts")
                chain_id = await self.request("eth_chainId")
            except (WalletUnavailable, RpcError):
                await asyncio.sleep(POLL_INTERVAL)
                continue

            current = (
                tuple(a for a in (accounts or []) if isinstance(a, str)),
                str(chain_id or ""),
            )
            if self._seen is not None and current != self._seen:
                was = self._seen
                self._seen = current
                if current[0] != was[0]:
                    self._emit("accountsChanged", list(current[0]))
                if current[1] != was[1] and current[1]:
                    self._emit("chainChanged", current[1])
            else:
                self._seen = current
            await asyncio.sleep(POLL_INTERVAL)

    async def close(self) -> None:
        self._closed = True
        if self._watch is not None:
            self._watch.cancel()
            self._watch = None

    # -- discovery ---------------------------------------------------------

    async def probe(self) -> bool:
        """Is a wallet actually listening? Never prompts, never raises."""
        try:
            payload = {
                "jsonrpc": "2.0",
                "id": 0,
                "method": "eth_chainId",
                "params": [],
            }
            await asyncio.to_thread(self._post, payload, PROBE_TIMEOUT)
            return True
        except Exception:
            return False


async def discover(endpoint: str = DEFAULT_ENDPOINT) -> DesktopWalletProvider:
    """Return a reachable desktop provider, or raise `WalletUnavailable`."""
    provider = DesktopWalletProvider(endpoint)
    if not await provider.probe():
        raise WalletUnavailable(
            f"No wallet is listening on {endpoint}.\n\n"
            "This app talks to a local wallet the same way Frame does:\n"
            "  - Frame  -- https://frame.sh\n"
            "  - qeth   -- run it and leave it open\n\n"
            "Both serve JSON-RPC on 127.0.0.1:1248.\n"
            "Set FLET_PAY_RPC to use a different endpoint."
        )
    provider.name = f"Frame / qeth ({endpoint.removeprefix('http://')})"
    return provider
