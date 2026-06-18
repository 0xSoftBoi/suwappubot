"""Background relayer that completes CCTP V2 deposits into HyperCore.

The user only signs the source-chain burn (where they hold funds + gas). This
relayer then does the destination half on HyperEVM, which costs HYPE gas the
user doesn't have:

  burned   -> poll Circle attestation
  attested -> receiveMessage (relayer-signed, mints native USDC to the user's
              HyperEVM address) + a small HYPE gas-drop to that address
  minted   -> the user's custodial wallet signs the ERC20 transfer to the USDC
              system address, crediting their HyperCore *spot* balance
  credited -> notify the user

Design constraints (read before enabling):
  * Recipient must be a **bot-custodied** EVM wallet — the Core-credit (last
    step) is signed with the user's key, which only works for wallets the bot
    holds. So CCTP deposits target the user's default custodial EVM wallet (its
    address IS its HyperCore account), not an externally-connected hl_address.
  * The relayer wallet (settings.cctp_relayer_private_key) must hold HYPE on
    HyperEVM to pay for receiveMessage + gas-drops.
  * DISABLED by default (settings.cctp_relayer_enabled). Fund + testnet-verify
    before turning on. The Across rail remains the zero-friction default.

Mirrors the HLEcosystemMonitor lifecycle.
"""

import asyncio
import logging
from decimal import Decimal
from typing import Optional

from web3 import Web3

from bot.config.settings import settings
from bot.config.chains import get_chain_by_name
from bot.models.cctp import CctpDeposit
from bot.models.user import Wallet
from bot.services.cctp_hypercore import cctp_hypercore
from bot.services.rpc_manager import rpc_manager
from bot.services.wallet import WalletService
from database.db import get_session, run_in_db

logger = logging.getLogger(__name__)

HYPEREVM_CHAIN = "hyperevm"
MAX_ATTEMPTS = 8  # per deposit, across loop iterations, before marking failed


