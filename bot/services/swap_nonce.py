"""Pre-broadcast nonce recording, and resolution of hashless swap rows.

MONEY-PATH. Nothing here signs or sends; it records an identity before a send
and reads the chain afterwards. But it is what decides whether a swap whose
outcome was never observed gets called COMPLETED, FAILED, or left alone, so
the asymmetry below is the whole point of the module.

## The problem

`SwapTransaction.tx_hash` is written *after* `send_raw_transaction` returns.
When that call times out, or the process dies in the window between the
broadcast and the write, the row ends up with no hash. `tx_poller` filters
its work queue on `tx_hash IS NOT NULL`, so a hashless row is never selected:
it sits UNKNOWN until a human goes and reads the chain, and it blocks
`orders.resume_dca`, which refuses to advance while a tranche's swap is
UNKNOWN. The funds may or may not have moved and the database cannot tell.

## The identity that survives

`(sender, nonce)` is known *before* the send and is also what the chain
indexes afterwards, so it survives exactly the failure that loses the hash.
Recording it costs one write on a path that already does several, and changes
no transaction's construction: every EVM executor in `swap_engine` already
holds its nonce in a local before signing.

## Resolution is deliberately asymmetric

`eth_getTransactionCount(sender, "latest")` is the authoritative half and
needs nothing but the RPC we already use:

- `mined_count <= nonce` proves the nonce was **never consumed**. Nothing the
  swap built can ever land now (any later send reuses the nonce or a higher
  one, and a reorg deep enough to undo this is outside what a poller should
  reason about). The swap is safely FAILED: no funds moved.
- `mined_count > nonce` proves *something* with that nonce mined — ours, or a
  replacement/cancel at the same nonce. That is not enough to call the swap
  done, so this half never resolves anything on its own.

Getting from "consumed" to "which transaction" needs an index by nonce, which
no RPC method provides, so a Blockscout instance is asked for a candidate
hash. An explorer is never trusted with the outcome: the candidate is then
re-fetched over our own RPC and accepted only if `from` and `nonce` both match
what we recorded. A wrong or hostile explorer answer can therefore cost a
wasted RPC round-trip and nothing else — it cannot mark a swap COMPLETED.

Where no instance exists or the lookup fails, the row stays unresolved and is
retried on the next pass. That is the correct resting state: "we know the
nonce was spent but not on what" is strictly more than the row knew before,
and still not grounds to claim an outcome.

## The ceiling of this approach, and what would remove it

A nonce identifies a *slot*, not a transaction. If a swap's broadcast never
landed, the wallet's next send takes that same nonce, and the transaction
occupying it then satisfies the sender and nonce checks exactly as the real
one would. `tx_poller._resolve_hashless_rows` refuses to adopt a hash another
swap row already owns, which covers the realistic collision (the send that
reused the nonce was the user's next swap, and it recorded its own hash). What
it cannot catch is a nonce consumed from the same address by something that
keeps no SwapTransaction row at all — a hot-wallet sweep, a relayer, bulk pay.
For those, RESOLVED could still name a transaction that is not the swap's.

The design that removes this entirely is to persist the transaction hash
itself before broadcasting rather than the nonce: an EVM hash is keccak of the
signed payload, so it is fully determined at signing time, one step before the
send that may lose it. That identifies the exact transaction with no
ambiguity and no explorer. It is a strictly better mechanism than this one and
the recommended follow-up; it is not what this change does, because it would
rewrite what every executor records rather than adding to it.

Until then, the asymmetry is the safety property to preserve: NOT_MINED is
sound unconditionally, and RESOLVED is only ever as strong as the guard above.

That retry is load-bearing, not a formality. Verified live against
eth.blockscout.com: a transaction already mined and already counted by
`eth_getTransactionCount` was missing from the sender's address listing for
some minutes afterwards, because the address index lags the chain tip. So the
*expected* first verdict for a freshly lost broadcast is CONSUMED_UNKNOWN, and
it becomes RESOLVED only on a later pass. Anything that treated the first
CONSUMED_UNKNOWN as final would misreport the most recent — i.e. the most
common — case.

## Scope

EVM only. Solana and Tron have no account nonce — their rows leave both
columns NULL and are never selected by the resolution pass, which keys off the
chain being EVM, not off the nonce being present. Resolving those needs a
recorded signature or recent blockhash instead; that is a separate design
question and deliberately not answered here.
"""

import asyncio
import contextlib
import contextvars
import logging
from typing import Optional

