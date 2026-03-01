"""Security utilities: spending limits, 2FA (TOTP), transaction simulation,
audit logging, withdrawal whitelist, and backup codes."""

import hashlib
import json
import logging
import secrets
import string
import time
from typing import Optional
from dataclasses import dataclass
from datetime import datetime, timedelta

import pyotp

from bot.config.settings import settings
from bot.models.user import User
from database.db import get_session

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Spending limits
# ---------------------------------------------------------------------------

@dataclass
class SpendingLimits:
    """User spending limits configuration."""
    per_swap_limit: float = 5000.0  # $5,000 per swap
    hourly_limit: float = 10000.0   # $10,000 per hour
    daily_limit: float = 50000.0    # $50,000 per day
    require_2fa_above: float = 1000.0  # Require 2FA for swaps > $1,000


class SpendingTracker:
    """Track user spending for limit enforcement.

    Uses Redis when available (keys ``spending:{user_id}:hourly`` and
    ``spending:{user_id}:daily`` with TTL), falls back to in-memory tracking.
    """

    def __init__(self):
        # In-memory fallback
        self._hourly_spending: dict[int, list[tuple[float, float]]] = {}
        self._daily_spending: dict[int, list[tuple[float, float]]] = {}

    # -- Redis helpers -------------------------------------------------------

    @staticmethod
    def _get_redis():
        """Return the async Redis client if connected, else ``None``."""
        try:
            from bot.utils.redis_cache import redis_cache
            if redis_cache._connected and redis_cache.client:
                return redis_cache.client
        except Exception:
            pass
        return None

    async def _redis_add(self, key: str, amount: float, ttl: int) -> bool:
        """Append *amount* to a Redis sorted set keyed by timestamp."""
        r = self._get_redis()
        if r is None:
            return False
        try:
            now = time.time()
            member = f"{now}:{amount}"
            await r.zadd(key, {member: now})
            await r.expire(key, ttl)
            return True
        except Exception:
            return False

    async def _redis_sum(self, key: str, window_seconds: int) -> Optional[float]:
        """Sum amounts stored in the sorted set within *window_seconds*."""
        r = self._get_redis()
        if r is None:
            return None
        try:
            cutoff = time.time() - window_seconds
            # Remove old entries
            await r.zremrangebyscore(key, "-inf", cutoff)
            members = await r.zrangebyscore(key, cutoff, "+inf")
            total = 0.0
            for m in members:
                # member format: "timestamp:amount"
                parts = m.rsplit(":", 1)
                if len(parts) == 2:
                    total += float(parts[1])
            return total
        except Exception:
            return None

    # -- In-memory helpers ---------------------------------------------------

    def _cleanup_old_entries(self, entries: list, cutoff: float) -> list:
        """Remove entries older than cutoff."""
        return [(ts, amt) for ts, amt in entries if ts > cutoff]

    def _memory_get_hourly(self, user_id: int) -> float:
        now = time.time()
        cutoff = now - 3600
        entries = self._hourly_spending.get(user_id, [])
        entries = self._cleanup_old_entries(entries, cutoff)
        self._hourly_spending[user_id] = entries
        return sum(amt for _, amt in entries)

    def _memory_get_daily(self, user_id: int) -> float:
        now = time.time()
        cutoff = now - 86400
        entries = self._daily_spending.get(user_id, [])
        entries = self._cleanup_old_entries(entries, cutoff)
        self._daily_spending[user_id] = entries
        return sum(amt for _, amt in entries)

    def _memory_record(self, user_id: int, amount_usd: float) -> None:
        now = time.time()
        self._hourly_spending.setdefault(user_id, []).append((now, amount_usd))
        self._daily_spending.setdefault(user_id, []).append((now, amount_usd))

    # -- Public API ----------------------------------------------------------

    async def get_hourly_spent(self, user_id: int) -> float:
        """Get amount spent in the last hour."""
        key = f"spending:{user_id}:hourly"
        total = await self._redis_sum(key, 3600)
        if total is not None:
            return total
        return self._memory_get_hourly(user_id)

    async def get_daily_spent(self, user_id: int) -> float:
        """Get amount spent in the last 24 hours."""
        key = f"spending:{user_id}:daily"
        total = await self._redis_sum(key, 86400)
        if total is not None:
            return total
        return self._memory_get_daily(user_id)

    async def record_spending(self, user_id: int, amount_usd: float) -> None:
        """Record a spending event."""
        hourly_key = f"spending:{user_id}:hourly"
        daily_key = f"spending:{user_id}:daily"
        hourly_ok = await self._redis_add(hourly_key, amount_usd, 3600)
        daily_ok = await self._redis_add(daily_key, amount_usd, 86400)
        if not hourly_ok or not daily_ok:
            self._memory_record(user_id, amount_usd)

    async def check_limits(
        self,
        user_id: int,
        amount_usd: float,
        limits: SpendingLimits = None,
    ) -> tuple[bool, Optional[str]]:
        """Check if a swap would exceed limits.

        Returns:
            Tuple of (allowed, error_message)
        """
        limits = limits or SpendingLimits()

        # Check per-swap limit
        if amount_usd > limits.per_swap_limit:
            return False, f"Amount exceeds per-swap limit of ${limits.per_swap_limit:,.0f}"

        # Check hourly limit
        hourly_spent = await self.get_hourly_spent(user_id)
        if hourly_spent + amount_usd > limits.hourly_limit:
            remaining = limits.hourly_limit - hourly_spent
            return False, f"Would exceed hourly limit. You can swap up to ${remaining:,.0f} more this hour."

        # Check daily limit
        daily_spent = await self.get_daily_spent(user_id)
        if daily_spent + amount_usd > limits.daily_limit:
            remaining = limits.daily_limit - daily_spent
            return False, f"Would exceed daily limit. You can swap up to ${remaining:,.0f} more today."

        return True, None

    def requires_2fa(self, amount_usd: float, limits: SpendingLimits = None) -> bool:
        """Check if amount requires 2FA confirmation."""
        limits = limits or SpendingLimits()
        return amount_usd > limits.require_2fa_above


