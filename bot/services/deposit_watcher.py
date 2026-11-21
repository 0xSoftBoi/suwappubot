"""Credits inbound custodial deposits.

Implements the pipeline in ``docs/operations/deposit-crediting.md``:

    assign → detect → confirm → credit (idempotent) → sweep

Before this existed, ``TransactionType.DEPOSIT`` was defined and never written:
every user was shown one shared omnibus address, and nothing on-chain could be
attributed back to a depositor. EVM has no memo field, so attribution has to
come from the address itself — each user now has their own (see
``hot_wallet_service.get_or_create_user_deposit_wallet``).

Scope, deliberately narrow and stated rather than implied:

* **Allowlisted ERC-20 tokens only.** Native ETH/BNB/MATIC transfers emit no
  log, so detecting them means either scanning every transaction or diffing
  balances — neither of which yields a per-transfer identity to make crediting
  idempotent. Native deposits are NOT credited, and the UI must not offer them.
* **EVM only.** Solana SPL deposits need a different scan; until that lands the
  Solana deposit address is not presented as fundable.
* Anything not on the allowlist is ignored, which is also the spam-token
  defence: unsolicited airdrops must never enter the ledger.
"""

import asyncio
import logging
import re
import time
from datetime import datetime
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from sqlalchemy import text
from web3 import Web3

from bot.config.tokens import get_token_address, get_token_decimals
from bot.models.custodial import (
    CustodialTransaction,
    TransactionStatus,
    TransactionType,
)
from database.db import get_session

logger = logging.getLogger(__name__)

# keccak256("Transfer(address,address,uint256)")
TRANSFER_TOPIC0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

# Confirmations before a deposit is credited. Finality is a policy decision, not
# a property of the chain: these follow the thresholds major exchanges publish.
# L2 values are deliberately conservative — a sequencer reorg is rare but the
# cost of crediting one is a real loss.
CONFIRMATIONS: Dict[str, int] = {
    "ethereum": 12,
    "bsc": 15,
    "polygon": 128,
    "arbitrum": 20,
    "optimism": 20,
    "base": 20,
}

# Tokens we credit, per chain. An allowlist rather than a denylist: a token we
# have not vetted is a token we do not price, cannot sweep, and must not book.
ALLOWLIST: Dict[str, Tuple[str, ...]] = {
    "ethereum": ("USDC", "USDT"),
    "bsc": ("USDC", "USDT"),
    "polygon": ("USDC", "USDT"),
    "arbitrum": ("USDC", "USDT"),
    "optimism": ("USDC", "USDT"),
    "base": ("USDC",),
}

# Per-asset floor. Below this the sweep costs more than the deposit is worth,
# so crediting it would hand the user a balance we cannot economically move.
MIN_DEPOSIT: Dict[str, Decimal] = {"USDC": Decimal("1"), "USDT": Decimal("1")}

# getLogs range per request. Public RPCs commonly cap around 10k blocks; stay
# well under so one aggressive provider cannot stall a chain's cursor.
MAX_BLOCK_RANGE = 2_000

# Smallest range the watcher will shrink to when a provider rejects a range as
# too large. Below this a provider is not capping range, it is just broken.
MIN_BLOCK_RANGE = 100

# Providers phrase "your range is too big" in many ways (BlockPI: "limited to
# 1024 block range"; others "-32005 limit exceeded", "query returned more than
# N results"). Halving the range is the fix for these; switching endpoint is
# not, since the next provider usually has a cap of its own.
#
# Deliberately NOT matched, because halving does nothing for them and they need
# a different endpoint instead: bare "limit exceeded" and "-32005", which
# providers also use for RATE limits ("Rate limit exceeded", "compute units
# limit exceeded"); and "block range extends beyond / exceeds current head",
# which means the node is lagging, not that the range is too wide.
_RANGE_LIMIT_ERROR = re.compile(
    r"limited to \d+ block|"
    r"block range (?:is )?(?:too|larger|greater)|"
    r"block range exceeds? (?:the )?(?:max|limit|allowed)|"
    r"range (?:is )?too (?:large|wide|big)|"
    r"exceed(?:s|ed)? (?:the )?(?:max(?:imum)? )?(?:allowed )?(?:block )?range|"
    r"more than \d+ (?:results|logs|blocks)|query returned more|"
    r"too many (?:logs|results|blocks)",
    re.IGNORECASE,
)