class CctpRelayer:
    """Completes CCTP V2 deposits on HyperEVM for HYPE-less users."""

    POLL_INTERVAL = 30  # seconds

    def __init__(self):
        self._running = False
        self._task = None
        self._bot = None
        self.wallet_service = WalletService()

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    def is_enabled(self) -> bool:
        return bool(
            getattr(settings, "cctp_relayer_enabled", False)
            and getattr(settings, "cctp_relayer_private_key", None)
        )

    async def start(self, bot=None):
        if self._running:
            return
        if not self.is_enabled():
            logger.info("CCTP relayer disabled (set cctp_relayer_enabled + key to enable)")
            return
        self._bot = bot
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("CCTP relayer started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()

    async def _loop(self):
        while self._running:
            try:
                await self.process_once()
            except Exception as e:  # noqa: BLE001 — never let the loop die
                logger.warning("CCTP relayer loop error: %s", e)
            await asyncio.sleep(self.POLL_INTERVAL)

    # ------------------------------------------------------------------ #
    # Recording a new deposit (called after the user's burn is submitted)
    # ------------------------------------------------------------------ #
    def record_burn(
        self,
        user_id: int,
        recipient_address: str,
        from_chain: str,
        burn_tx_hash: str,
        amount_raw: int,
    ) -> Optional[int]:
        """Persist a freshly-submitted burn so the relayer will complete it.

        `recipient_address` must be the user's custodial EVM wallet (see module
        docstring). Returns the CctpDeposit id, or None if already recorded.
        """
        with get_session() as session:
            existing = session.query(CctpDeposit).filter_by(burn_tx_hash=burn_tx_hash).first()
            if existing:
                return existing.id
            dep = CctpDeposit(
                user_id=user_id,
                hl_address=recipient_address,
                from_chain=from_chain,
                burn_tx_hash=burn_tx_hash,
                amount_raw=Decimal(int(amount_raw)),
                status="burned",
            )
            session.add(dep)
            session.flush()
            return dep.id

    # ------------------------------------------------------------------ #
    # Processing
    # ------------------------------------------------------------------ #
    def _pending(self):
        with get_session() as session:
            rows = (
                session.query(CctpDeposit)
                .filter(
                    CctpDeposit.status.in_(("burned", "attested", "minted")),
                    CctpDeposit.attempts < MAX_ATTEMPTS,
                )
                .all()
            )
            # detach the bits we need (avoid lazy-load after session close)
            return [
                {
                    "id": r.id,
                    "user_id": r.user_id,
                    "recipient": r.hl_address,
                    "from_chain": r.from_chain,
                    "burn_tx_hash": r.burn_tx_hash,
                    "amount_raw": int(r.amount_raw),
                    "status": r.status,
                }
                for r in rows
            ]

    async def process_once(self):
        for dep in self._pending():
            try:
                await self._advance(dep)
            except Exception as e:  # noqa: BLE001 — isolate per-deposit failures
                logger.warning("CCTP deposit %s failed: %s", dep["id"], e)
                self._bump_error(dep["id"], str(e))

    async def _advance(self, dep: dict):
        web3 = rpc_manager.get_web3(HYPEREVM_CHAIN)

        if dep["status"] == "burned":
            # One non-blocking attestation check per loop iteration.
            att = await cctp_hypercore.get_attestation(
                dep["from_chain"], dep["burn_tx_hash"], max_attempts=1, poll_interval=0
            )
            if not att.is_complete:
                return
            # Mint on HyperEVM (relayer pays HYPE) + gas-drop to the user.
            receive_tx = cctp_hypercore.build_receive_tx(att)
            mint_hash = await self._relayer_send(web3, receive_tx, gas=300_000)
            await self._gas_drop(web3, dep["recipient"])
            self._set_status(dep["id"], "minted", mint_tx_hash=mint_hash)
            dep["status"] = "minted"

        if dep["status"] == "minted":
            credit_hash = await self._user_credit(web3, dep)
            self._set_status(dep["id"], "credited", credit_tx_hash=credit_hash)
            await self._notify(dep)

    # ------------------------------------------------------------------ #
    # EVM execution
    # ------------------------------------------------------------------ #
    def _relayer_account(self, web3):
        return web3.eth.account.from_key(settings.cctp_relayer_private_key)

    async def _relayer_send(self, web3, tx: dict, gas: int) -> str:
        """Sign `tx` with the relayer key and broadcast on HyperEVM."""
        acct = self._relayer_account(web3)
        chain = get_chain_by_name(HYPEREVM_CHAIN)
        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(acct.address))
        full = {
            "to": Web3.to_checksum_address(tx["to"]),
            "data": tx["data"],
            "value": int(tx.get("value", 0) or 0),
            "gas": gas,
            "gasPrice": await asyncio.to_thread(lambda: web3.eth.gas_price),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }
        signed = acct.sign_transaction(full)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(signed.raw_transaction)
        )
        await asyncio.to_thread(lambda: web3.eth.wait_for_transaction_receipt(tx_hash, timeout=180))
        return tx_hash.hex()

    async def _gas_drop(self, web3, recipient: str):
        """Send a little HYPE to the user's address so it can sign the credit."""
        drop = web3.to_wei(getattr(settings, "cctp_relayer_gas_drop_hype", 0.02), "ether")
        acct = self._relayer_account(web3)
        chain = get_chain_by_name(HYPEREVM_CHAIN)
        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(acct.address))
        tx = {
            "to": Web3.to_checksum_address(recipient),
            "value": int(drop),
            "gas": 21_000,
            "gasPrice": await asyncio.to_thread(lambda: web3.eth.gas_price),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }
        signed = acct.sign_transaction(tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(signed.raw_transaction)
        )
        await asyncio.to_thread(lambda: web3.eth.wait_for_transaction_receipt(tx_hash, timeout=180))

    async def _user_credit(self, web3, dep: dict) -> str:
        """User's custodial wallet signs the HyperEVM->HyperCore credit transfer."""
        wallet = await self._custodial_wallet(dep["recipient"])
        if not wallet:
            raise RuntimeError(
                f"No custodial wallet for {dep['recipient']}; cannot sign HyperCore credit"
            )
        credit_tx = cctp_hypercore.build_core_credit_tx(dep["amount_raw"])
        chain = get_chain_by_name(HYPEREVM_CHAIN)
        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(dep["recipient"]))
        full = {
            "to": Web3.to_checksum_address(credit_tx["to"]),
            "data": credit_tx["data"],
            "value": 0,
            "gas": 120_000,
            "gasPrice": await asyncio.to_thread(lambda: web3.eth.gas_price),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }
        signed_hex = await self.wallet_service.sign_evm_transaction(wallet, full)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_hex.replace("0x", "")))
        )
        await asyncio.to_thread(lambda: web3.eth.wait_for_transaction_receipt(tx_hash, timeout=180))
        return tx_hash.hex()

    async def _custodial_wallet(self, address: str) -> Optional[Wallet]:
        def _q():
            with get_session() as session:
                return session.query(Wallet).filter(Wallet.address == address).first()

        return await run_in_db(_q)

    # ------------------------------------------------------------------ #
    # DB + notify helpers
    # ------------------------------------------------------------------ #
    def _set_status(self, dep_id: int, status: str, **fields):
        with get_session() as session:
            row = session.query(CctpDeposit).filter_by(id=dep_id).first()
            if row:
                row.status = status
                for k, v in fields.items():
                    setattr(row, k, v)

    def _bump_error(self, dep_id: int, err: str):
        with get_session() as session:
            row = session.query(CctpDeposit).filter_by(id=dep_id).first()
            if row:
                row.attempts = (row.attempts or 0) + 1
                row.last_error = err[:400]
                if row.attempts >= MAX_ATTEMPTS:
                    row.status = "failed"

    async def _notify(self, dep: dict):
        if not self._bot:
            return
        try:
            usdc = dep["amount_raw"] / 1e6
            await self._bot.send_message(
                chat_id=dep["user_id"],
                text=(
                    f"✅ Your ${usdc:,.2f} USDC deposit landed on HyperCore (via CCTP). "
                    "It's in your spot balance — move it to perp to trade."
                ),
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("CCTP notify failed for %s: %s", dep["user_id"], e)

    # ------------------------------------------------------------------ #
    # Observability + recovery
    # ------------------------------------------------------------------ #
    def latest_for_user(self, user_id: int) -> Optional[dict]:
        """Most recent CCTP deposit for a user (status + tx hashes), or None."""
        with get_session() as session:
            row = (
                session.query(CctpDeposit)
                .filter_by(user_id=user_id)
                .order_by(CctpDeposit.id.desc())
                .first()
            )
            if not row:
                return None
            return {
                "id": row.id,
                "status": row.status,
                "from_chain": row.from_chain,
                "amount_usd": int(row.amount_raw) / 1e6,
                "burn_tx_hash": row.burn_tx_hash,
                "mint_tx_hash": row.mint_tx_hash,
                "credit_tx_hash": row.credit_tx_hash,
                "last_error": row.last_error,
                "attempts": row.attempts or 0,
            }

    def health(self) -> dict:
        """Status counts across all CCTP deposits, for ops dashboards."""
        from sqlalchemy import func

        with get_session() as session:
            rows = (
                session.query(CctpDeposit.status, func.count(CctpDeposit.id))
                .group_by(CctpDeposit.status)
                .all()
            )
        counts = {status: int(n) for status, n in rows}
        in_flight = sum(counts.get(s, 0) for s in ("burned", "attested", "minted"))
        return {
            "enabled": self.is_enabled(),
            "running": self._running,
            "counts": counts,
            "in_flight": in_flight,
            "failed": counts.get("failed", 0),
            "credited": counts.get("credited", 0),
        }

    def requeue_failed(self) -> int:
        """Reset failed deposits so the loop retries them. Returns the count."""
        with get_session() as session:
            failed = session.query(CctpDeposit).filter_by(status="failed").all()
            n = 0
            for row in failed:
                # Resume at the furthest step we know completed.
                row.status = "minted" if row.mint_tx_hash else "burned"
                row.attempts = 0
                row.last_error = None
                n += 1
            return n

    async def relayer_balance_hype(self) -> Optional[float]:
        """HYPE balance of the relayer wallet on HyperEVM (None if unset)."""
        if not getattr(settings, "cctp_relayer_private_key", None):
            return None
        web3 = rpc_manager.get_web3(HYPEREVM_CHAIN)
        acct = self._relayer_account(web3)
        wei = await asyncio.to_thread(lambda: web3.eth.get_balance(acct.address))
        return float(web3.from_wei(wei, "ether"))


# Global instance.
cctp_relayer = CctpRelayer()
