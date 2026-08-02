"""Security utilities: spending limits, 2FA, transaction simulation."""

import asyncio
import hashlib
import secrets
import time
import logging
from typing import Optional
from dataclasses import dataclass
from datetime import datetime, timedelta

from bot.config.settings import settings
from bot.models.user import User
from database.db import get_session

logger = logging.getLogger(__name__)


@dataclass
class SpendingLimits:
    """User spending limits configuration."""

    per_swap_limit: float = 5000.0  # $5,000 per swap
    hourly_limit: float = 10000.0  # $10,000 per hour
    daily_limit: float = 50000.0  # $50,000 per day
    require_2fa_above: float = 1000.0  # Require 2FA for swaps > $1,000


class SpendingTracker:
    """Track user spending for limit enforcement."""

    def __init__(self):
        # In-memory tracking (could be Redis in production)
        self._hourly_spending: dict[int, list[tuple[float, float]]] = (
            {}
        )  # user_id -> [(timestamp, amount)]
        self._daily_spending: dict[int, list[tuple[float, float]]] = {}
        self._lock = asyncio.Lock()

    def _cleanup_old_entries(self, entries: list, cutoff: float) -> list:
        """Remove entries older than cutoff."""
        return [(ts, amt) for ts, amt in entries if ts > cutoff]

    def get_hourly_spent(self, user_id: int) -> float:
        """Get amount spent in the last hour."""
        now = time.time()
        cutoff = now - 3600  # 1 hour ago

        entries = self._hourly_spending.get(user_id, [])
        entries = self._cleanup_old_entries(entries, cutoff)
        self._hourly_spending[user_id] = entries

        return sum(amt for _, amt in entries)

    def get_daily_spent(self, user_id: int) -> float:
        """Get amount spent in the last 24 hours."""
        now = time.time()
        cutoff = now - 86400  # 24 hours ago

        entries = self._daily_spending.get(user_id, [])
        entries = self._cleanup_old_entries(entries, cutoff)
        self._daily_spending[user_id] = entries

        return sum(amt for _, amt in entries)

    def record_spending(self, user_id: int, amount_usd: float) -> None:
        """Record a spending event."""
        now = time.time()

        if user_id not in self._hourly_spending:
            self._hourly_spending[user_id] = []
        if user_id not in self._daily_spending:
            self._daily_spending[user_id] = []

        self._hourly_spending[user_id].append((now, amount_usd))
        self._daily_spending[user_id].append((now, amount_usd))

    def check_limits(
        self,
        user_id: int,
        amount_usd: float,
        limits: SpendingLimits = None,
        wallet=None,
    ) -> tuple[bool, Optional[str]]:
        """
        Check if a swap would exceed limits.

        For Turnkey wallets, infrastructure-level policies are the
        primary enforcement. App-level checks still run as a fast
        pre-flight so users get friendly error messages before the
        Turnkey API rejects the signing request.

        Args:
            user_id: Database user ID
            amount_usd: Swap amount in USD
            limits: Override spending limits (defaults to SpendingLimits())
            wallet: Optional Wallet object for Turnkey-aware checks

        Returns:
            Tuple of (allowed, error_message)
        """
        limits = limits or SpendingLimits()

        # Check per-swap limit (always app-level, Turnkey doesn't have per-tx limits)
        if amount_usd > limits.per_swap_limit:
            return False, f"Amount exceeds per-swap limit of ${limits.per_swap_limit:,.0f}"

        # Check hourly limit
        hourly_spent = self.get_hourly_spent(user_id)
        if hourly_spent + amount_usd > limits.hourly_limit:
            remaining = limits.hourly_limit - hourly_spent
            return (
                False,
                f"Would exceed hourly limit. You can swap up to ${remaining:,.0f} more this hour.",
            )

        # Check daily limit
        daily_spent = self.get_daily_spent(user_id)
        if daily_spent + amount_usd > limits.daily_limit:
            remaining = limits.daily_limit - daily_spent
            return (
                False,
                f"Would exceed daily limit. You can swap up to ${remaining:,.0f} more today.",
            )

        # For Turnkey wallets, note that Turnkey policies also enforce limits
        # at the signing layer. If the app check passes but Turnkey rejects,
        # the signing call will raise a TurnkeyActivityError.
        if wallet and hasattr(wallet, "is_turnkey_wallet") and wallet.is_turnkey_wallet:
            # Turnkey policies provide additional infrastructure-level enforcement.
            # No extra check needed here -- Turnkey will reject at sign time.
            pass

        return True, None

    async def check_limits_with_turnkey(
        self,
        user_id: int,
        amount_usd: float,
        wallet_provider: str = "local",
        limits: SpendingLimits = None,
    ) -> tuple[bool, Optional[str]]:
        """
        Check spending limits. For Turnkey wallets, app-level checks
        provide fast UX feedback; Turnkey enforces at infrastructure level.
        """
        # Always do app-level check first (fast, good UX)
        allowed, error = self.check_limits(user_id, amount_usd, limits)
        if not allowed:
            return allowed, error

        # For Turnkey wallets, infrastructure-level enforcement happens
        # at signing time. If Turnkey rejects, the signing call will
        # raise an error that the swap engine handles.
        if wallet_provider == "turnkey":
            import logging

            logging.getLogger(__name__).debug(
                f"User {user_id} swap ${amount_usd:.2f} passed app limits, "
                "Turnkey policy will enforce at signing time"
            )

        return True, None

    def requires_2fa(self, amount_usd: float, limits: SpendingLimits = None) -> bool:
        """Check if amount requires 2FA confirmation."""
        limits = limits or SpendingLimits()
        return amount_usd > limits.require_2fa_above


