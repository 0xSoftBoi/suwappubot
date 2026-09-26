"""Waiting for a transaction, and then for the node to admit it happened."""

from __future__ import annotations

import asyncio
from typing import Any

from wallet.base import RpcError, WalletError, WalletProvider

#: How often to ask. Ethereum blocks are ~12s; other chains are faster, and
#: an unanswered poll is cheap.
POLL_INTERVAL = 2.0

#: How long to wait for the receipt before giving up on watching.
RECEIPT_TIMEOUT = 180.0

#: How long to wait for the endpoint to catch up to the receipt's block.
CATCH_UP_TIMEOUT = 30.0


class TransactionFailed(WalletError):
    """Mined, and reverted."""


class StillPending(WalletError):
    """Not mined within the time this app was willing to watch."""


async def wait_for_receipt(
    provider: WalletProvider,
    tx_hash: str,
    *,
    timeout: float = RECEIPT_TIMEOUT,
    interval: float = POLL_INTERVAL,
) -> dict[str, Any]:
    """Poll until the transaction is mined. Raise if it failed or timed out."""
    waited = 0.0
    while True:
        try:
            receipt = await provider.transaction_receipt(tx_hash)
        except RpcError:
            receipt = None
        if receipt:
            if _status_of(receipt) == 0:
                raise TransactionFailed(
                    "The transaction was mined but reverted. Nothing changed on chain."
                )
            return receipt
        if waited >= timeout:
            raise StillPending(
                f"{tx_hash[:14]}… has not been mined yet. It may still land; "
                "this app has stopped watching."
            )
        await asyncio.sleep(interval)
        waited += interval


async def wait_for_block(
    provider: WalletProvider,
    block: int,
    *,
    timeout: float = CATCH_UP_TIMEOUT,
    interval: float = POLL_INTERVAL,
) -> bool:
    """Wait until the endpoint's head has reached `block`."""
    if block <= 0:
        return True
    waited = 0.0
    while True:
        try:
            if await provider.block_number() >= block:
                return True
        except (RpcError, ValueError, TypeError):
            return False
        if waited >= timeout:
            return False
        await asyncio.sleep(interval)
        waited += interval


async def wait_for_confirmation(
    provider: WalletProvider,
    tx_hash: str,
    *,
    timeout: float = RECEIPT_TIMEOUT,
    interval: float = POLL_INTERVAL,
) -> int:
    """Mined, successful, and visible to this endpoint."""
    receipt = await wait_for_receipt(
        provider, tx_hash, timeout=timeout, interval=interval
    )
    block = _block_of(receipt)
    await wait_for_block(provider, block, interval=interval)
    return block


def _status_of(receipt: dict[str, Any]) -> int:
    """1 for success, 0 for a mined revert."""
    raw = receipt.get("status")
    if raw is None:
        return 1
    try:
        return int(raw, 16) if isinstance(raw, str) else int(raw)
    except (TypeError, ValueError):
        return 1


def _block_of(receipt: dict[str, Any]) -> int:
    raw = receipt.get("blockNumber")
    try:
        return int(raw, 16) if isinstance(raw, str) else int(raw or 0)
    except (TypeError, ValueError):
        return 0
