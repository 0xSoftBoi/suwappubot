"""Blacklist service for tracking known scam tokens and creators.

Maintains blacklists for:
1. Token addresses - Known rug pulls, honeypots, scams
2. Creator addresses - Serial scammers
3. Name patterns - Common scam naming patterns

Sources:
- Internal reports from users
- External scam databases
- Automated detection (repeat offenders)
"""

import logging
import re
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

logger = logging.getLogger(__name__)


class BlacklistType(Enum):
    """Types of blacklist entries."""

    TOKEN = "token"
    CREATOR = "creator"
    NAME_PATTERN = "name_pattern"
    SYMBOL_PATTERN = "symbol_pattern"


class BlacklistReason(Enum):
    """Reasons for blacklisting."""

    RUG_PULL = "rug_pull"
    HONEYPOT = "honeypot"
    SCAM = "scam"
    SERIAL_SCAMMER = "serial_scammer"
    USER_REPORT = "user_report"
    AUTOMATED = "automated"


@dataclass
class BlacklistEntry:
    """Entry in the blacklist."""

    entry_type: BlacklistType
    value: str
    reason: BlacklistReason
    added_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    added_by: Optional[str] = None
    description: Optional[str] = None
    severity: int = 1  # 1-3, higher = worse

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "type": self.entry_type.value,
            "value": self.value,
            "reason": self.reason.value,
            "added_at": self.added_at.isoformat(),
            "severity": self.severity,
        }


@dataclass
class BlacklistCheckResult:
    """Result of blacklist check."""

    is_blacklisted: bool
    entries: List[BlacklistEntry] = field(default_factory=list)
    reasons: List[str] = field(default_factory=list)
    highest_severity: int = 0


