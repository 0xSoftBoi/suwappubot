"""
Fallback signing service with circuit breaker for Turnkey outages.

When Turnkey is down, signs transactions locally using KMS-encrypted backup keys.
"""

import logging
import time
from enum import Enum
from typing import Optional

from bot.services.turnkey_client import TurnkeyAPIError

logger = logging.getLogger(__name__)


class CircuitState(str, Enum):
    CLOSED = "closed"        # Normal — using Turnkey
    OPEN = "open"            # Turnkey down — using local backup
    HALF_OPEN = "half_open"  # Testing if Turnkey recovered


class CircuitBreaker:
    """
    Circuit breaker for Turnkey API calls.

    CLOSED → OPEN after `threshold` consecutive failures.
    OPEN → HALF_OPEN after `recovery_timeout` seconds.
    HALF_OPEN → CLOSED after `success_threshold` consecutive successes.
    HALF_OPEN → OPEN on any failure.
    """

    def __init__(self, threshold: int = 3, recovery_timeout: int = 300, success_threshold: int = 2):
        self.threshold = threshold
        self.recovery_timeout = recovery_timeout
        self.success_threshold = success_threshold
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._last_failure_time: float = 0

    @property
    def state(self) -> CircuitState:
        if self._state == CircuitState.OPEN:
            if time.time() - self._last_failure_time >= self.recovery_timeout:
                self._state = CircuitState.HALF_OPEN
                self._success_count = 0
                logger.info("Circuit breaker → HALF_OPEN (testing Turnkey)")
        return self._state

    @property
    def is_open(self) -> bool:
        return self.state == CircuitState.OPEN

    def record_failure(self):
        self._failure_count += 1
        self._last_failure_time = time.time()
        if self._state == CircuitState.HALF_OPEN:
            self._state = CircuitState.OPEN
            logger.warning("Circuit breaker → OPEN (Turnkey still failing)")
        elif self._failure_count >= self.threshold:
            self._state = CircuitState.OPEN
            logger.warning(f"Circuit breaker → OPEN after {self._failure_count} failures")

    def record_success(self):
        if self._state == CircuitState.HALF_OPEN:
            self._success_count += 1
            if self._success_count >= self.success_threshold:
                self._state = CircuitState.CLOSED
                self._failure_count = 0
                logger.info("Circuit breaker → CLOSED (Turnkey recovered)")
        else:
            self._failure_count = 0

    def reset(self):
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0


# Global circuit breaker instance
_circuit_breaker: Optional[CircuitBreaker] = None


def get_circuit_breaker() -> CircuitBreaker:
    global _circuit_breaker
    if _circuit_breaker is None:
        from bot.config.settings import settings
        _circuit_breaker = CircuitBreaker(
            threshold=getattr(settings, 'turnkey_circuit_breaker_threshold', 3),
            recovery_timeout=getattr(settings, 'turnkey_circuit_breaker_recovery_seconds', 300),
        )
    return _circuit_breaker


def should_use_fallback() -> bool:
    """Check if we should use fallback signing (local backup keys)."""
    from bot.config.settings import settings

    mode = getattr(settings, 'turnkey_fallback_mode', 'auto')

    if mode == 'disabled':
        return False
    if mode == 'manual':
        return True
    # auto mode — use circuit breaker
    return get_circuit_breaker().is_open


async def sign_evm_with_fallback(wallet_service, wallet, transaction: dict) -> str:
    """
    Sign an EVM transaction with Turnkey fallback.

    Tries Turnkey first; on failure, falls back to local signing using backup key.
    """
    from bot.config.settings import settings

    if not getattr(settings, 'turnkey_fallback_enabled', True):
        return await wallet_service.sign_evm_transaction(wallet, transaction)

    if not wallet.is_turnkey_wallet:
        return await wallet_service._sign_evm_local(wallet, transaction)

    if should_use_fallback():
        return _sign_evm_local(wallet_service, wallet, transaction)

    try:
        result = await wallet_service._sign_evm_via_turnkey(wallet, transaction)
        get_circuit_breaker().record_success()
        return result
    except (TurnkeyAPIError, Exception) as e:
        get_circuit_breaker().record_failure()
        logger.warning(f"Turnkey EVM signing failed, trying backup: {e}")
        if wallet.encrypted_private_key and wallet.encrypted_private_key != "turnkey_managed":
            return _sign_evm_local(wallet_service, wallet, transaction)
        raise