# How long an endpoint that failed a log query is skipped for log queries only.
LOGS_ENDPOINT_COOLDOWN = 600
# Endpoints tried per range before giving up for this pass. Lagging endpoints
# are skipped without counting, so a stale one cannot hide a caught-up one.
MAX_LOG_ENDPOINTS = 3

# Passes a single deposit may fail to book, while the database is otherwise
# answering, before it is quarantined (logged CRITICAL for a manual credit) so
# the cursor can move on. Without a bound, one poison log stalls the chain.
MAX_CREDIT_ATTEMPTS = 10

# Addresses per getLogs topic filter. The topic list goes in the URL-ish JSON
# body and providers differ on how large a filter they accept.
ADDRESS_CHUNK = 100


class _RangeLimited(Exception):
    """A provider rejected the block range as too large."""


class _Lagging(Exception):
    """A failover endpoint has not confirmed the end of the requested range.

    ``confirmed`` is the highest block it has confirmed, so the caller can
    re-read a shorter range that the endpoint can vouch for.
    """

    def __init__(self, message: str, confirmed: int):
        super().__init__(message)
        self.confirmed = confirmed


# How far back to start when a chain has never been scanned. Deposits sent
# before the watcher existed are an ops question (see the runbook), not
# something to silently sweep up on first boot.
COLD_START_LOOKBACK = 500


def _topic_for_address(address: str) -> str:
    """Left-pad an address to a 32-byte topic."""
    return "0x" + address.lower().replace("0x", "").rjust(64, "0")


def _address_from_topic(topic: str) -> str:
    """Recover the address from a 32-byte indexed topic."""
    raw = topic.hex() if hasattr(topic, "hex") else str(topic)
    return "0x" + raw.replace("0x", "")[-40:]


