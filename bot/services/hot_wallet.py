"""Hot wallet management service for custodial operations."""

import asyncio
import logging
import os
from typing import Optional, Tuple
from decimal import Decimal
from datetime import datetime, timezone
from web3 import Web3
from eth_account import Account
import aiohttp
import base58
from sqlalchemy.exc import IntegrityError

from bot.config.settings import settings
from bot.services.rpc_manager import rpc_manager
from bot.config.chains import CHAINS, ChainType, get_chain_by_name
from bot.config.tokens import get_token_address, get_token_decimals, NATIVE_TOKEN_ADDRESS
from bot.utils.encryption import encrypt_private_key, decrypt_private_key
from bot.utils.envelope_crypto import (
    encrypt_private_key_v2,
    encode_for_db,
    get_private_key_with_auto_migrate,
    SCHEME_LEGACY_FERNET_V1,
    SCHEME_KMS_AESGCM_V2,
)
from bot.models.custodial import (
    HotWallet,
    CustodialBalance,
    CustodialTransaction,
    TransactionType,
    TransactionStatus,
)
from database.db import get_session

logger = logging.getLogger(__name__)


class WithdrawalsPausedError(RuntimeError):
    """Raised when a withdrawal is attempted while the kill-switch is off."""


def _assert_withdrawals_enabled() -> None:
    """Shared server-side kill-switch for ALL withdraw surfaces (web + bot).

    Enforced here, inside send_native_token/send_token, so every caller
    (terminal API route, Telegram bot handler, future surfaces) honors the
    same TERMINAL_WITHDRAW_ENABLED toggle without needing to duplicate the
    check at each call site. Set TERMINAL_WITHDRAW_ENABLED=false to pause
    withdrawals instantly without a redeploy (deposits are unaffected).
    """
    enabled = os.getenv("TERMINAL_WITHDRAW_ENABLED", "true").strip().lower() not in (
        "false",
        "0",
        "no",
        "off",
    )
    if not enabled:
        raise WithdrawalsPausedError(
            "Withdrawals are temporarily paused. Please try again shortly."
        )


class ComplianceBlockedError(RuntimeError):
    """Raised when a withdrawal recipient fails sanctions screening."""


def _assert_recipient_compliant(
    to_address: str, chain_name: str, token_address: Optional[str] = None
) -> None:
    """Sanctions-screen a withdrawal recipient before any funds move.

    Placed beside the withdrawal kill-switch, inside send_native_token/send_token,
    so EVERY withdraw surface (terminal API route, Telegram handler, future ones)
    is covered without duplicating the check per call site.

    Previously ``compliance_service.screen`` had exactly ONE call site —
    ``SwapEngine.execute_swap`` — so withdrawals, the most obvious
    funds-leave-the-platform path, were screened by nothing on every chain.

    Behaviour follows ``COMPLIANCE_MODE``: DISABLED skips entirely (today's
    default), MONITOR logs, ENFORCE raises. Screening errors are logged and
    allowed through rather than breaking withdrawals — an outage in the screener
    must not become an outage in the product. That is a deliberate fail-OPEN on
    *errors* only; a real blocklist hit in ENFORCE mode always raises.
    """
    try:
        from bot.services.compliance import compliance_service

        if not compliance_service.enabled:
            return
        result = compliance_service.screen(
            recipient=to_address,
            tokens=[token_address] if token_address else None,
            chain=chain_name,
        )
        if not result.allowed:
            raise ComplianceBlockedError(result.reason or "Recipient failed compliance screening.")
    except ComplianceBlockedError:
        raise
    except Exception as e:  # noqa: BLE001 — screener failure must not halt withdrawals
        logger.warning("Compliance screening errored for %s on %s: %s", to_address, chain_name, e)


class PostBroadcastAmbiguous(RuntimeError):
    """Raised when the actual node broadcast call (send_raw_transaction /
    send_transaction) itself failed or threw AFTER the transaction may
    already have been accepted/propagated by the node (read timeout, dropped
    HTTP response, "already known", transient 5xx, etc).

    This is intentionally distinct from every other failure in the send path
    (nonce fetch, gas estimation, signing) which fail BEFORE anything is ever
    broadcast and are therefore safe to refund. Callers MUST NOT refund the
    reservation or release/delete an idempotency placeholder when they catch
    this — the reconciler (bot/services/withdraw_reconciler.py) is the only
    thing allowed to resolve it, by checking real chain state.
    """

    def __init__(self, message: str, tx_hash: Optional[str] = None):
        super().__init__(message)
        self.tx_hash = tx_hash


def quantize_to_decimals(amount: Decimal, decimals: int) -> Decimal:
    """Floor ``amount`` to the token's on-chain precision (ROUND_DOWN), so the
    ledger debit and the on-chain integer amount (``int(amount * 10**decimals)``)
    always agree exactly. Rounding DOWN (never up) ensures we never send more
    on-chain than we reserved in the ledger."""
    from decimal import ROUND_DOWN

    if decimals is None:
        return amount
    quantum = Decimal(1).scaleb(-decimals)
    return amount.quantize(quantum, rounding=ROUND_DOWN)


