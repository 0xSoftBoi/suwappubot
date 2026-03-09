"""GoPlus Token Security API integration for cross-chain token safety scoring.

GoPlus provides free token security data across 60+ chains including:
- Honeypot detection
- Mint/freeze authority status
- Liquidity lock analysis
- Top holder concentration
- Rug probability scoring
- Contract verification

Free tier: ~1000 requests/day (cached to minimize usage).
"""

import logging
import time
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from enum import Enum

from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# GoPlus chain IDs
GOPLUS_CHAIN_IDS = {
    "ethereum": "1",
    "bsc": "56",
    "polygon": "137",
    "arbitrum": "42161",
    "optimism": "10",
    "base": "8453",
    "avalanche": "43114",
    "fantom": "250",
    "linea": "59144",
    "mantle": "5000",
    "gnosis": "100",
    "scroll": "534352",
    "solana": "solana",
}

GOPLUS_BASE_URL = "https://api.gopluslabs.io/api/v1"


class RiskLevel(Enum):
    SAFE = "safe"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class TokenSecurityReport:
    """Unified token security report from GoPlus."""
    token_address: str
    chain: str
    risk_level: RiskLevel = RiskLevel.MEDIUM
    safety_score: int = 50  # 0-100

    # Core checks
    is_honeypot: Optional[bool] = None
    is_open_source: Optional[bool] = None
    is_proxy: Optional[bool] = None
    is_mintable: Optional[bool] = None
    can_freeze: Optional[bool] = None
    has_blacklist: Optional[bool] = None
    has_whitelist: Optional[bool] = None
    is_anti_whale: Optional[bool] = None

    # Tax info
    buy_tax: Optional[float] = None
    sell_tax: Optional[float] = None

    # Liquidity
    total_liquidity_usd: Optional[float] = None
    lp_locked_percentage: Optional[float] = None
    lp_holder_count: Optional[int] = None

    # Holders
    holder_count: Optional[int] = None
    top10_holder_percentage: Optional[float] = None
    creator_percentage: Optional[float] = None

    # Metadata
    token_name: Optional[str] = None
    token_symbol: Optional[str] = None

    # Warnings and details
    warnings: List[str] = field(default_factory=list)
    risks: List[str] = field(default_factory=list)

    # Cache
    fetched_at: float = 0


