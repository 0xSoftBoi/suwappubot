"""Smart routing service - compares providers and finds best routes."""

import asyncio
import logging
from typing import List, Optional, Dict
from dataclasses import dataclass
from decimal import Decimal
from datetime import datetime

from bot.services.lifi_api import LiFiAPI
from bot.services.jupiter_api import JupiterAPI
from bot.services.layerzero_api import LayerZeroAPI
from bot.services.cctp_api import CircleCCTPAPI
from bot.services.across_api import AcrossAPI
from bot.services.wormhole_api import WormholeAPI
from bot.services.price_service import price_service
from bot.config.chains import get_chain_by_name
from bot.config.tokens import get_token_decimals

logger = logging.getLogger(__name__)


@dataclass
class RouteOption:
    """A single route option from a provider."""
    provider: str  # lifi, jupiter, layerzero, cctp, across, wormhole
    provider_display: str  # "Li.Fi", "Jupiter", "LayerZero", "Circle CCTP", "Across", "Wormhole"
    
    from_chain: str
    from_token: str
    from_amount: str
    from_amount_human: float
    
    to_chain: str
    to_token: str
    to_amount: str
    to_amount_human: float
    
    # Costs
    gas_cost_usd: float
    bridge_fee_usd: float
    total_cost_usd: float
    
    # Metrics
    output_usd: float
    net_output_usd: float  # output - costs
    execution_time_seconds: int
    
    # For execution
    raw_quote: dict
    
    # Ranking
    score: float = 0  # Higher is better