class DepositWatcher:
    """Scans EVM chains for inbound transfers to per-user deposit addresses."""

    def __init__(self, poll_seconds: int = 60):
        self.poll_seconds = poll_seconds
        self._task: Optional[asyncio.Task] = None
        self._running = False
        # Per-chain block range that the current providers accept, learned by
        # halving on range errors so we stop re-probing an oversized range.
        self._span: Dict[str, int] = {}
        # (chain, url) -> monotonic time until which that endpoint is skipped
        # for log queries. Local on purpose; see RPCManager.web3_for_url.
        self._logs_cooldown: Dict[Tuple[str, str], float] = {}
        self._credit_failures: Dict[str, int] = {}

    # --- cursor -----------------------------------------------------------

    def _get_cursor(self, chain: str) -> Optional[int]:
        with get_session() as session:
            row = session.execute(
                text("SELECT last_scanned_block FROM deposit_scan_cursors WHERE chain = :c"),
                {"c": chain},
            ).first()
            return int(row[0]) if row else None

    def _set_cursor(self, chain: str, block: int) -> None:
        with get_session() as session:
            updated = session.execute(
                text(
                    "UPDATE deposit_scan_cursors SET last_scanned_block = :b, updated_at = :t "
                    "WHERE chain = :c"
                ),
                {"b": int(block), "t": datetime.utcnow(), "c": chain},
            ).rowcount
            if not updated:
                session.execute(
                    text(
                        "INSERT INTO deposit_scan_cursors (chain, last_scanned_block, updated_at) "
                        "VALUES (:c, :b, :t)"
                    ),
                    {"c": chain, "b": int(block), "t": datetime.utcnow()},
                )

    # --- credit -----------------------------------------------------------

    def _credit(
        self,
        *,
        user_id: int,
        chain: str,
        token_symbol: str,
        token_address: str,
        amount: Decimal,
        tx_hash: str,
        log_index: int,
        block_number: int,
        from_address: str,
        to_address: str,
    ) -> bool:
        """Book one deposit. Returns True if this call credited it.

        The ledger row and the balance move commit together. The row carries a
        UNIQUE(user_id, idempotency_key), so a re-scan of the same block range —
        after a crash, a restart, or a rewound cursor — raises instead of
        crediting twice, and we treat that as "already done".
        """
        from bot.services.hot_wallet import hot_wallet_service

        key = f"deposit:{chain}:{tx_hash}:{log_index}"
        try:
            with get_session() as session:
                session.add(
                    CustodialTransaction(
                        user_id=user_id,
                        tx_type=TransactionType.DEPOSIT.value,
                        status=TransactionStatus.COMPLETED.value,
                        chain=chain,
                        token_symbol=token_symbol,
                        token_address=token_address,
                        amount=str(amount),
                        tx_hash=tx_hash,
                        from_address=from_address,
                        to_address=to_address,
                        idempotency_key=key,
                        notes=f"block {block_number}, log {log_index}",
                        completed_at=datetime.utcnow(),
                    )
                )
                session.flush()
                hot_wallet_service.update_custodial_balance(
                    user_id=user_id,
                    chain=chain,
                    token_symbol=token_symbol,
                    amount=amount,
                    operation="add",
                    session=session,
                )
            logger.info(
                "Credited deposit %s %s to user %s on %s (%s)",
                amount,
                token_symbol,
                user_id,
                chain,
                tx_hash,
            )
            return True
        except Exception as exc:
            # The unique index doing its job is the expected path on a re-scan.
            # Decide that by asking whether the ledger row exists, NOT by
            # matching "unique" in the message: update_custodial_balance can hit
            # a unique race on the BALANCE row, which rolls the ledger row back
            # too, and reading that as "already credited" loses the deposit.
            # (SQLite's message also never names the index, so name-matching
            # cannot work on both backends.)
            done = self._already_credited(user_id, key)
            if done:
                logger.debug("Deposit %s already credited", key)
                self._credit_failures.pop(key, None)
                return False
            # Nothing was credited: the ledger row and the balance move rolled
            # back together. Raise rather than return, so scan_chain stops before
            # advancing the cursor and the next pass retries this range. This
            # used to return False, the scan carried on, and the cursor moved
            # past a deposit that was never booked — a transient DB error was
            # enough to lose it for good. Re-crediting is idempotent; skipping
            # is permanent.
            if done is None:
                # The database itself is unreachable: an outage, not this
                # deposit. Retry for as long as it takes; never count it.
                logger.error("Failed to credit deposit %s (database unreachable): %s", key, exc)
                raise
            failures = self._credit_failures.get(key, 0) + 1
            if failures < MAX_CREDIT_ATTEMPTS:
                self._credit_failures[key] = failures
                logger.error(
                    "Failed to credit deposit %s (attempt %d/%d): %s",
                    key,
                    failures,
                    MAX_CREDIT_ATTEMPTS,
                    exc,
                )
                raise
            # The database answers but this one deposit will not book: a poison
            # row. Holding the cursor on it would stall every deposit on the
            # chain behind it, so quarantine it loudly (CRITICAL reaches Sentry)
            # with everything needed to credit it by hand, and move on.
            self._credit_failures.pop(key, None)
            logger.critical(
                "DEPOSIT QUARANTINED, manual credit required: key=%s user_id=%s "
                "chain=%s token=%s amount=%s tx=%s log=%s block=%s to=%s error=%s",
                key,
                user_id,
                chain,
                token_symbol,
                amount,
                tx_hash,
                log_index,
                block_number,
                to_address,
                exc,
            )
            return False

    def _already_credited(self, user_id: int, key: str) -> Optional[bool]:
        """Whether the ledger row for this deposit is committed; None if unknown."""
        try:
            with get_session() as session:
                return (
                    session.query(CustodialTransaction.id)
                    .filter(
                        CustodialTransaction.user_id == user_id,
                        CustodialTransaction.idempotency_key == key,
                    )
                    .first()
                    is not None
                )
        except Exception:
            # Cannot tell (the database is not answering). The caller treats
            # this as an outage and retries the pass, which is safe; guessing
            # "credited" is not.
            return None

    # --- scan -------------------------------------------------------------

    def _token_map(self, chain: str) -> Dict[str, str]:
        """token contract address (lowercase) -> symbol, for allowlisted tokens."""
        out: Dict[str, str] = {}
        for symbol in ALLOWLIST.get(chain, ()):
            addr = get_token_address(symbol, chain)
            if addr:
                out[addr.lower()] = symbol
        return out

    async def scan_chain(self, chain: str) -> int:
        """One pass over a chain. Returns the number of deposits credited."""
        from bot.services.hot_wallet import hot_wallet_service
        from bot.services.rpc_manager import rpc_manager

        watched = hot_wallet_service.list_user_deposit_wallets("evm")
        if not watched:
            return 0
        by_address = {addr.lower(): uid for uid, addr in watched}

        tokens = self._token_map(chain)
        if not tokens:
            logger.debug("No allowlisted tokens resolved for %s — skipping", chain)
            return 0

        web3 = rpc_manager.get_web3(chain)
        # Read the URL now, with no await in between: another task can rebuild
        # the cache during the awaits below, and a mislabelled primary would
        # cool down the wrong endpoint while the failing one gets retried.
        primary_url = rpc_manager.current_url(chain)
        head = await asyncio.to_thread(lambda: web3.eth.block_number)
        safe_head = head - CONFIRMATIONS.get(chain, 12)
        if safe_head <= 0:
            return 0

        cursor = self._get_cursor(chain)
        if cursor is None:
            cursor = max(0, safe_head - COLD_START_LOOKBACK)
            # Persist the anchor NOW, before the first read. It used to live
            # only in a local variable, so on a chain whose reads were failing
            # every pass recomputed it from the current head: the window slid
            # forward a minute at a time and any deposit that fell behind it
            # was never scanned at all. Pinning it means a failed pass retries
            # the same window instead of abandoning it.
            self._set_cursor(chain, cursor)
            logger.info("Cold start for %s at block %s", chain, cursor)

        if cursor >= safe_head:
            return 0

        from_block = cursor + 1
        addresses = list(by_address.keys())
        # Filter by token contract as well as recipient. Allnodes/PublicNode
        # reject an address-less log query outright ("Please specify an
        # address"), which is what stalled base, polygon and bsc. It is also
        # strictly narrower and loses nothing: _handle_log discards any log
        # whose contract is not in `tokens` anyway.
        token_addresses = [Web3.to_checksum_address(a) for a in tokens]
        span = self._span.get(chain, MAX_BLOCK_RANGE)

        while True:
            to_block = min(safe_head, cursor + span)
            try:
                logs = await self._fetch_range(
                    chain,
                    web3,
                    primary_url,
                    from_block,
                    to_block,
                    token_addresses,
                    addresses,
                    # At the floor, a "range" error can only be the provider
                    # misbehaving, so let it fall through to failover instead.
                    allow_range_shrink=span > MIN_BLOCK_RANGE,
                )
                break
            except _RangeLimited as exc:
                # Only raised while span > MIN_BLOCK_RANGE (see allow_range_shrink).
                span = max(MIN_BLOCK_RANGE, span // 2)
                self._span[chain] = span
                logger.info("get_logs range on %s halved to %d blocks: %s", chain, span, exc)
            except _Lagging as exc:
                # The primary failed and the best fallback has confirmed only
                # part of the range. Read just that part; to_block strictly
                # shrinks each time, so this terminates.
                if from_block <= exc.confirmed < to_block:
                    safe_head = exc.confirmed
                    logger.info(
                        "get_logs on %s: reading %s-%s via a fallback that confirms only that far",
                        chain,
                        from_block,
                        safe_head,
                    )
                    continue
                logger.warning("get_logs failed on %s %s-%s: %s", chain, from_block, to_block, exc)
                return 0
            except Exception as exc:
                # Do NOT advance the cursor past a range we failed to read —
                # that is how a deposit goes missing permanently.
                logger.warning("get_logs failed on %s %s-%s: %s", chain, from_block, to_block, exc)
                return 0

        credited = 0
        for log in logs:
            credited += 1 if self._handle_log(log, chain, tokens, by_address) else 0

        self._set_cursor(chain, to_block)
        # Grow the range back after a success. A transient error that happens
        # to match the range pattern would otherwise pin the span at the floor
        # for the life of the process, and on a fast chain (bsc produces ~80
        # blocks a minute) 100 blocks per pass cannot work through a backlog.
        # On a provider with a hard cap this costs one rejected read per pass.
        if span < MAX_BLOCK_RANGE:
            self._span[chain] = min(MAX_BLOCK_RANGE, span * 2)
        return credited

    async def _fetch_range(
        self,
        chain: str,
        primary: Web3,
        primary_url: Optional[str],
        from_block: int,
        to_block: int,
        token_addresses: List[str],
        addresses: List[str],
        *,
        allow_range_shrink: bool,
    ) -> list:
        """Every matching log in [from_block, to_block], or raise.

        All recipient chunks must succeed for the range to count; a partial read
        would let the cursor move past logs we never saw. Raises _RangeLimited
        when a provider says the range is too large, so the caller can halve it,
        and the last error otherwise.
        """
        out: list = []
        for i in range(0, len(addresses), ADDRESS_CHUNK):
            chunk_end = i + ADDRESS_CHUNK
            chunk = addresses[i:chunk_end]
            params = {
                "fromBlock": from_block,
                "toBlock": to_block,
                "address": token_addresses,
                "topics": [TRANSFER_TOPIC0, None, [_topic_for_address(a) for a in chunk]],
            }
            out.extend(
                await self._get_logs_with_failover(
                    chain, primary, primary_url, params, allow_range_shrink
                )
            )
        return out

    async def _get_logs_with_failover(
        self,
        chain: str,
        primary: Web3,
        primary_url: Optional[str],
        params: dict,
        allow_range_shrink: bool,
    ) -> list:
        """eth_getLogs, falling over to other endpoints when one rejects it.

        The RPC manager never probes eth_getLogs, so an endpoint that answers
        block-number and eth_call fine but rejects every log query stays healthy
        and keeps getting selected — which is how ethereum sat on a Blastapi
        endpoint returning HTTP 400 to every log query, pass after pass. Failed
        endpoints are cooled down here, for log queries only.
        """
        from bot.services.rpc_manager import rpc_manager

        now = time.monotonic()
        candidates: List[Tuple[Optional[str], bool]] = []
        if primary_url is None or self._logs_cooldown.get((chain, primary_url), 0.0) <= now:
            candidates.append((primary_url, True))
        for url in rpc_manager.get_healthy_urls(chain):
            if url != primary_url and self._logs_cooldown.get((chain, url), 0.0) <= now:
                candidates.append((url, False))
        if not candidates:
            # Every endpoint is cooling down; fall back to the primary rather
            # than skip the pass, since a cooldown is a guess and the read is cheap.
            candidates.append((primary_url, True))

        to_block = params["toBlock"]
        confirmations = CONFIRMATIONS.get(chain, 12)
        last_exc: Optional[Exception] = None
        best_lag: Optional[_Lagging] = None
        attempts = 0
        for url, is_primary in candidates:
            if attempts >= MAX_LOG_ENDPOINTS:
                break
            # Built lazily: most passes succeed on the primary and need none.
            client = primary if is_primary else rpc_manager.web3_for_url(chain, url)

            def _read(c: Web3 = client, check_head: bool = not is_primary) -> list:
                # safe_head came from the PRIMARY. A failover endpoint behind it
                # may answer a log query for blocks it has not reached with an
                # empty list instead of an error, and trusting that would move
                # the cursor past real deposits. And reaching to_block is not
                # enough: at its own tip the block may be on a fork the primary
                # already abandoned, and a credit from an orphaned block is
                # permanent. So require to_block to be as deeply confirmed on
                # this endpoint as the primary required it to be.
                if check_head:
                    head = c.eth.block_number
                    if head - confirmations < to_block:
                        raise _Lagging(
                            f"head {head} has not confirmed block {to_block} "
                            f"({confirmations} confirmations)",
                            head - confirmations,
                        )
                return c.eth.get_logs(params)

            try:
                return await asyncio.to_thread(_read)
            except _Lagging as exc:
                # Behind, not broken: skip it this time without a cooldown, and
                # without spending one of the attempts on it.
                last_exc = exc
                if best_lag is None or exc.confirmed > best_lag.confirmed:
                    best_lag = exc
            except Exception as exc:
                attempts += 1
                if allow_range_shrink and _RANGE_LIMIT_ERROR.search(str(exc)):
                    raise _RangeLimited(str(exc)[:160]) from exc
                last_exc = exc
                if url is not None:
                    self._logs_cooldown[(chain, url)] = time.monotonic() + LOGS_ENDPOINT_COOLDOWN
        # If a fallback could vouch for part of the range, say so: the caller
        # re-reads the confirmed part instead of losing the whole pass. A
        # fallback a block or two behind the primary would otherwise never be
        # usable once the primary breaks, since it can never confirm the
        # primary's own safe head.
        if best_lag is not None and best_lag.confirmed >= params["fromBlock"]:
            raise best_lag
        assert last_exc is not None
        raise last_exc

    def _handle_log(
        self, log, chain: str, tokens: Dict[str, str], by_address: Dict[str, int]
    ) -> bool:
        """Validate and credit a single Transfer log."""
        token_addr = str(log["address"]).lower()
        symbol = tokens.get(token_addr)
        if symbol is None:
            return False  # not allowlisted: spam, or a token we do not book

        to_address = _address_from_topic(log["topics"][2]).lower()
        user_id = by_address.get(to_address)
        if user_id is None:
            return False

        raw = log["data"]
        raw_hex = raw.hex() if hasattr(raw, "hex") else str(raw)
        value = int(raw_hex.replace("0x", "") or "0", 16)
        decimals = get_token_decimals(symbol, chain)
        # Credit what actually arrived. A fee-on-transfer token moves less than
        # the sender signed for, and the log value is the received amount.
        amount = Decimal(value) / (Decimal(10) ** decimals)

        floor = MIN_DEPOSIT.get(symbol)
        if floor is not None and amount < floor:
            logger.info("Ignoring dust deposit %s %s on %s (min %s)", amount, symbol, chain, floor)
            return False

        return self._credit(
            user_id=user_id,
            chain=chain,
            token_symbol=symbol,
            token_address=token_addr,
            amount=amount,
            tx_hash=(
                log["transactionHash"].hex()
                if hasattr(log["transactionHash"], "hex")
                else str(log["transactionHash"])
            ),
            log_index=int(log["logIndex"]),
            block_number=int(log["blockNumber"]),
            from_address=_address_from_topic(log["topics"][1]),
            to_address=to_address,
        )

    # --- lifecycle --------------------------------------------------------

    async def _loop(self) -> None:
        while self._running:
            for chain in CONFIRMATIONS:
                if not self._running:
                    break
                try:
                    await self.scan_chain(chain)
                except Exception as exc:  # one bad chain must not stop the rest
                    logger.error("Deposit scan failed for %s: %s", chain, exc)
            await asyncio.sleep(self.poll_seconds)

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("✓ Deposit watcher started (%s chains)", len(CONFIRMATIONS))

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None


deposit_watcher = DepositWatcher()
