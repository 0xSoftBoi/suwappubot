"""Gas price tracking and estimation."""

import asyncio
import aiohttp
import logging
from typing import Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)

from bot.config.settings import settings
from bot.config.chains import CHAINS, ChainType, get_chain_by_name
from bot.services.rpc_manager import rpc_manager
from bot.utils.cache import gas_cache, cached
from bot.utils.retry import async_retry


@dataclass
class GasPrice:
    """Gas price information for a chain."""

    chain: str
    slow: float  # Gwei
    standard: float
    fast: float
    instant: float
    base_fee: Optional[float] = None

    def get_usd_estimate(self, gas_limit: int, native_price_usd: float) -> dict:
        """Get USD estimates for different speeds."""
        gwei_to_eth = 1e-9
        return {
            "slow": gas_limit * self.slow * gwei_to_eth * native_price_usd,
            "standard": gas_limit * self.standard * gwei_to_eth * native_price_usd,
            "fast": gas_limit * self.fast * gwei_to_eth * native_price_usd,
            "instant": gas_limit * self.instant * gwei_to_eth * native_price_usd,
        }


class GasTracker:
    """Track gas prices across chains."""

    # Typical gas limits for different operations
    GAS_LIMITS = {
        "erc20_transfer": 65000,
        "erc20_approve": 50000,
        "swap_simple": 150000,
        "swap_complex": 300000,
        "cross_chain_swap": 500000,
    }

    async def get_evm_gas_price(self, chain_name: str) -> Optional[GasPrice]:
        """Get current gas prices for an EVM chain."""
        cache_key = f"gas_{chain_name}"

        # Check cache first
        cached_price = await gas_cache.get(cache_key)
        if cached_price:
            return cached_price

        chain = get_chain_by_name(chain_name)
        if not chain or chain.chain_type != ChainType.EVM:
            return None

        try:
            rpc_url = rpc_manager.get_rpc_url(chain_name)
            if not rpc_url:
                return None

            # Total timeout so a slow/hanging RPC can't block callers that
            # race this alongside other quote providers (e.g. OKX/1inch/0x's
            # real-gas computation in swap_engine._real_gas_cost_usd) past
            # their own FAST_TIMEOUT — an unbounded session here used to be
            # able to push the whole race out of its fast path.
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=2.0)) as session:
                # Get gas price from RPC
                payload = {"jsonrpc": "2.0", "method": "eth_gasPrice", "params": [], "id": 1}
                async with session.post(rpc_url, json=payload) as resp:
                    result = await resp.json()
                    if "result" in result:
                        gas_wei = int(result["result"], 16)
                        gas_gwei = gas_wei / 1e9

                        # Estimate different speeds based on current price
                        gas_price = GasPrice(
                            chain=chain_name,
                            slow=gas_gwei * 0.8,
                            standard=gas_gwei,
                            fast=gas_gwei * 1.2,
                            instant=gas_gwei * 1.5,
                        )

                        # Try to get base fee for EIP-1559 chains
                        try:
                            block_payload = {
                                "jsonrpc": "2.0",
                                "method": "eth_getBlockByNumber",
                                "params": ["latest", False],
                                "id": 2,
                            }
                            async with session.post(rpc_url, json=block_payload) as block_resp:
                                block_result = await block_resp.json()
                                if "result" in block_result and block_result["result"]:
                                    base_fee_hex = block_result["result"].get("baseFeePerGas")
                                    if base_fee_hex:
                                        gas_price.base_fee = int(base_fee_hex, 16) / 1e9
                        except Exception as e:
                            logger.debug(f"Failed to fetch base fee for {chain_name}: {e}")

                        # Cache the result
                        await gas_cache.set(cache_key, gas_price, ttl=15)
                        return gas_price

            return None
        except Exception as e:
            logger.warning(f"Failed to fetch gas price for {chain_name}: {e}")
            return None

    async def get_solana_fee(self) -> Optional[float]:
        """Get current Solana transaction fee in SOL."""
        cache_key = "gas_solana"

        cached_fee = await gas_cache.get(cache_key)
        if cached_fee:
            return cached_fee

        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as session:
                payload = {
                    "jsonrpc": "2.0",
                    "method": "getRecentPrioritizationFees",
                    "params": [],
                    "id": 1,
                }
                async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
                    result = await resp.json()
                    if "result" in result and result["result"]:
                        # Get median fee
                        fees = [f["prioritizationFee"] for f in result["result"]]
                        median_fee = sorted(fees)[len(fees) // 2]
                        fee_sol = median_fee / 1e9

                        await gas_cache.set(cache_key, fee_sol, ttl=15)
                        return fee_sol

            # Default fee if API fails
            return 0.000005  # 5000 lamports
        except Exception as e:
            logger.warning(f"Failed to fetch Solana fee: {e}")
            return 0.000005

    async def get_all_gas_prices(self) -> dict[str, GasPrice]:
        """Get gas prices for all supported chains in parallel."""
        evm_chains = [name for name, chain in CHAINS.items() if chain.chain_type == ChainType.EVM]

        # Fetch all in parallel
        tasks = [self.get_evm_gas_price(chain) for chain in evm_chains]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        gas_prices = {}
        for chain, result in zip(evm_chains, results):
            if isinstance(result, GasPrice):
                gas_prices[chain] = result

        return gas_prices

    def estimate_swap_cost(
        self,
        gas_price: GasPrice,
        native_price_usd: float,
        is_cross_chain: bool = False,
    ) -> dict:
        """Estimate swap cost in USD."""
        gas_limit = (
            self.GAS_LIMITS["cross_chain_swap"]
            if is_cross_chain
            else self.GAS_LIMITS["swap_complex"]
        )
        return gas_price.get_usd_estimate(gas_limit, native_price_usd)

    def format_gas_message(self, gas_prices: dict[str, GasPrice]) -> str:
        """Format gas prices for display."""
        lines = ["⛽ *Current Gas Prices*\n"]

        for chain_name, gas in gas_prices.items():
            chain = get_chain_by_name(chain_name)
            if chain:
                lines.append(
                    f"{chain.logo_emoji} *{chain.display_name}*: " f"{gas.standard:.1f} gwei"
                )

        return "\n".join(lines)


# Global instance
gas_tracker = GasTracker()
