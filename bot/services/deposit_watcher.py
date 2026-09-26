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
from datetime import datetime
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from sqlalchemy import text

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

# Addresses per getLogs topic filter. The topic list goes in the URL-ish JSON
# body and providers differ on how large a filter they accept.
ADDRESS_CHUNK = 100

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
            # The unique index doing its job is the expected path on a re-scan,
            # not an error. Anything else is worth seeing.
            if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
                logger.debug("Deposit %s already credited", key)
            else:
                logger.error("Failed to credit deposit %s: %s", key, exc)
            return False

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
        head = await asyncio.to_thread(lambda: web3.eth.block_number)
        safe_head = head - CONFIRMATIONS.get(chain, 12)
        if safe_head <= 0:
            return 0

        cursor = self._get_cursor(chain)
        if cursor is None:
            cursor = max(0, safe_head - COLD_START_LOOKBACK)
            logger.info("Cold start for %s at block %s", chain, cursor)

        if cursor >= safe_head:
            return 0

        from_block = cursor + 1
        to_block = min(safe_head, cursor + MAX_BLOCK_RANGE)
        addresses = list(by_address.keys())
        credited = 0

        for i in range(0, len(addresses), ADDRESS_CHUNK):
            chunk = addresses[i : i + ADDRESS_CHUNK]
            topics = [TRANSFER_TOPIC0, None, [_topic_for_address(a) for a in chunk]]
            try:
                logs = await asyncio.to_thread(
                    lambda: web3.eth.get_logs(
                        {
                            "fromBlock": from_block,
                            "toBlock": to_block,
                            "topics": topics,
                        }
                    )
                )
            except Exception as exc:
                # Do NOT advance the cursor past a range we failed to read —
                # that is how a deposit goes missing permanently.
                logger.warning("get_logs failed on %s %s-%s: %s", chain, from_block, to_block, exc)
                return credited

            for log in logs:
                credited += 1 if self._handle_log(log, chain, tokens, by_address) else 0

        self._set_cursor(chain, to_block)
        return credited

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
