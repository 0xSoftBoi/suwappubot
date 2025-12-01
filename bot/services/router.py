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
from bot.services.price_service import price_service
from bot.config.chains import get_chain_by_name

logger = logging.getLogger(__name__)


@dataclass
class RouteOption:
    """A single route option from a provider."""
    provider: str  # lifi, jupiter, layerzero
    provider_display: str  # "Li.Fi", "Jupiter", "LayerZero"
    
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
    """Smart routing engine that compares multiple providers."""
    
    def __init__(self):
        self.lifi = LiFiAPI()
        self.jupiter = JupiterAPI()
        self.layerzero = LayerZeroAPI()
    
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
        
        # Determine which providers to query
        is_solana_source = from_chain.lower() == "solana"
        is_solana_dest = to_chain.lower() == "solana"
        is_same_chain = from_chain.lower() == to_chain.lower()
        is_same_token = from_token.upper() == to_token.upper()
        
        # Li.Fi - supports most cross-chain routes
        if not (is_solana_source and is_solana_dest):  # Li.Fi doesn't do Solana<->Solana
            tasks.append(self._get_lifi_route(
                from_chain, from_token, from_amount, to_chain, to_token,
                from_address, to_address, slippage
            ))
        
        # Jupiter - Solana only
        if is_solana_source and is_solana_dest:
            tasks.append(self._get_jupiter_route(
                from_token, to_token, from_amount, from_address, slippage
            ))
        
        # LayerZero/Stargate - best for same stablecoin cross-chain
        if not is_same_chain and is_same_token and self._is_stargate_supported(from_chain, to_chain, from_token):
            tasks.append(self._get_layerzero_route(
                from_chain, from_token, from_amount, to_chain, to_token,
                from_address, to_address
            ))
        
        # Gather all quotes
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, Exception):
                logger.error(f"Route fetch error: {result}")
                continue
            if result:
                routes.append(result)
        
        # Score and sort routes
        routes = self._score_routes(routes)
        routes.sort(key=lambda r: r.score, reverse=True)
        
        return routes
    
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
                amount_raw=from_amount,
                from_address=from_address,
                to_address=to_address,
                slippage=slippage,
            )
            
            # Get USD values
            prices = await price_service.get_prices([to_token])
            to_price = prices.get(to_token, 0)
            output_usd = quote.to_amount_human * to_price
            
            return RouteOption(
                provider="lifi",
                provider_display="Li.Fi",
                from_chain=from_chain,
                from_token=from_token,
                from_amount=from_amount,
                from_amount_human=quote.from_amount_human,
                to_chain=to_chain,
                to_token=to_token,
                to_amount=quote.to_amount,
                to_amount_human=quote.to_amount_human,
                gas_cost_usd=quote.gas_cost_usd,
                bridge_fee_usd=quote.fee_cost_usd,
                total_cost_usd=quote.total_cost_usd,
                output_usd=output_usd,
                net_output_usd=output_usd - quote.total_cost_usd,
                execution_time_seconds=quote.estimated_time,
                raw_quote=quote.raw_quote,
            )
        except Exception as e:
            logger.error(f"Li.Fi route error: {e}")
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
            output_usd = quote.to_amount_human * to_price
            
            return RouteOption(
                provider="jupiter",
                provider_display="Jupiter",
                from_chain="solana",
                from_token=from_token,
                from_amount=from_amount,
                from_amount_human=quote.from_amount_human,
                to_chain="solana",
                to_token=to_token,
                to_amount=quote.to_amount,
                to_amount_human=quote.to_amount_human,
                gas_cost_usd=0.001,  # Solana fees are minimal
                bridge_fee_usd=0,
                total_cost_usd=0.001,
                output_usd=output_usd,
                net_output_usd=output_usd - 0.001,
                execution_time_seconds=5,  # Solana is fast
                raw_quote=quote.raw_quote,
            )
        except Exception as e:
            logger.error(f"Jupiter route error: {e}")
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
                from_chain=from_chain,
                to_chain=to_chain,
                from_token=from_token,
                to_token=to_token,
                amount_raw=from_amount,
                from_address=from_address,
                to_address=to_address,
            )
            
            prices = await price_service.get_prices([to_token])
            to_price = prices.get(to_token, 0)
            output_usd = quote.to_amount_human * to_price
            
            return RouteOption(
                provider="layerzero",
                provider_display="LayerZero",
                from_chain=from_chain,
                from_token=from_token,
                from_amount=from_amount,
                from_amount_human=quote.from_amount_human,
                to_chain=to_chain,
                to_token=to_token,
                to_amount=quote.to_amount,
                to_amount_human=quote.to_amount_human,
                gas_cost_usd=quote.gas_cost_usd,
                bridge_fee_usd=quote.fee_cost_usd,
                total_cost_usd=quote.total_cost_usd,
                output_usd=output_usd,
                net_output_usd=output_usd - quote.total_cost_usd,
                execution_time_seconds=quote.estimated_time,
                raw_quote=quote.raw_quote,
            )
        except Exception as e:
            logger.error(f"LayerZero route error: {e}")
            return None
    
    def _is_stargate_supported(self, from_chain: str, to_chain: str, token: str) -> bool:
        """Check if route is supported by Stargate."""
        supported_chains = {"ethereum", "polygon", "bsc", "arbitrum", "optimism", "base"}
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
            "output": 0.5,      # Higher output is better
            "cost": 0.25,       # Lower cost is better
            "speed": 0.15,      # Faster is better
            "reliability": 0.1, # Provider reliability bonus
        }
        
        # Normalize values
        max_output = max(r.net_output_usd for r in routes) or 1
        min_cost = min(r.total_cost_usd for r in routes)
        max_cost = max(r.total_cost_usd for r in routes) or 1
        min_time = min(r.execution_time_seconds for r in routes)
        max_time = max(r.execution_time_seconds for r in routes) or 1
        
        # Provider reliability scores
        reliability = {
            "lifi": 0.9,
            "jupiter": 0.95,
            "layerzero": 0.85,
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
            
            lines.append(
                f"{badge} *{route.provider_display}*\n"
                f"   Output: {route.to_amount_human:.4f} {route.to_token}\n"
                f"   Cost: ${route.total_cost_usd:.2f} | Time: ~{time_str}\n"
                f"   Net: ${route.net_output_usd:.2f}"
            )
            
            if i < len(routes):
                lines.append("")
        
        return "\n".join(lines)


# Global instance
smart_router = SmartRouter()

