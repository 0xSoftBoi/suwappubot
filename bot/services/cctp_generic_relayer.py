"""Background relayer that completes GENERIC-rail CCTP V2 transfers.

This is the sibling of bot/services/cctp_relayer.py, which only completes
bot/services/cctp_hypercore.py burns (destination always HyperEVM, plus a
HyperCore-credit step). The generic rail (bot/services/cctp_api.py, used by
swap_engine._execute_cctp_swap) has an ARBITRARY destination -- any chain in
cctp_api.CCTP_DOMAINS -- and no HyperCore-credit step: receiveMessage mints
straight to the recipient and the transfer is done.

Why a sibling service and not an extension of CctpRelayer:
  * CctpRelayer is hardcoded to HyperEVM (module constant HYPEREVM_CHAIN) at
    nearly every call site -- _advance, _relayer_send, _gas_drop, _user_credit,
    relayer_balance_hype. Making destination a parameter would touch almost
    every method and risks regressing the HyperCore path, which CLAUDE.md and
    the task both require to stay byte-for-byte behaviourally unchanged.
  * The state machines differ: HyperCore has an extra `minted -> credited`
    step (sign with the *user's* custodial key) that has no equivalent here.
  * Keeping them separate means a bug in the generic relayer (new, unproven)
    can't touch the HyperCore relayer (already working in production), and
    vice versa.

Lifecycle:
  pending_broadcast -> the burn tx was recorded before broadcast (see
    swap_engine._execute_cctp_swap); reconciled against the SOURCE chain
    receipt and promoted to "burned" or dropped.
  burned -> poll Circle Iris V2 attestation (keyed by source domain + burn tx)
  burned -> (attestation complete) submit receiveMessage on `to_chain`
  minted -> terminal success; notify the user
  failed -> terminal after MAX_ATTEMPTS genuine errors OR STALL_TERMINAL_HOURS
    of unresolved transient/gas stalls; alerts admins, requires human requeue

Idempotency / crash safety:
  * `record_burn` upserts on burn_tx_hash (unique) -- calling it twice for the
    same burn is a no-op (except an explicit status transition -- see
    `mark_broadcast`), so a retried record_burn call is safe.
  * `receiveMessage` consumes the message's nonce on-chain. Before broadcasting
    (and again if the broadcast itself errors) we ask
    MessageTransmitterV2.usedNonces(nonce) directly -- the ONLY authoritative
    source of truth for whether a message has already been relayed. We never
    infer that from a revert string: broadcast errors are dominated by
    ordinary EOA transaction-nonce collisions (see `_submit_receive`'s own
    `nonce = get_transaction_count()`), and several RPC providers phrase THAT
    as "nonce already used" too -- matching text would falsely mark a deposit
    minted with no mint having happened.
  * On restart, `_pending()` re-reads status from the DB and resumes any
    "burned" deposit exactly where it left off -- no double-mint, no dropped
    deposit.

Destination gas (the key new risk vs the HyperCore relayer): the relayer
wallet (settings.cctp_relayer_private_key, reused across chains) must hold
native gas on EVERY destination chain a generic burn can target. If it
doesn't, we must not silently drop the deposit -- see `_advance` and
`_alert_low_balance`: an insufficient-gas failure is logged, alerted, and the
deposit stays retryable (stall_count increments but status stays "burned").

DISABLED by default (settings.cctp_generic_relayer_enabled). Independent of
settings.cctp_generic_rail_enabled (the swap-execution kill switch in
swap_engine.py) -- building/testing this relayer does NOT flip that switch.
See cctp_generic_rail_enabled's docstring in bot/config/settings.py for the
exact live-test bar required before that switch can be turned on.
"""

import asyncio
import logging
import os
import socket
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import or_
from web3 import Web3