class TwoFactorAuth:
    """Simple 2FA implementation using time-based codes."""

    def __init__(self):
        self._pending_codes: dict[int, tuple[str, float]] = {}
        self._failed_attempts: dict[int, int] = {}
        self._code_ttl = 300  # 5 minutes
        self._max_attempts = 5

    def generate_code(self, user_id: int) -> str:
        """Generate a 6-digit confirmation code."""
        code = "".join(secrets.choice("0123456789") for _ in range(6))
        expires_at = time.time() + self._code_ttl
        self._pending_codes[user_id] = (code, expires_at)
        self._failed_attempts.pop(user_id, None)
        return code

    def verify_code(self, user_id: int, code: str) -> bool:
        """Verify a confirmation code."""
        if user_id not in self._pending_codes:
            return False

        stored_code, expires_at = self._pending_codes[user_id]

        if time.time() > expires_at:
            self._pending_codes.pop(user_id, None)
            self._failed_attempts.pop(user_id, None)
            return False

        attempts = self._failed_attempts.get(user_id, 0)
        if attempts >= self._max_attempts:
            self._pending_codes.pop(user_id, None)
            self._failed_attempts.pop(user_id, None)
            return False

        if secrets.compare_digest(code, stored_code):
            self._pending_codes.pop(user_id, None)
            self._failed_attempts.pop(user_id, None)
            return True

        self._failed_attempts[user_id] = attempts + 1
        return False

    def clear_code(self, user_id: int) -> None:
        """Clear pending code for user."""
        self._pending_codes.pop(user_id, None)
        self._failed_attempts.pop(user_id, None)


class TransactionSimulator:
    """Simulate transactions before execution."""

    async def simulate_evm_transaction(
        self,
        web3,
        transaction: dict,
        from_address: str,
    ) -> tuple[bool, Optional[str]]:
        """
        Simulate an EVM transaction using eth_call.

        Returns:
            Tuple of (success, error_message)
        """
        try:
            # Use eth_call to simulate
            result = web3.eth.call(
                {
                    "to": transaction.get("to"),
                    "from": from_address,
                    "data": transaction.get("data"),
                    "value": transaction.get("value", 0),
                    "gas": transaction.get("gas", 500000),
                }
            )
            return True, None
        except Exception as e:
            error_str = str(e)
            if "revert" in error_str.lower():
                return False, "Transaction would revert"
            elif "insufficient" in error_str.lower():
                return False, "Insufficient balance or allowance"
            else:
                return False, f"Simulation failed: {error_str[:100]}"

    async def check_token_allowance(
        self,
        web3,
        token_address: str,
        owner: str,
        spender: str,
        amount: int,
    ) -> tuple[bool, int]:
        """
        Check if token allowance is sufficient.

        Returns:
            Tuple of (sufficient, current_allowance)
        """
        # ERC20 allowance ABI
        allowance_abi = [
            {
                "constant": True,
                "inputs": [
                    {"name": "owner", "type": "address"},
                    {"name": "spender", "type": "address"},
                ],
                "name": "allowance",
                "outputs": [{"name": "", "type": "uint256"}],
                "type": "function",
            }
        ]

        try:
            contract = web3.eth.contract(
                address=web3.to_checksum_address(token_address), abi=allowance_abi
            )
            current_allowance = contract.functions.allowance(
                web3.to_checksum_address(owner), web3.to_checksum_address(spender)
            ).call()

            return current_allowance >= amount, current_allowance
        except Exception:
            return False, 0


async def sync_limits_to_turnkey(user_id: int) -> None:
    """
    Sync a user's app-level spending limits to Turnkey policies.

    Call this whenever the user updates their limits via /settings.
    Only affects Turnkey wallets; no-op for local wallet users.
    """
    from bot.services.turnkey_policies import turnkey_policy_service

    try:
        await turnkey_policy_service.sync_app_limits_to_turnkey(user_id)
    except Exception as e:
        import logging

        logging.getLogger(__name__).error(
            f"Failed to sync limits to Turnkey for user {user_id}: {e}"
        )


# Global instances
spending_tracker = SpendingTracker()
two_factor_auth = TwoFactorAuth()
transaction_simulator = TransactionSimulator()
