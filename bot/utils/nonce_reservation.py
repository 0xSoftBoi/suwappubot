"""Per-wallet EVM nonce reservation — MONEY-PATH.

Fixes a stale-nonce-reuse bug: reading `get_transaction_count(addr)` with the
default (`"latest"`) block tag returns the nonce as of the last MINED block,
which does not account for a transaction this same process just broadcast
but that hasn't mined yet. Two sends issued back-to-back (mobile `/send`,
`/earn/deposit`, `/earn/withdraw`) against the same wallet can therefore both
build a tx with the SAME nonce — the second one silently REPLACES the first
on-chain instead of queuing after it.

`reserve_nonce()` combines the chain's own `"pending"`-block view (which
already accounts for anything sitting in the mempool, including transactions
broadcast by OTHER processes/replicas or the user's own external wallet)
with an in-process last-reserved-nonce counter (which accounts for a tx this
process just built but that the node hasn't indexed into its pending view
yet — there can be a race between `send_raw_transaction` returning and the
node's own mempool/`pending` accounting catching up).

Callers MUST hold their own per-wallet lock (e.g. the asyncio.Lock in
api/routes/mobile.py's `_earn_wallet_lock`) across the entire
reserve -> build -> sign -> broadcast sequence — this module only makes the
reservation bookkeeping itself thread-safe, it does not serialize the
broader read/build/sign/broadcast flow.
"""

import threading
import time
from typing import Dict, Tuple

# How long a reservation is trusted before we fall back to whatever the chain
# reports. Guards against a wedged wallet if a reserved nonce's tx never
# actually made it out (e.g. the process crashed between reserving and
# broadcasting, or broadcast raised before the RPC accepted it) — after this
# many seconds we stop trusting the stale reservation and let the chain's own
# pending-nonce view drive the next send again.
_RESERVATION_TTL_SECONDS = 120

_lock = threading.Lock()
# address (lowercased, 0x-prefixed) -> (last_reserved_nonce, reserved_at_epoch)
_reserved: Dict[str, Tuple[int, float]] = {}


def reserve_nonce(web3, address: str) -> int:
    """Return the next nonce to use for `address` on `web3`'s chain.

    Reads the chain's `"pending"` block nonce (not the default `"latest"`)
    and reconciles it against this process's own last-reserved nonce for the
    address, so back-to-back sends never collide even if the chain's pending
    view hasn't caught up yet.
    """
    from web3 import Web3

    checksum_addr = Web3.to_checksum_address(address)
    key = checksum_addr.lower()
    chain_nonce = web3.eth.get_transaction_count(checksum_addr, "pending")

    with _lock:
        entry = _reserved.get(key)
        now = time.time()
        if entry is not None:
            last_nonce, reserved_at = entry
            expired = (now - reserved_at) > _RESERVATION_TTL_SECONDS
            if not expired and chain_nonce <= last_nonce:
                next_nonce = last_nonce + 1
            else:
                # Either the reservation expired (a dropped/never-broadcast
                # tx must not wedge the wallet forever) or the chain's own
                # pending view has already caught up to (or passed) our last
                # reservation — trust the chain in both cases.
                next_nonce = chain_nonce
        else:
            next_nonce = chain_nonce
        _reserved[key] = (next_nonce, now)
    return next_nonce


def release_nonce(address: str, nonce: int) -> None:
    """Un-reserve `nonce` for `address` if it is still the current
    reservation — used when a tx is deterministically rejected by the node
    BEFORE broadcast (e.g. insufficient funds, intrinsic gas too low) so the
    nonce was never actually consumed on-chain and a retry doesn't skip it
    unnecessarily. Safe no-op if a newer reservation has already superseded
    it (never rewinds past a nonce another in-flight send is relying on)."""
    from web3 import Web3

    checksum_addr = Web3.to_checksum_address(address)
    key = checksum_addr.lower()
    with _lock:
        entry = _reserved.get(key)
        if entry is not None and entry[0] == nonce:
            _reserved.pop(key, None)


def _reset_for_tests() -> None:
    """Test-only: clear all reservations between test cases."""
    with _lock:
        _reserved.clear()