class HotWalletService:
    """Service for managing hot wallets and custodial balances."""

    def _get_web3(self, chain_name: str) -> Web3:
        """Get Web3 instance for a chain via RPCManager."""
        from bot.services.rpc_manager import rpc_manager

        return rpc_manager.get_web3(chain_name)

    # === Hot Wallet Management ===

    async def create_hot_wallet(
        self,
        name: str,
        chain_type: str,
        is_deposit_wallet: bool = True,
        is_gas_payer: bool = False,
    ) -> HotWallet:
        """
        Create a new hot wallet.

        Routes to Turnkey if configured, otherwise creates local wallet.
        """
        # Check if Turnkey is configured
        if settings.wallet_provider == "turnkey":
            return await self._create_turnkey_hot_wallet(
                name, chain_type, is_deposit_wallet, is_gas_payer
            )

        # Local hot wallet creation
        return self._create_local_hot_wallet(name, chain_type, is_deposit_wallet, is_gas_payer)

    def _create_local_hot_wallet(
        self,
        name: str,
        chain_type: str,
        is_deposit_wallet: bool,
        is_gas_payer: bool,
    ) -> HotWallet:
        """Create a local hot wallet with encrypted private key."""
        if chain_type == "evm":
            account = Account.create()
            address = account.address
            private_key = account.key.hex()
        elif chain_type == "solana":
            from solders.keypair import Keypair

            keypair = Keypair()
            address = str(keypair.pubkey())
            private_key = base58.b58encode(bytes(keypair)).decode()
        else:
            raise ValueError(f"Unsupported chain type: {chain_type}")

        # Use envelope encryption (v2) or legacy based on settings
        use_v2 = settings.wallet_encryption_scheme == SCHEME_KMS_AESGCM_V2

        if use_v2:
            encrypted = encrypt_private_key_v2(private_key)
            db_fields = encode_for_db(encrypted)
        else:
            db_fields = {
                "encrypted_private_key": encrypt_private_key(private_key, settings.encryption_key),
                "encryption_scheme": SCHEME_LEGACY_FERNET_V1,
                "kms_wrapped_dek": None,
                "aesgcm_nonce": None,
                "kms_key_id": None,
                "key_version": 1,
            }

        with get_session() as session:
            wallet = HotWallet(
                name=name,
                chain_type=chain_type,
                address=address,
                encrypted_private_key=db_fields["encrypted_private_key"],
                encryption_scheme=db_fields["encryption_scheme"],
                kms_wrapped_dek=db_fields.get("kms_wrapped_dek"),
                aesgcm_nonce=db_fields.get("aesgcm_nonce"),
                kms_key_id=db_fields.get("kms_key_id"),
                key_version=db_fields.get("key_version", 1),
                wallet_provider="local",
                is_deposit_wallet=is_deposit_wallet,
                is_gas_payer=is_gas_payer,
            )
            session.add(wallet)
            session.flush()
            wallet_id = wallet.id

        return self.get_hot_wallet_by_id(wallet_id)

    async def _create_turnkey_hot_wallet(
        self,
        name: str,
        chain_type: str,
        is_deposit_wallet: bool,
        is_gas_payer: bool,
    ) -> HotWallet:
        """Create a hot wallet via Turnkey (in main organization)."""
        from bot.services.turnkey_client import get_turnkey_client

        client = get_turnkey_client()

        # Create wallet in main organization (for hot wallets)
        turnkey_wallet = await client.create_wallet(
            wallet_name=f"hot_{name}_{chain_type}",
            chain_type=chain_type,
            organization_id=None,  # Use parent org
        )

        if not turnkey_wallet.address:
            raise RuntimeError("Turnkey hot wallet creation failed: no address returned")

        with get_session() as session:
            wallet = HotWallet(
                name=name,
                chain_type=chain_type,
                address=turnkey_wallet.address,
                # For Turnkey wallets, use a placeholder to satisfy NOT NULL constraints if they exist
                encrypted_private_key="turnkey_managed",
                encryption_scheme="turnkey",
                wallet_provider="turnkey",
                turnkey_wallet_id=turnkey_wallet.wallet_id,
                turnkey_account_id=turnkey_wallet.account_id,
                is_deposit_wallet=is_deposit_wallet,
                is_gas_payer=is_gas_payer,
            )
            session.add(wallet)
            session.flush()
            wallet_id = wallet.id

        logger.info(f"Created Turnkey hot wallet: {turnkey_wallet.address}")
        return self.get_hot_wallet_by_id(wallet_id)

    def import_hot_wallet(
        self,
        name: str,
        chain_type: str,
        private_key: str,
        is_deposit_wallet: bool = True,
        is_gas_payer: bool = False,
    ) -> HotWallet:
        """Import an existing wallet as hot wallet with KMS envelope encryption (v2)."""
        if chain_type == "evm":
            if not private_key.startswith("0x"):
                private_key = "0x" + private_key
            account = Account.from_key(private_key)
            address = account.address
        elif chain_type == "solana":
            from solders.keypair import Keypair

            key_bytes = base58.b58decode(private_key)
            keypair = Keypair.from_bytes(key_bytes)
            address = str(keypair.pubkey())
        else:
            raise ValueError(f"Unsupported chain type: {chain_type}")

        # Use envelope encryption (v2) or legacy based on settings
        use_v2 = settings.wallet_encryption_scheme == SCHEME_KMS_AESGCM_V2

        if use_v2:
            encrypted = encrypt_private_key_v2(private_key)
            db_fields = encode_for_db(encrypted)
        else:
            db_fields = {
                "encrypted_private_key": encrypt_private_key(private_key, settings.encryption_key),
                "encryption_scheme": SCHEME_LEGACY_FERNET_V1,
                "kms_wrapped_dek": None,
                "aesgcm_nonce": None,
                "kms_key_id": None,
                "key_version": 1,
            }

        with get_session() as session:
            wallet = HotWallet(
                name=name,
                chain_type=chain_type,
                address=address,
                encrypted_private_key=db_fields["encrypted_private_key"],
                encryption_scheme=db_fields["encryption_scheme"],
                kms_wrapped_dek=db_fields.get("kms_wrapped_dek"),
                aesgcm_nonce=db_fields.get("aesgcm_nonce"),
                kms_key_id=db_fields.get("kms_key_id"),
                key_version=db_fields.get("key_version", 1),
                is_deposit_wallet=is_deposit_wallet,
                is_gas_payer=is_gas_payer,
            )
            session.add(wallet)
            session.flush()
            wallet_id = wallet.id

        return self.get_hot_wallet_by_id(wallet_id)

    def get_hot_wallet_by_id(self, wallet_id: int) -> Optional[HotWallet]:
        """Get hot wallet by ID."""
        with get_session() as session:
            return session.query(HotWallet).filter(HotWallet.id == wallet_id).first()

    def get_deposit_wallet(self, chain_type: str) -> Optional[HotWallet]:
        """Get the primary deposit wallet for a chain type."""
        with get_session() as session:
            return (
                session.query(HotWallet)
                .filter(
                    HotWallet.chain_type == chain_type,
                    HotWallet.is_deposit_wallet == True,
                    HotWallet.is_active == True,
                )
                .first()
            )

    def get_gas_payer_wallet(self, chain_type: str) -> Optional[HotWallet]:
        """Get the gas payer wallet for a chain type."""
        with get_session() as session:
            return (
                session.query(HotWallet)
                .filter(
                    HotWallet.chain_type == chain_type,
                    HotWallet.is_gas_payer == True,
                    HotWallet.is_active == True,
                )
                .first()
            )

    def get_private_key(self, wallet: HotWallet, auto_migrate: bool = True) -> str:
        """
        Decrypt and return private key.

        Handles both legacy (Fernet) and v2 (KMS + AES-GCM) encryption schemes.
        Optionally auto-migrates legacy wallets to v2 on first access.

        Note: Turnkey wallets do not have accessible private keys.

        Args:
            wallet: HotWallet object
            auto_migrate: Whether to migrate legacy wallets to v2

        Returns:
            Decrypted private key string

        Raises:
            ValueError: If wallet is a Turnkey wallet
        """
        # Turnkey wallets don't have local private keys
        if wallet.is_turnkey_wallet:
            raise ValueError(
                "Cannot access private key for Turnkey hot wallet. "
                "Use send_native_token or send_token instead."
            )

        with get_session() as session:
            # Re-attach wallet to session for potential migration update
            wallet = session.merge(wallet)
            return get_private_key_with_auto_migrate(
                wallet_row=wallet,
                session=session,
                auto_migrate=auto_migrate,
            )

    # === Balance Management ===

    def get_custodial_balance(
        self,
        user_id: int,
        chain: str,
        token_symbol: str,
    ) -> Decimal:
        """Get user's custodial balance for a token."""
        with get_session() as session:
            balance = (
                session.query(CustodialBalance)
                .filter(
                    CustodialBalance.user_id == user_id,
                    CustodialBalance.chain == chain,
                    CustodialBalance.token_symbol == token_symbol,
                )
                .first()
            )

            if balance:
                return Decimal(balance.balance)
            return Decimal("0")

    def get_all_custodial_balances(self, user_id: int) -> dict[str, dict[str, Decimal]]:
        """Get all custodial balances for a user."""
        with get_session() as session:
            balances = (
                session.query(CustodialBalance)
                .filter(
                    CustodialBalance.user_id == user_id,
                )
                .all()
            )

            result: dict[str, dict[str, Decimal]] = {}
            for bal in balances:
                if bal.chain not in result:
                    result[bal.chain] = {}
                result[bal.chain][bal.token_symbol] = Decimal(bal.balance)

            return result

    def update_custodial_balance(
        self,
        user_id: int,
        chain: str,
        token_symbol: str,
        amount: Decimal,
        operation: str = "add",  # "add" or "subtract"
    ) -> Decimal:
        """Update custodial balance. Returns new balance."""
        token_address = get_token_address(token_symbol, chain) or NATIVE_TOKEN_ADDRESS

        with get_session() as session:
            balance = (
                session.query(CustodialBalance)
                .filter(
                    CustodialBalance.user_id == user_id,
                    CustodialBalance.chain == chain,
                    CustodialBalance.token_symbol == token_symbol,
                )
                .first()
            )

            if not balance:
                balance = CustodialBalance(
                    user_id=user_id,
                    chain=chain,
                    token_symbol=token_symbol,
                    token_address=token_address,
                    balance="0",
                )
                session.add(balance)

            current = Decimal(balance.balance)

            if operation == "add":
                new_balance = current + amount
            elif operation == "subtract":
                new_balance = current - amount
                if new_balance < 0:
                    raise ValueError("Insufficient balance")
            else:
                raise ValueError(f"Invalid operation: {operation}")

            balance.balance = str(new_balance)
            session.flush()

            return new_balance

    def reserve_custodial_balance(
        self,
        user_id: int,
        chain: str,
        token_symbol: str,
        amount: Decimal,
        max_retries: int = 5,
    ) -> bool:
        """Atomically debit ``amount`` from a user's custodial balance, iff the
        current balance covers it. This is the single source of truth for the
        "reserve before send" pattern: callers MUST call this BEFORE submitting
        an on-chain send, and MUST refund (operation="add") if the send fails.

        Implemented as a compare-and-swap loop: read the current balance string,
        then issue an UPDATE guarded by ``balance == <the exact string just
        read>``. The UPDATE's rowcount tells us, atomically, whether another
        concurrent reservation won the race in between our read and our write —
        if so we retry against the fresh value (bounded by ``max_retries``)
        instead of silently overwriting a change we never saw. This avoids
        relying on numeric CAST comparisons in the WHERE clause (balance is
        stored as a precision-preserving string and the column type differs
        between sqlite and postgres), while still giving each successful UPDATE
        the same "only one writer wins" guarantee a numeric conditional UPDATE
        would provide.

        Returns True iff the reservation succeeded (balance was debited).
        Returns False iff the balance was insufficient (never over-debits).
        """
        if amount <= 0:
            return False

        for _ in range(max_retries):
            with get_session() as session:
                row = (
                    session.query(CustodialBalance)
                    .filter(
                        CustodialBalance.user_id == user_id,
                        CustodialBalance.chain == chain,
                        CustodialBalance.token_symbol == token_symbol,
                    )
                    .first()
                )
                if not row:
                    return False

                current_str = row.balance
                current = Decimal(current_str)
                if current < amount:
                    return False

                new_balance = current - amount
                updated = (
                    session.query(CustodialBalance)
                    .filter(
                        CustodialBalance.id == row.id,
                        CustodialBalance.balance == current_str,
                    )
                    .update({"balance": str(new_balance)}, synchronize_session=False)
                )
                session.commit()

                if updated == 1:
                    return True
                # Lost the race to a concurrent reservation/credit; retry against
                # the now-current balance rather than assuming failure.

        return False

    # === Transaction Recording ===

    def record_transaction(
        self,
        user_id: int,
        tx_type: TransactionType,
        chain: str,
        token_symbol: str,
        amount: Decimal,
        tx_hash: Optional[str] = None,
        from_address: Optional[str] = None,
        to_address: Optional[str] = None,
        gas_sponsored: bool = False,
        gas_cost: Optional[Decimal] = None,
        notes: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> CustodialTransaction:
        """Record a custodial transaction."""
        token_address = get_token_address(token_symbol, chain) or NATIVE_TOKEN_ADDRESS

        with get_session() as session:
            tx = CustodialTransaction(
                user_id=user_id,
                tx_type=tx_type.value,
                chain=chain,
                token_symbol=token_symbol,
                token_address=token_address,
                amount=str(amount),
                tx_hash=tx_hash,
                from_address=from_address,
                to_address=to_address,
                gas_sponsored=gas_sponsored,
                gas_cost=str(gas_cost) if gas_cost else None,
                notes=notes,
                idempotency_key=idempotency_key,
            )
            session.add(tx)
            session.flush()
            tx_id = tx.id

        with get_session() as session:
            return (
                session.query(CustodialTransaction).filter(CustodialTransaction.id == tx_id).first()
            )

    def claim_idempotency_key(
        self,
        idempotency_key: str,
        user_id: int,
        tx_type: TransactionType,
        chain: str,
        token_symbol: str,
        amount: Decimal,
        to_address: Optional[str] = None,
    ) -> Optional[int]:
        """Atomically claim an idempotency key by inserting a PENDING
        placeholder row guarded by the unique index on idempotency_key.

        This must be called BEFORE reserving/debiting the balance so the
        dedupe check itself has no TOCTOU window: if two requests race with
        the same key, the DB unique constraint lets only one INSERT succeed;
        the loser gets an IntegrityError and returns None (caller should then
        look up and return the winner's result instead of proceeding).

        Returns the new transaction id on success, or None if the key was
        already claimed by another request.
        """
        token_address = get_token_address(token_symbol, chain) or NATIVE_TOKEN_ADDRESS
        try:
            with get_session() as session:
                tx = CustodialTransaction(
                    user_id=user_id,
                    tx_type=tx_type.value,
                    status=TransactionStatus.PENDING.value,
                    chain=chain,
                    token_symbol=token_symbol,
                    token_address=token_address,
                    amount=str(amount),
                    to_address=to_address,
                    idempotency_key=idempotency_key,
                )
                session.add(tx)
                session.commit()
                return tx.id
        except IntegrityError:
            return None

    def finalize_claimed_transaction(
        self,
        tx_id: int,
        tx_hash: str,
        from_address: Optional[str] = None,
    ) -> None:
        """Mark a claimed (pending) idempotency placeholder as completed once
        the on-chain send has actually succeeded."""
        with get_session() as session:
            tx = (
                session.query(CustodialTransaction).filter(CustodialTransaction.id == tx_id).first()
            )
            if tx:
                tx.status = TransactionStatus.COMPLETED.value
                tx.tx_hash = tx_hash
                if from_address:
                    tx.from_address = from_address
                tx.completed_at = datetime.now(timezone.utc)

    def stamp_pending_tx_hash(self, tx_id: int, tx_hash: str) -> None:
        """Persist the deterministic tx hash/signature onto a PENDING claimed
        placeholder BEFORE the broadcast call is made. This is what lets the
        withdraw reconciler resolve an ambiguous send (PostBroadcastAmbiguous)
        against real chain state instead of ever having to blind-refund a
        withdrawal purely by age — the hash is known before the risky call,
        so it is always available even if the broadcast call itself throws."""
        if not tx_hash:
            return
        with get_session() as session:
            tx = (
                session.query(CustodialTransaction).filter(CustodialTransaction.id == tx_id).first()
            )
            if tx and not tx.tx_hash:
                tx.tx_hash = tx_hash

    def record_pending_tx_hash(self, tx_id: int, tx_hash: str) -> bool:
        """Record a tx hash/signature on a PENDING placeholder WITHOUT
        finalizing it — used by callers catching PostBroadcastAmbiguous to
        make sure the hash from the exception is actually persisted (the
        pre-broadcast stamp inside send_token/send_native_token already does
        this in the common case, but this is the explicit, idempotent
        backstop callers invoke from their except block so a hash is never
        silently dropped).

        Implemented as a single conditional UPDATE guarded by
        ``status='pending' AND tx_hash IS NULL`` so it is safe to call
        repeatedly and never overwrites a hash/status set by a concurrent
        finalize() or a reconciler pass. Returns True iff the row was
        updated.
        """
        if not tx_hash:
            return False
        with get_session() as session:
            updated = (
                session.query(CustodialTransaction)
                .filter(
                    CustodialTransaction.id == tx_id,
                    CustodialTransaction.status == TransactionStatus.PENDING.value,
                    CustodialTransaction.tx_hash.is_(None),
                )
                .update({"tx_hash": tx_hash}, synchronize_session=False)
            )
            session.commit()
            return updated == 1

    def cas_transaction_status(
        self,
        tx_id: int,
        expected_status: TransactionStatus,
        new_status: TransactionStatus,
        tx_hash: Optional[str] = None,
    ) -> bool:
        """Atomically transition a CustodialTransaction's status via a single
        conditional UPDATE guarded by the row's CURRENT status. Returns True
        only if the transition was applied (rowcount == 1) — i.e. no other
        writer (a live request finalizing the same placeholder, or a
        concurrent reconciler pass) had already moved the row out of
        ``expected_status``.

        This is the CAS the withdraw reconciler uses for both its
        confirmed->COMPLETED and its refund->FAILED transitions, so a
        request-path finalize() racing a reconciler pass can never result in
        a double-refund or a status flip back to FAILED after a real
        completion.
        """
        with get_session() as session:
            values: dict = {"status": new_status.value}
            if new_status == TransactionStatus.COMPLETED:
                values["completed_at"] = datetime.now(timezone.utc)
            if tx_hash:
                values["tx_hash"] = tx_hash
            updated = (
                session.query(CustodialTransaction)
                .filter(
                    CustodialTransaction.id == tx_id,
                    CustodialTransaction.status == expected_status.value,
                )
                .update(values, synchronize_session=False)
            )
            session.commit()
            return updated == 1

    def release_claimed_transaction(self, tx_id: int) -> None:
        """Delete a claimed idempotency placeholder after a failed send so the
        key becomes reusable for a genuine retry (the balance reservation is
        refunded separately by the caller)."""
        with get_session() as session:
            tx = (
                session.query(CustodialTransaction).filter(CustodialTransaction.id == tx_id).first()
            )
            if tx:
                session.delete(tx)

    def get_transaction_by_idempotency_key(
        self, user_id: int, idempotency_key: str
    ) -> Optional[CustodialTransaction]:
        """Look up a previously-recorded custodial transaction by its client
        idempotency key, SCOPED TO user_id (the unique index is now
        UNIQUE(user_id, idempotency_key) — two different users may reuse the
        same client-chosen key without colliding or leaking each other's tx
        hash/status). Used to short-circuit withdraw retries/replays."""
        if not idempotency_key:
            return None
        with get_session() as session:
            return (
                session.query(CustodialTransaction)
                .filter(
                    CustodialTransaction.user_id == user_id,
                    CustodialTransaction.idempotency_key == idempotency_key,
                )
                .first()
            )

    def update_transaction_status(
        self,
        tx_id: int,
        status: TransactionStatus,
        tx_hash: Optional[str] = None,
    ) -> None:
        """Update transaction status."""
        with get_session() as session:
            tx = (
                session.query(CustodialTransaction).filter(CustodialTransaction.id == tx_id).first()
            )

            if tx:
                tx.status = status.value
                if tx_hash:
                    tx.tx_hash = tx_hash
                if status == TransactionStatus.COMPLETED:
                    tx.completed_at = datetime.now(timezone.utc)

    # === Hot Wallet Operations ===

    async def get_hot_wallet_balance(
        self,
        wallet: HotWallet,
        chain_name: str,
    ) -> Tuple[Decimal, dict[str, Decimal]]:
        """
        Get hot wallet balances.

        Returns:
            Tuple of (native_balance, {token_symbol: balance})
        """
        if wallet.chain_type == "evm":
            return await self._get_evm_wallet_balance(wallet, chain_name)
        elif wallet.chain_type == "solana":
            return await self._get_solana_wallet_balance(wallet)
        else:
            return Decimal("0"), {}

    async def _get_evm_wallet_balance(
        self,
        wallet: HotWallet,
        chain_name: str,
    ) -> Tuple[Decimal, dict[str, Decimal]]:
        """Get EVM wallet balances."""
        web3 = self._get_web3(chain_name)

        # Native balance
        native_wei = web3.eth.get_balance(Web3.to_checksum_address(wallet.address))
        native_balance = Decimal(str(native_wei)) / Decimal(10**18)

        # Token balances
        from bot.config.tokens import TOKENS

        token_balances = {}

        for token_symbol, token in TOKENS.items():
            if chain_name in token.addresses:
                token_address = token.addresses[chain_name]
                if token_address.startswith("0x") and token_address != NATIVE_TOKEN_ADDRESS:
                    try:
                        balance = await self._get_erc20_balance(
                            web3, token_address, wallet.address, token.decimals
                        )
                        if balance > 0:
                            token_balances[token_symbol] = balance
                    except Exception as e:
                        logger.debug(f"Failed to fetch {token_symbol} balance: {e}")

        return native_balance, token_balances

    async def _get_erc20_balance(
        self,
        web3: Web3,
        token_address: str,
        wallet_address: str,
        decimals: int,
    ) -> Decimal:
        """Get ERC20 token balance."""
        abi = [
            {
                "constant": True,
                "inputs": [{"name": "_owner", "type": "address"}],
                "name": "balanceOf",
                "outputs": [{"name": "balance", "type": "uint256"}],
                "type": "function",
            }
        ]

        contract = web3.eth.contract(address=Web3.to_checksum_address(token_address), abi=abi)

        balance = contract.functions.balanceOf(Web3.to_checksum_address(wallet_address)).call()
        return Decimal(str(balance)) / Decimal(10**decimals)

    async def _get_solana_wallet_balance(
        self,
        wallet: HotWallet,
    ) -> Tuple[Decimal, dict[str, Decimal]]:
        """Get Solana wallet balances."""
        native_balance = Decimal("0")
        token_balances = {}

        try:
            async with aiohttp.ClientSession() as session:
                # SOL balance
                payload = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "getBalance",
                    "params": [wallet.address],
                }
                async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
                    result = await resp.json()
                    if "result" in result:
                        lamports = result["result"]["value"]
                        native_balance = Decimal(str(lamports)) / Decimal(10**9)
        except Exception as e:
            logger.error(f"Error fetching Solana balance: {e}")

        return native_balance, token_balances

    async def send_native_token(
        self,
        wallet: HotWallet,
        chain_name: str,
        to_address: str,
        amount: Decimal,
        claimed_tx_id: Optional[int] = None,
    ) -> str:
        """Send native token from hot wallet. Returns tx hash.

        ``claimed_tx_id``, if provided, is the id of the caller's claimed
        idempotency placeholder (see claim_idempotency_key). It is used to
        stamp the deterministic tx hash onto that row BEFORE the broadcast
        call, so an ambiguous broadcast failure (PostBroadcastAmbiguous)
        always leaves a resolvable hash behind for the withdraw reconciler.
        """
        _assert_withdrawals_enabled()
        _assert_recipient_compliant(to_address, chain_name)
        if wallet.chain_type == "solana":
            return await self._send_sol_native(
                wallet, to_address, amount, claimed_tx_id=claimed_tx_id
            )
        elif wallet.chain_type != "evm":
            raise NotImplementedError(f"Chain type {wallet.chain_type} not supported")

        web3 = self._get_web3(chain_name)
        chain = get_chain_by_name(chain_name)

        amount_wei = int(amount * Decimal(10**18))

        # Build transaction
        nonce = web3.eth.get_transaction_count(Web3.to_checksum_address(wallet.address))
        gas_price = web3.eth.gas_price

        tx = {
            "nonce": nonce,
            "to": Web3.to_checksum_address(to_address),
            "value": amount_wei,
            "gas": 21000,
            "gasPrice": gas_price,
            "chainId": chain.chain_id,
        }

        # Sign based on wallet provider. Signing itself is pre-broadcast and
        # safe to let fail normally; only the send_raw_transaction call is
        # ambiguous once invoked.
        if wallet.is_turnkey_wallet:
            signed_tx_hex = await self._sign_via_turnkey(wallet, tx)
            raw_tx = bytes.fromhex(signed_tx_hex.replace("0x", ""))
        else:
            private_key = self.get_private_key(wallet)
            if not private_key.startswith("0x"):
                private_key = "0x" + private_key
            signed = Account.sign_transaction(tx, private_key)
            raw_tx = signed.rawTransaction

        tx_hash = self._broadcast_evm_raw_tx(web3, raw_tx, claimed_tx_id=claimed_tx_id)
        return tx_hash.hex()

    def _broadcast_evm_raw_tx(self, web3: Web3, raw_tx: bytes, claimed_tx_id: Optional[int] = None):
        """Submit a signed raw EVM transaction. The tx hash is deterministic
        from the signed raw bytes (keccak256), so it's known and stamped onto
        the claimed idempotency placeholder BEFORE we ever call the node —
        that way, if send_raw_transaction itself throws (timeout / dropped
        response / transient 5xx / "already known"), the row this ambiguous
        failure leaves behind ALWAYS has a hash the reconciler can resolve
        against real chain state, instead of a hash-less row that would
        otherwise have to be blind-refunded by age.

        Any exception from the actual send_raw_transaction call is treated as
        PostBroadcastAmbiguous — the node may have already accepted the tx
        even though the call raised. Callers must NOT refund/release on this
        path; leave it for the reconciler."""
        precomputed_hash = Web3.keccak(raw_tx).hex()
        if claimed_tx_id is not None:
            self.stamp_pending_tx_hash(claimed_tx_id, precomputed_hash)
        try:
            return web3.eth.send_raw_transaction(raw_tx)
        except Exception as e:
            raise PostBroadcastAmbiguous(
                f"send_raw_transaction failed ambiguously (tx may already be broadcast): {e}",
                tx_hash=precomputed_hash,
            ) from e

    async def _send_sol_native(
        self,
        wallet: HotWallet,
        to_address: str,
        amount: Decimal,
        claimed_tx_id: Optional[int] = None,
    ) -> str:
        """Send native SOL from hot wallet. Returns transaction signature."""
        from solana.rpc.async_api import AsyncClient
        from solders.keypair import Keypair
        from solders.pubkey import Pubkey
        from solders.system_program import transfer, TransferParams
        from solders.transaction import Transaction
        from solders.message import Message

        # Get Solana RPC URL
        rpc_url = getattr(settings, "solana_rpc_url", None)
        if not rpc_url:
            raise ValueError("Solana RPC URL not configured")

        # Decrypt private key and restore keypair
        private_key = self.get_private_key(wallet)
        key_bytes = base58.b58decode(private_key)
        keypair = Keypair.from_bytes(key_bytes)

        # Convert amount to lamports (1 SOL = 10^9 lamports)
        lamports = int(amount * Decimal(10**9))

        # Create async client
        async with AsyncClient(rpc_url) as client:
            # Build transfer instruction
            transfer_ix = transfer(
                TransferParams(
                    from_pubkey=keypair.pubkey(),
                    to_pubkey=Pubkey.from_string(to_address),
                    lamports=lamports,
                )
            )

            # Get recent blockhash
            blockhash_resp = await client.get_latest_blockhash()
            recent_blockhash = blockhash_resp.value.blockhash

            # Create and sign transaction
            message = Message.new_with_blockhash(
                [transfer_ix],
                keypair.pubkey(),
                recent_blockhash,
            )
            tx = Transaction.new_unsigned(message)
            tx.sign([keypair], recent_blockhash)

            # The signature is deterministic from the signed tx — derive and
            # stamp it onto the claimed idempotency placeholder BEFORE
            # sending, same rationale as the EVM path: an ambiguous send
            # failure must always leave a resolvable hash behind.
            precomputed_sig = str(tx.signatures[0])
            if claimed_tx_id is not None:
                self.stamp_pending_tx_hash(claimed_tx_id, precomputed_sig)

            # Send transaction. Any exception here is ambiguous — the RPC node
            # may have already accepted/relayed the transaction even if this
            # call raised. Do not let callers treat this as safe-to-refund.
            try:
                result = await client.send_transaction(tx)
            except Exception as e:
                raise PostBroadcastAmbiguous(
                    f"Solana send_transaction failed ambiguously (tx may already be broadcast): {e}",
                    tx_hash=precomputed_sig,
                ) from e
            signature = str(result.value)

            logger.info(f"Sent {amount} SOL to {to_address}, signature: {signature}")
            return signature

    async def _send_spl_token(
        self,
        wallet: HotWallet,
        token_address: str,
        to_address: str,
        amount: Decimal,
        decimals: int,
        claimed_tx_id: Optional[int] = None,
    ) -> str:
        """Send SPL token from hot wallet. Returns transaction signature."""
        from solana.rpc.async_api import AsyncClient
        from solders.keypair import Keypair
        from solders.pubkey import Pubkey
        from solders.transaction import Transaction
        from solders.message import Message
        from spl.token.instructions import (
            transfer_checked,
            TransferCheckedParams,
            get_associated_token_address,
        )
        from spl.token.async_client import AsyncToken

        # Get Solana RPC URL
        rpc_url = getattr(settings, "solana_rpc_url", None)
        if not rpc_url:
            raise ValueError("Solana RPC URL not configured")

        # Decrypt private key and restore keypair
        private_key = self.get_private_key(wallet)
        key_bytes = base58.b58decode(private_key)
        keypair = Keypair.from_bytes(key_bytes)

        # Convert token addresses to Pubkey
        mint_pubkey = Pubkey.from_string(token_address)
        dest_pubkey = Pubkey.from_string(to_address)

        # Get associated token accounts
        source_ata = get_associated_token_address(keypair.pubkey(), mint_pubkey)
        dest_ata = get_associated_token_address(dest_pubkey, mint_pubkey)

        # Convert amount to token units
        amount_raw = int(amount * Decimal(10**decimals))

        # Create async client
        async with AsyncClient(rpc_url) as client:
            # Build transfer_checked instruction (validates decimals for safety)
            transfer_ix = transfer_checked(
                TransferCheckedParams(
                    program_id=Pubkey.from_string(
                        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
                    ),  # SPL Token program
                    source=source_ata,
                    mint=mint_pubkey,
                    dest=dest_ata,
                    owner=keypair.pubkey(),
                    amount=amount_raw,
                    decimals=decimals,
                )
            )

            # Get recent blockhash
            blockhash_resp = await client.get_latest_blockhash()
            recent_blockhash = blockhash_resp.value.blockhash

            # Create and sign transaction
            message = Message.new_with_blockhash(
                [transfer_ix],
                keypair.pubkey(),
                recent_blockhash,
            )
            tx = Transaction.new_unsigned(message)
            tx.sign([keypair], recent_blockhash)

            # See _send_sol_native: stamp the deterministic signature onto the
            # claimed idempotency placeholder BEFORE sending.
            precomputed_sig = str(tx.signatures[0])
            if claimed_tx_id is not None:
                self.stamp_pending_tx_hash(claimed_tx_id, precomputed_sig)

            # Send transaction. Any exception here is ambiguous — see
            # _send_sol_native for why this must not be treated as safe to
            # refund/release by callers.
            try:
                result = await client.send_transaction(tx)
            except Exception as e:
                raise PostBroadcastAmbiguous(
                    f"Solana send_transaction failed ambiguously (tx may already be broadcast): {e}",
                    tx_hash=precomputed_sig,
                ) from e
            signature = str(result.value)

            logger.info(
                f"Sent {amount} of token {token_address} to {to_address}, signature: {signature}"
            )
            return signature

    async def send_token(
        self,
        wallet: HotWallet,
        chain_name: str,
        token_address: str,
        to_address: str,
        amount: Decimal,
        decimals: int,
        memo: str = "",
        claimed_tx_id: Optional[int] = None,
    ) -> str:
        """Send ERC20/SPL token from hot wallet. Returns tx hash/signature.

        On Tempo (chain 4217), tokens are TIP-20 (an ERC-20 superset). Tempo
        transfers are routed through ``transferWithMemo`` so an optional payment
        ``memo`` can ride with the transfer; an empty memo still produces a real
        TIP-20 transferWithMemo call. All other chains use plain ERC-20
        ``transfer``.

        ``claimed_tx_id`` — see send_native_token: stamps the deterministic
        pre-broadcast hash onto the caller's claimed idempotency placeholder.
        """
        _assert_withdrawals_enabled()
        _assert_recipient_compliant(to_address, chain_name, token_address)
        if wallet.chain_type == "solana":
            return await self._send_spl_token(
                wallet, token_address, to_address, amount, decimals, claimed_tx_id=claimed_tx_id
            )
        elif wallet.chain_type != "evm":
            raise NotImplementedError(f"Chain type {wallet.chain_type} not supported")

        web3 = self._get_web3(chain_name)
        chain = get_chain_by_name(chain_name)

        amount_raw = int(amount * Decimal(10**decimals))

        nonce = web3.eth.get_transaction_count(Web3.to_checksum_address(wallet.address))
        gas_price = web3.eth.gas_price

        if chain_name == "tempo":
            # TIP-20 transferWithMemo (Tempo native). build_transfer_with_memo
            # returns {to, data, value}; we add the standard tx fields here.
            from bot.services.tempo_tip20 import tempo_tip20

            base = tempo_tip20.build_transfer_with_memo(
                token_address=token_address,
                to=to_address,
                amount=amount_raw,
                memo=memo or "",
            )
            tx = {
                "from": Web3.to_checksum_address(wallet.address),
                "to": base["to"],
                "data": base["data"],
                "value": base.get("value", 0),
                "nonce": nonce,
                "gasPrice": gas_price,
                "chainId": chain.chain_id,
            }
        else:
            # ERC20 transfer ABI
            abi = [
                {
                    "constant": False,
                    "inputs": [
                        {"name": "_to", "type": "address"},
                        {"name": "_value", "type": "uint256"},
                    ],
                    "name": "transfer",
                    "outputs": [{"name": "", "type": "bool"}],
                    "type": "function",
                }
            ]

            contract = web3.eth.contract(address=Web3.to_checksum_address(token_address), abi=abi)

            # Build transaction
            tx = contract.functions.transfer(
                Web3.to_checksum_address(to_address), amount_raw
            ).build_transaction(
                {
                    "nonce": nonce,
                    "gasPrice": gas_price,
                    "chainId": chain.chain_id,
                }
            )

        # Estimate gas
        tx["gas"] = web3.eth.estimate_gas(tx)

        # Sign based on wallet provider. Signing itself is pre-broadcast and
        # safe to let fail normally; only the send_raw_transaction call is
        # ambiguous once invoked.
        if wallet.is_turnkey_wallet:
            signed_tx_hex = await self._sign_via_turnkey(wallet, tx)
            raw_tx = bytes.fromhex(signed_tx_hex.replace("0x", ""))
        else:
            private_key = self.get_private_key(wallet)
            if not private_key.startswith("0x"):
                private_key = "0x" + private_key
            signed = Account.sign_transaction(tx, private_key)
            raw_tx = signed.rawTransaction

        tx_hash = self._broadcast_evm_raw_tx(web3, raw_tx, claimed_tx_id=claimed_tx_id)
        return tx_hash.hex()

    async def _sign_via_turnkey(self, wallet: HotWallet, transaction: dict) -> str:
        """Sign a transaction via Turnkey API."""
        from bot.services.turnkey_client import get_turnkey_client
        import rlp

        client = get_turnkey_client()

        # Serialize transaction for Turnkey
        tx_data = [
            transaction.get("nonce", 0),
            transaction.get("gasPrice", 0),
            transaction.get("gas", 21000),
            bytes.fromhex(transaction["to"][2:]) if transaction.get("to") else b"",
            transaction.get("value", 0),
            bytes.fromhex(transaction.get("data", "0x")[2:]) if transaction.get("data") else b"",
            transaction.get("chainId", 1),
            0,
            0,
        ]
        encoded = rlp.encode(tx_data)
        unsigned_tx_hex = "0x" + encoded.hex()

        signed_tx = await client.sign_transaction(
            unsigned_transaction=unsigned_tx_hex,
            sign_with=wallet.address,
            transaction_type="TRANSACTION_TYPE_ETHEREUM",
            organization_id=None,  # Main org for hot wallets
        )

        return signed_tx


# Global instance
hot_wallet_service = HotWalletService()