# ---------------------------------------------------------------------------
# Two-Factor Authentication (TOTP + legacy code-based)
# ---------------------------------------------------------------------------

class TwoFactorAuth:
    """Two-factor authentication using TOTP (RFC 6238) via ``pyotp``.

    The legacy ``generate_code`` / ``verify_code`` methods are kept for
    backward compatibility but new integrations should use TOTP.
    """

    def __init__(self):
        # Legacy pending codes: user_id -> (code, expires_at)
        self._pending_codes: dict[int, tuple[str, float]] = {}
        self._code_ttl = 300  # 5 minutes

    # -- TOTP (preferred) ----------------------------------------------------

    def generate_totp_secret(
        self,
        user_id: int,
        username: str = "user",
    ) -> tuple[str, str]:
        """Generate a new TOTP secret for a user.

        Returns:
            ``(secret, provisioning_uri)`` — the URI can be rendered as a QR
            code for authenticator apps.
        """
        secret = pyotp.random_base32()
        totp = pyotp.TOTP(secret)
        uri = totp.provisioning_uri(
            name=username,
            issuer_name="Suwappu Bot",
        )
        return secret, uri

    def verify_totp(self, secret: str, code: str) -> bool:
        """Verify a TOTP code against a secret with +/-1 window."""
        if not secret or not code:
            return False
        totp = pyotp.TOTP(secret)
        return totp.verify(code, valid_window=1)

    # -- Legacy code-based 2FA (backward compat) ----------------------------

    def generate_code(self, user_id: int) -> str:
        """(Legacy) Generate a 6-digit confirmation code."""
        code = "".join(secrets.choice("0123456789") for _ in range(6))
        expires_at = time.time() + self._code_ttl
        self._pending_codes[user_id] = (code, expires_at)
        return code

    def verify_code(self, user_id: int, code: str) -> bool:
        """(Legacy) Verify a confirmation code."""
        if user_id not in self._pending_codes:
            return False

        stored_code, expires_at = self._pending_codes[user_id]

        if time.time() > expires_at:
            del self._pending_codes[user_id]
            return False

        if code == stored_code:
            del self._pending_codes[user_id]
            return True

        return False

    def clear_code(self, user_id: int) -> None:
        """Clear pending code for user."""
        self._pending_codes.pop(user_id, None)