class GoPlusService:
    """Service for fetching token security data from GoPlus API."""

    CACHE_TTL = 300  # 5 minutes

    def __init__(self):
        self._cache: Dict[str, TokenSecurityReport] = {}

    def _get_cache_key(self, token_address: str, chain: str) -> str:
        return f"{chain}:{token_address.lower()}"

    def _get_cached(self, token_address: str, chain: str) -> Optional[TokenSecurityReport]:
        key = self._get_cache_key(token_address, chain)
        report = self._cache.get(key)
        if report and (time.time() - report.fetched_at) < self.CACHE_TTL:
            return report
        return None

    async def get_token_security(
        self,
        token_address: str,
        chain: str,
    ) -> TokenSecurityReport:
        """Get token security report from GoPlus API.

        Args:
            token_address: Token contract address
            chain: Chain name (ethereum, bsc, polygon, solana, etc.)

        Returns:
            TokenSecurityReport with safety analysis
        """
        # Check cache
        cached = self._get_cached(token_address, chain)
        if cached:
            return cached

        chain_id = GOPLUS_CHAIN_IDS.get(chain.lower())
        if not chain_id:
            return self._unknown_report(token_address, chain)

        try:
            if chain.lower() == "solana":
                report = await self._fetch_solana_security(token_address)
            else:
                report = await self._fetch_evm_security(token_address, chain_id, chain)
        except Exception as e:
            logger.error(f"GoPlus API error for {token_address} on {chain}: {e}")
            return self._unknown_report(token_address, chain)

        # Cache result
        report.fetched_at = time.time()
        self._cache[self._get_cache_key(token_address, chain)] = report
        return report

    async def _fetch_evm_security(
        self,
        token_address: str,
        chain_id: str,
        chain: str,
    ) -> TokenSecurityReport:
        """Fetch EVM token security from GoPlus."""
        url = f"{GOPLUS_BASE_URL}/token_security/{chain_id}"
        params = {"contract_addresses": token_address.lower()}

        await api_limiter.acquire("goplus")

        async with get_session() as session:
            resp = await session.get(url, params=params)
            data = resp.json()

        if data.get("code") != 1 or not data.get("result"):
            return self._unknown_report(token_address, chain)

        # GoPlus returns result keyed by lowercase address
        token_data = data["result"].get(token_address.lower(), {})
        if not token_data:
            return self._unknown_report(token_address, chain)

        return self._parse_evm_report(token_data, token_address, chain)

    async def _fetch_solana_security(self, token_address: str) -> TokenSecurityReport:
        """Fetch Solana token security from GoPlus."""
        url = f"{GOPLUS_BASE_URL}/solana/token_security"
        params = {"contract_addresses": token_address}

        await api_limiter.acquire("goplus")

        async with get_session() as session:
            resp = await session.get(url, params=params)
            data = resp.json()

        if data.get("code") != 1 or not data.get("result"):
            return self._unknown_report(token_address, "solana")

        token_data = data["result"].get(token_address, {})
        if not token_data:
            return self._unknown_report(token_address, "solana")

        return self._parse_solana_report(token_data, token_address)

    def _parse_evm_report(
        self,
        data: dict,
        token_address: str,
        chain: str,
    ) -> TokenSecurityReport:
        """Parse GoPlus EVM token security response into report."""
        report = TokenSecurityReport(
            token_address=token_address,
            chain=chain,
            token_name=data.get("token_name"),
            token_symbol=data.get("token_symbol"),
        )

        # Core checks (GoPlus uses "1" for true, "0" for false)
        report.is_honeypot = data.get("is_honeypot") == "1"
        report.is_open_source = data.get("is_open_source") == "1"
        report.is_proxy = data.get("is_proxy") == "1"
        report.is_mintable = data.get("is_mintable") == "1"
        report.has_blacklist = data.get("is_blacklisted") == "1"
        report.has_whitelist = data.get("is_whitelisted") == "1"
        report.is_anti_whale = data.get("is_anti_whale") == "1"

        # Tax
        try:
            report.buy_tax = float(data.get("buy_tax", 0)) * 100
            report.sell_tax = float(data.get("sell_tax", 0)) * 100
        except (ValueError, TypeError):
            pass

        # Liquidity
        try:
            report.total_liquidity_usd = float(data.get("total_supply", 0))
            lp_holders = data.get("lp_holders", [])
            if lp_holders:
                locked = sum(float(h.get("percent", 0)) for h in lp_holders if h.get("is_locked"))
                report.lp_locked_percentage = locked * 100
                report.lp_holder_count = len(lp_holders)
        except (ValueError, TypeError):
            pass

        # Holders
        try:
            report.holder_count = int(data.get("holder_count", 0))
            holders = data.get("holders", [])
            if holders:
                top10 = sum(float(h.get("percent", 0)) for h in holders[:10])
                report.top10_holder_percentage = top10 * 100
                creator = data.get("creator_percent", "0")
                report.creator_percentage = float(creator) * 100
        except (ValueError, TypeError):
            pass

        # Calculate safety score and risks
        self._calculate_safety(report)
        return report

    def _parse_solana_report(self, data: dict, token_address: str) -> TokenSecurityReport:
        """Parse GoPlus Solana token security response."""
        report = TokenSecurityReport(
            token_address=token_address,
            chain="solana",
            token_name=data.get("token_name"),
            token_symbol=data.get("token_symbol"),
        )

        # Solana-specific checks
        report.is_mintable = data.get("mintable", {}).get("status") == "1"
        report.can_freeze = data.get("freezeable", {}).get("status") == "1"

        # Metadata
        try:
            report.holder_count = int(data.get("holder_count", 0))
            report.top10_holder_percentage = float(data.get("top10_holder_rate", 0)) * 100
            report.creator_percentage = float(data.get("creator_rate", 0)) * 100
        except (ValueError, TypeError):
            pass

        self._calculate_safety(report)
        return report

    def _calculate_safety(self, report: TokenSecurityReport) -> None:
        """Calculate safety score (0-100) and risk level from report data."""
        score = 100

        # Critical risks (-40 to -50 each)
        if report.is_honeypot:
            score -= 50
            report.risks.append("HONEYPOT: Cannot sell this token")

        if report.sell_tax is not None and report.sell_tax > 50:
            score -= 40
            report.risks.append(f"Extreme sell tax: {report.sell_tax:.0f}%")

        # High risks (-15 to -25 each)
        if report.is_mintable:
            score -= 20
            report.warnings.append("Mint authority: supply can be increased")

        if report.can_freeze:
            score -= 15
            report.warnings.append("Freeze authority: tokens can be frozen")

        if report.has_blacklist:
            score -= 15
            report.warnings.append("Has blacklist: addresses can be blocked")

        if report.is_proxy:
            score -= 15
            report.warnings.append("Proxy contract: code can be changed")

        if report.sell_tax is not None and 10 < report.sell_tax <= 50:
            score -= 15
            report.warnings.append(f"High sell tax: {report.sell_tax:.0f}%")

        if report.buy_tax is not None and report.buy_tax > 10:
            score -= 10
            report.warnings.append(f"High buy tax: {report.buy_tax:.0f}%")

        # Medium risks (-5 to -10 each)
        if report.top10_holder_percentage is not None and report.top10_holder_percentage > 80:
            score -= 15
            report.warnings.append(f"Top 10 holders own {report.top10_holder_percentage:.0f}%")
        elif report.top10_holder_percentage is not None and report.top10_holder_percentage > 50:
            score -= 5
            report.warnings.append(f"Top 10 holders own {report.top10_holder_percentage:.0f}%")

        if report.creator_percentage is not None and report.creator_percentage > 10:
            score -= 10
            report.warnings.append(f"Creator holds {report.creator_percentage:.0f}%")

        if report.is_open_source is False:
            score -= 10
            report.warnings.append("Contract source not verified")

        if report.holder_count is not None and report.holder_count < 50:
            score -= 10
            report.warnings.append(f"Very few holders: {report.holder_count}")

        # Positive signals (+5 to +10 each, can't exceed 100)
        if report.lp_locked_percentage is not None and report.lp_locked_percentage > 50:
            score = min(100, score + 5)

        if report.is_open_source:
            score = min(100, score + 5)

        # Clamp score
        report.safety_score = max(0, min(100, score))

        # Determine risk level
        if report.safety_score >= 80:
            report.risk_level = RiskLevel.SAFE
        elif report.safety_score >= 60:
            report.risk_level = RiskLevel.LOW
        elif report.safety_score >= 40:
            report.risk_level = RiskLevel.MEDIUM
        elif report.safety_score >= 20:
            report.risk_level = RiskLevel.HIGH
        else:
            report.risk_level = RiskLevel.CRITICAL

    def _unknown_report(self, token_address: str, chain: str) -> TokenSecurityReport:
        """Return a report for tokens that couldn't be analyzed."""
        report = TokenSecurityReport(
            token_address=token_address,
            chain=chain,
            risk_level=RiskLevel.MEDIUM,
            safety_score=50,
            fetched_at=time.time(),
        )
        report.warnings.append("Unable to fetch security data")
        return report

    def get_shield_emoji(self, report: TokenSecurityReport) -> str:
        """Get a visual shield emoji based on risk level."""
        return {
            RiskLevel.SAFE: "\U0001f7e2",     # green circle
            RiskLevel.LOW: "\U0001f7e2",       # green circle
            RiskLevel.MEDIUM: "\U0001f7e1",    # yellow circle
            RiskLevel.HIGH: "\U0001f534",      # red circle
            RiskLevel.CRITICAL: "\u26d4",      # no entry
        }.get(report.risk_level, "\u2753")     # question mark

    def format_safety_summary(self, report: TokenSecurityReport) -> str:
        """Format a concise safety summary for Telegram display."""
        emoji = self.get_shield_emoji(report)
        level = report.risk_level.value.upper()
        score = report.safety_score

        lines = [f"{emoji} *Safety: {level}* ({score}/100)"]

        # Show top risks first
        for risk in report.risks[:3]:
            lines.append(f"  \u26a0\ufe0f {risk}")

        # Then warnings
        for warning in report.warnings[:3]:
            lines.append(f"  \u2022 {warning}")

        # Key metrics
        if report.buy_tax is not None and report.sell_tax is not None:
            lines.append(f"  Tax: Buy {report.buy_tax:.1f}% / Sell {report.sell_tax:.1f}%")

        if report.holder_count is not None:
            lines.append(f"  Holders: {report.holder_count:,}")

        return "\n".join(lines)

    def format_safety_badge(self, report: TokenSecurityReport) -> str:
        """Format a one-line safety badge for inline display."""
        emoji = self.get_shield_emoji(report)
        return f"{emoji} {report.safety_score}/100"


# Global instance
goplus_service = GoPlusService()
