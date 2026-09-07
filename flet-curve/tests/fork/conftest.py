"""A forked mainnet, driven through the app's own wallet transport."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from curve.rpc import ChainlistDirectory
from wallet.desktop import DesktopWalletProvider
from wallet.erc20 import encode_transfer

#: How long to wait for anvil to answer after launching it.
STARTUP_TIMEOUT = 90.0

#: Anvil's own unlocked accounts are irrelevant here -- every test acts as
#: some mainnet address -- but one is handy for paying gas from.
ANVIL_MNEMONIC_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _rpc(url: str, method: str, params: list | None = None, timeout: float = 60.0):
    """One JSON-RPC call, stdlib only, raising on an error result."""
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}
    ).encode()
    request = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.load(response)
    if "error" in payload:
        raise AssertionError(f"{method}: {payload['error']}")
    return payload.get("result")


async def _fork_source() -> str:
    """Where to fork from: the env var, else a public endpoint."""
    configured = os.environ.get("FORK_RPC_URL")
    if configured:
        return configured
    directory = ChainlistDirectory()
    endpoints = await directory.endpoints(1)
    if not endpoints:
        pytest.skip("no mainnet endpoint to fork from; set FORK_RPC_URL")
    return endpoints[0]


@pytest.fixture(scope="session")
def anvil() -> str:
    """A forked mainnet on a free port. Yields its URL."""
    binary = shutil.which("anvil") or str(Path.home() / ".config/.foundry/bin/anvil")
    if not Path(binary).exists():
        pytest.skip("anvil not installed (foundry)")

    source = asyncio.run(_fork_source())
    port = _free_port()
    url = f"http://127.0.0.1:{port}"
    pinned = os.environ.get("FORK_BLOCK")
    process = subprocess.Popen(
        [
            binary,
            "--fork-url", source,
            "--port", str(port),
            "--auto-impersonate",   # sign as anybody: that is the whole trick
            "--silent",
            *(("--fork-block-number", pinned) if pinned else ()),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    deadline = time.monotonic() + STARTUP_TIMEOUT
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stderr = (process.stderr.read() or b"").decode()[-400:]
            pytest.skip(f"anvil exited: {stderr}")
        try:
            if _rpc(url, "eth_chainId", timeout=3.0):
                break
        except (urllib.error.URLError, OSError, TimeoutError):
            time.sleep(0.5)
    else:
        process.terminate()
        pytest.skip(f"anvil did not start within {STARTUP_TIMEOUT}s")

    at = int(_rpc(url, "eth_blockNumber"), 16)
    print(f"\nforked mainnet at block {at} -- reproduce with FORK_BLOCK={at}")

    yield url

    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


class Fork:
    """The bits of a fork a test needs, beyond plain RPC."""

    def __init__(self, url: str) -> None:
        self.url = url

    def rpc(self, method: str, params: list | None = None):
        return _rpc(self.url, method, params)

    def wait(self, tx: str, timeout: float = 30.0, *, require_success: bool = True) -> dict:
        """The receipt, once there is one, asserting it did not revert."""
        deadline = time.monotonic() + timeout
        while True:
            receipt = self.rpc("eth_getTransactionReceipt", [tx])
            if receipt is not None:
                assert not require_success or int(receipt["status"], 16) == 1, (
                    f"{tx} reverted"
                )
                return receipt
            assert time.monotonic() < deadline, f"{tx} not mined within {timeout}s"
            time.sleep(0.2)

    def provider(self, timeout: float = 120.0) -> DesktopWalletProvider:
        """The app's real transport, pointed at the fork."""
        return DesktopWalletProvider(self.url)

    def give_eth(self, address: str, ether: int = 100) -> None:
        self.rpc("anvil_setBalance", [address, hex(ether * 10**18)])

    def warm(self, to: str, data: str) -> None:
        """Make a call once through raw RPC, before the app makes it."""
        self.rpc("eth_call", [{"to": to, "data": data}, "latest"])

    def advance(self, seconds: int = 7 * 24 * 3600) -> None:
        """Move the clock forward so time-based rewards accrue."""
        self.rpc("evm_increaseTime", [seconds])
        self.rpc("evm_mine")

    def snapshot(self) -> str:
        return self.rpc("evm_snapshot")

    def revert(self, snapshot: str) -> None:
        """Roll back, and insist that it happened."""
        assert self.rpc("evm_revert", [snapshot]) is True, (
            f"evm_revert({snapshot}) refused: a snapshot is freed by the "
            "revert that uses it, so take a new one before rolling back again"
        )

    def erc20_balance(self, token: str, owner: str) -> int:
        from wallet.erc20 import encode_balance_of

        raw = self.rpc(
            "eth_call", [{"to": token, "data": encode_balance_of(owner)}, "latest"]
        )
        return int(raw, 16) if raw and raw != "0x" else 0

    def fund_erc20(self, token: str, source: str, to: str, amount: int) -> None:
        """Move tokens from whoever already has them."""
        self.give_eth(source, 1)
        tx = self.rpc(
            "eth_sendTransaction",
            [{"from": source, "to": token, "data": encode_transfer(to, amount)}],
        )
        receipt = self.rpc("eth_getTransactionReceipt", [tx])
        assert receipt and int(receipt["status"], 16) == 1, f"funding failed: {tx}"


@pytest.fixture
def fork(anvil: str):
    """A fork, rolled back to its starting state after each test."""
    handle = Fork(anvil)
    snapshot = handle.snapshot()
    yield handle
    handle.revert(snapshot)