async def sign_typed_data_with_fallback(wallet_service, wallet, typed_data: dict) -> str:
    """Sign EIP-712 typed data with Turnkey fallback."""
    from bot.config.settings import settings

    if not getattr(settings, 'turnkey_fallback_enabled', True):
        return await wallet_service.sign_typed_data(wallet, typed_data)

    if not wallet.is_turnkey_wallet:
        return await wallet_service._sign_typed_data_local(wallet, typed_data)

    if should_use_fallback():
        return _sign_typed_data_local(wallet_service, wallet, typed_data)

    try:
        result = await wallet_service._sign_typed_data_via_turnkey(wallet, typed_data)
        get_circuit_breaker().record_success()
        return result
    except (TurnkeyAPIError, Exception) as e:
        get_circuit_breaker().record_failure()
        logger.warning(f"Turnkey typed data signing failed, trying backup: {e}")
        if wallet.encrypted_private_key and wallet.encrypted_private_key != "turnkey_managed":
            return _sign_typed_data_local(wallet_service, wallet, typed_data)
        raise


async def sign_solana_with_fallback(wallet_service, wallet, transaction_bytes: bytes) -> bytes:
    """Sign a Solana transaction with Turnkey fallback."""
    from bot.config.settings import settings

    if not getattr(settings, 'turnkey_fallback_enabled', True):
        return await wallet_service.sign_solana_transaction(wallet, transaction_bytes)

    if not wallet.is_turnkey_wallet:
        return await wallet_service._sign_solana_local(wallet, transaction_bytes)

    if should_use_fallback():
        return _sign_solana_local(wallet_service, wallet, transaction_bytes)

    try:
        result = await wallet_service._sign_solana_via_turnkey(wallet, transaction_bytes)
        get_circuit_breaker().record_success()
        return result
    except (TurnkeyAPIError, Exception) as e:
        get_circuit_breaker().record_failure()
        logger.warning(f"Turnkey Solana signing failed, trying backup: {e}")
        if wallet.encrypted_private_key and wallet.encrypted_private_key != "turnkey_managed":
            return _sign_solana_local(wallet_service, wallet, transaction_bytes)
        raise


# --- Local signing helpers using backup keys ---

def _get_backup_private_key(wallet) -> str:
    """Decrypt the backup private key from a Turnkey wallet."""
    from bot.utils.envelope_crypto import get_private_key_with_auto_migrate

    if not wallet.encrypted_private_key or wallet.encrypted_private_key == "turnkey_managed":
        raise ValueError(f"No backup key for wallet {wallet.id}")

    return get_private_key_with_auto_migrate(wallet, auto_migrate=False)


def _sign_evm_local(wallet_service, wallet, transaction: dict) -> str:
    """Sign EVM transaction using backup key."""
    from eth_account import Account

    private_key = _get_backup_private_key(wallet)
    if not private_key.startswith("0x"):
        private_key = "0x" + private_key

    logger.info(f"Signing EVM tx locally (fallback) for wallet {wallet.address[:10]}...")
    signed = Account.sign_transaction(transaction, private_key)
    return signed.raw_transaction.hex()


def _sign_typed_data_local(wallet_service, wallet, typed_data: dict) -> str:
    """Sign EIP-712 typed data using backup key."""
    from eth_account import Account
    from eth_account.messages import encode_typed_data

    private_key = _get_backup_private_key(wallet)
    if not private_key.startswith("0x"):
        private_key = "0x" + private_key

    logger.info(f"Signing typed data locally (fallback) for wallet {wallet.address[:10]}...")
    account = Account.from_key(private_key)
    encoded_message = encode_typed_data(full_message=typed_data)
    signed = account.sign_message(encoded_message)
    return signed.signature.hex()


def _sign_solana_local(wallet_service, wallet, transaction_bytes: bytes) -> bytes:
    """Sign Solana transaction using backup key."""
    import json
    import base58
    from solders.keypair import Keypair
    from solders.transaction import VersionedTransaction

    private_key = _get_backup_private_key(wallet)

    try:
        key_bytes = base58.b58decode(private_key)
    except Exception:
        key_bytes = bytes(json.loads(private_key))

    logger.info(f"Signing Solana tx locally (fallback) for wallet {wallet.address[:10]}...")
    keypair = Keypair.from_bytes(key_bytes)
    tx = VersionedTransaction.from_bytes(transaction_bytes)
    tx.sign([keypair])
    return bytes(tx)
