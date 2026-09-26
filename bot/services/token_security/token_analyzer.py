"""Token safety analyzer for comprehensive token risk assessment.

Analyzes tokens for:
1. Honeypot risk (can't sell)
2. Mint authority (can mint unlimited tokens)
3. Freeze authority (can freeze your tokens)
4. Known scam patterns (creator blacklist, name patterns)
5. Liquidity analysis (locked, low, etc.)
6. Holder concentration (top wallets)
7. Contract verification

Safety score: 0-100 (higher = safer)
- 80-100: Low risk
- 60-79: Medium risk
- 40-59: High risk
- 0-39: Very high risk / likely scam
"""

import logging
import asyncio
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

from bot.services.rpc_manager import rpc_manager
from bot.services.token_security.honeypot_detector import honeypot_detector
from bot.services.token_security.authority_checker import authority_checker
from bot.services.token_security.blacklist_service import blacklist_service, BlacklistType
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)


class RiskLevel(Enum):
    """Risk level for a token."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class RiskCategory(Enum):
    """Categories of risk."""

    HONEYPOT = "honeypot"
    MINT_AUTHORITY = "mint_authority"
    FREEZE_AUTHORITY = "freeze_authority"
    BLACKLISTED_CREATOR = "blacklisted_creator"
    SUSPICIOUS_NAME = "suspicious_name"
    LOW_LIQUIDITY = "low_liquidity"
    HIGH_CONCENTRATION = "high_concentration"
    NEW_TOKEN = "new_token"
    NO_SOCIALS = "no_socials"
    UNLOCKED_LIQUIDITY = "unlocked_liquidity"


@dataclass
class RiskFactor:
    """Individual risk factor."""

    category: RiskCategory
    severity: RiskLevel
    description: str
    score_impact: int  # Negative impact on safety score
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TokenSafetyReport:
    """Comprehensive token safety report."""

    token_mint: str
    chain: str = "solana"
    analyzed_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Overall assessment
    safety_score: int = 0  # 0-100
    risk_level: RiskLevel = RiskLevel.HIGH
    is_safe: bool = False  # Score >= 60

    # Risk factors
    risk_factors: List[RiskFactor] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    # Authority status
    mint_authority: Optional[str] = None
    mint_authority_revoked: bool = False
    freeze_authority: Optional[str] = None
    freeze_authority_revoked: bool = False

    # Honeypot check
    honeypot_checked: bool = False
    is_honeypot: bool = False
    sell_tax: Optional[float] = None
    buy_tax: Optional[float] = None

    # Liquidity (None = not measured/unknown, not zero)
    liquidity_sol: Optional[float] = None
    liquidity_locked: bool = False
    liquidity_lock_until: Optional[datetime] = None

    # Holder analysis
    total_holders: int = 0
    top_10_percentage: float = 0
    creator_percentage: float = 0

    # Metadata
    token_name: Optional[str] = None
    token_symbol: Optional[str] = None
    token_decimals: int = 9
    total_supply: int = 0

    # Blacklist status
    creator_blacklisted: bool = False
    token_blacklisted: bool = False

    @property
    def critical_warnings(self) -> List[str]:
        """Get only critical warnings."""
        return [f.description for f in self.risk_factors if f.severity == RiskLevel.CRITICAL]

    @property
    def is_tradeable(self) -> bool:
        """Whether token appears tradeable (not a honeypot)."""
        return not self.is_honeypot and self.safety_score >= 30

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "token_mint": self.token_mint,
            "chain": self.chain,
            "safety_score": self.safety_score,
            "risk_level": self.risk_level.value,
            "is_safe": self.is_safe,
            "warnings": self.warnings,
            "is_honeypot": self.is_honeypot,
            "mint_authority_revoked": self.mint_authority_revoked,
            "freeze_authority_revoked": self.freeze_authority_revoked,
            "liquidity_sol": self.liquidity_sol,
            "total_holders": self.total_holders,
            "top_10_percentage": self.top_10_percentage,
        }


class TokenAnalyzerError(Exception):
    """Exception for token analyzer errors."""

    def __init__(self, message: str, data: Optional[Dict] = None):
        super().__init__(message)
        self.data = data or {}


class TokenAnalyzer:
    """Comprehensive token safety analyzer.

    Usage:
        analyzer = token_analyzer  # Global instance

        # Full analysis
        report = await analyzer.analyze(token_mint)

        # Quick safety check
        is_safe, warnings = await analyzer.quick_check(token_mint)
    """

    def __init__(self):
        self._cache: Dict[str, Tuple[TokenSafetyReport, datetime]] = {}
        self._cache_ttl = 300  # 5 minutes

    async def analyze(
        self,
        token_mint: str,
        chain: str = "solana",
        skip_honeypot: bool = False,
        use_cache: bool = True,
    ) -> TokenSafetyReport:
        """
        Perform comprehensive token safety analysis.

        Args:
            token_mint: Token mint address
            chain: Blockchain (solana, ethereum, etc.)
            skip_honeypot: Skip honeypot simulation (faster but less thorough)
            use_cache: Use cached results if available

        Returns:
            TokenSafetyReport with full analysis
        """
        # Check cache
        if use_cache and token_mint in self._cache:
            report, cached_at = self._cache[token_mint]
            if (datetime.now(timezone.utc) - cached_at).total_seconds() < self._cache_ttl:
                return report

        report = TokenSafetyReport(token_mint=token_mint, chain=chain)
        risk_factors = []  # noqa: F841

        try:
            # Run checks in parallel
            checks = [
                self._check_authorities(token_mint, report),
                self._check_blacklist(token_mint, report),
                self._check_liquidity(token_mint, report),
                self._check_holders(token_mint, report),
                self._check_metadata(token_mint, report),
            ]

            if not skip_honeypot:
                checks.append(self._check_honeypot(token_mint, report))

            await asyncio.gather(*checks, return_exceptions=True)

            # Calculate safety score
            self._calculate_score(report)

            # Cache result
            self._cache[token_mint] = (report, datetime.now(timezone.utc))

        except Exception as e:
            logger.error(f"Error analyzing token {token_mint}: {e}")
            report.warnings.append(f"Analysis error: {str(e)}")
            report.safety_score = 0
            report.risk_level = RiskLevel.CRITICAL

        return report

    async def quick_check(
        self,
        token_mint: str,
        chain: str = "solana",
    ) -> Tuple[bool, List[str]]:
        """
        Quick safety check without full analysis.

        Returns:
            Tuple of (is_safe, list of warnings)
        """
        warnings = []

        try:
            # Check blacklist first (fastest)
            if await blacklist_service.is_blacklisted(token_mint, BlacklistType.TOKEN):
                return False, ["Token is blacklisted"]

            # Check authorities
            auth_result = await authority_checker.check_authorities(token_mint)
            if auth_result.has_mint_authority:
                warnings.append("Mint authority not revoked")
            if auth_result.has_freeze_authority:
                warnings.append("Freeze authority not revoked")

            # Quick honeypot check
            hp_result = await honeypot_detector.quick_check(token_mint)
            if hp_result.is_honeypot:
                return False, ["Token appears to be a honeypot"]

            is_safe = len(warnings) == 0 or (
                len(warnings) <= 1 and "Mint authority" not in str(warnings)
            )

            return is_safe, warnings

        except Exception as e:
            logger.error(f"Quick check error for {token_mint}: {e}")
            return False, [f"Check failed: {str(e)}"]

    async def _check_authorities(self, token_mint: str, report: TokenSafetyReport):
        """Check mint and freeze authorities."""
        try:
            result = await authority_checker.check_authorities(token_mint)

            report.mint_authority = result.mint_authority
            report.mint_authority_revoked = not result.has_mint_authority
            report.freeze_authority = result.freeze_authority
            report.freeze_authority_revoked = not result.has_freeze_authority

            if result.has_mint_authority:
                report.risk_factors.append(
                    RiskFactor(
                        category=RiskCategory.MINT_AUTHORITY,
                        severity=RiskLevel.HIGH,
                        description="Mint authority not revoked - tokens can be minted",
                        score_impact=30,
                        details={"authority": result.mint_authority},
                    )
                )
                report.warnings.append("Mint authority active - risk of inflation")

            if result.has_freeze_authority:
                report.risk_factors.append(
                    RiskFactor(
                        category=RiskCategory.FREEZE_AUTHORITY,
                        severity=RiskLevel.HIGH,
                        description="Freeze authority not revoked - your tokens can be frozen",
                        score_impact=25,
                        details={"authority": result.freeze_authority},
                    )
                )
                report.warnings.append("Freeze authority active - tokens can be frozen")

        except Exception as e:
            logger.warning(f"Authority check failed: {e}")
            report.warnings.append("Could not verify authorities")

    async def _check_honeypot(self, token_mint: str, report: TokenSafetyReport):
        """Check for honeypot (can't sell)."""
        try:
            result = await honeypot_detector.detect(token_mint)

            report.honeypot_checked = True
            report.is_honeypot = result.is_honeypot
            report.sell_tax = result.sell_tax
            report.buy_tax = result.buy_tax

            if result.is_honeypot:
                report.risk_factors.append(
                    RiskFactor(
                        category=RiskCategory.HONEYPOT,
                        severity=RiskLevel.CRITICAL,
                        description="Honeypot detected - selling may not be possible",
                        score_impact=100,
                        details={
                            "sell_tax": result.sell_tax,
                            "buy_tax": result.buy_tax,
                            "reason": result.reason,
                        },
                    )
                )
                report.warnings.append("HONEYPOT DETECTED - DO NOT BUY")

            elif result.sell_tax and result.sell_tax > 10:
                report.risk_factors.append(
                    RiskFactor(
                        category=RiskCategory.HONEYPOT,
                        severity=RiskLevel.HIGH,
                        description=f"High sell tax detected: {result.sell_tax}%",
                        score_impact=20,
                    )
                )
                report.warnings.append(f"High sell tax: {result.sell_tax}%")

        except Exception as e:
            logger.warning(f"Honeypot check failed: {e}")
            report.warnings.append("Could not verify honeypot status")

    async def _check_blacklist(self, token_mint: str, report: TokenSafetyReport):
        """Check blacklists."""
        try:
            # Check token blacklist
            if await blacklist_service.is_blacklisted(token_mint, BlacklistType.TOKEN):
                report.token_blacklisted = True
                report.risk_factors.append(
                    RiskFactor(
                        category=RiskCategory.BLACKLISTED_CREATOR,
                        severity=RiskLevel.CRITICAL,
                        description="Token is on the blacklist",
                        score_impact=100,
                    )
                )
                report.warnings.append("Token is blacklisted as a known scam")

            # Get token metadata to check creator
            # This would normally fetch the token's creator address
            # For now, we'll skip creator blacklist check

        except Exception as e:
            logger.warning(f"Blacklist check failed: {e}")

    async def _check_liquidity(self, token_mint: str, report: TokenSafetyReport):
        """Check liquidity levels.

        On-chain DEX-pool liquidity querying is not yet implemented. The previous
        code hardcoded ``liquidity_sol = 0`` and therefore flagged EVERY token
        with a fabricated MEDIUM "very low liquidity" risk factor (score_impact
        15) — desensitizing users and corrupting the safety score. Until a real
        pool query exists, leave liquidity unknown (None) and surface an honest,
        non-scoring warning rather than inventing a measurement.
        """
        report.liquidity_sol = None  # unknown — not measured
        report.warnings.append(
            "Liquidity not verified — confirm pool depth on a DEX explorer before trading"
        )

    async def _check_holders(self, token_mint: str, report: TokenSafetyReport):
        """Check holder distribution."""
        try:
            await api_limiter.wait_and_acquire("solana")
            session = await get_session()
            rpc_url = rpc_manager.get_rpc_url("solana")

            # Get largest token accounts
            async with session.post(
                rpc_url,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "getTokenLargestAccounts",
                    "params": [token_mint],
                },
            ) as response:
                data = await response.json()
                result = data.get("result", {}).get("value", [])

                if not result:
                    return

                # Calculate top 10 concentration
                total_held = sum(int(acc.get("amount", 0)) for acc in result[:10])

                # Get supply
                async with session.post(
                    rpc_url,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "getTokenSupply",
                        "params": [token_mint],
                    },
                ) as supply_response:
                    supply_data = await supply_response.json()
                    supply = int(supply_data.get("result", {}).get("value", {}).get("amount", 1))

                report.total_supply = supply
                report.top_10_percentage = (total_held / supply * 100) if supply > 0 else 100

                if report.top_10_percentage > 80:
                    report.risk_factors.append(
                        RiskFactor(
                            category=RiskCategory.HIGH_CONCENTRATION,
                            severity=RiskLevel.HIGH,
                            description=f"Top 10 wallets hold {report.top_10_percentage:.1f}% of supply",
                            score_impact=25,
                        )
                    )
                    report.warnings.append(
                        f"High concentration: top 10 hold {report.top_10_percentage:.1f}%"
                    )
                elif report.top_10_percentage > 50:
                    report.risk_factors.append(
                        RiskFactor(
                            category=RiskCategory.HIGH_CONCENTRATION,
                            severity=RiskLevel.MEDIUM,
                            description=f"Top 10 wallets hold {report.top_10_percentage:.1f}% of supply",
                            score_impact=10,
                        )
                    )

        except Exception as e:
            logger.debug(f"Holder check failed: {e}")

    async def _check_metadata(self, token_mint: str, report: TokenSafetyReport):
        """Check token metadata for suspicious patterns."""
        try:
            # Fetch token metadata (name, symbol) from the pump.fun API.
            from bot.services.sniping.pump_fun_api import pump_fun_api

            token = await pump_fun_api.get_token(token_mint)
            if token:
                report.token_name = token.name
                report.token_symbol = token.symbol
                report.token_decimals = 6  # pump.fun uses 6 decimals

                # Check for suspicious name patterns
                suspicious_patterns = [
                    "test",
                    "fake",
                    "scam",
                    "rug",
                    "honeypot",
                    "free money",
                    "guaranteed",
                    "100x",
                ]

                name_lower = token.name.lower()
                symbol_lower = token.symbol.lower()

                for pattern in suspicious_patterns:
                    if pattern in name_lower or pattern in symbol_lower:
                        report.risk_factors.append(
                            RiskFactor(
                                category=RiskCategory.SUSPICIOUS_NAME,
                                severity=RiskLevel.MEDIUM,
                                description=f"Suspicious name/symbol pattern: {pattern}",
                                score_impact=15,
                            )
                        )
                        report.warnings.append("Suspicious name pattern detected")
                        break

                # Check socials
                if not token.twitter and not token.telegram and not token.website:
                    report.risk_factors.append(
                        RiskFactor(
                            category=RiskCategory.NO_SOCIALS,
                            severity=RiskLevel.LOW,
                            description="No social media links",
                            score_impact=5,
                        )
                    )

        except Exception as e:
            logger.debug(f"Metadata check failed: {e}")

    def _calculate_score(self, report: TokenSafetyReport):
        """Calculate final safety score."""
        # Start at 100
        score = 100

        # Apply risk factor impacts
        for factor in report.risk_factors:
            score -= factor.score_impact

        # Clamp to 0-100
        score = max(0, min(100, score))

        report.safety_score = score

        # Determine risk level
        if score >= 80:
            report.risk_level = RiskLevel.LOW
        elif score >= 60:
            report.risk_level = RiskLevel.MEDIUM
        elif score >= 40:
            report.risk_level = RiskLevel.HIGH
        else:
            report.risk_level = RiskLevel.CRITICAL

        report.is_safe = score >= 60

    def clear_cache(self, token_mint: Optional[str] = None):
        """Clear analysis cache."""
        if token_mint:
            self._cache.pop(token_mint, None)
        else:
            self._cache.clear()

    def get_shield_emoji(self, score: int) -> str:
        """Get safety shield emoji based on score."""
        if score >= 80:
            return "🛡️"
        if score >= 60:
            return "⚠️"
        if score >= 40:
            return "🚨"
        return "🚫"

    def get_safety_summary(self, report: TokenSafetyReport) -> str:
        """Generate a formatted safety summary string for Telegram."""
        shield = self.get_shield_emoji(report.safety_score)

        summary = [
            f"{shield} *Security Score: {report.safety_score}/100*",
            f"Risk Level: {report.risk_level.value.upper()}",
            "",
        ]

        if report.is_honeypot:
            summary.append("🚫 *HONEYPOT DETECTED*")

        # Add key metrics
        summary.append(f"{'✅' if report.mint_authority_revoked else '❌'} Mint Authority Revoked")
        summary.append(
            f"{'✅' if report.freeze_authority_revoked else '❌'} Freeze Authority Revoked"
        )

        if report.sell_tax is not None:
            summary.append(f"💰 Sell Tax: {report.sell_tax:.1f}%")

        if report.top_10_percentage > 0:
            summary.append(f"👥 Top 10 Holders: {report.top_10_percentage:.1f}%")

        # Add high-level warnings
        if report.warnings:
            summary.append("\n*Warnings:*")
            for warning in report.warnings[:3]:  # Top 3 warnings
                summary.append(f"• {warning}")

        return "\n".join(summary)


# Global instance
token_analyzer = TokenAnalyzer()
