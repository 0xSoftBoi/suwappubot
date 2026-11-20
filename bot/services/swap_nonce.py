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

- `mined_count <= nonce` **and** the same count at `"pending"` also at or
  below the nonce proves the nonce was never consumed and nothing is queued to
  consume it. Nothing the swap built can land now. The swap is safely FAILED:
  no funds moved. Both views are required — `"latest"` counts mined
  transactions only, so a transaction still in the mempool reads there as
  though the nonce were untouched, and calling that FAILED would both lie and
  invite a retry of a swap that then mines.
- `mined_count <= nonce` but pending above it means the transaction was built,
  signed and broadcast and simply has not mined. Nothing to conclude yet.
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

## Why the nonce is not the primary identity (and what is)

A nonce identifies a *slot*, not a transaction, and that cuts two ways.

First, within one swap: most executors send an ERC20 approval and re-fetch
the nonce for the swap itself, so the recorded nonce is the approval's until
the swap transaction is built. A process that dies in that window leaves a
mined, successful approval and no swap. A success at the recorded nonce
therefore does NOT mean the swap succeeded, which is why
`tx_poller._resolve_hashless_rows` concludes FAILED from a revert but never
COMPLETED from a success.

Second, across swaps: if a swap's broadcast never
landed, the wallet's next send takes that same nonce, and the transaction
occupying it then satisfies the sender and nonce checks exactly as the real
one would. `tx_poller._resolve_hashless_rows` refuses to adopt a hash another
swap row already owns, which covers the realistic collision (the send that
reused the nonce was the user's next swap, and it recorded its own hash). What
it cannot catch is a nonce consumed from the same address by something that
keeps no SwapTransaction row at all — a hot-wallet sweep, a relayer, bulk pay.
For those, RESOLVED could still name a transaction that is not the swap's.

Both of these are removed by `intended_tx_hash`, which is now recorded
alongside the nonce and is the identity resolution prefers. An EVM hash is
keccak256 of the signed payload, so it is fully determined at signing time —
one step before the send that may lose it — and it names ONE transaction.
An approval hashes elsewhere than the swap that follows it, and a later send
that recycles an abandoned nonce hashes elsewhere than the send that abandoned
it, so neither ambiguity above can arise. `resolve_tx_by_intended_hash` turns
that into one `eth_getTransactionReceipt` with no explorer in the loop, and
its success half IS conclusive: HASH_RESOLVED can report COMPLETED, which the
nonce path never does.

## Why both identities are kept

The two halves prove opposite things and neither subsumes the other.

The hash proves the positive: a receipt for it is this swap's outcome,
full stop. What it cannot do is prove a negative — a null receipt means
"in the mempool" and "never broadcast" alike, and no amount of asking
again distinguishes them.

The nonce proves exactly that negative. Unspent at both "latest" and
"pending" means nothing mined this slot and nothing is queued to, so the
transaction cannot land and no funds moved. That proof costs two RPC calls,
needs no explorer, and is the fastest way to clear a row — and it is also
the common case, since a lost broadcast usually never reached a node at all.

So resolution reads the hash first and falls back to the nonce, and rows
written before `intended_tx_hash` existed (whose hashes are not recoverable
from anything the database kept) stay on the nonce path unchanged. For those
rows the old asymmetry remains the safety property to preserve: NOT_MINED is
sound unconditionally, and RESOLVED is only ever as strong as the guard above.
Do not loosen RESOLVED because HASH_RESOLVED is sound — they are different
grades of evidence and the verdicts are named apart for that reason.

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
from typing import Optional, Union

from web3 import Web3

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
NOT_MINED = "not_mined"  # nonce unspent AND nothing pending -> safe to FAIL
PENDING_UNMINED = "pending_unmined"  # a tx at this nonce is in the mempool
CONSUMED_UNKNOWN = "consumed_unknown"  # nonce spent, hash not identified yet
RESOLVED = "resolved"  # hash identified and verified over our own RPC
INDETERMINATE = "indeterminate"  # could not reach the chain; retry later

# Verdicts from the recorded-hash path (`resolve_tx_by_intended_hash`). Kept
# distinct from RESOLVED on purpose: RESOLVED comes from a nonce match, whose
# success half is not trustworthy (see the docstring), while HASH_RESOLVED
# identifies one transaction cryptographically and its success half IS. A
# caller that collapsed the two would silently extend nonce-grade evidence to
# a COMPLETED conclusion, which is the exact bug this module exists to avoid.
HASH_RESOLVED = "hash_resolved"  # the recorded hash has a receipt -> conclusive
HASH_UNMINED = "hash_unmined"  # no receipt for it yet; says nothing on its own


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


def canonical_tx_hash(value: Optional[str]) -> Optional[str]:
    """Normalise a transaction hash to lowercase `0x` + 64 hex, or None.

    Two formats are in circulation and they must not be compared directly.
    `intended_tx_hash` is written canonically by `record_intended_hash`, while
    the existing `tx_hash` column holds whatever an executor returned — and
    under hexbytes 1.x (pinned 1.3.1) `HexBytes.hex()` yields the digest with
    NO `0x` prefix, so historical and current rows carry the bare form. A
    string comparison between the two would silently never match, which on the
    money path means a nonce-reuse guard that always passes.

    Anything that is not a 32-byte hex digest returns None rather than being
    passed through: a caller that got None must not then use the raw value.
    """
    if not value:
        return None
    text = str(value).strip().lower()
    if text.startswith("0x"):
        text = text[2:]
    if len(text) != 64:
        return None
    try:
        int(text, 16)
    except ValueError:
        return None
    return "0x" + text


def tx_hash_variants(value: Optional[str]) -> list[str]:
    """Both spellings of `value`, for querying a column of mixed format.

    Returns the canonical `0x`-prefixed form and the bare form. Used where a
    lookup must match rows written by either convention — notably the guard
    that refuses a hash another swap already owns, which has to fail closed and
    so cannot afford to miss a row on formatting alone.

    Returns an EMPTY list for anything that is not a 32-byte hex digest, and
    that emptiness is the signal callers act on. Passing an unparseable value
    through as a literal to query with would be worse than useless on a money
    path: the query would reliably find nothing and the caller would read that
    as "no other row owns this", which is the permissive answer. An empty list
    lets the caller fail closed instead.
    """
    canonical = canonical_tx_hash(value)
    if not canonical:
        return []
    return [canonical, canonical[2:]]


async def record_intended_hash(signed: Union[str, bytes, bytearray, None]) -> None:
    """Record the hash of a signed payload on the active swap row, BEFORE sending.

    This is the stronger half of this module, and the reason is arithmetic
    rather than engineering: an EVM transaction hash is keccak256 of the signed
    RLP payload, so it is fully determined the instant signing returns — one
    step before `send_raw_transaction`, which is the call that loses it. The
    identity is therefore available exactly where the old failure happened, and
    it names ONE transaction, which `(sender, nonce)` cannot:

    - An approval and the swap that follows it occupy different hashes even
      when the recorded nonce is the same, so a success here cannot be an
      approval mistaken for a swap.
    - A later send that reuses an abandoned nonce produces a different payload
      and so a different hash, so it cannot be mistaken for this swap either.

    Call it after signing and before the matching send, on EVERY send a swap
    makes, including each approval: the column tracks the transaction currently
    in flight, so whichever send loses its outcome is the one whose hash is on
    the row.

    Accepts the signed payload in any form the executors hold it in — a hex
    string with or without `0x`, or raw bytes (the Tempo type-0x76 path encodes
    its own envelope) — because the hash is of the payload either way.

    Never raises, for the same reason `record_intended_nonce` does not: the
    cost of not recording is a row that may need a human, which is the status
    quo being improved on, while the cost of raising is a swap that was ready
    to send and now does not happen.
    """
    swap_id = _active_swap.get()
    if swap_id is None or signed is None:
        return

    try:
        if isinstance(signed, (bytes, bytearray)):
            digest = Web3.keccak(bytes(signed))
        else:
            payload = str(signed).strip()
            if not payload:
                return
            digest = Web3.keccak(hexstr=payload)
        # Web3.to_hex, not HexBytes.hex(): under the pinned hexbytes 1.3.1 the
        # latter returns the digest WITHOUT the 0x prefix, and this column's
        # whole job is to be handed straight to eth_getTransactionReceipt.
        tx_hash = canonical_tx_hash(Web3.to_hex(digest))
    except Exception as e:
        logger.warning(
            "Could not compute intended hash for swap %s (continuing to broadcast): %s",
            swap_id,
            e,
        )
        return

    if not tx_hash:
        return

    def _work():
        with get_db_session() as session:
            db_tx = session.query(SwapTransaction).filter(SwapTransaction.id == swap_id).first()
            if not db_tx:
                return
            db_tx.intended_tx_hash = tx_hash

    try:
        await run_in_db(_work)
    except Exception as e:
        logger.warning(
            "Could not record intended hash %s for swap %s (continuing to broadcast): %s",
            tx_hash,
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


async def _nonce_count(rpc_url: str, sender: str, block: str) -> Optional[int]:
    """`eth_getTransactionCount` at `block` ("latest" or "pending"), parsed."""
    raw = await _rpc(rpc_url, "eth_getTransactionCount", [sender, block])
    if raw is None:
        return None
    try:
        return int(raw, 16) if isinstance(raw, str) else int(raw)
    except (TypeError, ValueError):
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

    # BOTH counts are needed, and asking only for "latest" is a trap worth
    # spelling out: it counts mined transactions only, so a transaction still
    # sitting in the mempool (underpriced gas, a congested chain) reads as
    # though the nonce were untouched. Concluding NOT_MINED there would mark a
    # swap FAILED that goes on to mine minutes later — and FAILED is precisely
    # what the engine's idempotency guard reads as "safe to retry", so it
    # would invite a second send of a swap that did execute.
    #
    # "pending" includes the mempool, so NOT_MINED requires both to be at or
    # below the nonce: nothing mined it and nothing is queued to.
    mined_count = await _nonce_count(rpc_url, sender, "latest")
    if mined_count is None:
        return NonceResolution(INDETERMINATE, detail="transaction_count_unavailable")

    pending_count = await _nonce_count(rpc_url, sender, "pending")
    if pending_count is None:
        # Without the mempool view we cannot safely say "never sent". Treat as
        # retryable rather than guessing in the dangerous direction.
        return NonceResolution(INDETERMINATE, detail="pending_count_unavailable")

    if mined_count <= nonce:
        if pending_count > nonce:
            # Built, signed and broadcast — just not mined yet. Nothing to
            # conclude: it will either mine or be dropped, and the next pass
            # sees which.
            return NonceResolution(
                PENDING_UNMINED,
                detail=f"mined={mined_count} pending={pending_count}",
            )
        # Conclusive: nothing mined this nonce and nothing is queued to. The
        # transaction this swap built is not on-chain and cannot get there.
        return NonceResolution(NOT_MINED, detail=f"next_nonce={mined_count}")

    candidate = await _candidate_hash_from_explorer(chain.name, sender, nonce)
    if not candidate:
        return NonceResolution(CONSUMED_UNKNOWN, detail=f"next_nonce={mined_count}")

    status = await _verify_candidate(rpc_url, candidate, sender, nonce)
    if not status:
        return NonceResolution(CONSUMED_UNKNOWN, detail="candidate_unverified")

    return NonceResolution(RESOLVED, tx_hash=candidate, status=status)


async def resolve_tx_by_intended_hash(
    chain_name: str,
    intended_hash: str,
    expected_sender: Optional[str] = None,
) -> NonceResolution:
    """Work out what became of the transaction whose hash we recorded at signing.

    This is the half with no ambiguity to manage, and it is worth being
    explicit about why, because every caution in the nonce path above exists to
    work around a weakness this one does not have.

    A transaction hash is keccak256 of the signed payload. Only the holder of
    the key could have produced that payload, and any different payload —
    another nonce, another calldata, an approval instead of a swap, a later
    send that recycled the nonce — hashes somewhere else. So a receipt returned
    for this hash is a receipt for the exact transaction this swap signed, and
    its status is the swap's status. There is nothing to disambiguate, no
    explorer in the loop, and one RPC call does the whole job.

    Verdicts:

    - HASH_RESOLVED with `status` COMPLETED or FAILED. Conclusive. This is what
      the nonce path cannot produce for a success.
    - HASH_UNMINED: no receipt. On its own this says nothing — the transaction
      may be in the mempool, or the broadcast may never have left. The caller
      should fall through to the nonce path, which is what can prove the
      second case (`NOT_MINED` requires the nonce to be unspent at both
      "latest" and "pending", and that proof needs no hash).
    - INDETERMINATE: the chain could not be reached, or the receipt did not
      survive the checks below. Retried on the next pass.

    `expected_sender` is defence in depth, not the trust boundary. The hash
    already binds the transaction to our payload; this only catches a column
    that holds the wrong value — a mis-recorded or corrupted row — and costs
    nothing, since `eth_getTransactionReceipt` returns `from` already. A
    mismatch refuses to resolve rather than guessing which field to believe.
    """
    chain = get_chain_by_name(chain_name)
    if not chain or chain.chain_type != ChainType.EVM:
        return NonceResolution(INDETERMINATE, detail="not_an_evm_chain")

    tx_hash = canonical_tx_hash(intended_hash)
    if not tx_hash:
        # Not a 32-byte digest, so it cannot be looked up and must not be
        # passed to the RPC raw.
        return NonceResolution(INDETERMINATE, detail="malformed_intended_hash")

    try:
        rpc_url = rpc_manager.get_rpc_url(chain.name)
    except Exception as e:
        return NonceResolution(INDETERMINATE, detail=f"no_rpc:{e}")
    if not rpc_url:
        return NonceResolution(INDETERMINATE, detail="no_rpc")

    receipt = await _rpc(rpc_url, "eth_getTransactionReceipt", [tx_hash])
    if receipt is None:
        # Either still in the mempool, or the broadcast never landed. Both read
        # as a null receipt, so this is explicitly NOT a failure verdict: the
        # nonce path is the one that can tell those apart.
        return NonceResolution(HASH_UNMINED, tx_hash=tx_hash, detail="no_receipt")
    if not isinstance(receipt, dict):
        return NonceResolution(INDETERMINATE, detail="unreadable_receipt")

    # The node should echo the hash we asked about. If it does not, something
    # between us and the chain is not answering the question we asked, and no
    # outcome should be concluded from its answer.
    echoed = canonical_tx_hash(receipt.get("transactionHash"))
    if echoed and echoed != tx_hash:
        logger.warning(
            "Receipt for %s came back as %s — refusing to resolve from it",
            tx_hash,
            echoed,
        )
        return NonceResolution(INDETERMINATE, detail="receipt_hash_mismatch")

    if expected_sender:
        receipt_from = str(receipt.get("from") or "").lower()
        if receipt_from and receipt_from != str(expected_sender).strip().lower():
            logger.warning(
                "Recorded hash %s is on-chain but sent by %s, not the recorded %s "
                "— refusing to resolve this row from it",
                tx_hash,
                receipt_from,
                expected_sender,
            )
            return NonceResolution(INDETERMINATE, detail="sender_mismatch")

    status = receipt.get("status")
    if status == "0x1" or status == 1:
        return NonceResolution(HASH_RESOLVED, tx_hash=tx_hash, status=SwapStatus.COMPLETED.value)
    if status == "0x0" or status == 0:
        return NonceResolution(HASH_RESOLVED, tx_hash=tx_hash, status=SwapStatus.FAILED.value)

    # A receipt with no readable status: pre-Byzantium, or a node returning a
    # shape we do not know. Mined, but the outcome is not established.
    return NonceResolution(INDETERMINATE, tx_hash=tx_hash, detail=f"unreadable_status:{status!r}")
