"""Honeypot detection for Solana tokens.

Honeypots are tokens designed to steal funds by:
1. Preventing sells (revert on sell)
2. Charging excessive sell tax
3. Blocking transfers after purchase
4. Draining wallet via malicious approvals

Detection methods:
1. Simulate buy/sell transactions
2. Check for suspicious transfer restrictions
3. Analyze sell tax vs buy tax
4. Check transaction history patterns
"""

import logging
import asyncio
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

from bot.config.settings import settings
from bot.services.rpc_manager import rpc_manager
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# Wrapped SOL
WSOL_MINT = "So11111111111111111111111111111111111111112"


class HoneypotReason(Enum):
    """Reasons a token might be flagged as honeypot."""
    SELL_FAILED = "sell_failed"
    HIGH_SELL_TAX = "high_sell_tax"
    TRANSFER_BLOCKED = "transfer_blocked"
    NO_LIQUIDITY = "no_liquidity"
    SIMULATION_FAILED = "simulation_failed"
    KNOWN_SCAM = "known_scam"


@dataclass
class HoneypotResult:
    """Result of honeypot detection."""
    token_mint: str
    is_honeypot: bool
    confidence: float  # 0-1
    reason: Optional[HoneypotReason] = None
    buy_tax: Optional[float] = None  # Percentage
    sell_tax: Optional[float] = None  # Percentage
    transfer_tax: Optional[float] = None
    can_buy: bool = True
    can_sell: bool = True
    max_transaction: Optional[float] = None  # Max tokens per tx
    details: Dict[str, Any] = None

    def __post_init__(self):
        if self.details is None:
            self.details = {}


class HoneypotDetectorError(Exception):
    """Exception for honeypot detection errors."""
    def __init__(self, message: str, data: Optional[Dict] = None):
        super().__init__(message)
        self.data = data or {}