# ---------------------------------------------------------------------------
# Transaction Simulator
# ---------------------------------------------------------------------------

class TransactionSimulator:
    """Simulate transactions before execution."""

    async def simulate_evm_transaction(
        self,
        web3,
        transaction: dict,
        from_address: str,
    ) -> tuple[bool, Optional[str]]:
        """Simulate an EVM transaction using eth_call.

        Returns:
            Tuple of (success, error_message)
        """
        try:
            result = web3.eth.call({
                "to": transaction.get("to"),
                "from": from_address,
                "data": transaction.get("data"),
                "value": transaction.get("value", 0),
                "gas": transaction.get("gas", 500000),
            })
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
        """Check if token allowance is sufficient.

        Returns:
            Tuple of (sufficient, current_allowance)
        """
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
                address=web3.to_checksum_address(token_address),
                abi=allowance_abi,
            )
            current_allowance = contract.functions.allowance(
                web3.to_checksum_address(owner),
                web3.to_checksum_address(spender),
            ).call()

            return current_allowance >= amount, current_allowance
        except Exception:
            return False, 0


# ---------------------------------------------------------------------------
# Audit Logger
# ---------------------------------------------------------------------------

class AuditLogger:
    """Write audit events to the ``audit_logs`` table."""

    async def log_event(
        self,
        user_id: int,
        event_type: str,
        details: Optional[dict] = None,
        ip_address: Optional[str] = None,
    ) -> None:
        """Persist an audit log entry.

        Runs the synchronous DB write in a thread executor so the caller
        can ``await`` without blocking the event loop.
        """
        import asyncio

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            self._write_log,
            user_id,
            event_type,
            details,
            ip_address,
        )

    @staticmethod
    def _write_log(
        user_id: int,
        event_type: str,
        details: Optional[dict],
        ip_address: Optional[str],
    ) -> None:
        try:
            from bot.models.security import AuditLog

            with get_session() as session:
                entry = AuditLog(
                    user_id=user_id,
                    event_type=event_type,
                    details=json.dumps(details) if details else None,
                    ip_address=ip_address,
                )
                session.add(entry)
        except Exception:
            logger.exception("Failed to write audit log")


# ---------------------------------------------------------------------------
# Withdrawal Whitelist Service
# ---------------------------------------------------------------------------