from bot.config.chains import ChainType, get_chain_by_name
from bot.models.swap import SwapStatus, SwapTransaction
from bot.services.rpc_manager import rpc_manager
from bot.utils.http_client import get_session
from database.db import get_session as get_db_session
from database.db import run_in_db

logger = logging.getLogger(__name__)

# Keyless public Blockscout instances, used ONLY to suggest a candidate hash
# for a (sender, nonce) pair. Every answer is verified against our own RPC
# before it is believed, so this map is a convenience, not a trust boundary.
# Kept separate from token_intel's copy on purpose: that one feeds advisory
# token reports, this one feeds money-path resolution, and they should be free
# to diverge (e.g. dropping an instance here that returns stale indexes)
# without silently changing the other.
BLOCKSCOUT_BASE_URLS: dict[str, str] = {
    "ethereum": "https://eth.blockscout.com",
    "base": "https://base.blockscout.com",
    "bsc": "https://bsc.blockscout.com",
    "polygon": "https://polygon.blockscout.com",
    "arbitrum": "https://arbitrum.blockscout.com",
    "optimism": "https://optimism.blockscout.com",
    "gnosis": "https://gnosis.blockscout.com",
    "base_sepolia": "https://base-sepolia.blockscout.com",
    "rootstock": "https://rootstock.blockscout.com",
    "robinhood": "https://robinhoodchain.blockscout.com",
}

# How many of the sender's recent transactions to scan for the nonce. The
# target is the swap's own tx, submitted minutes-to-hours ago, so it is near
# the top of a desc-sorted list; a wallet that has sent 200 transactions since
# then is not one whose stuck swap we can resolve this way, and scanning
# further would turn one unresolved row into an unbounded explorer crawl.
_EXPLORER_SCAN_LIMIT = 200

# Per-call network budget. The poller runs this for several rows per pass and
# must not stall the loop on one slow explorer.
_RPC_TIMEOUT = 10.0
_EXPLORER_TIMEOUT = 12.0


# Resolution verdicts.
NOT_MINED = "not_mined"  # nonce provably never consumed -> safe to FAIL
CONSUMED_UNKNOWN = "consumed_unknown"  # nonce spent, hash not identified yet
RESOLVED = "resolved"  # hash identified and verified over our own RPC
INDETERMINATE = "indeterminate"  # could not reach the chain; retry later


class NonceResolution:
    """Outcome of a (sender, nonce) chain lookup.

    `verdict` is one of the module constants. `tx_hash` and `status` are
    populated only for RESOLVED; `status` is a `SwapStatus` value.
    """

    __slots__ = ("verdict", "tx_hash", "status", "detail")

    def __init__(
        self,
        verdict: str,
        tx_hash: Optional[str] = None,
        status: Optional[str] = None,
        detail: Optional[str] = None,
    ) -> None:
        self.verdict = verdict
        self.tx_hash = tx_hash
        self.status = status
        self.detail = detail

    def __repr__(self) -> str:  # pragma: no cover - diagnostics only
        return (
            f"<NonceResolution {self.verdict} hash={self.tx_hash} "
            f"status={self.status} detail={self.detail}>"
        )


# ---------------------------------------------------------------------------
# Recording (pre-broadcast)
# ---------------------------------------------------------------------------

# The active swap row, if any. A ContextVar and not instance state on the
# engine: SwapEngine is shared across concurrently executing swaps, so an
# attribute would let one user's broadcast stamp its nonce onto another user's
# row. ContextVars are per-task under asyncio, which is exactly the isolation
# this needs, and they make the ~30 call sites one-liners that need no
# executor signature changes.
#
# A no-op default is load-bearing: the same helper is called from code paths
# that legitimately have no swap row (hot-wallet sweeps, bulk pay, the CCTP
# and Hyperliquid relayers), and those must stay writes-to-nowhere rather than
# attaching a nonce to whatever row happened to be in scope.
_active_swap: contextvars.ContextVar[Optional[int]] = contextvars.ContextVar(
    "suwappu_active_swap_id", default=None
)


@contextlib.contextmanager
def swap_nonce_scope(swap_id: Optional[int]):
    """Mark `swap_id` as the row that nonce recordings belong to.

    Wrap the executor dispatch with this. Outside any scope,
    `record_intended_nonce` is a no-op.
    """
    token = enter_swap_nonce_scope(swap_id)
    try:
        yield
    finally:
        exit_swap_nonce_scope(token)