class HoneypotDetector:
    """Detects honeypot tokens on Solana.

    Detection strategies:
    1. Jupiter simulation - simulate buy/sell via Jupiter
    2. Transaction analysis - check recent sell success rate
    3. Tax calculation - compare buy vs sell amounts
    """

    def __init__(self):
        self._cache: Dict[str, tuple[HoneypotResult, datetime]] = {}
        self._cache_ttl = 300  # 5 minutes
        self._jupiter_api = "https://quote-api.jup.ag/v6"

    async def detect(
        self,
        token_mint: str,
        amount_sol: float = 0.1,
        use_cache: bool = True,
    ) -> HoneypotResult:
        """
        Full honeypot detection with simulation.

        Args:
            token_mint: Token mint address
            amount_sol: Amount of SOL to simulate trading
            use_cache: Use cached results if available

        Returns:
            HoneypotResult with detection details
        """
        # Check cache
        if use_cache and token_mint in self._cache:
            result, cached_at = self._cache[token_mint]
            if (datetime.now(timezone.utc) - cached_at).total_seconds() < self._cache_ttl:
                return result

        result = HoneypotResult(
            token_mint=token_mint,
            is_honeypot=False,
            confidence=0,
        )

        try:
            # Run detection checks
            await asyncio.gather(
                self._check_buy_simulation(token_mint, amount_sol, result),
                self._check_sell_simulation(token_mint, amount_sol, result),
                self._check_transaction_history(token_mint, result),
            )

            # Determine final verdict
            self._calculate_verdict(result)

            # Cache result
            self._cache[token_mint] = (result, datetime.now(timezone.utc))

        except Exception as e:
            logger.error(f"Honeypot detection error for {token_mint}: {e}")
            result.details["error"] = str(e)
            result.confidence = 0.3  # Low confidence due to error

        return result

    async def quick_check(
        self,
        token_mint: str,
        use_cache: bool = True,
    ) -> HoneypotResult:
        """
        Quick honeypot check without full simulation.

        Faster but less accurate than full detect().
        """
        # Check cache first
        if use_cache and token_mint in self._cache:
            result, cached_at = self._cache[token_mint]
            if (datetime.now(timezone.utc) - cached_at).total_seconds() < self._cache_ttl:
                return result

        result = HoneypotResult(
            token_mint=token_mint,
            is_honeypot=False,
            confidence=0.5,
        )

        try:
            # Just check if we can get a sell quote
            can_sell = await self._can_get_sell_quote(token_mint)
            if not can_sell:
                result.is_honeypot = True
                result.can_sell = False
                result.reason = HoneypotReason.SELL_FAILED
                result.confidence = 0.7

            # Check recent transactions
            await self._check_transaction_history(token_mint, result)

        except Exception as e:
            logger.debug(f"Quick check error for {token_mint}: {e}")

        return result

    async def _check_buy_simulation(
        self,
        token_mint: str,
        amount_sol: float,
        result: HoneypotResult,
    ):
        """Simulate buying the token."""
        try:
            await api_limiter.wait_and_acquire("jupiter")
            session = await get_session()

            amount_lamports = int(amount_sol * 1e9)

            async with session.get(
                f"{self._jupiter_api}/quote",
                params={
                    "inputMint": WSOL_MINT,
                    "outputMint": token_mint,
                    "amount": str(amount_lamports),
                    "slippageBps": "1000",
                }
            ) as response:
                if response.status != 200:
                    result.can_buy = False
                    result.details["buy_error"] = f"HTTP {response.status}"
                    return

                data = await response.json()

                if "error" in data:
                    result.can_buy = False
                    result.details["buy_error"] = data.get("error")
                    return

                # Calculate effective buy tax from price impact
                in_amount = int(data.get("inAmount", amount_lamports))
                out_amount = int(data.get("outAmount", 0))
                price_impact = float(data.get("priceImpactPct", 0))

                result.details["buy_quote"] = {
                    "in_amount": in_amount,
                    "out_amount": out_amount,
                    "price_impact": price_impact,
                }

                # High price impact might indicate low liquidity or tax
                if price_impact > 20:
                    result.buy_tax = price_impact
                    result.details["buy_warning"] = "High price impact"

        except Exception as e:
            logger.debug(f"Buy simulation error: {e}")
            result.details["buy_error"] = str(e)

    async def _check_sell_simulation(
        self,
        token_mint: str,
        amount_sol: float,
        result: HoneypotResult,
    ):
        """Simulate selling the token."""
        try:
            await api_limiter.wait_and_acquire("jupiter")
            session = await get_session()

            # First get a buy quote to know how many tokens we'd have
            buy_amount_lamports = int(amount_sol * 1e9)

            async with session.get(
                f"{self._jupiter_api}/quote",
                params={
                    "inputMint": WSOL_MINT,
                    "outputMint": token_mint,
                    "amount": str(buy_amount_lamports),
                    "slippageBps": "1000",
                }
            ) as response:
                if response.status != 200:
                    return

                buy_data = await response.json()
                tokens_received = int(buy_data.get("outAmount", 0))

                if tokens_received == 0:
                    return

            # Now simulate selling those tokens
            await api_limiter.wait_and_acquire("jupiter")

            async with session.get(
                f"{self._jupiter_api}/quote",
                params={
                    "inputMint": token_mint,
                    "outputMint": WSOL_MINT,
                    "amount": str(tokens_received),
                    "slippageBps": "1000",
                }
            ) as response:
                if response.status != 200:
                    result.can_sell = False
                    result.reason = HoneypotReason.SELL_FAILED
                    result.details["sell_error"] = f"HTTP {response.status}"
                    return

                data = await response.json()

                if "error" in data:
                    result.can_sell = False
                    result.reason = HoneypotReason.SELL_FAILED
                    result.details["sell_error"] = data.get("error")
                    return

                # Calculate sell tax
                sol_returned = int(data.get("outAmount", 0))
                price_impact = float(data.get("priceImpactPct", 0))

                result.details["sell_quote"] = {
                    "in_amount": tokens_received,
                    "out_amount": sol_returned,
                    "price_impact": price_impact,
                }

                # Calculate effective tax (buy + sell round trip)
                if sol_returned > 0 and buy_amount_lamports > 0:
                    round_trip_loss = (buy_amount_lamports - sol_returned) / buy_amount_lamports * 100
                    result.sell_tax = round_trip_loss - (result.buy_tax or 0)

                    if result.sell_tax > 50:
                        result.reason = HoneypotReason.HIGH_SELL_TAX
                        result.details["sell_warning"] = "Extremely high sell tax"
                    elif result.sell_tax > 20:
                        result.details["sell_warning"] = "High sell tax"

        except Exception as e:
            logger.debug(f"Sell simulation error: {e}")
            result.can_sell = False
            result.reason = HoneypotReason.SIMULATION_FAILED
            result.details["sell_error"] = str(e)

    async def _check_transaction_history(
        self,
        token_mint: str,
        result: HoneypotResult,
    ):
        """Analyze recent transactions for sell patterns."""
        try:
            await api_limiter.wait_and_acquire("solana")
            session = await get_session()
            rpc_url = rpc_manager.get_rpc_url("solana")

            # Get recent signatures for the token
            async with session.post(
                rpc_url,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "getSignaturesForAddress",
                    "params": [token_mint, {"limit": 50}]
                }
            ) as response:
                if response.status != 200:
                    return

                data = await response.json()
                signatures = data.get("result", [])

                total_txs = len(signatures)
                failed_txs = sum(1 for s in signatures if s.get("err"))

                result.details["tx_analysis"] = {
                    "total": total_txs,
                    "failed": failed_txs,
                    "success_rate": (total_txs - failed_txs) / total_txs if total_txs > 0 else 0,
                }

                # Very high failure rate might indicate honeypot
                if total_txs > 10 and failed_txs / total_txs > 0.5:
                    result.details["tx_warning"] = "High transaction failure rate"

        except Exception as e:
            logger.debug(f"Transaction history check error: {e}")

    async def _can_get_sell_quote(self, token_mint: str) -> bool:
        """Quick check if sell quote is available."""
        try:
            await api_limiter.wait_and_acquire("jupiter")
            session = await get_session()

            # Try to get a quote for selling 1 token
            async with session.get(
                f"{self._jupiter_api}/quote",
                params={
                    "inputMint": token_mint,
                    "outputMint": WSOL_MINT,
                    "amount": "1000000",  # 1 token with 6 decimals
                    "slippageBps": "5000",  # High slippage for test
                }
            ) as response:
                if response.status != 200:
                    return False

                data = await response.json()
                return "error" not in data and int(data.get("outAmount", 0)) > 0

        except Exception:
            return False

    def _calculate_verdict(self, result: HoneypotResult):
        """Calculate final honeypot verdict from collected data."""
        confidence = 0.5
        is_honeypot = False
        reasons = []

        # Can't sell = definite honeypot
        if not result.can_sell:
            is_honeypot = True
            confidence = 0.9
            reasons.append("Cannot sell")

        # Very high sell tax = likely honeypot
        if result.sell_tax and result.sell_tax > 80:
            is_honeypot = True
            confidence = max(confidence, 0.85)
            reasons.append(f"Sell tax {result.sell_tax:.1f}%")
        elif result.sell_tax and result.sell_tax > 50:
            is_honeypot = True
            confidence = max(confidence, 0.7)
            reasons.append(f"High sell tax {result.sell_tax:.1f}%")

        # High failure rate
        tx_analysis = result.details.get("tx_analysis", {})
        success_rate = tx_analysis.get("success_rate", 1)
        if success_rate < 0.3:
            confidence = max(confidence, 0.6)
            reasons.append("Low tx success rate")

        result.is_honeypot = is_honeypot
        result.confidence = confidence
        if reasons:
            result.details["verdict_reasons"] = reasons

    def clear_cache(self, token_mint: Optional[str] = None):
        """Clear detection cache."""
        if token_mint:
            self._cache.pop(token_mint, None)
        else:
            self._cache.clear()


# Global instance
honeypot_detector = HoneypotDetector()