class WithdrawalWhitelistService:
    """Manage per-user withdrawal address whitelists with a 24-hour cooldown."""

    COOLDOWN_HOURS = 24

    async def add_address(
        self,
        user_id: int,
        chain: str,
        address: str,
        label: Optional[str] = None,
    ) -> dict:
        """Add an address to the whitelist.

        Returns a dict with the new entry details.
        """
        import asyncio

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self._add, user_id, chain, address, label
        )

    def _add(
        self,
        user_id: int,
        chain: str,
        address: str,
        label: Optional[str],
    ) -> dict:
        from bot.models.security import WithdrawalWhitelist

        cooldown_until = datetime.utcnow() + timedelta(hours=self.COOLDOWN_HOURS)
        with get_session() as session:
            entry = WithdrawalWhitelist(
                user_id=user_id,
                chain=chain,
                address=address,
                label=label,
                cooldown_until=cooldown_until,
                is_active=True,
            )
            session.add(entry)
            session.flush()
            return {
                "id": entry.id,
                "chain": entry.chain,
                "address": entry.address,
                "label": entry.label,
                "cooldown_until": cooldown_until.isoformat(),
            }

    async def remove_address(self, user_id: int, whitelist_id: int) -> bool:
        """Soft-delete a whitelist entry. Returns ``True`` if found."""
        import asyncio

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self._remove, user_id, whitelist_id
        )

    @staticmethod
    def _remove(user_id: int, whitelist_id: int) -> bool:
        from bot.models.security import WithdrawalWhitelist

        with get_session() as session:
            entry = (
                session.query(WithdrawalWhitelist)
                .filter_by(id=whitelist_id, user_id=user_id, is_active=True)
                .first()
            )
            if not entry:
                return False
            entry.is_active = False
            return True

    async def is_whitelisted(
        self, user_id: int, chain: str, address: str
    ) -> bool:
        """Check if an address is whitelisted and past cooldown."""
        import asyncio

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self._check, user_id, chain, address
        )

    @staticmethod
    def _check(user_id: int, chain: str, address: str) -> bool:
        from bot.models.security import WithdrawalWhitelist

        now = datetime.utcnow()
        with get_session() as session:
            entry = (
                session.query(WithdrawalWhitelist)
                .filter_by(user_id=user_id, chain=chain, address=address, is_active=True)
                .first()
            )
            if not entry:
                return False
            if entry.cooldown_until and entry.cooldown_until > now:
                return False
            return True

    async def get_addresses(self, user_id: int) -> list[dict]:
        """Return all active whitelist entries for a user."""
        import asyncio

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._list, user_id)

    @staticmethod
    def _list(user_id: int) -> list[dict]:
        from bot.models.security import WithdrawalWhitelist

        with get_session() as session:
            entries = (
                session.query(WithdrawalWhitelist)
                .filter_by(user_id=user_id, is_active=True)
                .order_by(WithdrawalWhitelist.created_at.desc())
                .all()
            )
            return [
                {
                    "id": e.id,
                    "chain": e.chain,
                    "address": e.address,
                    "label": e.label,
                    "cooldown_until": e.cooldown_until.isoformat() if e.cooldown_until else None,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in entries
            ]


# ---------------------------------------------------------------------------
# Backup Codes Service
# ---------------------------------------------------------------------------

class BackupCodesService:
    """Generate and verify one-time backup codes (hashed with SHA-256)."""

    NUM_CODES = 10
    CODE_LENGTH = 8

    async def generate_codes(self, user_id: int) -> list[str]:
        """Generate a fresh set of backup codes for *user_id*.

        Any existing unused codes are invalidated. Returns the plaintext
        codes (display once to the user).
        """
        import asyncio

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._generate, user_id)

    def _generate(self, user_id: int) -> list[str]:
        from bot.models.security import BackupCode

        alphabet = string.ascii_uppercase + string.digits
        codes: list[str] = []

        with get_session() as session:
            # Invalidate old unused codes
            session.query(BackupCode).filter_by(
                user_id=user_id, is_used=False
            ).delete()

            for _ in range(self.NUM_CODES):
                raw = "".join(secrets.choice(alphabet) for _ in range(self.CODE_LENGTH))
                codes.append(raw)
                hashed = hashlib.sha256(raw.encode()).hexdigest()
                session.add(BackupCode(user_id=user_id, code_hash=hashed))

        return codes

    async def verify_backup_code(self, user_id: int, code: str) -> bool:
        """Verify a backup code and mark it used if valid."""
        import asyncio

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._verify, user_id, code)

    @staticmethod
    def _verify(user_id: int, code: str) -> bool:
        from bot.models.security import BackupCode

        hashed = hashlib.sha256(code.strip().upper().encode()).hexdigest()
        with get_session() as session:
            entry = (
                session.query(BackupCode)
                .filter_by(user_id=user_id, code_hash=hashed, is_used=False)
                .first()
            )
            if not entry:
                return False
            entry.is_used = True
            entry.used_at = datetime.utcnow()
            return True


# ---------------------------------------------------------------------------
# Global instances
# ---------------------------------------------------------------------------

spending_tracker = SpendingTracker()
two_factor_auth = TwoFactorAuth()
transaction_simulator = TransactionSimulator()
audit_logger = AuditLogger()
whitelist_service = WithdrawalWhitelistService()
backup_codes_service = BackupCodesService()