from bot.config.settings import settings
from bot.config.chains import get_chain_by_name
from bot.models.cctp import CctpGenericDeposit
from bot.services.cctp_api import cctp_api
from bot.services.rpc_manager import rpc_manager
from database.db import get_session

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 8  # genuine/permanent relayer errors, across loop iterations
STALL_TERMINAL_HOURS = 24  # transient/insufficient-gas stalls become terminal after this long
CLAIM_LEASE_MINUTES = 5  # claim/lease window so two replicas never race a receiveMessage


def _aware(dt: Optional[datetime]) -> datetime:
    """Treat a naive DB datetime (default=datetime.utcnow) as UTC."""
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


class CctpGenericRelayerError(Exception):
    """Raised for generic-rail relayer failures that should NOT be treated as
    an already-completed transfer (i.e. genuine failures, not idempotent no-ops)."""


class InsufficientRelayerGasError(CctpGenericRelayerError):
    """The relayer wallet doesn't hold enough native gas on the destination
    chain to submit receiveMessage. The deposit stays retryable -- this must
    never be swallowed or treated as a terminal failure by itself."""


class CctpGenericRelayer:
    """Completes generic-rail CCTP V2 transfers on their arbitrary destination chain."""

    POLL_INTERVAL = 30  # seconds

    def __init__(self):
        self._running = False
        self._task = None
        self._bot = None
        self._low_balance_alerted: set = set()  # {chain} currently in a low-balance episode
        self._alert_tasks: set = set()  # holds refs to fire-and-forget alert tasks (no GC)
        self._loop_count = 0

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    def is_enabled(self) -> bool:
        return bool(
            getattr(settings, "cctp_generic_relayer_enabled", False)
            and getattr(settings, "cctp_relayer_private_key", None)
        )

    async def start(self, bot=None):
        if self._running:
            return
        if not self.is_enabled():
            logger.info(
                "CCTP generic relayer disabled "
                "(set cctp_generic_relayer_enabled + cctp_relayer_private_key to enable)"
            )
            return
        self._bot = bot
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("CCTP generic relayer started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()

    async def _loop(self):
        while self._running:
            try:
                await self.process_once()
            except Exception as e:  # noqa: BLE001 — never let the loop die
                logger.warning("CCTP generic relayer loop error: %s", e)
            self._loop_count += 1
            # Periodic per-chain relayer-gas sweep (~every 10 iterations, i.e.
            # ~5min at POLL_INTERVAL=30) so we learn the relayer is low on gas
            # BEFORE a user's burn stalls, not only after.
            if self._loop_count % 10 == 0:
                try:
                    await self._sweep_relayer_balances()
                except Exception as e:  # noqa: BLE001
                    logger.warning("CCTP generic relayer balance sweep failed: %s", e)
            await asyncio.sleep(self.POLL_INTERVAL)

    # ------------------------------------------------------------------ #
    # Recording a new transfer (called before/after the user's burn is submitted)
    # ------------------------------------------------------------------ #
    def record_burn(
        self,
        user_id: int,
        recipient_address: str,
        from_chain: str,
        to_chain: str,
        burn_tx_hash: str,
        amount_raw: int,
        version: int = 2,
        status: str = "pending_broadcast",
    ) -> Optional[int]:
        """Persist a generic-rail burn so the relayer will complete it.

        MUST be called synchronously with `status="pending_broadcast"` BEFORE
        the burn tx is broadcast (see swap_engine._execute_cctp_swap) -- the
        tx hash is deterministic from the signed payload (recoverable via
        `Web3.keccak(raw_tx)` before ever calling send_raw_transaction), so
        this guarantees a DB row exists even if the process crashes or
        send_raw_transaction raises AFTER the raw tx already propagated (a
        real failure mode on congested RPCs). Call `mark_broadcast` right
        after broadcast succeeds to promote the row to "burned".

        Idempotent on burn_tx_hash: calling it twice for the same hash
        returns the existing row's id without re-inserting or changing its
        status (use `mark_broadcast`/`_set_status` for status transitions).
        Raises on any DB failure (callers must treat that as loud/fatal, not
        swallow it).
        """
        with get_session() as session:
            existing = (
                session.query(CctpGenericDeposit).filter_by(burn_tx_hash=burn_tx_hash).first()
            )
            if existing:
                return existing.id
            dep = CctpGenericDeposit(
                user_id=user_id,
                recipient_address=recipient_address,
                from_chain=from_chain,
                to_chain=to_chain,
                burn_tx_hash=burn_tx_hash,
                amount_raw=Decimal(int(amount_raw)),
                version=int(version),
                status=status,
            )
            session.add(dep)
            session.flush()
            return dep.id

    def mark_broadcast(self, burn_tx_hash: str) -> None:
        """Promote a `pending_broadcast` row to `burned` right after
        send_raw_transaction returns successfully. No-op if the row is
        missing or already past this stage (idempotent)."""
        with get_session() as session:
            row = session.query(CctpGenericDeposit).filter_by(burn_tx_hash=burn_tx_hash).first()
            if row and row.status == "pending_broadcast":
                row.status = "burned"

    # ------------------------------------------------------------------ #
    # Processing
    # ------------------------------------------------------------------ #
    def _worker_id(self) -> str:
        return f"{socket.gethostname()}:{os.getpid()}"

    def _backoff_minutes(self, dep) -> int:
        """Exponential backoff keyed off stall/attempt count, capped at 60min."""
        n = max(dep.stall_count or 0, dep.attempts or 0)
        return min(2**n, 60) if n > 0 else 0

    def _pending(self):
        """Claim and return actionable "burned"/"attested" deposits.

        Claim (H2): a conditional row lock (`FOR UPDATE SKIP LOCKED`) plus a
        claimed_at/claimed_by lease means two relayer replicas never both
        pass the precheck and both broadcast for the same deposit -- one
        claims the row, the other's SKIP LOCKED query simply doesn't see it
        until the lease (CLAIM_LEASE_MINUTES) expires.

        Backoff (H1): a deposit whose last attempt was too recent (relative
        to its stall/attempt count) is skipped this pass rather than hammered
        every POLL_INTERVAL.
        """
        now = datetime.now(timezone.utc)
        lease_cutoff = now - timedelta(minutes=CLAIM_LEASE_MINUTES)
        with get_session() as session:
            rows = (
                session.query(CctpGenericDeposit)
                .filter(
                    CctpGenericDeposit.status.in_(("burned", "attested")),
                    CctpGenericDeposit.attempts < MAX_ATTEMPTS,
                )
                .filter(
                    or_(
                        CctpGenericDeposit.claimed_at.is_(None),
                        CctpGenericDeposit.claimed_at < lease_cutoff,
                    )
                )
                .with_for_update(skip_locked=True)
                .all()
            )
            claimed = []
            for r in rows:
                backoff_min = self._backoff_minutes(r)
                if (
                    backoff_min
                    and r.updated_at
                    and (now - _aware(r.updated_at)) < timedelta(minutes=backoff_min)
                ):
                    continue
                r.claimed_at = now
                r.claimed_by = self._worker_id()
                claimed.append(
                    {
                        "id": r.id,
                        "user_id": r.user_id,
                        "recipient": r.recipient_address,
                        "from_chain": r.from_chain,
                        "to_chain": r.to_chain,
                        "burn_tx_hash": r.burn_tx_hash,
                        "amount_raw": int(r.amount_raw),
                        "version": r.version or 2,
                        "status": r.status,
                    }
                )
            return claimed

    def _pending_broadcast_rows(self):
        """Rows still awaiting source-chain broadcast confirmation (C2)."""
        with get_session() as session:
            rows = session.query(CctpGenericDeposit).filter_by(status="pending_broadcast").all()
            return [
                {
                    "id": r.id,
                    "from_chain": r.from_chain,
                    "burn_tx_hash": r.burn_tx_hash,
                    "created_at": r.created_at,
                }
                for r in rows
            ]

    async def process_once(self):
        await self._reconcile_pending_broadcasts()
        for dep in self._pending():
            try:
                await self._advance(dep)
            except InsufficientRelayerGasError as e:
                # Explicit, surfaced, and retryable -- NOT a silent drop, and
                # NOT counted against the permanent-error budget (MAX_ATTEMPTS).
                logger.warning(
                    "CCTP generic deposit %s stalled: insufficient relayer gas on %s: %s",
                    dep["id"],
                    dep["to_chain"],
                    e,
                )
                self._bump_stall(dep["id"], f"insufficient relayer gas on {dep['to_chain']}: {e}")
                await self._alert_low_balance(dep["to_chain"], str(e))
            except CctpGenericRelayerError as e:
                logger.warning("CCTP generic deposit %s failed: %s", dep["id"], e)
                self._bump_error(dep["id"], str(e))
            except (
                Exception
            ) as e:  # noqa: BLE001 — isolate per-deposit failures; treat as transient
                # Anything reaching here (network hiccup, RPC 429/5xx, timeout)
                # is presumed transient -- it must not burn the permanent
                # error budget in ~4 minutes (see H1). Only explicit
                # CctpGenericRelayerError is a genuine/permanent failure.
                logger.warning("CCTP generic deposit %s transient error: %s", dep["id"], e)
                self._bump_stall(dep["id"], str(e))

    async def _reconcile_pending_broadcasts(self):
        """For rows recorded pre-broadcast (C2), check the SOURCE chain
        receipt to decide whether to advance to 'burned' or flag for human
        review. We can NEVER safely re-broadcast here (we don't hold the
        user's signing key) -- only observe."""
        for row in self._pending_broadcast_rows():
            try:
                web3 = rpc_manager.get_web3(row["from_chain"])
                receipt = await asyncio.to_thread(
                    lambda: web3.eth.get_transaction_receipt(row["burn_tx_hash"])
                )
            except Exception:
                receipt = None
            if receipt is not None:
                if receipt.get("status") == 1:
                    self.mark_broadcast(row["burn_tx_hash"])
                else:
                    # Burn tx landed but reverted -- no funds were actually
                    # burned; nothing to relay. Mark terminal so it stops
                    # being polled, and alert so a human can confirm.
                    self._set_status(
                        row["id"], "failed", last_error="source burn tx reverted on-chain"
                    )
                    await self._alert_admins(
                        f"CCTP generic-rail deposit #{row['id']}: source burn tx "
                        f"{row['burn_tx_hash']} reverted on {row['from_chain']} -- no USDC was "
                        "actually burned, no action needed on the mint side, but confirm."
                    )
                continue
            # No receipt yet. If this has been pending broadcast confirmation
            # for an unreasonably long time, the tx may have been dropped
            # (never actually propagated) -- surface it; we cannot rebroadcast.
            created = _aware(row["created_at"]) if row["created_at"] else datetime.now(timezone.utc)
            if datetime.now(timezone.utc) - created > timedelta(hours=1):
                await self._alert_admins(
                    f"CCTP generic-rail deposit #{row['id']}: burn tx {row['burn_tx_hash']} on "
                    f"{row['from_chain']} has had no receipt for over an hour -- may have been "
                    "dropped before propagating, or the RPC is behind. Investigate; if genuinely "
                    "dropped, the user's USDC was never burned and they can retry the swap."
                )

    async def _advance(self, dep: dict):
        if dep["status"] not in ("burned", "attested"):
            return

        att = await cctp_api.get_attestation_v2(
            dep["from_chain"], dep["burn_tx_hash"], max_attempts=1, poll_interval=0
        )
        if att.status != "ATTESTED" or not att.attestation:
            return  # still pending; retry next loop iteration

        message_hex = (att.raw_response or {}).get("message")
        if not message_hex:
            # Attested-but-no-message would be a Circle API contract violation;
            # treat as a transient hiccup rather than corrupting state.
            logger.warning(
                "CCTP generic deposit %s: attestation complete but no message bytes returned",
                dep["id"],
            )
            return

        message_bytes = Web3.to_bytes(hexstr=message_hex)
        receive_tx = cctp_api.build_receive_transaction(
            dep["to_chain"], message_bytes, att.attestation, version=dep["version"]
        )

        web3 = rpc_manager.get_web3(dep["to_chain"])
        mint_hash = await self._submit_receive(web3, dep, receive_tx, message_bytes)
        self._set_status(dep["id"], "minted", mint_tx_hash=mint_hash)
        await self._notify(dep, mint_hash)

    # ------------------------------------------------------------------ #
    # EVM execution
    # ------------------------------------------------------------------ #
    def _relayer_account(self, web3):
        return web3.eth.account.from_key(settings.cctp_relayer_private_key)

    async def _submit_receive(self, web3, dep: dict, tx: dict, message_bytes: bytes) -> str:
        """Submit receiveMessage on `dep['to_chain']`.

        Idempotency (C1): checked EXCLUSIVELY via
        MessageTransmitterV2.usedNonces(nonce) -- never via revert-string
        matching. That check runs both before broadcasting AND again if the
        broadcast itself raises, because a broadcast-time exception (RPC
        timeout, connection drop) is ambiguous: the tx may have landed
        despite the client-side error. usedNonces resolves that ambiguity
        authoritatively; an EOA transaction-nonce collision (a genuinely
        different failure mode, common on congested RPCs) will correctly
        NOT show the message's nonce as used, so it's re-raised as a real
        failure instead of being misread as success.
        """
        acct = self._relayer_account(web3)
        chain = get_chain_by_name(dep["to_chain"])
        to_addr = Web3.to_checksum_address(tx["to"])
        nonce_bytes32 = cctp_api.message_nonce_bytes32(message_bytes)

        already_used = await asyncio.to_thread(
            lambda: cctp_api.is_nonce_used(
                web3, dep["to_chain"], nonce_bytes32, version=dep["version"]
            )
        )
        if already_used:
            logger.info(
                "CCTP generic deposit %s: usedNonces confirms this message's nonce is already "
                "consumed on %s -- already-relayed (verified on-chain, not inferred).",
                dep["id"],
                dep["to_chain"],
            )
            return "already-relayed-verified-onchain"

        value = int(tx.get("value", 0) or 0)
        call_params = {
            "from": acct.address,
            "to": to_addr,
            "data": tx["data"],
            "value": value,
        }

        try:
            gas_estimate = await asyncio.to_thread(lambda: web3.eth.estimate_gas(call_params))
        except Exception as e:  # noqa: BLE001 — a genuine revert (bad attestation, wrong ABI, etc.)
            raise CctpGenericRelayerError(
                f"receiveMessage would revert on {dep['to_chain']}: {e}"
            ) from e

        gas = int(gas_estimate * 1.3)
        gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)
        # Include `value` (not just gas) in the affordability check -- harmless
        # today since receiveMessage's value is always 0, but correct in
        # general (H1 minor fix).
        gas_cost_wei = gas * gas_price + value

        native_balance = await asyncio.to_thread(lambda: web3.eth.get_balance(acct.address))
        if native_balance < gas_cost_wei:
            have = float(web3.from_wei(native_balance, "ether"))
            need = float(web3.from_wei(gas_cost_wei, "ether"))
            raise InsufficientRelayerGasError(
                f"relayer has {have:.6f} {chain.native_token} on {dep['to_chain']}, "
                f"needs ~{need:.6f} for receiveMessage"
            )

        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(acct.address))
        full = {
            "to": to_addr,
            "data": tx["data"],
            "value": value,
            "gas": gas,
            "gasPrice": gas_price,
            "nonce": nonce,
            "chainId": chain.chain_id,
        }
        signed = acct.sign_transaction(full)
        try:
            tx_hash = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(signed.raw_transaction)
            )
            receipt = await asyncio.to_thread(
                lambda: web3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
            )
        except Exception as e:  # noqa: BLE001 — could be an EOA-nonce race, timeout, or RPC drop
            # Authoritative recheck: did the message actually get consumed
            # despite the client-side error? This is the ONLY thing that may
            # turn this exception into a success -- never the error text.
            landed = await asyncio.to_thread(
                lambda: cctp_api.is_nonce_used(
                    web3, dep["to_chain"], nonce_bytes32, version=dep["version"]
                )
            )
            if landed:
                logger.info(
                    "CCTP generic deposit %s: broadcast raised (%s) but usedNonces confirms "
                    "the message landed anyway -- treating as verified success.",
                    dep["id"],
                    e,
                )
                return "already-relayed-verified-onchain"
            raise CctpGenericRelayerError(
                f"receiveMessage broadcast failed on {dep['to_chain']}: {e}"
            ) from e

        if receipt.get("status") != 1:
            # Race with another relayer landing first, or a genuine revert.
            landed = await asyncio.to_thread(
                lambda: cctp_api.is_nonce_used(
                    web3, dep["to_chain"], nonce_bytes32, version=dep["version"]
                )
            )
            if landed:
                return "already-relayed-verified-onchain"
            raise CctpGenericRelayerError(
                f"receiveMessage tx {tx_hash.hex()} reverted on {dep['to_chain']}"
            )
        return tx_hash.hex()

    # ------------------------------------------------------------------ #
    # DB + notify helpers
    # ------------------------------------------------------------------ #
    def _set_status(self, dep_id: int, status: str, **fields):
        with get_session() as session:
            row = session.query(CctpGenericDeposit).filter_by(id=dep_id).first()
            if row:
                row.status = status
                for k, v in fields.items():
                    setattr(row, k, v)

    def _schedule_alert(self, text: str):
        """Fire-and-forget an admin alert from a sync context, holding a
        reference so the task can't be garbage-collected mid-flight (a real
        bug in the previous version -- create_task()'s return value must be
        kept alive or asyncio may drop it silently)."""
        try:
            task = asyncio.get_event_loop().create_task(self._alert_admins(text))
            self._alert_tasks.add(task)
            task.add_done_callback(self._alert_tasks.discard)
        except RuntimeError:
            logger.error("CCTP generic relayer: no event loop running to alert admins: %s", text)

    def _bump_error(self, dep_id: int, err: str):
        """Permanent/genuine relayer error (CctpGenericRelayerError). Counts
        against MAX_ATTEMPTS -- `failed` here means "receiveMessage itself
        keeps genuinely reverting", a real problem, not an RPC hiccup."""
        terminal = False
        found = False
        with get_session() as session:
            row = session.query(CctpGenericDeposit).filter_by(id=dep_id).first()
            if row:
                found = True
                row.attempts = (row.attempts or 0) + 1
                row.last_error = err[:400]
                if row.attempts >= MAX_ATTEMPTS:
                    row.status = "failed"
                    terminal = True
        if found and terminal:
            self._schedule_alert(
                f"CCTP generic-rail deposit #{dep_id} FAILED after {MAX_ATTEMPTS} genuine "
                f"receiveMessage errors: {err[:300]}. USDC was burned on the source chain and "
                "is unminted -- requires manual requeue/investigation."
            )

    def _bump_stall(self, dep_id: int, err: str):
        """Transient error (RPC hiccup, timeout) or InsufficientRelayerGasError.
        Does NOT consume the permanent-error budget -- `failed` must mean "a
        human must look", not "the RPC hiccuped 8 times in under 4 minutes".
        Only becomes terminal after STALL_TERMINAL_HOURS of wall-clock time
        with the deposit still unresolved, regardless of how many stall
        attempts that represents."""
        terminal = False
        found = False
        with get_session() as session:
            row = session.query(CctpGenericDeposit).filter_by(id=dep_id).first()
            if row:
                found = True
                row.stall_count = (row.stall_count or 0) + 1
                row.last_error = err[:400]
                created = _aware(row.created_at)
                if datetime.now(timezone.utc) - created > timedelta(hours=STALL_TERMINAL_HOURS):
                    row.status = "failed"
                    terminal = True
        if found and terminal:
            self._schedule_alert(
                f"CCTP generic-rail deposit #{dep_id} FAILED after stalling for "
                f"{STALL_TERMINAL_HOURS}h (transient/gas errors, never resolved): "
                f"{err[:300]}. USDC was burned on the source chain and is unminted -- "
                "requires manual requeue/investigation (likely: relayer gas never topped "
                "up, or destination RPC has been down)."
            )

    async def _notify(self, dep: dict, mint_hash: Optional[str] = None):
        if not self._bot:
            return
        telegram_id = await asyncio.to_thread(self._resolve_telegram_id, dep["user_id"])
        if not telegram_id:
            logger.warning(
                "CCTP generic notify: no telegram_id for db user_id=%s (deposit %s)",
                dep["user_id"],
                dep["id"],
            )
            return
        try:
            usdc = dep["amount_raw"] / 1e6
            await self._bot.send_message(
                chat_id=telegram_id,
                text=(
                    f"✅ Your ${usdc:,.2f} USDC CCTP transfer to {dep['to_chain']} landed "
                    f"(mint tx: {mint_hash or 'n/a'})."
                ),
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("CCTP generic notify failed for %s: %s", dep["user_id"], e)

    @staticmethod
    def _resolve_telegram_id(db_user_id: int) -> Optional[int]:
        """dep['user_id'] is `users.id` (the DATABASE primary key), NOT the
        Telegram chat id -- swap_engine passes wallet_data["user_id"], which
        is `wallet_obj.user_id`, a DB id. Sending to it directly as a
        Telegram chat_id (as a prior version of this method did) silently
        DMs the wrong id space. Resolve the real Telegram id explicitly."""
        from bot.models.user import User

        with get_session() as session:
            user = session.query(User).filter_by(id=db_user_id).first()
            return int(user.telegram_id) if user and user.telegram_id else None

    @staticmethod
    def _admin_ids() -> list:
        raw = getattr(settings, "admin_telegram_ids", "") or ""
        return [int(x) for x in raw.split(",") if x.strip()]

    async def _alert_admins(self, text: str):
        """Best-effort direct Telegram DM (if the bot handle is wired) PLUS a
        durable support ticket so terminal alerts don't depend on the bot
        being up (H4) -- api/main.py can pass bot=None if the bot failed to
        initialize, and a fire-and-forget DM with no fallback silently
        becomes an unread log line in that case."""
        if self._bot:
            for admin_id in self._admin_ids():
                try:
                    await self._bot.send_message(chat_id=admin_id, text=text)
                except Exception as e:  # noqa: BLE001
                    logger.warning("CCTP generic admin alert failed for %s: %s", admin_id, e)
        else:
            logger.error("CCTP generic relayer admin alert (no bot wired): %s", text)

        try:
            from bot.models.support import SupportTicket, TicketKind

            with get_session() as session:
                session.add(
                    SupportTicket(
                        kind=TicketKind.BUG,
                        source="telegram",
                        message=f"[cctp_generic_relayer] {text}",
                    )
                )
        except (
            Exception
        ) as e:  # noqa: BLE001 — this is itself the alerting fallback; must not raise
            logger.error("CCTP generic relayer: failed to persist support ticket alert: %s", e)

    async def _alert_low_balance(self, chain: str, detail: str):
        """Alert admins once per low-balance episode per destination chain."""
        if chain in self._low_balance_alerted:
            return
        self._low_balance_alerted.add(chain)
        await self._alert_admins(
            f"⚠️ CCTP generic relayer gas low on {chain}: {detail}. Top up the relayer "
            "wallet on this chain or in-flight transfers will stall (retryable, not lost)."
        )

    async def _sweep_relayer_balances(self):
        """Periodic per-chain gas check (H4) -- proactively alerts BEFORE a
        user's burn stalls on a chain, using
        settings.cctp_generic_relayer_min_native_alert. Also clears
        `_low_balance_alerted` once a chain's balance recovers, so a future
        real shortfall alerts again instead of staying suppressed for the
        rest of the process lifetime."""
        from bot.services.cctp_api import CCTP_DOMAINS

        threshold = float(getattr(settings, "cctp_generic_relayer_min_native_alert", 0.01) or 0.01)
        for chain in CCTP_DOMAINS.keys():
            try:
                balance = await self.relayer_balance(chain)
            except Exception as e:  # noqa: BLE001
                logger.warning("CCTP generic relayer balance sweep failed for %s: %s", chain, e)
                continue
            if balance is None:
                continue
            if balance < threshold:
                await self._alert_low_balance(
                    chain, f"balance {balance:.6f} below alert threshold {threshold}"
                )
            elif chain in self._low_balance_alerted:
                self._low_balance_alerted.discard(chain)
                logger.info("CCTP generic relayer gas on %s recovered above threshold", chain)

    # ------------------------------------------------------------------ #
    # Observability + recovery
    # ------------------------------------------------------------------ #
    def latest_for_user(self, user_id: int) -> Optional[dict]:
        with get_session() as session:
            row = (
                session.query(CctpGenericDeposit)
                .filter_by(user_id=user_id)
                .order_by(CctpGenericDeposit.id.desc())
                .first()
            )
            if not row:
                return None
            return {
                "id": row.id,
                "status": row.status,
                "from_chain": row.from_chain,
                "to_chain": row.to_chain,
                "amount_usd": int(row.amount_raw) / 1e6,
                "burn_tx_hash": row.burn_tx_hash,
                "mint_tx_hash": row.mint_tx_hash,
                "last_error": row.last_error,
                "attempts": row.attempts or 0,
                "stall_count": row.stall_count or 0,
            }

    def health(self) -> dict:
        from sqlalchemy import func

        with get_session() as session:
            rows = (
                session.query(CctpGenericDeposit.status, func.count(CctpGenericDeposit.id))
                .group_by(CctpGenericDeposit.status)
                .all()
            )
        counts = {status: int(n) for status, n in rows}
        in_flight = sum(counts.get(s, 0) for s in ("pending_broadcast", "burned", "attested"))
        return {
            "enabled": self.is_enabled(),
            "running": self._running,
            "counts": counts,
            "in_flight": in_flight,
            "failed": counts.get("failed", 0),
            "minted": counts.get("minted", 0),
        }

    def requeue_failed(self) -> int:
        """Reset failed deposits so the loop retries them from 'burned'.
        Safe because receiveMessage is naturally idempotent (nonce-consuming,
        verified via usedNonces) -- a requeued deposit that actually
        completed will just hit the already-used-nonce path and be marked
        minted again. Exposed via an admin command/route -- see
        bot/handlers/admin.py (search "cctp") for the wiring; without that,
        recovery requires a direct psql session."""
        with get_session() as session:
            failed = session.query(CctpGenericDeposit).filter_by(status="failed").all()
            n = 0
            for row in failed:
                row.status = "burned"
                row.attempts = 0
                row.stall_count = 0
                row.last_error = None
                row.claimed_at = None
                row.claimed_by = None
                n += 1
            return n

    async def relayer_balance(self, chain: str) -> Optional[float]:
        """Native-gas balance of the relayer wallet on `chain` (None if unset)."""
        if not getattr(settings, "cctp_relayer_private_key", None):
            return None
        web3 = rpc_manager.get_web3(chain)
        acct = self._relayer_account(web3)
        wei = await asyncio.to_thread(lambda: web3.eth.get_balance(acct.address))
        return float(web3.from_wei(wei, "ether"))


# Global instance.
cctp_generic_relayer = CctpGenericRelayer()
