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
from datetime import datetime
from enum import Enum

from bot.config.settings import settings
from bot.services.token_security.honeypot_detector import honeypot_detector
from bot.services.token_security.authority_checker import authority_checker
from bot.services.token_security.blacklist_service import blacklist_service, BlacklistType
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter
from bot.services.goplus_api import goplus_api, GoPlusError
from bot.services.dexscreener_api import dexscreener_api, DexScreenerError

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
    PROXY_CONTRACT = "proxy_contract"
    UNVERIFIED_CONTRACT = "unverified_contract"
    OWNERSHIP_RISK = "ownership_risk"
    LOW_VOLUME = "low_volume"


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
    analyzed_at: datetime = field(default_factory=datetime.utcnow)

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

    # Liquidity
    liquidity_sol: float = 0
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

    # GoPlus data
    goplus_checked: bool = False
    is_open_source: bool = False
    is_proxy: bool = False

    # DexScreener data
    volume_24h: float = 0
    price_usd: Optional[float] = None
    price_change_24h: float = 0
    liquidity_usd: float = 0
    pair_age_hours: Optional[float] = None
    dex_url: Optional[str] = None

    @property
    def critical_warnings(self) -> List[str]:
        """Get only critical warnings."""
        return [
            f.description for f in self.risk_factors
            if f.severity == RiskLevel.CRITICAL
        ]

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
            if (datetime.utcnow() - cached_at).total_seconds() < self._cache_ttl:
                return report

        report = TokenSafetyReport(token_mint=token_mint, chain=chain)
        risk_factors = []

        try:
            # Run checks in parallel
            checks = [
                self._check_authorities(token_mint, report),
                self._check_blacklist(token_mint, report),
                self._check_liquidity(token_mint, report),
                self._check_holders(token_mint, report),
                self._check_metadata(token_mint, report),
                self._check_goplus(token_mint, chain, report),
                self._check_dexscreener(token_mint, chain, report),
            ]

            if not skip_honeypot:
                checks.append(self._check_honeypot(token_mint, report))

            await asyncio.gather(*checks, return_exceptions=True)

            # Calculate safety score
            self._calculate_score(report)

            # Cache result
            self._cache[token_mint] = (report, datetime.utcnow())

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
                report.risk_factors.append(RiskFactor(
                    category=RiskCategory.MINT_AUTHORITY,
                    severity=RiskLevel.HIGH,
                    description="Mint authority not revoked - tokens can be minted",
                    score_impact=30,
                    details={"authority": result.mint_authority},
                ))
                report.warnings.append("Mint authority active - risk of inflation")

            if result.has_freeze_authority:
                report.risk_factors.append(RiskFactor(
                    category=RiskCategory.FREEZE_AUTHORITY,
                    severity=RiskLevel.HIGH,
                    description="Freeze authority not revoked - your tokens can be frozen",
                    score_impact=25,
                    details={"authority": result.freeze_authority},
                ))
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
                report.risk_factors.append(RiskFactor(
                    category=RiskCategory.HONEYPOT,
                    severity=RiskLevel.CRITICAL,
                    description="Honeypot detected - selling may not be possible",
                    score_impact=100,
                    details={
                        "sell_tax": result.sell_tax,
                        "buy_tax": result.buy_tax,
                        "reason": result.reason,
                    },
                ))
                report.warnings.append("HONEYPOT DETECTED - DO NOT BUY")

            elif result.sell_tax and result.sell_tax > 10:
                report.risk_factors.append(RiskFactor(
                    category=RiskCategory.HONEYPOT,
                    severity=RiskLevel.HIGH,
                    description=f"High sell tax detected: {result.sell_tax}%",
                    score_impact=20,
                ))
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
                report.risk_factors.append(RiskFactor(
                    category=RiskCategory.BLACKLISTED_CREATOR,
                    severity=RiskLevel.CRITICAL,
                    description="Token is on the blacklist",
                    score_impact=100,
                ))
                report.warnings.append("Token is blacklisted as a known scam")

            # Get token metadata to check creator
            # This would normally fetch the token's creator address
            # For now, we'll skip creator blacklist check

        except Exception as e:
            logger.warning(f"Blacklist check failed: {e}")

    async def _check_liquidity(self, token_mint: str, report: TokenSafetyReport):
        """Check liquidity levels."""
        try:
            await api_limiter.wait_and_acquire("solana")
            session = await get_session()
            rpc_url = settings.get_rpc_url("solana")

            # This would query DEX pools for liquidity
            # Simplified implementation
            report.liquidity_sol = 0

            if report.liquidity_sol < 1:
                report.risk_factors.append(RiskFactor(
                    category=RiskCategory.LOW_LIQUIDITY,
                    severity=RiskLevel.MEDIUM,
                    description="Very low liquidity - high slippage expected",
                    score_impact=15,
                    details={"liquidity_sol": report.liquidity_sol},
                ))

        except Exception as e:
            logger.debug(f"Liquidity check failed: {e}")

    async def _check_holders(self, token_mint: str, report: TokenSafetyReport):
        """Check holder distribution."""
        try:
            await api_limiter.wait_and_acquire("solana")
            session = await get_session()
            rpc_url = settings.get_rpc_url("solana")

            # Get largest token accounts
            async with session.post(
                rpc_url,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "getTokenLargestAccounts",
                    "params": [token_mint]
                }
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
                        "params": [token_mint]
                    }
                ) as supply_response:
                    supply_data = await supply_response.json()
                    supply = int(supply_data.get("result", {}).get("value", {}).get("amount", 1))

                report.total_supply = supply
                report.top_10_percentage = (total_held / supply * 100) if supply > 0 else 100

                if report.top_10_percentage > 80:
                    report.risk_factors.append(RiskFactor(
                        category=RiskCategory.HIGH_CONCENTRATION,
                        severity=RiskLevel.HIGH,
                        description=f"Top 10 wallets hold {report.top_10_percentage:.1f}% of supply",
                        score_impact=25,
                    ))
                    report.warnings.append(f"High concentration: top 10 hold {report.top_10_percentage:.1f}%")
                elif report.top_10_percentage > 50:
                    report.risk_factors.append(RiskFactor(
                        category=RiskCategory.HIGH_CONCENTRATION,
                        severity=RiskLevel.MEDIUM,
                        description=f"Top 10 wallets hold {report.top_10_percentage:.1f}% of supply",
                        score_impact=10,
                    ))

        except Exception as e:
            logger.debug(f"Holder check failed: {e}")

    async def _check_metadata(self, token_mint: str, report: TokenSafetyReport):
        """Check token metadata for suspicious patterns."""
        try:
            # This would fetch token metadata (name, symbol, etc.)
            # For pump.fun tokens, we can use their API
            from bot.services.sniping.pump_fun_api import pump_fun_api

            token = await pump_fun_api.get_token(token_mint)
            if token:
                report.token_name = token.name
                report.token_symbol = token.symbol
                report.token_decimals = 6  # pump.fun uses 6 decimals

                # Check for suspicious name patterns
                suspicious_patterns = [
                    "test", "fake", "scam", "rug", "honeypot",
                    "free money", "guaranteed", "100x",
                ]

                name_lower = token.name.lower()
                symbol_lower = token.symbol.lower()

                for pattern in suspicious_patterns:
                    if pattern in name_lower or pattern in symbol_lower:
                        report.risk_factors.append(RiskFactor(
                            category=RiskCategory.SUSPICIOUS_NAME,
                            severity=RiskLevel.MEDIUM,
                            description=f"Suspicious name/symbol pattern: {pattern}",
                            score_impact=15,
                        ))
                        report.warnings.append(f"Suspicious name pattern detected")
                        break

                # Check socials
                if not token.twitter and not token.telegram and not token.website:
                    report.risk_factors.append(RiskFactor(
                        category=RiskCategory.NO_SOCIALS,
                        severity=RiskLevel.LOW,
                        description="No social media links",
                        score_impact=5,
                    ))

        except Exception as e:
            logger.debug(f"Metadata check failed: {e}")

    async def _check_goplus(self, token_mint: str, chain: str, report: TokenSafetyReport):
        """Check token via GoPlus Security API."""
        try:
            if chain not in goplus_api.CHAIN_MAP:
                return

            security = await goplus_api.get_token_security(chain, token_mint)
            report.goplus_checked = True
            report.is_open_source = security.is_open_source
            report.is_proxy = security.is_proxy

            # Override honeypot if GoPlus also flags it
            if security.is_honeypot and not report.is_honeypot:
                report.is_honeypot = True
                report.risk_factors.append(RiskFactor(
                    category=RiskCategory.HONEYPOT,
                    severity=RiskLevel.CRITICAL,
                    description="Honeypot detected by GoPlus",
                    score_impact=100,
                ))
                report.warnings.append("HONEYPOT DETECTED (GoPlus)")

            # Update tax data if not already set
            if security.buy_tax is not None and report.buy_tax is None:
                report.buy_tax = security.buy_tax
            if security.sell_tax is not None and report.sell_tax is None:
                report.sell_tax = security.sell_tax

            # Holder count
            if security.holder_count > 0:
                report.total_holders = security.holder_count

            # Proxy contract risk
            if security.is_proxy:
                report.risk_factors.append(RiskFactor(
                    category=RiskCategory.PROXY_CONTRACT,
                    severity=RiskLevel.MEDIUM,
                    description="Contract is upgradeable (proxy pattern)",
                    score_impact=15,
                ))
                report.warnings.append("Upgradeable proxy contract")

            # Unverified / not open source
            if not security.is_open_source:
                report.risk_factors.append(RiskFactor(
                    category=RiskCategory.UNVERIFIED_CONTRACT,
                    severity=RiskLevel.HIGH,
                    description="Contract source code is not verified",
                    score_impact=20,
                ))
                report.warnings.append("Contract not verified")

            # Ownership risks
            ownership_issues = []
            if security.can_take_back_ownership:
                ownership_issues.append("can reclaim ownership")
            if security.owner_change_balance:
                ownership_issues.append("owner can change balances")
            if security.hidden_owner:
                ownership_issues.append("hidden owner")

            if ownership_issues:
                report.risk_factors.append(RiskFactor(
                    category=RiskCategory.OWNERSHIP_RISK,
                    severity=RiskLevel.HIGH,
                    description=f"Ownership risks: {', '.join(ownership_issues)}",
                    score_impact=25,
                ))
                report.warnings.append(f"Ownership risk: {', '.join(ownership_issues)}")

            # Mintable (supplement authority check for EVM chains)
            if security.is_mintable and chain != "solana":
                already_flagged = any(
                    f.category == RiskCategory.MINT_AUTHORITY
                    for f in report.risk_factors
                )
                if not already_flagged:
                    report.risk_factors.append(RiskFactor(
                        category=RiskCategory.MINT_AUTHORITY,
                        severity=RiskLevel.HIGH,
                        description="Token is mintable - supply can be inflated",
                        score_impact=30,
                    ))
                    report.warnings.append("Token is mintable")

        except (GoPlusError, Exception) as e:
            logger.debug(f"GoPlus check failed for {token_mint}: {e}")

    async def _check_dexscreener(self, token_mint: str, chain: str, report: TokenSafetyReport):
        """Check token via DexScreener API."""
        try:
            if chain not in dexscreener_api.CHAIN_MAP:
                return

            pairs = await dexscreener_api.get_token_pairs(chain, token_mint)
            if not pairs:
                return

            # Use the highest-liquidity pair
            best_pair = pairs[0]

            report.price_usd = best_pair.price_usd
            report.volume_24h = best_pair.volume_24h
            report.price_change_24h = best_pair.price_change_24h
            report.liquidity_usd = best_pair.liquidity_usd
            report.dex_url = best_pair.url

            # Calculate pair age
            if best_pair.pair_created_at:
                from datetime import datetime
                age_delta = datetime.utcnow() - best_pair.pair_created_at
                report.pair_age_hours = age_delta.total_seconds() / 3600

                # New token risk (< 24 hours old)
                if report.pair_age_hours < 24:
                    already_flagged = any(
                        f.category == RiskCategory.NEW_TOKEN
                        for f in report.risk_factors
                    )
                    if not already_flagged:
                        report.risk_factors.append(RiskFactor(
                            category=RiskCategory.NEW_TOKEN,
                            severity=RiskLevel.MEDIUM,
                            description=f"Token pair is only {report.pair_age_hours:.1f} hours old",
                            score_impact=10,
                        ))

            # Update liquidity in SOL terms if available
            if best_pair.price_native and best_pair.liquidity_usd:
                # Approximate liquidity in native token
                report.liquidity_sol = best_pair.liquidity_usd / max(best_pair.price_native, 0.01)

            # Low volume warning
            if best_pair.volume_24h < 1000:
                report.risk_factors.append(RiskFactor(
                    category=RiskCategory.LOW_VOLUME,
                    severity=RiskLevel.MEDIUM,
                    description=f"Very low 24h volume: ${best_pair.volume_24h:,.0f}",
                    score_impact=10,
                ))

        except (DexScreenerError, Exception) as e:
            logger.debug(f"DexScreener check failed for {token_mint}: {e}")

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
        if score >= 80: return "🛡️"
        if score >= 60: return "⚠️"
        if score >= 40: return "🚨"
        return "🚫"

    def get_safety_summary(self, report: TokenSafetyReport) -> str:
        """Generate a formatted safety summary string for Telegram."""
        shield = self.get_shield_emoji(report.safety_score)

        summary = [
            f"{shield} *Security Score: {report.safety_score}/100*",
            f"Risk Level: {report.risk_level.value.upper()}",
            ""
        ]

        if report.is_honeypot:
            summary.append("🚫 *HONEYPOT DETECTED*")

        # Add key metrics
        summary.append(f"{'✅' if report.mint_authority_revoked else '❌'} Mint Authority Revoked")
        summary.append(f"{'✅' if report.freeze_authority_revoked else '❌'} Freeze Authority Revoked")

        # GoPlus contract verification
        if report.goplus_checked:
            summary.append(f"{'✅' if report.is_open_source else '❌'} Contract Verified")
            if report.is_proxy:
                summary.append("⚠️ Upgradeable Proxy")

        if report.sell_tax is not None:
            summary.append(f"💰 Sell Tax: {report.sell_tax:.1f}%")
        if report.buy_tax is not None:
            summary.append(f"💰 Buy Tax: {report.buy_tax:.1f}%")

        if report.top_10_percentage > 0:
            summary.append(f"👥 Top 10 Holders: {report.top_10_percentage:.1f}%")

        if report.total_holders > 0:
            summary.append(f"👥 Holders: {report.total_holders:,}")

        # DexScreener market data
        if report.liquidity_usd > 0:
            summary.append(f"💧 Liquidity: ${report.liquidity_usd:,.0f}")
        if report.volume_24h > 0:
            summary.append(f"📊 24h Volume: ${report.volume_24h:,.0f}")
        if report.price_change_24h != 0:
            emoji = "📈" if report.price_change_24h > 0 else "📉"
            summary.append(f"{emoji} 24h Change: {report.price_change_24h:+.1f}%")
        if report.pair_age_hours is not None:
            if report.pair_age_hours < 24:
                summary.append(f"🕐 Age: {report.pair_age_hours:.1f}h")
            else:
                summary.append(f"🕐 Age: {report.pair_age_hours / 24:.1f}d")

        # Add high-level warnings
        if report.warnings:
            summary.append("\n*Warnings:*")
            for warning in report.warnings[:3]:  # Top 3 warnings
                summary.append(f"• {warning}")

        return "\n".join(summary)


# Global instance
token_analyzer = TokenAnalyzer()
