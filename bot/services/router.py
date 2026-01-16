"""Smart routing service - compares providers and finds best routes.

Routing Priority (for maximum user value):
1. CoW Protocol - Same-chain EVM swaps (MEV protection, P2P matching = zero fees)
2. Socket - Super-aggregator (compares ALL bridges + DEXes)
3. Jupiter + Jito - Solana swaps with MEV protection
4. Circle CCTP - Cross-chain USDC (zero bridge fee)
5. Across Protocol - Fast EVM bridges (~0.04% fee)
6. Wormhole - Solana <-> EVM bridges
7. Li.Fi - Aggregated fallback
8. LayerZero/Stargate - Same-token bridges
"""

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
from bot.services.cow_api import CoWProtocolAPI, cow_api
from bot.services.socket_api import SocketAPI, socket_api
from bot.services.jito_api import JitoAPI, jito_api, TipPriority
from bot.services.price_service import price_service
from bot.config.chains import get_chain_by_name
from bot.config.tokens import get_token_decimals, get_token_address

logger = logging.getLogger(__name__)


@dataclass
class RouteOption:
    """A single route option from a provider."""
    provider: str  # cow, socket, jito, lifi, jupiter, layerzero, cctp, across, wormhole
    provider_display: str  # "CoW", "Socket", "Jito", "Li.Fi", "Jupiter", etc.
    
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
    
    Route selection priority (optimized for user value):
    1. CoW Protocol - Same-chain EVM (MEV protection, P2P matching = zero fees!)
    2. Socket - Super-aggregator (compares ALL bridges + DEXes)
    3. Jupiter + Jito - Solana swaps with MEV protection
    4. Circle CCTP - Cross-chain USDC (zero bridge fee)
    5. Across Protocol - Fast EVM bridges (~0.04% fee)
    6. Wormhole - Solana <-> EVM routes
    7. Li.Fi - Aggregated fallback
    8. LayerZero/Stargate - Same-token bridges
    """
    
    def __init__(self):
        # New high-value providers
        self.cow = cow_api
        self.socket = socket_api
        self.jito = jito_api
        
        # Existing providers
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
        # PRIORITY 1: CoW Protocol (MEV protection + P2P matching)
        # For same-chain EVM swaps - potential ZERO fees with P2P matching!
        # ============================================================
        if is_same_chain and not is_solana_route:
            if self.cow.is_supported_chain(from_chain):
                tasks.append(self._get_cow_route(
                    from_chain, from_token, to_token, from_amount, from_address, to_address
                ))
        
        # ============================================================
        # PRIORITY 2: Socket (Super-aggregator - compares EVERYTHING)
        # For cross-chain AND same-chain - finds absolute cheapest route
        # ============================================================
        if not is_solana_route and self.socket.is_supported_chain(from_chain):
            if self.socket.is_supported_chain(to_chain):
                tasks.append(self._get_socket_route(
                    from_chain, from_token, from_amount, to_chain, to_token,
                    from_address, to_address
                ))
        
        # ============================================================
        # PRIORITY 3: Jupiter + Jito (Solana with MEV protection)
        # ============================================================
        if is_solana_source and is_solana_dest:
            tasks.append(self._get_jupiter_jito_route(
                from_token, to_token, from_amount, from_address, slippage
            ))
        
        # ============================================================
        # PRIORITY 4: Circle CCTP (cheapest for USDC - $0 bridge fee)
        # ============================================================
        if is_usdc and not is_same_chain and self.cctp.is_supported_route(from_chain, to_chain, "USDC"):
            tasks.append(self._get_cctp_route(
                from_chain, to_chain, from_amount
            ))
        
        # ============================================================
        # PRIORITY 5: Across Protocol (cheapest for EVM-to-EVM)
        # ============================================================
        if not is_solana_route and not is_same_chain:
            if self.across.is_supported_route(from_chain, to_chain, from_token):
                tasks.append(self._get_across_route(
                    from_chain, to_chain, from_token, from_amount, from_address, to_address
                ))
        
        # ============================================================
        # PRIORITY 6: Wormhole (for Solana <-> EVM routes)
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
        # Jupiter Standard - Solana-only swaps (without Jito as fallback)
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
    
    async def _get_cow_route(
        self,
        chain: str,
        from_token: str,
        to_token: str,
        from_amount: str,
        from_address: str,
        to_address: Optional[str],
    ) -> Optional[RouteOption]:
        """Get route from CoW Protocol (MEV-protected batch auctions).
        
        CoW is special because:
        - P2P matching = potentially ZERO fees
        - Batch auctions = no MEV extraction
        - Solvers compete = best price
        - Gasless for user = protocol pays gas
        """
        try:
            # Get token addresses
            from_token_addr = get_token_address(from_token, chain)
            to_token_addr = get_token_address(to_token, chain)
            
            if not from_token_addr or not to_token_addr:
                return None
            
            quote = await self.cow.get_quote(
                chain=chain,
                from_token=from_token_addr,
                to_token=to_token_addr,
                amount=from_amount,
                from_address=from_address,
                receiver=to_address,
            )
            
            # Get USD values
            prices = await price_service.get_prices([to_token])
            to_price = prices.get(to_token.upper(), 0)
            output_usd = quote.to_amount_human * to_price
            
            # CoW fee is taken from output token, not gas
            fee_usd = quote.fee_amount_human * to_price
            
            # For CoW, user doesn't pay gas directly
            return RouteOption(
                provider="cow",
                provider_display="CoW Protocol",
                from_chain=chain,
                from_token=from_token,
                from_amount=from_amount,
                from_amount_human=int(quote.from_amount) / 1e18,  # Approximate
                to_chain=chain,
                to_token=to_token,
                to_amount=quote.to_amount,
                to_amount_human=quote.to_amount_human,
                gas_cost_usd=0,  # CoW is gasless for user!
                bridge_fee_usd=fee_usd,  # Fee from output token
                total_cost_usd=fee_usd,
                output_usd=output_usd,
                net_output_usd=output_usd - fee_usd,
                execution_time_seconds=30,  # Batch auction cycle
                raw_quote=quote.raw_quote,
            )
        except Exception as e:
            logger.debug(f"CoW route error: {e}")
            return None
    
    async def _get_socket_route(
        self,
        from_chain: str,
        from_token: str,
        from_amount: str,
        to_chain: str,
        to_token: str,
        from_address: str,
        to_address: Optional[str],
    ) -> Optional[RouteOption]:
        """Get route from Socket super-aggregator.
        
        Socket compares ALL bridges and DEXes to find the absolute cheapest route:
        - 18+ bridges (Across, Stargate, Hop, etc.)
        - 15+ DEXes (Uniswap, 1inch, etc.)
        """
        try:
            # Get token addresses
            from_token_addr = get_token_address(from_token, from_chain)
            to_token_addr = get_token_address(to_token, to_chain)
            
            if not from_token_addr or not to_token_addr:
                return None
            
            quote = await self.socket.get_quote(
                from_chain=from_chain,
                to_chain=to_chain,
                from_token=from_token_addr,
                to_token=to_token_addr,
                from_amount=from_amount,
                from_address=from_address,
                to_address=to_address,
            )
            
            if not quote.best_route:
                return None
            
            route = quote.best_route
            
            # Get USD values
            prices = await price_service.get_prices([to_token])
            to_price = prices.get(to_token.upper(), 0)
            output_usd = route.to_amount_human * to_price
            
            # Include bridge/DEX info in display
            via_info = []
            if route.bridge_name != "unknown":
                via_info.append(route.bridge_name)
            via_info.extend(route.dex_names[:2])  # Limit to 2 DEXes
            via_str = " + ".join(via_info) if via_info else ""
            display = f"Socket ({via_str})" if via_str else "Socket"
            
            return RouteOption(
                provider="socket",
                provider_display=display,
                from_chain=from_chain,
                from_token=from_token,
                from_amount=from_amount,
                from_amount_human=int(route.from_amount) / 1e18,  # Approximate
                to_chain=to_chain,
                to_token=to_token,
                to_amount=route.to_amount,
                to_amount_human=route.to_amount_human,
                gas_cost_usd=route.gas_usd,
                bridge_fee_usd=route.service_fee_usd,
                total_cost_usd=route.total_fee_usd,
                output_usd=output_usd,
                net_output_usd=output_usd - route.total_fee_usd,
                execution_time_seconds=route.estimated_time_seconds,
                raw_quote=route.raw_route,
            )
        except Exception as e:
            logger.debug(f"Socket route error: {e}")
            return None
    
    async def _get_jupiter_jito_route(
        self,
        from_token: str,
        to_token: str,
        from_amount: str,
        from_address: str,
        slippage: float,
    ) -> Optional[RouteOption]:
        """Get route from Jupiter with Jito MEV protection.
        
        This combines Jupiter's DEX aggregation with Jito's MEV protection:
        - Jupiter finds the best swap route
        - Jito submits as bundle to prevent sandwich attacks
        """
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
            
            # Jito tip cost (dynamic based on swap size)
            tip_info = await self.jito.get_tip_info()
            swap_usd = from_amount_human * prices.get(from_token, 1)
            tip_lamports = self.jito.calculate_dynamic_tip(swap_usd, tip_info)
            tip_sol = tip_lamports / 1e9
            sol_price = prices.get("SOL", 100)
            tip_usd = tip_sol * sol_price
            
            # Total cost = Solana tx fee + Jito tip
            total_cost = 0.001 + tip_usd  # ~0.001 USD base fee
            
            return RouteOption(
                provider="jito",
                provider_display="Jupiter + Jito",
                from_chain="solana",
                from_token=from_token,
                from_amount=from_amount,
                from_amount_human=from_amount_human,
                to_chain="solana",
                to_token=to_token,
                to_amount=quote.out_amount,
                to_amount_human=to_amount_human,
                gas_cost_usd=0.001 + tip_usd,
                bridge_fee_usd=0,
                total_cost_usd=total_cost,
                output_usd=output_usd,
                net_output_usd=output_usd - total_cost,
                execution_time_seconds=3,  # Jito bundles are fast
                raw_quote={
                    "jupiter_quote": quote.raw_data if hasattr(quote, 'raw_data') else {},
                    "jito_tip": tip_lamports,
                    "mev_protected": True,
                },
            )
        except Exception as e:
            logger.debug(f"Jupiter+Jito route error: {e}")
            return None
    
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
            "output": 0.35,      # Higher output is better
            "cost": 0.35,        # Lower cost is better
            "speed": 0.15,       # Faster is better
            "reliability": 0.1,  # Provider reliability bonus
            "mev_protection": 0.05,  # MEV protection bonus
        }
        
        # Normalize values
        max_output = max(r.net_output_usd for r in routes) or 1
        min_cost = min(r.total_cost_usd for r in routes)
        max_cost = max(r.total_cost_usd for r in routes) or 1
        min_time = min(r.execution_time_seconds for r in routes)
        max_time = max(r.execution_time_seconds for r in routes) or 1
        
        # Provider reliability scores (based on uptime and success rates)
        reliability = {
            "cow": 0.95,        # CoW Protocol - battle-tested
            "socket": 0.92,     # Socket aggregator
            "jito": 0.97,       # Jito - Solana MEV protection
            "cctp": 0.98,       # Circle's native protocol - very reliable
            "across": 0.95,     # Intent-based, relayer-backed
            "wormhole": 0.90,   # Guardian network
            "lifi": 0.88,       # Aggregator
            "jupiter": 0.95,    # Solana native
            "layerzero": 0.85,  # Cross-chain messaging
        }
        
        # MEV protection scores
        mev_protection = {
            "cow": 1.0,         # Full MEV protection (batch auctions)
            "jito": 1.0,        # Full MEV protection (bundles)
            "socket": 0.3,      # Some routes may have MEV exposure
            "cctp": 0.8,        # Protocol-level, less MEV exposure
            "across": 0.7,      # Intent-based, partial protection
            "wormhole": 0.5,    # Cross-chain, moderate exposure
            "lifi": 0.3,        # Depends on underlying route
            "jupiter": 0.2,     # No inherent MEV protection
            "layerzero": 0.5,   # Cross-chain, moderate exposure
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
            
            # MEV protection score
            mev_score = mev_protection.get(route.provider, 0.3)
            
            # Calculate final score
            route.score = (
                weights["output"] * output_score +
                weights["cost"] * cost_score +
                weights["speed"] * speed_score +
                weights["reliability"] * rel_score +
                weights["mev_protection"] * mev_score
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
            
            # Show special badge for route features
            feature_badge = ""
            if route.provider == "cow":
                feature_badge = " 🛡️ MEV Protected"
            elif route.provider == "jito":
                feature_badge = " 🛡️ MEV Protected"
            elif route.provider == "socket":
                feature_badge = " 🔍 Super-Aggregated"
            elif route.provider == "cctp":
                feature_badge = " 💰 $0 bridge fee"
            elif route.provider == "across":
                feature_badge = " ⚡ ~0.04% fee"
            
            lines.append(
                f"{badge} *{route.provider_display}*{feature_badge}\n"
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