def enter_swap_nonce_scope(swap_id: Optional[int]):
    """Imperative form of `swap_nonce_scope`, for callers that cannot nest.

    `execute_swap`'s dispatch is already wrapped in a long try/except whose
    body would need a 200-line re-indent to sit inside a `with`. Pairing this
    with `exit_swap_nonce_scope` in that try's `finally` gives identical
    scoping with a three-line diff on a money path, which is the safer trade.
    """
    return _active_swap.set(swap_id)


def exit_swap_nonce_scope(token) -> None:
    """Release a scope opened by `enter_swap_nonce_scope`. Never raises.

    Called from a `finally` on the broadcast path: a failure to restore the
    previous scope must not replace the real execution error with its own.
    """
    try:
        _active_swap.reset(token)
    except Exception:  # pragma: no cover - defensive
        _active_swap.set(None)


def active_swap_id() -> Optional[int]:
    """The swap row nonce recordings currently attach to, if any."""
    return _active_swap.get()


async def record_intended_nonce(nonce: Optional[int], sender: Optional[str]) -> None:
    """Record (sender, nonce) on the active swap row, BEFORE broadcasting.

    Call this after the nonce is known and before the transaction is signed or
    sent. Executors that send more than once per swap (an approval, then the
    swap itself) should call it before each send: the column tracks the nonce
    currently in flight, so if the approval's broadcast is the one that gets
    lost, that is the nonce resolution needs — the swap transaction was never
    built.

    Never raises. A failure here must not fail a swap that is otherwise ready
    to send: the cost of not recording is a row that may need a human, which
    is the status quo this is improving on, while the cost of raising is a
    swap that does not happen at all.
    """
    swap_id = _active_swap.get()
    if swap_id is None or nonce is None or not sender:
        return

    if not isinstance(nonce, int) or isinstance(nonce, bool) or nonce < 0:
        logger.warning("Refusing to record non-nonce value %r for swap %s", nonce, swap_id)
        return

    address = str(sender)[:64]

    def _work():
        with get_db_session() as session:
            db_tx = session.query(SwapTransaction).filter(SwapTransaction.id == swap_id).first()
            if not db_tx:
                return
            db_tx.sender_address = address
            db_tx.nonce = nonce

    try:
        await run_in_db(_work)
    except Exception as e:
        logger.warning(
            "Could not record nonce %s for swap %s (continuing to broadcast): %s",
            nonce,
            swap_id,
            e,
        )


# ---------------------------------------------------------------------------
# Resolution (post-hoc, from the chain)
# ---------------------------------------------------------------------------


async def _rpc(rpc_url: str, method: str, params: list):
    """One JSON-RPC call. Returns the `result` field, or None on any failure."""
    http_session = await get_session()
    payload = {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}

    async def _do():
        async with http_session.post(rpc_url, json=payload) as response:
            if response.status != 200:
                return None
            data = await response.json()
            if data.get("error"):
                logger.debug("RPC %s error: %s", method, data["error"])
                return None
            return data.get("result")

    try:
        return await asyncio.wait_for(_do(), timeout=_RPC_TIMEOUT)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.debug("RPC %s failed against %s: %s", method, rpc_url, e)
        return None


def _blockscout_base(chain_name: str) -> Optional[str]:
    """A keyless Blockscout base URL for `chain_name`, if one is known.

    Falls back to the chain's configured explorer when that explorer is itself
    a Blockscout deployment (several chains in `chains.py` are), since those
    expose the same keyless API. Etherscan-family explorers are skipped: their
    equivalent endpoint needs an API key this deployment does not hold.
    """
    base = BLOCKSCOUT_BASE_URLS.get(chain_name)
    if base:
        return base

    chain = get_chain_by_name(chain_name)
    explorer = (getattr(chain, "explorer_url", "") or "") if chain else ""
    if "blockscout" in explorer:
        return explorer.rstrip("/")
    return None


async def _candidate_hash_from_explorer(chain_name: str, sender: str, nonce: int) -> Optional[str]:
    """Ask a Blockscout instance which of `sender`'s txs used `nonce`.

    Returns a *candidate* hash only. The caller must verify it over our own
    RPC — this value is untrusted third-party data and is never used to decide
    a swap's outcome by itself.
    """
    base = _blockscout_base(chain_name)
    if not base:
        return None

    http_session = await get_session()
    url = f"{base}/api/v2/addresses/{sender}/transactions"

    async def _do():
        scanned = 0
        params = {"filter": "from"}
        # Blockscout v2 paginates via an opaque next_page_params blob.
        while scanned < _EXPLORER_SCAN_LIMIT:
            async with http_session.get(url, params=params) as response:
                if response.status != 200:
                    return None
                data = await response.json()
            items = data.get("items") or []
            if not items:
                return None
            for item in items:
                scanned += 1
                try:
                    item_nonce = int(item.get("nonce"))
                except (TypeError, ValueError):
                    continue
                if item_nonce == nonce:
                    return item.get("hash")
                # Results are newest-first, so once we are below the target
                # nonce every remaining page is older still.
                if item_nonce < nonce:
                    return None
            next_params = data.get("next_page_params")
            if not next_params:
                return None
            params = {"filter": "from", **next_params}
        return None

    try:
        return await asyncio.wait_for(_do(), timeout=_EXPLORER_TIMEOUT)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.debug("Blockscout nonce lookup failed for %s/%s: %s", chain_name, sender, e)
        return None