class BlacklistService:
    """Manages blacklists for scam protection.

    Usage:
        service = blacklist_service  # Global instance

        # Check if token is blacklisted
        if await service.is_blacklisted(mint, BlacklistType.TOKEN):
            print("Token is blacklisted!")

        # Add to blacklist
        await service.add_to_blacklist(
            BlacklistType.TOKEN,
            mint,
            BlacklistReason.RUG_PULL,
            "Rugged 1 hour after launch"
        )
    """

    def __init__(self):
        # In-memory blacklists (would be database in production)
        self._token_blacklist: Dict[str, BlacklistEntry] = {}
        self._creator_blacklist: Dict[str, BlacklistEntry] = {}
        self._name_patterns: List[BlacklistEntry] = []
        self._symbol_patterns: List[BlacklistEntry] = []

        # Initialize with known patterns
        self._init_default_patterns()

    def _init_default_patterns(self):
        """Initialize default blacklist patterns."""
        # Suspicious name patterns
        suspicious_names = [
            r"(?i)elon.*musk",
            r"(?i)trump.*coin",
            r"(?i)guaranteed.*profit",
            r"(?i)100x.*gem",
            r"(?i)free.*airdrop",
            r"(?i)send.*to.*receive",
            r"(?i)testtoken",
            r"(?i)honeypot",
            r"(?i)rugpull",
        ]

        for pattern in suspicious_names:
            self._name_patterns.append(
                BlacklistEntry(
                    entry_type=BlacklistType.NAME_PATTERN,
                    value=pattern,
                    reason=BlacklistReason.SCAM,
                    description="Suspicious name pattern",
                    severity=1,
                )
            )

        # Known scam symbol patterns
        suspicious_symbols = [
            r"(?i)^test$",
            r"(?i)^fake",
            r"(?i)^scam",
        ]

        for pattern in suspicious_symbols:
            self._symbol_patterns.append(
                BlacklistEntry(
                    entry_type=BlacklistType.SYMBOL_PATTERN,
                    value=pattern,
                    reason=BlacklistReason.SCAM,
                    description="Suspicious symbol pattern",
                    severity=1,
                )
            )

    async def is_blacklisted(
        self,
        value: str,
        entry_type: BlacklistType,
    ) -> bool:
        """
        Check if a value is blacklisted.

        Args:
            value: The value to check (address, name, symbol)
            entry_type: Type of blacklist to check

        Returns:
            True if blacklisted
        """
        result = await self.check(value, entry_type)
        return result.is_blacklisted

    async def check(
        self,
        value: str,
        entry_type: BlacklistType,
    ) -> BlacklistCheckResult:
        """
        Check if a value is blacklisted with full details.

        Args:
            value: The value to check
            entry_type: Type of blacklist to check

        Returns:
            BlacklistCheckResult with details
        """
        result = BlacklistCheckResult(is_blacklisted=False)

        if entry_type == BlacklistType.TOKEN:
            entry = self._token_blacklist.get(value.lower())
            if entry:
                result.is_blacklisted = True
                result.entries.append(entry)
                result.reasons.append(entry.reason.value)
                result.highest_severity = entry.severity

        elif entry_type == BlacklistType.CREATOR:
            entry = self._creator_blacklist.get(value.lower())
            if entry:
                result.is_blacklisted = True
                result.entries.append(entry)
                result.reasons.append(entry.reason.value)
                result.highest_severity = entry.severity

        elif entry_type == BlacklistType.NAME_PATTERN:
            for entry in self._name_patterns:
                if re.search(entry.value, value):
                    result.is_blacklisted = True
                    result.entries.append(entry)
                    result.reasons.append(f"Name matches pattern: {entry.description}")
                    result.highest_severity = max(result.highest_severity, entry.severity)

        elif entry_type == BlacklistType.SYMBOL_PATTERN:
            for entry in self._symbol_patterns:
                if re.search(entry.value, value):
                    result.is_blacklisted = True
                    result.entries.append(entry)
                    result.reasons.append(f"Symbol matches pattern: {entry.description}")
                    result.highest_severity = max(result.highest_severity, entry.severity)

        return result

    async def check_token_full(
        self,
        token_mint: str,
        creator: Optional[str] = None,
        name: Optional[str] = None,
        symbol: Optional[str] = None,
    ) -> BlacklistCheckResult:
        """
        Full blacklist check for a token including creator and name/symbol patterns.

        Args:
            token_mint: Token mint address
            creator: Creator address (optional)
            name: Token name (optional)
            symbol: Token symbol (optional)

        Returns:
            Combined BlacklistCheckResult
        """
        result = BlacklistCheckResult(is_blacklisted=False)

        # Check token address
        token_result = await self.check(token_mint, BlacklistType.TOKEN)
        if token_result.is_blacklisted:
            result.is_blacklisted = True
            result.entries.extend(token_result.entries)
            result.reasons.extend(token_result.reasons)
            result.highest_severity = max(result.highest_severity, token_result.highest_severity)

        # Check creator
        if creator:
            creator_result = await self.check(creator, BlacklistType.CREATOR)
            if creator_result.is_blacklisted:
                result.is_blacklisted = True
                result.entries.extend(creator_result.entries)
                result.reasons.append(f"Creator is blacklisted: {creator_result.reasons}")
                result.highest_severity = max(
                    result.highest_severity, creator_result.highest_severity
                )

        # Check name patterns
        if name:
            name_result = await self.check(name, BlacklistType.NAME_PATTERN)
            if name_result.is_blacklisted:
                result.is_blacklisted = True
                result.entries.extend(name_result.entries)
                result.reasons.extend(name_result.reasons)
                result.highest_severity = max(result.highest_severity, name_result.highest_severity)

        # Check symbol patterns
        if symbol:
            symbol_result = await self.check(symbol, BlacklistType.SYMBOL_PATTERN)
            if symbol_result.is_blacklisted:
                result.is_blacklisted = True
                result.entries.extend(symbol_result.entries)
                result.reasons.extend(symbol_result.reasons)
                result.highest_severity = max(
                    result.highest_severity, symbol_result.highest_severity
                )

        return result

    async def add_to_blacklist(
        self,
        entry_type: BlacklistType,
        value: str,
        reason: BlacklistReason,
        description: Optional[str] = None,
        severity: int = 1,
        added_by: Optional[str] = None,
    ) -> BlacklistEntry:
        """
        Add an entry to the blacklist.

        Args:
            entry_type: Type of blacklist
            value: Value to blacklist
            reason: Reason for blacklisting
            description: Optional description
            severity: 1-3 severity level
            added_by: Who added the entry

        Returns:
            Created BlacklistEntry
        """
        entry = BlacklistEntry(
            entry_type=entry_type,
            value=(
                value.lower()
                if entry_type in (BlacklistType.TOKEN, BlacklistType.CREATOR)
                else value
            ),
            reason=reason,
            description=description,
            severity=min(3, max(1, severity)),
            added_by=added_by,
        )

        if entry_type == BlacklistType.TOKEN:
            self._token_blacklist[entry.value] = entry
            logger.info(f"Added token to blacklist: {value[:20]}... ({reason.value})")

        elif entry_type == BlacklistType.CREATOR:
            self._creator_blacklist[entry.value] = entry
            logger.info(f"Added creator to blacklist: {value[:20]}... ({reason.value})")

        elif entry_type == BlacklistType.NAME_PATTERN:
            self._name_patterns.append(entry)
            logger.info(f"Added name pattern to blacklist: {value}")

        elif entry_type == BlacklistType.SYMBOL_PATTERN:
            self._symbol_patterns.append(entry)
            logger.info(f"Added symbol pattern to blacklist: {value}")

        return entry

    async def remove_from_blacklist(
        self,
        entry_type: BlacklistType,
        value: str,
    ) -> bool:
        """
        Remove an entry from the blacklist.

        Args:
            entry_type: Type of blacklist
            value: Value to remove

        Returns:
            True if removed, False if not found
        """
        value_lower = value.lower()

        if entry_type == BlacklistType.TOKEN:
            if value_lower in self._token_blacklist:
                del self._token_blacklist[value_lower]
                return True

        elif entry_type == BlacklistType.CREATOR:
            if value_lower in self._creator_blacklist:
                del self._creator_blacklist[value_lower]
                return True

        elif entry_type == BlacklistType.NAME_PATTERN:
            for i, entry in enumerate(self._name_patterns):
                if entry.value == value:
                    self._name_patterns.pop(i)
                    return True

        elif entry_type == BlacklistType.SYMBOL_PATTERN:
            for i, entry in enumerate(self._symbol_patterns):
                if entry.value == value:
                    self._symbol_patterns.pop(i)
                    return True

        return False

    def get_blacklist_stats(self) -> Dict[str, int]:
        """Get blacklist statistics."""
        return {
            "tokens": len(self._token_blacklist),
            "creators": len(self._creator_blacklist),
            "name_patterns": len(self._name_patterns),
            "symbol_patterns": len(self._symbol_patterns),
        }

    async def report_scam(
        self,
        token_mint: str,
        reporter_id: str,
        reason: str,
    ) -> bool:
        """
        Process a user scam report.

        Args:
            token_mint: Reported token
            reporter_id: Who reported
            reason: Why they reported

        Returns:
            True if added to blacklist
        """
        # In production, this would:
        # 1. Store the report in database
        # 2. Require multiple reports before auto-blacklisting
        # 3. Trigger admin review

        # For now, just log it
        logger.info(f"Scam report: {token_mint} by {reporter_id}: {reason}")

        # Could auto-blacklist with low severity
        # await self.add_to_blacklist(
        #     BlacklistType.TOKEN,
        #     token_mint,
        #     BlacklistReason.USER_REPORT,
        #     f"User report: {reason}",
        #     severity=1,
        #     added_by=reporter_id,
        # )

        return True


# Global instance
blacklist_service = BlacklistService()