class SmartRouter:
    """Smart routing engine that compares multiple providers.
    
    Route selection priority:
    1. Circle CCTP - For USDC (zero bridge fee)
    2. Across Protocol - For EVM-to-EVM (~0.04% fee)
    3. Wormhole - For Solana <-> EVM routes
    4. Li.Fi - Aggregated fallback
    5. Jupiter - Solana-only swaps
    6. LayerZero/Stargate - Same-token bridges
    """
    
    def __init__(self):
        self.lifi = LiFiAPI()
        self.jupiter = JupiterAPI()
        self.layerzero = LayerZeroAPI()
        self.cctp = CircleCCTPAPI()
        self.across = AcrossAPI()
        self.wormhole = WormholeAPI()
    
    async def get_all_routes(
        self,
        from_chain: str,
        from_token: str,
        from_amount: str,
        to_chain: str,
        to_token: str,
        from_address: str,
        to_address: Optional[str] = None,
        slippage: float = 0.5,
    ) -> List[RouteOption]:
        """Get routes from all available providers."""
        routes = []
        tasks = []
        
        # Determine route characteristics
        is_solana_source = from_chain.lower() == "solana"
        is_solana_dest = to_chain.lower() == "solana"
        is_solana_route = is_solana_source or is_solana_dest
        is_same_chain = from_chain.lower() == to_chain.lower()
        is_same_token = from_token.upper() == to_token.upper()
        is_usdc = from_token.upper() == "USDC" and to_token.upper() == "USDC"
        
        # ============================================================
        # PRIORITY 1: Circle CCTP (cheapest for USDC - $0 bridge fee)
        # ============================================================
        if is_usdc and not is_same_chain and self.cctp.is_supported_route(from_chain, to_chain, "USDC"):
            tasks.append(self._get_cctp_route(
                from_chain, to_chain, from_amount
            ))
        
        # ============================================================
        # PRIORITY 2: Across Protocol (cheapest for EVM-to-EVM)
        # ============================================================
        if not is_solana_route and not is_same_chain:
            if self.across.is_supported_route(from_chain, to_chain, from_token):
                tasks.append(self._get_across_route(
                    from_chain, to_chain, from_token, from_amount, from_address, to_address
                ))
        
        # ============================================================
        # PRIORITY 3: Wormhole (for Solana <-> EVM routes)
        # ============================================================
        if is_solana_route and not is_same_chain:
            if self.wormhole.is_supported_route(from_chain, to_chain, from_token):
                tasks.append(self._get_wormhole_route(
                    from_chain, to_chain, from_token, from_amount
                ))
        
        # ============================================================
        # FALLBACK: Li.Fi (aggregator for other routes)
        # ============================================================
        if not (is_solana_source and is_solana_dest):  # Li.Fi doesn't do Solana<->Solana
            tasks.append(self._get_lifi_route(
                from_chain, from_token, from_amount, to_chain, to_token,
                from_address, to_address, slippage
            ))
        
        # ============================================================
        # Jupiter - Solana-only swaps
        # ============================================================
        if is_solana_source and is_solana_dest:
            tasks.append(self._get_jupiter_route(
                from_token, to_token, from_amount, from_address, slippage
            ))
        
        # ============================================================
        # LayerZero/Stargate - same stablecoin cross-chain
        # ============================================================
        if not is_same_chain and is_same_token and not is_solana_route:
            if self._is_stargate_supported(from_chain, to_chain, from_token):
                tasks.append(self._get_layerzero_route(
                    from_chain, from_token, from_amount, to_chain, to_token,
                    from_address, to_address
                ))
        
        # Gather all quotes
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, Exception):
                logger.debug(f"Route fetch error: {result}")
                continue
            if result:
                routes.append(result)
        
        # Score and sort routes
        routes = self._score_routes(routes)
        routes.sort(key=lambda r: r.score, reverse=True)
        
        return routes
    
    async def _get_cctp_route(
        self,
        from_chain: str,
        to_chain: str,
        from_amount: str,
    ) -> Optional[RouteOption]:
        """Get route from Circle CCTP (native USDC bridging)."""
        try:
            quote = await self.cctp.get_quote(
                from_chain=from_chain,
                to_chain=to_chain,
                amount=from_amount,
            )
            
            # USDC is always $1
            output_usd = quote.to_amount_human
            
            return RouteOption(
                provider="cctp",
                provider_display="Circle CCTP",
                from_chain=from_chain,
                from_token="USDC",
                from_amount=from_amount,
                from_amount_human=quote.to_amount_human,
                to_chain=to_chain,
                to_token="USDC",
                to_amount=quote.to_amount,
                to_amount_human=quote.to_amount_human,
                gas_cost_usd=quote.gas_cost_usd,
                bridge_fee_usd=0.0,  # CCTP has ZERO bridge fee!
                total_cost_usd=quote.total_cost_usd,
                output_usd=output_usd,
                net_output_usd=output_usd - quote.total_cost_usd,
                execution_time_seconds=quote.estimated_time,
                raw_quote=quote.raw_data,
            )
        except Exception as e:
            logger.debug(f"CCTP route error: {e}")
            return None
    
    async def _get_across_route(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        from_amount: str,
        from_address: str,
        to_address: Optional[str],
    ) -> Optional[RouteOption]:
        """Get route from Across Protocol (cheap EVM bridges)."""
        try:
            quote = await self.across.get_quote(
                from_chain=from_chain,
                to_chain=to_chain,
                token=token,
                amount=from_amount,
                from_address=from_address,
                to_address=to_address,
            )
            
            # Get USD value
            prices = await price_service.get_prices([token])
            to_price = prices.get(token.upper(), 1)
            output_usd = quote.to_amount_human * to_price
            
            return RouteOption(
                provider="across",
                provider_display="Across",
                from_chain=from_chain,
                from_token=token,
                from_amount=from_amount,
                from_amount_human=quote.from_amount_human,
                to_chain=to_chain,
                to_token=token,
                to_amount=quote.to_amount,
                to_amount_human=quote.to_amount_human,
                gas_cost_usd=quote.gas_cost_usd,
                bridge_fee_usd=quote.relay_fee_usd,
                total_cost_usd=quote.total_cost_usd,
                output_usd=output_usd,
                net_output_usd=output_usd - quote.total_cost_usd,
                execution_time_seconds=quote.estimated_fill_time,
                raw_quote=quote.raw_quote,
            )
        except Exception as e:
            logger.debug(f"Across route error: {e}")
            return None
    
    async def _get_wormhole_route(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        from_amount: str,
    ) -> Optional[RouteOption]:
        """Get route from Wormhole (Solana <-> EVM bridges)."""
        try:
            quote = await self.wormhole.get_quote(
                from_chain=from_chain,
                to_chain=to_chain,
                token=token,
                amount=from_amount,
            )
            
            # Get USD value
            prices = await price_service.get_prices([token])
            to_price = prices.get(token.upper(), 1)
            output_usd = quote.to_amount_human * to_price
            
            return RouteOption(
                provider="wormhole",
                provider_display="Wormhole",
                from_chain=from_chain,
                from_token=token,
                from_amount=from_amount,
                from_amount_human=quote.from_amount_human,
                to_chain=to_chain,
                to_token=token,
                to_amount=quote.to_amount,
                to_amount_human=quote.to_amount_human,
                gas_cost_usd=quote.gas_cost_usd,
                bridge_fee_usd=quote.relayer_fee_usd,
                total_cost_usd=quote.total_cost_usd,
                output_usd=output_usd,
                net_output_usd=output_usd - quote.total_cost_usd,
                execution_time_seconds=quote.estimated_time,
                raw_quote=quote.raw_data,
            )
        except Exception as e:
            logger.debug(f"Wormhole route error: {e}")
            return None
    
    async def _get_lifi_route(
        self,
        from_chain: str,
        from_token: str,
        from_amount: str,
        to_chain: str,
        to_token: str,
        from_address: str,
        to_address: Optional[str],
        slippage: float,
    ) -> Optional[RouteOption]:
        """Get route from Li.Fi."""
        try:
            quote = await self.lifi.get_quote(
                from_chain=from_chain,
                to_chain=to_chain,
                from_token=from_token,
                to_token=to_token,
                from_amount=from_amount,
                from_address=from_address,
                to_address=to_address,
                slippage=slippage,
            )
            
            # Get USD values
            prices = await price_service.get_prices([to_token])
            to_price = prices.get(to_token, 0)
            
            # Parse amounts
            decimals = get_token_decimals(to_token, to_chain) or 18
            to_amount_human = int(quote.to_amount) / (10 ** decimals)
            from_decimals = get_token_decimals(from_token, from_chain) or 18
            from_amount_human = int(from_amount) / (10 ** from_decimals)
            
            output_usd = to_amount_human * to_price
            total_cost = quote.gas_cost_usd + quote.fee_cost_usd
            
            return RouteOption(
                provider="lifi",
                provider_display="Li.Fi",
                from_chain=from_chain,
                from_token=from_token,
                from_amount=from_amount,
                from_amount_human=from_amount_human,
                to_chain=to_chain,
                to_token=to_token,
                to_amount=quote.to_amount,
                to_amount_human=to_amount_human,
                gas_cost_usd=quote.gas_cost_usd,
                bridge_fee_usd=quote.fee_cost_usd,
                total_cost_usd=total_cost,
                output_usd=output_usd,
                net_output_usd=output_usd - total_cost,
                execution_time_seconds=quote.estimated_time,
                raw_quote=quote.raw_response,
            )
        except Exception as e:
            logger.debug(f"Li.Fi route error: {e}")
            return None
    
    async def _get_jupiter_route(
        self,
        from_token: str,
        to_token: str,
        from_amount: str,
        from_address: str,
        slippage: float,
    ) -> Optional[RouteOption]:
        """Get route from Jupiter (Solana)."""
        try:
            quote = await self.jupiter.get_quote(
                input_mint=from_token,
                output_mint=to_token,
                amount=from_amount,
                slippage_bps=int(slippage * 100),
            )
            
            prices = await price_service.get_prices([to_token])
            to_price = prices.get(to_token, 0)
            
            # Parse amounts
            from_amount_human = int(from_amount) / 1e9  # SOL decimals
            to_amount_human = int(quote.out_amount) / 1e9
            output_usd = to_amount_human * to_price
            
            return RouteOption(
                provider="jupiter",
                provider_display="Jupiter",
                from_chain="solana",
                from_token=from_token,
                from_amount=from_amount,
                from_amount_human=from_amount_human,
                to_chain="solana",
                to_token=to_token,
                to_amount=quote.out_amount,
                to_amount_human=to_amount_human,
                gas_cost_usd=0.001,  # Solana fees are minimal
                bridge_fee_usd=0,
                total_cost_usd=0.001,
                output_usd=output_usd,
                net_output_usd=output_usd - 0.001,
                execution_time_seconds=5,  # Solana is fast
                raw_quote=quote.raw_data if hasattr(quote, 'raw_data') else {},
            )
        except Exception as e:
            logger.debug(f"Jupiter route error: {e}")
            return None
    
    async def _get_layerzero_route(
        self,
        from_chain: str,
        from_token: str,
        from_amount: str,
        to_chain: str,
        to_token: str,
        from_address: str,
        to_address: Optional[str],
    ) -> Optional[RouteOption]:
        """Get route from LayerZero/Stargate."""
        try:
            quote = await self.layerzero.get_quote(
                src_chain=from_chain,
                dst_chain=to_chain,
                token_symbol=from_token,
                amount=from_amount,
            )
            
            prices = await price_service.get_prices([to_token])
            to_price = prices.get(to_token, 0)
            
            # Parse amounts
            decimals = get_token_decimals(to_token, to_chain) or 18
            to_amount_human = int(quote.amount_out) / (10 ** decimals)
            from_amount_human = int(from_amount) / (10 ** decimals)
            
            output_usd = to_amount_human * to_price
            total_cost = quote.lz_fee_usd
            
            return RouteOption(
                provider="layerzero",
                provider_display="LayerZero",
                from_chain=from_chain,
                from_token=from_token,
                from_amount=from_amount,
                from_amount_human=from_amount_human,
                to_chain=to_chain,
                to_token=to_token,
                to_amount=quote.amount_out,
                to_amount_human=to_amount_human,
                gas_cost_usd=quote.lz_fee_usd,
                bridge_fee_usd=0,
                total_cost_usd=total_cost,
                output_usd=output_usd,
                net_output_usd=output_usd - total_cost,
                execution_time_seconds=quote.estimated_time,
                raw_quote=quote.raw_data,
            )
        except Exception as e:
            logger.debug(f"LayerZero route error: {e}")
            return None
    
    def _is_stargate_supported(self, from_chain: str, to_chain: str, token: str) -> bool:
        """Check if route is supported by Stargate."""
        supported_chains = {"ethereum", "polygon", "bsc", "arbitrum", "optimism", "base", "avalanche"}
        supported_tokens = {"USDC", "USDT", "DAI", "FRAX", "ETH"}
        
        return (
            from_chain.lower() in supported_chains and
            to_chain.lower() in supported_chains and
            token.upper() in supported_tokens
        )
    
    def _score_routes(self, routes: List[RouteOption]) -> List[RouteOption]:
        """Score routes based on multiple factors."""
        if not routes:
            return routes
        
        # Weights for scoring
        weights = {
            "output": 0.4,       # Higher output is better
            "cost": 0.35,        # Lower cost is better (increased weight)
            "speed": 0.15,       # Faster is better
            "reliability": 0.1, # Provider reliability bonus
        }
        
        # Normalize values
        max_output = max(r.net_output_usd for r in routes) or 1
        min_cost = min(r.total_cost_usd for r in routes)
        max_cost = max(r.total_cost_usd for r in routes) or 1
        min_time = min(r.execution_time_seconds for r in routes)
        max_time = max(r.execution_time_seconds for r in routes) or 1
        
        # Provider reliability scores (based on uptime and success rates)
        reliability = {
            "cctp": 0.98,       # Circle's native protocol - very reliable
            "across": 0.95,     # Intent-based, relayer-backed
            "wormhole": 0.90,   # Guardian network
            "lifi": 0.88,       # Aggregator
            "jupiter": 0.95,    # Solana native
            "layerzero": 0.85,  # Cross-chain messaging
        }
        
        for route in routes:
            # Output score (0-1, higher is better)
            output_score = route.net_output_usd / max_output if max_output else 0
            
            # Cost score (0-1, lower cost = higher score)
            if max_cost == min_cost:
                cost_score = 1
            else:
                cost_score = 1 - (route.total_cost_usd - min_cost) / (max_cost - min_cost)
            
            # Speed score (0-1, faster = higher score)
            if max_time == min_time:
                speed_score = 1
            else:
                speed_score = 1 - (route.execution_time_seconds - min_time) / (max_time - min_time)
            
            # Reliability score
            rel_score = reliability.get(route.provider, 0.8)
            
            # Calculate final score
            route.score = (
                weights["output"] * output_score +
                weights["cost"] * cost_score +
                weights["speed"] * speed_score +
                weights["reliability"] * rel_score
            )
        
        return routes
    
    def format_routes_comparison(self, routes: List[RouteOption]) -> str:
        """Format routes for display."""
        if not routes:
            return "❌ No routes found"
        
        lines = ["🔀 *Route Comparison*\n"]
        
        for i, route in enumerate(routes, 1):
            is_best = i == 1
            badge = "👑 *BEST*" if is_best else f"#{i}"
            
            time_str = f"{route.execution_time_seconds // 60}m" if route.execution_time_seconds >= 60 else f"{route.execution_time_seconds}s"
            
            # Show special badge for cheapest routes
            cost_badge = ""
            if route.provider == "cctp":
                cost_badge = " 💰 $0 bridge fee"
            elif route.provider == "across":
                cost_badge = " ⚡ ~0.04% fee"
            
            lines.append(
                f"{badge} *{route.provider_display}*{cost_badge}\n"
                f"   Output: {route.to_amount_human:.4f} {route.to_token}\n"
                f"   Cost: ${route.total_cost_usd:.2f} | Time: ~{time_str}\n"
                f"   Net: ${route.net_output_usd:.2f}"
            )
            
            if i < len(routes):
                lines.append("")
        
        return "\n".join(lines)
    
    def get_cheapest_route(self, routes: List[RouteOption]) -> Optional[RouteOption]:
        """Get the route with the lowest total cost."""
        if not routes:
            return None
        return min(routes, key=lambda r: r.total_cost_usd)
    
    def get_fastest_route(self, routes: List[RouteOption]) -> Optional[RouteOption]:
        """Get the route with the fastest execution time."""
        if not routes:
            return None
        return min(routes, key=lambda r: r.execution_time_seconds)


# Global instance
smart_router = SmartRouter()