async def _verify_candidate(rpc_url: str, tx_hash: str, sender: str, nonce: int) -> Optional[str]:
    """Confirm `tx_hash` really is `sender`'s transaction at `nonce`.

    Returns the resulting `SwapStatus` value, or None if the transaction does
    not match or has no receipt yet. This is the trust boundary: the explorer
    suggested the hash, our own RPC decides whether it is ours and how it
    ended.
    """
    tx = await _rpc(rpc_url, "eth_getTransactionByHash", [tx_hash])
    if not isinstance(tx, dict):
        return None

    tx_from = (tx.get("from") or "").lower()
    if tx_from != sender.lower():
        logger.warning(
            "Explorer suggested %s for %s nonce %s but its sender is %s — rejecting",
            tx_hash,
            sender,
            nonce,
            tx_from,
        )
        return None

    try:
        tx_nonce = (
            int(tx.get("nonce"), 16) if isinstance(tx.get("nonce"), str) else int(tx["nonce"])
        )
    except (TypeError, ValueError, KeyError):
        return None
    if tx_nonce != nonce:
        logger.warning(
            "Explorer suggested %s for nonce %s but its nonce is %s — rejecting",
            tx_hash,
            nonce,
            tx_nonce,
        )
        return None

    receipt = await _rpc(rpc_url, "eth_getTransactionReceipt", [tx_hash])
    if not isinstance(receipt, dict):
        # Matches us, but still in the mempool. Not an outcome yet.
        return None

    status = receipt.get("status")
    if status == "0x1":
        return SwapStatus.COMPLETED.value
    if status == "0x0":
        return SwapStatus.FAILED.value
    return None


async def resolve_tx_by_sender_nonce(chain_name: str, sender: str, nonce: int) -> NonceResolution:
    """Work out what became of `sender`'s transaction at `nonce`.

    See the module docstring for why this is asymmetric: proving a nonce was
    never consumed needs only our own RPC and is conclusive, while naming the
    transaction that consumed it needs an explorer and is always verified
    before it is believed.
    """
    chain = get_chain_by_name(chain_name)
    if not chain or chain.chain_type != ChainType.EVM:
        return NonceResolution(INDETERMINATE, detail="not_an_evm_chain")

    if not sender or nonce is None or nonce < 0:
        return NonceResolution(INDETERMINATE, detail="incomplete_identity")

    try:
        rpc_url = rpc_manager.get_rpc_url(chain.name)
    except Exception as e:
        return NonceResolution(INDETERMINATE, detail=f"no_rpc:{e}")
    if not rpc_url:
        return NonceResolution(INDETERMINATE, detail="no_rpc")

    count_hex = await _rpc(rpc_url, "eth_getTransactionCount", [sender, "latest"])
    if count_hex is None:
        return NonceResolution(INDETERMINATE, detail="transaction_count_unavailable")

    try:
        mined_count = int(count_hex, 16) if isinstance(count_hex, str) else int(count_hex)
    except (TypeError, ValueError):
        return NonceResolution(INDETERMINATE, detail="unparseable_transaction_count")

    if mined_count <= nonce:
        # Conclusive, and the direction that matters: the nonce was never
        # spent, so nothing this swap built is on-chain or can get there.
        return NonceResolution(NOT_MINED, detail=f"next_nonce={mined_count}")

    candidate = await _candidate_hash_from_explorer(chain.name, sender, nonce)
    if not candidate:
        return NonceResolution(CONSUMED_UNKNOWN, detail=f"next_nonce={mined_count}")

    status = await _verify_candidate(rpc_url, candidate, sender, nonce)
    if not status:
        return NonceResolution(CONSUMED_UNKNOWN, detail="candidate_unverified")

    return NonceResolution(RESOLVED, tx_hash=candidate, status=status)
