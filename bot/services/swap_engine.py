"""Swap engine with multi-aggregator best-quote comparison.

Eligible providers are raced in parallel — the best output amount wins.

Providers:
- Jupiter + Jito: Solana swaps with MEV protection
- SunSwap V2: TRON on-chain DEX
- OKX DEX: Multi-chain aggregator (TRON, EVM, Solana) — 400+ DEXes
- Li.Fi: Cross-chain & EVM aggregator
- LayerZero/Stargate: Same-token cross-chain bridges
- CoW Protocol: MEV-protected EVM batch auctions
- Socket: Super-aggregated cross-chain routing
- Circle CCTP: Native USDC bridging
- Across Protocol: Fast EVM bridges
- Wormhole: Solana <-> EVM bridging
- Chainlink CCIP: Cross-chain messaging
"""

import asyncio
import logging
from typing import Optional, List
from dataclasses import dataclass, field
from datetime import datetime, timezone
from web3 import Web3
import aiohttp
import base64

from bot.config.settings import settings
from bot.services.rpc_manager import rpc_manager
from bot.utils.cache import quote_cache
from bot.utils.performance import track_time, MetricNames
from bot.config.chains import CHAINS, ChainType, get_chain_by_name
from bot.config.tokens import get_token_address, get_token_decimals, NATIVE_TOKEN_ADDRESS
from bot.services.lifi_api import LiFiAPI, LiFiQuote, LiFiError
from bot.services.jupiter_api import JupiterAPI, JupiterQuote, JupiterError
from bot.services.layerzero_api import LayerZeroAPI, LayerZeroQuote, LayerZeroError
from bot.services.ccip_api import ChainlinkCCIPAPI, CCIPQuote, CCIPError
from bot.services.cctp_api import CircleCCTPAPI, CCTPQuote, CCTPError
from bot.services.across_api import AcrossAPI, AcrossQuote, AcrossError
from bot.services.wormhole_api import WormholeAPI, WormholeQuote, WormholeError
from bot.services.cow_api import CoWProtocolAPI, cow_api, CoWError
from bot.services.socket_api import SocketAPI, socket_api, SocketError
from bot.services.jito_api import JitoAPI, jito_api, JitoError, TipPriority
from bot.services.sunswap_api import SunSwapAPI, SunSwapQuote, SunSwapError
from bot.services.tempo_dex_api import TempoDexAPI, tempo_dex_api
from bot.services.okx_dex_api import OKXDEXAPI, OKXDEXQuote, OKXDEXError, OKX_CHAIN_IDS
from bot.utils.http_client import get_session as get_http_session
from bot.services.tax_export import TaxExportService
from bot.services.token_security.simulation import simulation_service
from bot.services.x402_service import x402_service
from bot.services.wallet import WalletService
from bot.models.subscription import SubscriptionTier
from bot.models.user import Wallet
from bot.models.swap import SwapTransaction, SwapStatus
from bot.utils.quote_validator import quote_validator
from bot.utils.exceptions import SwapError
from bot.services.event_bus import event_bus
from database.db import get_session, run_in_db

logger = logging.getLogger(__name__)

# Try to import C++ core for performance
try:
    import suwappu_core
    USE_CPP_CORE = True
    logger.info("Using C++ core for high-performance math operations")
except ImportError:
    USE_CPP_CORE = False
    logger.info("C++ core not available, using Python fallback")


@dataclass
class SwapQuote:
    """Unified swap quote from any provider."""
    provider: str  # "cow", "socket", "jito", "lifi", "jupiter", "layerzero", "ccip", etc.
    from_chain: str
    to_chain: str
    from_token: str
    to_token: str
    from_amount: str
    from_amount_human: float
    to_amount: str
    to_amount_human: float
    to_amount_min: str
    gas_cost_usd: float
    fee_cost_usd: float
    total_cost_usd: float
    estimated_time: int  # seconds
    price_impact: float
    exchange_rate: float
    raw_quote: dict  # Original quote data for execution
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))  # When quote was created
    expires_in: int = 30  # Quote expires in seconds


def _parse_int(value, default: int = 0) -> int:
    """Parse an integer value that may be hex string or int."""
    if value is None:
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        # Use C++ core if available for faster parsing
        if USE_CPP_CORE:
            return suwappu_core.parse_int(value, default)
        value = value.strip()
        if value.startswith("0x") or value.startswith("0X"):
            return int(value, 16)
        return int(value)
    return default


class SwapEngine:
    """Engine for executing swaps via multiple providers with intelligent routing.

    Supports:
    - CoW Protocol: MEV-protected batch auctions with P2P matching
    - Socket: Super-aggregated routing across all bridges + DEXes
    - Jito: Solana MEV protection via bundle submission
    - SunSwap V2: TRON on-chain DEX swaps
    - Li.Fi: Cross-chain aggregator
    - Jupiter: Solana DEX aggregator
    - Circle CCTP: Native USDC bridging (zero fee)
    - Across: Fast EVM bridges
    - Wormhole: Solana <-> EVM bridging
    - LayerZero/Stargate: Same-token bridges
    - Chainlink CCIP: Cross-chain messaging
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
        self.ccip = ChainlinkCCIPAPI()
        self.cctp = CircleCCTPAPI()
        self.across = AcrossAPI()
        self.wormhole = WormholeAPI()
        self.sunswap = SunSwapAPI()
        self.okx_dex = OKXDEXAPI()
        self.wallet_service = WalletService()
        self._wallet_locks: dict[int, asyncio.Lock] = {}  # Per-wallet locks
        self._wallet_locks_max = 1000  # Cap to prevent unbounded growth

    async def _get_wallet_for_signing(self, wallet_data) -> Wallet:
        """Get Wallet model object for signing operations."""
        # Already a Wallet object
        if isinstance(wallet_data, Wallet):
            return wallet_data

        wallet_id = wallet_data.get("id") or wallet_data.get("wallet_id")
        if wallet_id:
            def _get_by_id():
                with get_session() as session:
                    return session.query(Wallet).filter(Wallet.id == wallet_id).first()
            wallet = await run_in_db(_get_by_id)
            if wallet:
                return wallet
        # Fallback: lookup by address
        address = wallet_data.get("address")
        if address:
            def _get_by_addr():
                with get_session() as session:
                    return session.query(Wallet).filter(Wallet.address == address).first()
            return await run_in_db(_get_by_addr)
        return None

    def _is_solana_only_swap(self, from_chain: str, to_chain: str) -> bool:
        """Check if this is a Solana-to-Solana swap (use Jupiter)."""
        return from_chain == "solana" and to_chain == "solana"

    def _is_tron_only_swap(self, from_chain: str, to_chain: str) -> bool:
        """Check if this is a TRON-to-TRON swap (use SunSwap V2)."""
        return from_chain.lower() == "tron" and to_chain.lower() == "tron"

    def _is_tempo_only_swap(self, from_chain: str, to_chain: str) -> bool:
        """Check if this is a Tempo-to-Tempo swap (use Tempo Enshrined DEX)."""
        return from_chain.lower() == "tempo" and to_chain.lower() == "tempo"

    def _is_tron_cross_chain(self, from_chain: str, to_chain: str) -> bool:
        """Check if TRON is involved in a cross-chain swap (not yet supported)."""
        chains = (from_chain.lower(), to_chain.lower())
        return "tron" in chains and chains[0] != chains[1]

    def _is_ccip_route(self, from_chain: str, to_chain: str, from_token: str, to_token: str) -> bool:
        """Check if this route can use Chainlink CCIP (same token cross-chain EVM)."""
        # CCIP is for same-token transfers across EVM chains
        if from_token != to_token:
            return False
        
        # Check if CCIP supports this route
        return self.ccip.is_supported_route(from_chain, to_chain, from_token)
    
    def _is_layerzero_route(self, from_chain: str, to_chain: str, from_token: str, to_token: str) -> bool:
        """Check if this route can use LayerZero/Stargate (same stablecoin cross-chain)."""
        # LayerZero is good for same-token cross-chain transfers
        if from_token != to_token:
            return False
        return self.layerzero.is_supported_route(from_chain, to_chain, from_token)
    
    def _get_token_amount_raw(self, amount: float, token_symbol: str, chain_name: str) -> str:
        """Convert human-readable amount to raw amount string."""
        decimals = get_token_decimals(token_symbol, chain_name)
        # Use C++ core if available for faster conversion
        if USE_CPP_CORE:
            return suwappu_core.to_raw_amount(amount, decimals)
        raw = int(amount * (10 ** decimals))
        return str(raw)
    
    def _get_token_amount_human(self, amount_raw: str, token_symbol: str, chain_name: str) -> float:
        """Convert raw amount to human-readable float."""
        decimals = get_token_decimals(token_symbol, chain_name)
        # Use C++ core if available for faster conversion
        if USE_CPP_CORE:
            return suwappu_core.to_human_amount(amount_raw, decimals)
        return int(amount_raw) / (10 ** decimals)
    
    async def _gather_quotes(self, tasks: list) -> list:
        """Run quote tasks in parallel, return successful SwapQuote results."""
        results = await asyncio.gather(*tasks, return_exceptions=True)
        quotes = []
        for r in results:
            if isinstance(r, SwapQuote):
                quotes.append(r)
            elif isinstance(r, Exception):
                logger.warning(f"Quote provider failed: {r}")
        return quotes

    @staticmethod
    def _extract_quotes(done_set) -> list:
        """Extract successful SwapQuote results from asyncio.wait done-set."""
        results = []
        for t in done_set:
            if t.cancelled():
                continue
            exc = t.exception()
            if exc:
                logger.warning(f"Quote provider failed: {exc}")
                continue
            r = t.result()
            if isinstance(r, SwapQuote):
                results.append(r)
        return results

    @track_time(MetricNames.SWAP_QUOTE)
    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        from_address: str,
        to_address: Optional[str] = None,
        slippage: float = 0.5,
    ) -> SwapQuote:
        """
        Get the best swap quote by racing all eligible providers in parallel.

        Args:
            from_chain: Source chain name
            to_chain: Destination chain name
            from_token: Source token symbol (e.g., "USDT")
            to_token: Destination token symbol
            amount: Amount to swap (human-readable)
            from_address: Sender wallet address
            to_address: Receiver wallet address (defaults to from_address)
            slippage: Slippage tolerance as percentage

        Returns:
            SwapQuote with best output amount from all providers
        """
        # Check quote cache
        cache_key = f"quote:{from_chain}:{to_chain}:{from_token}:{to_token}:{amount}:{slippage}"
        cached = await quote_cache.get(cache_key)
        if cached is not None:
            return cached

        if self._is_tron_cross_chain(from_chain, to_chain):
            raise SwapError("Cross-chain swaps from/to TRON are not yet supported. Phase 2 will add TRON bridging.")

        amount_raw = self._get_token_amount_raw(amount, from_token, from_chain)
        slippage_bps = int(slippage * 100)

        # Build list of eligible quote fetchers to race in parallel
        tasks = []

        if self._is_tempo_only_swap(from_chain, to_chain):
            tasks.append(self._get_tempo_dex_quote(
                from_token, to_token, amount, amount_raw
            ))

        if self._is_solana_only_swap(from_chain, to_chain):
            tasks.append(self._get_jupiter_quote(
                from_token, to_token, amount, amount_raw, from_address, slippage_bps
            ))

        if self._is_tron_only_swap(from_chain, to_chain):
            tasks.append(self._get_sunswap_quote(
                from_token, to_token, amount, amount_raw, slippage_bps
            ))

        # OKX DEX covers TRON, EVM, and Solana (same-chain only) — add if configured
        if self.okx_dex.is_configured and from_chain.lower() == to_chain.lower():
            tasks.append(self._get_okx_dex_quote(
                from_chain, to_chain, from_token, to_token,
                amount, amount_raw, from_address, slippage
            ))

        # EVM routing: Li.Fi + LayerZero (not for Solana-only, TRON-only, or Tempo-only)
        if not self._is_solana_only_swap(from_chain, to_chain) and not self._is_tron_only_swap(from_chain, to_chain) and not self._is_tempo_only_swap(from_chain, to_chain):
            if self._is_layerzero_route(from_chain, to_chain, from_token, to_token):
                tasks.append(self._get_layerzero_quote(
                    from_chain, to_chain, from_token, amount, amount_raw,
                    from_address, slippage
                ))
            tasks.append(self._get_lifi_quote(
                from_chain, to_chain, from_token, to_token,
                amount, amount_raw, from_address, to_address, slippage
            ))

        # Adaptive timeout: 3s fast path, extend to 8s total if no fast results
        FAST_TIMEOUT = 3.0
        EXTENDED_TIMEOUT = 5.0  # additional seconds (8s total)

        wrapped_tasks = [asyncio.ensure_future(t) for t in tasks]
        quotes = []

        if wrapped_tasks:
            done, pending = await asyncio.wait(wrapped_tasks, timeout=FAST_TIMEOUT)
            quotes = self._extract_quotes(done)

            if not quotes and pending:
                logger.info("No quotes in %.0fs fast path, extending to %.0fs for %d pending providers",
                            FAST_TIMEOUT, FAST_TIMEOUT + EXTENDED_TIMEOUT, len(pending))
                done2, still_pending = await asyncio.wait(pending, timeout=EXTENDED_TIMEOUT)
                quotes = self._extract_quotes(done2)
                # Cancel and await remaining tasks to prevent connection leaks
                for t in still_pending:
                    t.cancel()
                if still_pending:
                    await asyncio.gather(*still_pending, return_exceptions=True)
            elif pending:
                for t in pending:
                    t.cancel()
                await asyncio.gather(*pending, return_exceptions=True)

        if not quotes:
            raise SwapError("No provider returned a valid quote. Please try again.")

        best = max(quotes, key=lambda q: q.to_amount_human)
        if len(quotes) > 1:
            logger.info(
                f"Best quote: {best.provider} ({best.to_amount_human:.6f} {best.to_token}) "
                f"from {len(quotes)} providers"
            )

        await quote_cache.set(cache_key, best)
        return best
    
    async def _get_lifi_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        to_address: Optional[str],
        slippage: float,
    ) -> SwapQuote:
        """Get quote from Li.Fi for cross-chain or EVM swaps."""
        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, to_chain)
        
        if not from_token_address or not to_token_address:
            raise SwapError(f"Token not supported: {from_token} on {from_chain} or {to_token} on {to_chain}")
        
        quote = await self.lifi.get_quote(
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token_address,
            to_token=to_token_address,
            from_amount=amount_raw,
            from_address=from_address,
            to_address=to_address,
            slippage=slippage,
        )
        
        to_amount_human = self._get_token_amount_human(quote.to_amount, to_token, to_chain)
        to_amount_min_human = self._get_token_amount_human(quote.to_amount_min, to_token, to_chain)
        
        # Calculate exchange rate
        exchange_rate = to_amount_human / amount if amount > 0 else 0
        
        return SwapQuote(
            provider="lifi",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=quote.to_amount,
            to_amount_human=to_amount_human,
            to_amount_min=quote.to_amount_min,
            gas_cost_usd=quote.gas_cost_usd,
            fee_cost_usd=quote.fee_cost_usd,
            total_cost_usd=quote.gas_cost_usd + quote.fee_cost_usd,
            estimated_time=quote.estimated_time,
            price_impact=0,  # Li.Fi doesn't always provide this
            exchange_rate=exchange_rate,
            raw_quote=quote.raw_response,
        )
    
    async def _get_jupiter_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage_bps: int,
    ) -> SwapQuote:
        """Get quote from Jupiter for Solana swaps."""
        from_token_address = get_token_address(from_token, "solana")
        to_token_address = get_token_address(to_token, "solana")
        
        if not from_token_address or not to_token_address:
            raise SwapError(f"Token not supported on Solana: {from_token} or {to_token}")
        
        quote = await self.jupiter.get_quote(
            input_mint=from_token_address,
            output_mint=to_token_address,
            amount=amount_raw,
            slippage_bps=slippage_bps,
        )
        
        to_amount_human = self._get_token_amount_human(quote.out_amount, to_token, "solana")
        
        # Calculate exchange rate
        exchange_rate = to_amount_human / amount if amount > 0 else 0
        
        return SwapQuote(
            provider="jupiter",
            from_chain="solana",
            to_chain="solana",
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=quote.out_amount,
            to_amount_human=to_amount_human,
            to_amount_min=quote.other_amount_threshold,
            gas_cost_usd=0.001,  # Approximate Solana tx fee
            fee_cost_usd=0,
            total_cost_usd=0.001,
            estimated_time=30,  # Solana is fast
            price_impact=quote.price_impact_pct,
            exchange_rate=exchange_rate,
            raw_quote=quote.raw_response,
        )

    async def _get_sunswap_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        slippage_bps: int,
    ) -> SwapQuote:
        """Get quote from SunSwap V2 for TRON on-chain swaps."""
        from_token_address = get_token_address(from_token, "tron")
        to_token_address = get_token_address(to_token, "tron")

        if not from_token_address or not to_token_address:
            raise SwapError(f"Token not supported on TRON: {from_token} or {to_token}")

        quote = await self.sunswap.get_quote(
            from_token=from_token_address,
            to_token=to_token_address,
            amount_raw=amount_raw,
            slippage_bps=slippage_bps,
        )

        to_amount_human = self._get_token_amount_human(quote.amount_out, to_token, "tron")
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        return SwapQuote(
            provider="sunswap",
            from_chain="tron",
            to_chain="tron",
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=quote.amount_out,
            to_amount_human=to_amount_human,
            to_amount_min=quote.amount_out_min,
            gas_cost_usd=6.0,  # ~20 TRX energy cost for swap
            fee_cost_usd=0,
            total_cost_usd=6.0,
            estimated_time=6,  # TRON block time ~3s, 2 confirmations
            price_impact=quote.price_impact,
            exchange_rate=exchange_rate,
            raw_quote=quote.raw_response,
        )

    async def _get_tempo_dex_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
    ) -> SwapQuote:
        """Get quote from Tempo Enshrined DEX for same-chain stablecoin swaps."""
        if not tempo_dex_api.is_supported_pair(from_token, to_token):
            raise SwapError(f"Tempo DEX does not support pair: {from_token}/{to_token}")

        quote = await tempo_dex_api.get_quote(
            token_in=from_token,
            token_out=to_token,
            amount_in=int(amount_raw),
        )

        to_amount_human = quote.amount_out_human
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        return SwapQuote(
            provider="tempo_dex",
            from_chain="tempo",
            to_chain="tempo",
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=str(quote.amount_out),
            to_amount_human=to_amount_human,
            to_amount_min=str(quote.amount_out),  # enshrined DEX has minimal slippage
            gas_cost_usd=0.01,  # Tempo payment lane has near-zero gas
            fee_cost_usd=0,
            total_cost_usd=0.01,
            estimated_time=2,  # Tempo block time ~2s
            price_impact=quote.price_impact,
            exchange_rate=exchange_rate,
            raw_quote={
                "token_in": quote.token_in_address,
                "token_out": quote.token_out_address,
                "amount_in": quote.amount_in,
                "amount_out": quote.amount_out,
            },
        )

    async def _get_okx_dex_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage: float,
    ) -> SwapQuote:
        """Get quote from OKX DEX Aggregator (TRON, EVM, Solana)."""
        chain_id = OKX_CHAIN_IDS.get(from_chain.lower())
        if not chain_id:
            raise SwapError(f"OKX DEX does not support chain: {from_chain}")

        # Same-chain only for now
        if from_chain.lower() != to_chain.lower():
            raise SwapError("OKX DEX only supports same-chain swaps")

        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, to_chain)

        if not from_token_address or not to_token_address:
            raise SwapError(f"Token not supported: {from_token} on {from_chain} or {to_token} on {to_chain}")

        # Use lightweight /quote endpoint (tx data fetched at execution time)
        quote = await self.okx_dex.get_quote(
            chain_id=chain_id,
            from_token=from_token_address,
            to_token=to_token_address,
            amount=amount_raw,
            slippage=slippage,
        )

        to_amount_human = self._get_token_amount_human(quote.to_amount, to_token, to_chain)
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        # Estimate gas cost in USD (rough: gas units * gas price)
        gas_cost_usd = 0.0
        try:
            gas_cost_usd = float(quote.estimated_gas) * 1e-9 * 2000  # Very rough ETH estimate
            if from_chain.lower() in ("bsc", "polygon", "fantom", "gnosis"):
                gas_cost_usd *= 0.01  # Much cheaper chains
            elif from_chain.lower() == "tron":
                gas_cost_usd = 6.0  # Flat estimate for TRON energy
            elif from_chain.lower() == "solana":
                gas_cost_usd = 0.001
        except (ValueError, TypeError):
            pass

        return SwapQuote(
            provider="okx_dex",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=quote.to_amount,
            to_amount_human=to_amount_human,
            to_amount_min=quote.to_amount_min,
            gas_cost_usd=gas_cost_usd,
            fee_cost_usd=0,
            total_cost_usd=gas_cost_usd,
            estimated_time=15,  # OKX quotes are fast
            price_impact=quote.price_impact,
            exchange_rate=exchange_rate,
            raw_quote={
                "okx_quote": quote.raw_response,
                "tx_data": quote.tx_data,
                "chain_id": chain_id,
            },
        )

    async def _get_layerzero_quote(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage: float,
    ) -> SwapQuote:
        """Get quote from LayerZero/Stargate V2 for cross-chain stablecoin transfers."""
        quote = await self.layerzero.get_quote(
            src_chain=from_chain,
            dst_chain=to_chain,
            token_symbol=token,
            amount=amount_raw,
            from_address=from_address,
            slippage=slippage,
        )

        to_amount_human = self._get_token_amount_human(quote.amount_out, token, to_chain)

        return SwapQuote(
            provider="layerzero",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=token,
            to_token=token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=quote.amount_out,
            to_amount_human=to_amount_human,
            to_amount_min=quote.amount_out_min,
            gas_cost_usd=quote.native_fee_usd,
            fee_cost_usd=0,
            total_cost_usd=quote.native_fee_usd,
            estimated_time=quote.estimated_time,
            price_impact=0,
            exchange_rate=1.0,
            raw_quote=quote.raw_data,
        )
    
    async def _get_ccip_quote(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        amount: float,
        from_address: str,
        to_address: Optional[str] = None,
    ) -> SwapQuote:
        """Get quote from Chainlink CCIP for cross-chain token transfers."""
        quote = await self.ccip.get_quote(
            from_chain=from_chain,
            to_chain=to_chain,
            token=token,
            amount=amount,
            from_address=from_address,
            to_address=to_address,
        )
        
        # Include router info in raw_quote for execution
        raw_data = quote.raw_data.copy()
        raw_data["router_address"] = quote.router_address
        raw_data["destination_chain_selector"] = quote.destination_chain_selector
        raw_data["fee_token"] = quote.fee_token
        
        return SwapQuote(
            provider="ccip",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=token,
            to_token=token,
            from_amount=quote.from_amount,
            from_amount_human=quote.from_amount_human,
            to_amount=quote.to_amount,
            to_amount_human=quote.to_amount_human,
            to_amount_min=quote.to_amount,  # CCIP is 1:1
            gas_cost_usd=quote.fee_usd,
            fee_cost_usd=0,
            total_cost_usd=quote.fee_usd,
            estimated_time=quote.estimated_time,
            price_impact=0,  # 1:1 transfer
            exchange_rate=1.0,
            raw_quote=raw_data,
        )
    
    async def get_all_quotes(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        from_address: str,
        to_address: Optional[str] = None,
        slippage: float = 0.5,
    ) -> List[SwapQuote]:
        """
        Get quotes from all available providers for comparison.

        Returns:
            List of SwapQuotes sorted by best output amount
        """
        amount_raw = self._get_token_amount_raw(amount, from_token, from_chain)
        slippage_bps = int(slippage * 100)
        tasks = []

        # Always try Li.Fi for EVM
        if not self._is_solana_only_swap(from_chain, to_chain) and not self._is_tron_only_swap(from_chain, to_chain):
            tasks.append(self._get_lifi_quote(
                from_chain, to_chain, from_token, to_token,
                amount, amount_raw, from_address, to_address, slippage
            ))

        # LayerZero for same-token cross-chain
        if self._is_layerzero_route(from_chain, to_chain, from_token, to_token):
            tasks.append(self._get_layerzero_quote(
                from_chain, to_chain, from_token, amount, amount_raw,
                from_address, slippage
            ))

        # CCIP for same-token cross-chain EVM
        if self._is_ccip_route(from_chain, to_chain, from_token, to_token):
            tasks.append(self._get_ccip_quote(
                from_chain, to_chain, from_token, amount, from_address, to_address
            ))

        # Jupiter for Solana
        if self._is_solana_only_swap(from_chain, to_chain):
            tasks.append(self._get_jupiter_quote(
                from_token, to_token, amount, amount_raw, from_address, slippage_bps
            ))

        # SunSwap for TRON
        if self._is_tron_only_swap(from_chain, to_chain):
            tasks.append(self._get_sunswap_quote(
                from_token, to_token, amount, amount_raw, slippage_bps
            ))

        # OKX DEX for all chains
        if self.okx_dex.is_configured and from_chain.lower() == to_chain.lower():
            tasks.append(self._get_okx_dex_quote(
                from_chain, to_chain, from_token, to_token,
                amount, amount_raw, from_address, slippage
            ))

        quotes = await self._gather_quotes([
            asyncio.wait_for(t, timeout=8.0) for t in tasks
        ])

        quotes.sort(key=lambda q: q.to_amount_human, reverse=True)
        return quotes
    
    @track_time(MetricNames.SWAP_EXECUTE)
    async def execute_swap(
        self,
        quote: SwapQuote,
        wallet_id: int,
        user_id: int,
        idempotency_key: Optional[str] = None,
    ) -> SwapTransaction:
        """
        Execute a swap based on a quote.
        
        Args:
            quote: SwapQuote from get_quote
            wallet_id: User's wallet ID to execute from
            user_id: Database user ID
            
        Returns:
            SwapTransaction record
            
        Raises:
            SwapError: If validation fails or swap execution fails
        """
        # Prevent concurrent swaps from same wallet (with bounded growth)
        if wallet_id not in self._wallet_locks:
            if len(self._wallet_locks) >= self._wallet_locks_max:
                # Evict unlocked entries to prevent unbounded memory growth
                to_remove = [k for k, v in self._wallet_locks.items() if not v.locked()]
                for k in to_remove[:len(to_remove) // 2]:
                    del self._wallet_locks[k]
            self._wallet_locks[wallet_id] = asyncio.Lock()
        
        async with self._wallet_locks[wallet_id]:
            # Idempotency: if we already created/submitted this attempt, return it
            if idempotency_key:
                def _check_idempotency():
                    with get_session() as session:
                        existing = session.query(SwapTransaction).filter(
                            SwapTransaction.idempotency_key == idempotency_key
                        ).first()
                        if existing and existing.status not in [
                            SwapStatus.FAILED.value,
                            SwapStatus.CANCELLED.value,
                        ]:
                            return existing
                        return None
                existing = await run_in_db(_check_idempotency)
                if existing:
                    return existing

            # Get wallet data within session
            def _get_wallet():
                with get_session() as session:
                    wallet_obj = session.query(Wallet).filter(Wallet.id == wallet_id).first()
                    if not wallet_obj:
                        return None
                    return {
                        "id": wallet_obj.id,
                        "wallet_id": wallet_obj.id,
                        "address": wallet_obj.address,
                        "chain_type": wallet_obj.chain_type,
                        "encrypted_private_key": wallet_obj.encrypted_private_key,
                    }
            wallet = await run_in_db(_get_wallet)
            if not wallet:
                raise SwapError("Wallet not found")

            wallet_address = wallet["address"]
            wallet_chain_type = wallet["chain_type"]
            wallet_encrypted_key = wallet["encrypted_private_key"]
            
            # Validate quote freshness
            quote_validator.validate_quote_freshness(quote)
            
            # Validate balance
            await quote_validator.validate_balance(
                wallet_id=wallet_id,
                quote=quote,
                wallet_service=self.wallet_service,
            )
            
            # Gas check removed — providers (Li.Fi, Stargate) handle gas
            # in cross-chain routes. On-chain failures are caught below.

            # Create transaction record
            def _create_swap_record():
                with get_session() as session:
                    swap_tx = SwapTransaction(
                        user_id=user_id,
                        from_chain=quote.from_chain,
                        from_token=quote.from_token,
                        from_amount=quote.from_amount,
                        from_amount_usd=quote.from_amount_human,
                        to_chain=quote.to_chain,
                        to_token=quote.to_token,
                        to_amount=quote.to_amount,
                        to_amount_usd=quote.to_amount_human,
                        status=SwapStatus.EXECUTING.value,
                        route_provider=quote.provider,
                        gas_fee=quote.gas_cost_usd,
                        bridge_fee=quote.fee_cost_usd,
                        idempotency_key=idempotency_key,
                    )
                    session.add(swap_tx)
                    session.flush()
                    return swap_tx.id
            swap_id = await run_in_db(_create_swap_record)
            
            # Create a simple wallet data object for signing
            wallet_data = {
                "address": wallet_address,
                "encrypted_private_key": wallet_encrypted_key,
                "chain_type": wallet_chain_type,
            }
            
            # Phase 2: Deep State Simulation (Solana Anti-Honeypot)
            if quote.from_chain == "solana" and quote.to_chain == "solana":
                tier = await x402_service.get_tier(user_id)
                if tier in [SubscriptionTier.PRO, SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE]:
                    logger.info(f"Running Deep Simulation for user {user_id} on {quote.to_token}")
                    
                    # We simulate with a small amount of SOL for the safety test
                    # Usually 0.1 SOL is enough to trigger most tax/revert logic
                    sim_amount = min(0.1, quote.from_amount_human) 
                    
                    sim_res = await simulation_service.simulate_swap_cycle(
                        token_mint=get_token_address(quote.to_token, "solana"), # Address from quote
                        amount_sol=sim_amount,
                        user_pubkey=wallet_address
                    )
                    
                    if not sim_res["is_safe"]:
                        error_msg = f"Deep Simulation Blocked: {sim_res.get('reason')} - {sim_res.get('error')}"
                        logger.warning(error_msg)
                        
                        def _mark_sim_failed():
                            with get_session() as session:
                                db_tx = session.query(SwapTransaction).filter(SwapTransaction.id == swap_id).first()
                                db_tx.status = SwapStatus.FAILED.value
                                db_tx.error_message = error_msg
                        await run_in_db(_mark_sim_failed)

                        raise SwapError(f"⚠️ Safety simulation FAILED: {sim_res.get('reason')}. Trade blocked to protect your funds.")
                    
                    logger.info(f"Deep Simulation PASSED for {quote.to_token}. Proceeding with trade.")

            try:
                # Route to appropriate execution method based on provider
                if quote.provider == "cow":
                    tx_hash = await self._execute_cow_swap(quote, wallet)
                elif quote.provider == "socket":
                    tx_hash = await self._execute_socket_swap(quote, wallet)
                elif quote.provider == "jito":
                    tx_hash = await self._execute_jito_swap(quote, wallet)
                elif quote.provider == "jupiter":
                    tx_hash = await self._execute_jupiter_swap(quote, wallet)
                elif quote.provider == "ccip":
                    tx_hash = await self._execute_ccip_swap(quote, wallet)
                elif quote.provider == "layerzero":
                    tx_hash = await self._execute_layerzero_swap(quote, wallet)
                elif quote.provider == "cctp":
                    tx_hash = await self._execute_cctp_swap(quote, wallet)
                elif quote.provider == "across":
                    tx_hash = await self._execute_across_swap(quote, wallet)
                elif quote.provider == "wormhole":
                    tx_hash = await self._execute_wormhole_swap(quote, wallet)
                elif quote.provider == "sunswap":
                    tx_hash = await self._execute_sunswap_swap(quote, wallet)
                elif quote.provider == "okx_dex":
                    tx_hash = await self._execute_okx_dex_swap(quote, wallet)
                else:
                    tx_hash = await self._execute_lifi_swap(quote, wallet)
                
                # Persist tx_hash to the database record
                def _update_tx_hash():
                    with get_session() as session:
                        db_tx = session.query(SwapTransaction).filter(SwapTransaction.id == swap_id).first()
                        if db_tx:
                            db_tx.tx_hash = tx_hash
                            db_tx.status = SwapStatus.SUBMITTED.value
                await run_in_db(_update_tx_hash)

                # Invalidate balance cache so user sees updated balance
                try:
                    from bot.utils.cache import balance_cache
                    await balance_cache.delete(f"bal:{wallet_address}:{wallet_chain_type}")
                except Exception as e:
                    logger.debug(f"Failed to invalidate balance cache: {e}")

                # Publish swap.submitted event
                await event_bus.publish("swap.submitted", {
                    "userId": user_id,
                    "swapId": swap_id,
                    "txHash": tx_hash,
                    "fromChain": quote.from_chain,
                    "toChain": quote.to_chain,
                    "provider": quote.provider,
                })

                # Clean up local references
                wallet_encrypted_key = None

                # Re-fetch the updated record to return
                def _refetch():
                    with get_session() as session:
                        return session.query(SwapTransaction).filter(SwapTransaction.id == swap_id).first()
                swap_tx = await run_in_db(_refetch)

                return swap_tx

            except Exception as e:
                logger.error(f"Swap execution failed: {e}", exc_info=True)
                # Mark as failed
                def _mark_failed():
                    with get_session() as session:
                        db_tx = session.query(SwapTransaction).filter(SwapTransaction.id == swap_id).first()
                        if db_tx:
                            db_tx.status = SwapStatus.FAILED.value
                            db_tx.error_message = str(e)
                await run_in_db(_mark_failed)

                # Publish swap.failed event
                await event_bus.publish("swap.failed", {
                    "userId": user_id,
                    "swapId": swap_id,
                    "error": str(e),
                    "fromChain": quote.from_chain,
                    "toChain": quote.to_chain,
                    "fromToken": quote.from_token,
                    "toToken": quote.to_token,
                })

                # Clean up local references
                wallet_encrypted_key = None

                raise SwapError(f"Swap execution failed: {repr(e)}")
    
    async def _execute_lifi_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via Li.Fi."""
        tx_request = quote.raw_quote.get("transactionRequest", {})

        if not tx_request:
            raise SwapError("No transaction request in quote")

        wallet = self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        chain = get_chain_by_name(quote.from_chain)

        if chain.chain_type == ChainType.SOLANA:
            # Solana transaction via Li.Fi
            tx_data = tx_request.get("data")
            if not tx_data:
                raise SwapError("No transaction data")

            tx_bytes = base64.b64decode(tx_data)
            signed_tx = await self.wallet_service.sign_solana_transaction(wallet, tx_bytes)

            # Submit to Solana
            async with aiohttp.ClientSession() as session:
                payload = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "sendTransaction",
                    "params": [
                        base64.b64encode(signed_tx).decode(),
                        {"encoding": "base64", "skipPreflight": False}
                    ]
                }
                async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
                    result = await resp.json()
                    if "error" in result:
                        raise SwapError(f"Transaction failed: {result['error']}")
                    return result["result"]
        elif chain.chain_type == ChainType.TRON:
            # TRON transaction via Li.Fi
            tx_hash = await self.wallet_service.sign_and_broadcast_tron_transaction(
                wallet, tx_request
            )
            return tx_hash
        else:
            # EVM transaction
            web3 = self.wallet_service._get_web3(quote.from_chain)
            sender = Web3.to_checksum_address(wallet_data["address"])
            nonce = web3.eth.get_transaction_count(sender)

            # ERC20 approval: if swapping a token (not native), approve the LiFi contract
            from_token_address = get_token_address(quote.from_token, quote.from_chain)
            spender = Web3.to_checksum_address(tx_request.get("to"))

            if from_token_address and from_token_address != NATIVE_TOKEN_ADDRESS:
                token_addr = Web3.to_checksum_address(from_token_address)
                erc20_abi = [
                    {"inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}], "name": "allowance", "outputs": [{"name": "", "type": "uint256"}], "type": "function", "stateMutability": "view"},
                    {"inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}], "name": "approve", "outputs": [{"name": "", "type": "bool"}], "type": "function", "stateMutability": "nonpayable"},
                ]
                token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
                amount_needed = int(quote.from_amount)
                current_allowance = token_contract.functions.allowance(sender, spender).call()

                if current_allowance < amount_needed:
                    max_approval = 2**256 - 1
                    approve_data = token_contract.functions.approve(spender, max_approval).build_transaction({
                        "from": sender,
                        "nonce": nonce,
                        "chainId": chain.chain_id,
                        "gasPrice": web3.eth.gas_price,
                    })
                    approve_tx = {
                        "to": token_addr,
                        "data": approve_data["data"],
                        "value": 0,
                        "gas": approve_data.get("gas", 60000),
                        "gasPrice": approve_data["gasPrice"],
                        "nonce": nonce,
                        "chainId": chain.chain_id,
                    }
                    signed_approve = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
                    approve_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_approve.replace("0x", "")))
                    logger.info(f"LiFi approval tx: {approve_hash.hex()}")
                    web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
                    nonce += 1

            # Re-fetch nonce to account for any approval tx or pending txs
            nonce = web3.eth.get_transaction_count(sender)

            # Build swap transaction - parse hex values from Li.Fi
            tx = {
                "to": spender,
                "data": tx_request.get("data"),
                "value": _parse_int(tx_request.get("value"), 0),
                "gas": _parse_int(tx_request.get("gasLimit"), 500000),
                "gasPrice": _parse_int(tx_request.get("gasPrice"), web3.eth.gas_price),
                "nonce": nonce,
                "chainId": chain.chain_id,
            }

            # Sign and send
            signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
            tx_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))

            return tx_hash.hex()
    
    async def _execute_jupiter_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via Jupiter."""
        wallet = self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        # Get swap transaction from Jupiter
        swap_tx = await self.jupiter.get_swap_transaction(
            quote_response=quote.raw_quote,
            user_public_key=wallet_data["address"],
        )

        # Decode and sign transaction
        tx_bytes = base64.b64decode(swap_tx.swap_transaction)
        signed_tx = await self.wallet_service.sign_solana_transaction(wallet, tx_bytes)

        # Submit to Solana
        async with aiohttp.ClientSession() as session:
            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "sendTransaction",
                "params": [
                    base64.b64encode(signed_tx).decode(),
                    {"encoding": "base64", "skipPreflight": False}
                ]
            }
            async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
                result = await resp.json()
                if "error" in result:
                    raise SwapError(f"Transaction failed: {result['error']}")
                return result["result"]
    
    async def _execute_cow_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via CoW Protocol (MEV-protected batch auction).

        CoW swaps are gasless for the user - they sign an order and CoW submits it.
        Orders may be matched P2P (zero fees) or via solvers (protocol fee from output).
        """
        wallet = self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        chain = quote.from_chain

        # Get the order data from the raw quote
        raw_quote = quote.raw_quote
        cow_quote_data = raw_quote.get("quote", {})

        # Build order data for signing
        order_data = self.cow.build_order_data(
            cow_api.CoWQuote(
                quote_id=raw_quote.get("id", ""),
                from_token=get_token_address(quote.from_token, chain),
                to_token=get_token_address(quote.to_token, chain),
                from_amount=cow_quote_data.get("sellAmount", quote.from_amount),
                to_amount=cow_quote_data.get("buyAmount", quote.to_amount),
                to_amount_human=quote.to_amount_human,
                fee_amount=cow_quote_data.get("feeAmount", "0"),
                fee_amount_human=0,
                valid_to=cow_quote_data.get("validTo", 0),
                kind=cow_quote_data.get("kind", "sell"),
                sell_token_balance=cow_quote_data.get("sellTokenBalance", "erc20"),
                buy_token_balance=cow_quote_data.get("buyTokenBalance", "erc20"),
                partially_fillable=cow_quote_data.get("partiallyFillable", False),
                receiver=wallet_data["address"],
                app_data=self.cow.app_data,
                raw_quote=raw_quote,
            )
        )

        # Get typed data for EIP-712 signing
        typed_data = self.cow.get_order_typed_data(chain, order_data)

        # Sign the order using EIP-712 via wallet service
        signature = await self.wallet_service.sign_typed_data(wallet, typed_data)

        # Submit the order to CoW
        cow_order = await self.cow.submit_order(
            chain=chain,
            quote=cow_api.CoWQuote(
                quote_id=raw_quote.get("id", ""),
                from_token=get_token_address(quote.from_token, chain),
                to_token=get_token_address(quote.to_token, chain),
                from_amount=cow_quote_data.get("sellAmount", quote.from_amount),
                to_amount=cow_quote_data.get("buyAmount", quote.to_amount),
                to_amount_human=quote.to_amount_human,
                fee_amount=cow_quote_data.get("feeAmount", "0"),
                fee_amount_human=0,
                valid_to=cow_quote_data.get("validTo", 0),
                kind=cow_quote_data.get("kind", "sell"),
                sell_token_balance=cow_quote_data.get("sellTokenBalance", "erc20"),
                buy_token_balance=cow_quote_data.get("buyTokenBalance", "erc20"),
                partially_fillable=cow_quote_data.get("partiallyFillable", False),
                receiver=wallet_data["address"],
                app_data=self.cow.app_data,
                raw_quote=raw_quote,
            ),
            signature=signature,
            from_address=wallet_data["address"],
        )

        logger.info(f"CoW order submitted: {cow_order.order_uid}")

        # Return the order UID as the "tx_hash" - it can be tracked via CoW API
        return cow_order.order_uid
    
    async def _execute_socket_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via Socket super-aggregator.

        Socket finds the absolute best route by comparing all bridges and DEXes.
        """
        from bot.services.socket_api import SocketRoute

        wallet = self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        raw_route = quote.raw_quote

        # Create a SocketRoute from the raw data
        route = SocketRoute(
            route_id=raw_route.get("routeId", ""),
            from_chain_id=self.socket.get_chain_id(quote.from_chain),
            to_chain_id=self.socket.get_chain_id(quote.to_chain),
            from_token=get_token_address(quote.from_token, quote.from_chain),
            to_token=get_token_address(quote.to_token, quote.to_chain),
            from_amount=quote.from_amount,
            to_amount=quote.to_amount,
            to_amount_human=quote.to_amount_human,
            gas_usd=quote.gas_cost_usd,
            service_fee_usd=quote.fee_cost_usd,
            total_fee_usd=quote.total_cost_usd,
            estimated_time_seconds=quote.estimated_time,
            bridge_name=raw_route.get("bridgeName", ""),
            dex_names=[],
            steps=[],
            user_tx_count=1,
            raw_route=raw_route,
        )

        # Build the transaction
        socket_tx = await self.socket.build_tx(route)

        chain = get_chain_by_name(quote.from_chain)
        web3 = rpc_manager.get_web3(quote.from_chain)

        # Check if approval is needed
        if socket_tx.approval_data:
            approval_target = socket_tx.approval_data.get("allowanceTarget", "")
            token_address = socket_tx.approval_data.get("approvalTokenAddress", "")

            if approval_target and token_address:
                # Build approval tx
                approval_tx_data = await self.socket.build_approval_tx(
                    chain=quote.from_chain,
                    token_address=token_address,
                    owner=wallet_data["address"],
                    spender=approval_target,
                    amount=quote.from_amount,
                )

                nonce = web3.eth.get_transaction_count(wallet_data["address"])
                approval_tx = {
                    "to": Web3.to_checksum_address(approval_tx_data.get("to", token_address)),
                    "data": approval_tx_data.get("data", ""),
                    "value": 0,
                    "gas": 60000,
                    "gasPrice": web3.eth.gas_price,
                    "nonce": nonce,
                    "chainId": chain.chain_id,
                }

                signed_approval_hex = await self.wallet_service.sign_evm_transaction(wallet, approval_tx)
                approval_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_approval_hex.replace("0x", "")))
                logger.info(f"Socket approval tx: {approval_hash.hex()}")

                # Wait for approval
                web3.eth.wait_for_transaction_receipt(approval_hash, timeout=120)

        # Execute the main transaction
        nonce = web3.eth.get_transaction_count(wallet_data["address"])
        tx = {
            "to": Web3.to_checksum_address(socket_tx.to),
            "data": socket_tx.data,
            "value": int(socket_tx.value) if socket_tx.value else 0,
            "gas": int(socket_tx.gas_limit),
            "gasPrice": web3.eth.gas_price,
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        tx_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))

        logger.info(f"Socket swap tx: {tx_hash.hex()}")
        return tx_hash.hex()
    
    async def _execute_jito_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a Solana swap via Jupiter with Jito MEV protection.

        Jito protects swaps from sandwich attacks by:
        1. Building a Jupiter swap transaction
        2. Adding a Jito tip instruction
        3. Submitting as a bundle to Jito block engine
        """
        wallet = self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        raw_quote = quote.raw_quote
        jupiter_quote = raw_quote.get("jupiter_quote", {})
        jito_tip = raw_quote.get("jito_tip", TipPriority.MEDIUM.value)

        # Get swap transaction from Jupiter
        swap_tx = await self.jupiter.get_swap_transaction(
            quote_response=jupiter_quote,
            user_public_key=wallet_data["address"],
        )

        try:
            # Decode and sign the transaction
            tx_bytes = base64.b64decode(swap_tx.swap_transaction)
            signed_tx_bytes = await self.wallet_service.sign_solana_transaction(wallet, tx_bytes)
            signed_tx_b64 = base64.b64encode(signed_tx_bytes).decode()

            # Submit to Jito
            bundle_id, tx_sig = await self.jito.submit_swap_bundle(
                swap_transaction=signed_tx_b64,
                tip_amount=jito_tip,
            )

            logger.info(f"Jito bundle submitted: {bundle_id}, signature: {tx_sig}")

            # Return the transaction signature
            return tx_sig if tx_sig else bundle_id

        except Exception as e:
            logger.warning(f"Jito submission failed, falling back to standard RPC: {e}")

            # Fallback to standard Jupiter execution
            tx_bytes = base64.b64decode(swap_tx.swap_transaction)
            signed_tx = await self.wallet_service.sign_solana_transaction(wallet, tx_bytes)

            async with aiohttp.ClientSession() as session:
                payload = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "sendTransaction",
                    "params": [
                        base64.b64encode(signed_tx).decode(),
                        {"encoding": "base64", "skipPreflight": False}
                    ]
                }
                async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
                    result = await resp.json()
                    if "error" in result:
                        raise SwapError(f"Transaction failed: {result['error']}")
                    return result["result"]
    
    async def _execute_ccip_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a cross-chain transfer via Chainlink CCIP."""
        from bot.services.ccip_api import CCIPQuote

        wallet = self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        # Reconstruct CCIPQuote from raw_quote data
        ccip_quote = CCIPQuote(
            from_chain=quote.from_chain,
            to_chain=quote.to_chain,
            from_token=quote.from_token,
            to_token=quote.to_token,
            from_amount=quote.from_amount,
            from_amount_human=quote.from_amount_human,
            to_amount=quote.to_amount,
            to_amount_human=quote.to_amount_human,
            fee_token=quote.raw_quote.get("message", {}).get("feeToken", "NATIVE"),
            fee_amount=quote.raw_quote.get("fee", "0"),
            fee_amount_human=0,
            fee_usd=quote.gas_cost_usd,
            estimated_time=quote.estimated_time,
            router_address=quote.raw_quote.get("router_address", ""),
            destination_chain_selector=quote.raw_quote.get("destination_chain_selector", ""),
            raw_data=quote.raw_quote,
        )

        # Build transfer transaction
        transfer_data = await self.ccip.build_transfer_tx(
            quote=ccip_quote,
            from_address=wallet_data["address"],
        )

        chain = get_chain_by_name(quote.from_chain)
        web3 = rpc_manager.get_web3(quote.from_chain)

        # First, check if we need to approve the token
        token_address = transfer_data.token_address
        approval_tx = await self.ccip.get_approval_tx(
            chain=quote.from_chain,
            token=quote.from_token,
            owner=wallet_data["address"],
            amount=int(quote.from_amount),
        )

        if approval_tx:
            # Send approval transaction
            nonce = web3.eth.get_transaction_count(wallet_data["address"])
            approval_tx["nonce"] = nonce
            approval_tx["chainId"] = chain.chain_id
            approval_tx["gasPrice"] = web3.eth.gas_price

            signed_approval_hex = await self.wallet_service.sign_evm_transaction(wallet, approval_tx)
            approval_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_approval_hex.replace("0x", "")))

            # Wait for approval
            logger.info(f"CCIP approval tx: {approval_hash.hex()}")
            web3.eth.wait_for_transaction_receipt(approval_hash, timeout=120)

        # Build CCIP transfer transaction
        nonce = web3.eth.get_transaction_count(wallet_data["address"])

        tx = {
            "to": Web3.to_checksum_address(transfer_data.router_address),
            "data": transfer_data.data,
            "value": int(transfer_data.value),
            "gas": transfer_data.gas_limit,
            "gasPrice": web3.eth.gas_price,
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        # Sign and send
        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        tx_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))

        logger.info(f"CCIP transfer tx: {tx_hash.hex()}")
        return tx_hash.hex()
    
    def _get_web3_with_fallback(self, chain_name: str) -> Web3:
        """Get a Web3 instance via RPCManager (health-tracked, auto-failover)."""
        from bot.services.rpc_manager import rpc_manager
        return rpc_manager.get_web3(chain_name)

    async def _execute_layerzero_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a cross-chain transfer via LayerZero/Stargate V2.

        Steps:
        1. Rebuild tx from stored quote data (no extra RPC calls)
        2. Approve ERC20 spend to Stargate pool (wait for receipt)
        3. Call sendToken() on the Stargate pool contract
        """
        wallet = self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        sender = wallet_data["address"]
        chain = get_chain_by_name(quote.from_chain)
        web3 = self._get_web3_with_fallback(quote.from_chain)

        # Rebuild LZ quote from stored raw_quote data (avoids extra RPC round-trip)
        raw = quote.raw_quote
        from bot.services.layerzero_api import LayerZeroQuote
        lz_quote = LayerZeroQuote(
            src_chain=quote.from_chain,
            dst_chain=quote.to_chain,
            token_symbol=quote.from_token,
            amount_in=quote.from_amount,
            amount_out=quote.to_amount,
            amount_out_min=quote.to_amount_min,
            native_fee=raw.get("native_fee", "0"),
            native_fee_usd=quote.gas_cost_usd,
            estimated_time=quote.estimated_time,
            pool_address=self.layerzero.get_pool_address(quote.from_chain, quote.from_token),
            dst_eid=self.layerzero.get_dst_eid(quote.to_chain),
            raw_data=raw,
        )

        tx_bundle = self.layerzero.build_send_transaction(
            quote=lz_quote,
            sender_address=sender,
        )

        nonce = web3.eth.get_transaction_count(Web3.to_checksum_address(sender))
        gas_price = web3.eth.gas_price

        # Step 1: ERC20 approval (wait for confirmation before sendToken)
        if "approval_tx" in tx_bundle:
            approve_tx = {
                "to": Web3.to_checksum_address(tx_bundle["approval_tx"]["to"]),
                "data": tx_bundle["approval_tx"]["data"],
                "value": 0,
                "gas": 100_000,
                "gasPrice": gas_price,
                "nonce": nonce,
                "chainId": chain.chain_id,
            }
            signed_approve = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
            approve_hash = web3.eth.send_raw_transaction(
                bytes.fromhex(signed_approve.replace("0x", ""))
            )
            logger.info(f"Stargate approval tx: {approve_hash.hex()}")

            # Wait for approval to confirm (up to 60s)
            receipt = web3.eth.wait_for_transaction_receipt(approve_hash, timeout=60)
            if receipt["status"] != 1:
                raise SwapError(f"ERC20 approval failed (tx: {approve_hash.hex()})")
            logger.info(f"Stargate approval confirmed in block {receipt['blockNumber']}")
            nonce += 1

        # Step 2: sendToken on Stargate pool
        send_tx_data = tx_bundle["send_tx"]

        # Estimate gas with fallback
        gas_estimate = 350_000
        try:
            gas_estimate = web3.eth.estimate_gas({
                "from": Web3.to_checksum_address(sender),
                "to": Web3.to_checksum_address(send_tx_data["to"]),
                "data": send_tx_data["data"],
                "value": send_tx_data["value"],
            })
            gas_estimate = int(gas_estimate * 1.3)  # 30% buffer for LZ overhead
        except Exception as e:
            logger.warning(f"Gas estimate failed, using default 350k: {e}")

        send_tx = {
            "to": Web3.to_checksum_address(send_tx_data["to"]),
            "data": send_tx_data["data"],
            "value": send_tx_data["value"],
            "gas": gas_estimate,
            "gasPrice": gas_price,
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, send_tx)
        tx_hash = web3.eth.send_raw_transaction(
            bytes.fromhex(signed_tx_hex.replace("0x", ""))
        )

        logger.info(
            f"Stargate V2 sendToken: {tx_hash.hex()} "
            f"({quote.from_chain}→{quote.to_chain} {quote.from_token})"
        )
        return tx_hash.hex()
    
    async def _execute_cctp_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a USDC transfer via Circle CCTP (cheapest for USDC)."""
        wallet = self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        chain = get_chain_by_name(quote.from_chain)
        web3 = rpc_manager.get_web3(quote.from_chain)

        # Step 1: Approve USDC for TokenMessenger
        cctp_quote = await self.cctp.get_quote(
            from_chain=quote.from_chain,
            to_chain=quote.to_chain,
            amount=quote.from_amount,
        )

        approve_tx = self.cctp.build_approve_transaction(cctp_quote, wallet_data["address"])

        nonce = web3.eth.get_transaction_count(wallet_data["address"])
        approve_tx["gas"] = 60000
        approve_tx["gasPrice"] = web3.eth.gas_price
        approve_tx["nonce"] = nonce
        approve_tx["chainId"] = chain.chain_id

        signed_approve_hex = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
        approve_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_approve_hex.replace("0x", "")))
        logger.info(f"CCTP approval tx: {approve_hash.hex()}")

        # Wait for approval confirmation
        web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)

        # Step 2: Execute depositForBurn
        burn_tx = self.cctp.build_burn_transaction(
            cctp_quote,
            wallet_data["address"],
            wallet_data["address"]  # Same recipient
        )

        nonce = web3.eth.get_transaction_count(wallet_data["address"])
        burn_tx["gas"] = 200000
        burn_tx["gasPrice"] = web3.eth.gas_price
        burn_tx["nonce"] = nonce
        burn_tx["chainId"] = chain.chain_id

        signed_burn_hex = await self.wallet_service.sign_evm_transaction(wallet, burn_tx)
        burn_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_burn_hex.replace("0x", "")))

        logger.info(f"CCTP burn tx: {burn_hash.hex()}")
        return burn_hash.hex()
    
    async def _execute_across_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a bridge via Across Protocol (cheap EVM bridges)."""
        wallet = self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        chain = get_chain_by_name(quote.from_chain)
        web3 = rpc_manager.get_web3(quote.from_chain)

        # Get fresh quote with deposit data
        across_quote = await self.across.get_quote(
            from_chain=quote.from_chain,
            to_chain=quote.to_chain,
            token=quote.from_token,
            amount=quote.from_amount,
            from_address=wallet_data["address"],
        )

        # Check if token needs approval (not ETH)
        if quote.from_token.upper() not in ["ETH", "WETH"] or self.across.get_token_address(quote.from_token, quote.from_chain) != "0x0000000000000000000000000000000000000000":
            # Approve token for SpokePool
            token_address = self.across.get_token_address(quote.from_token, quote.from_chain)

            erc20_approve_abi = [{
                "inputs": [
                    {"name": "spender", "type": "address"},
                    {"name": "amount", "type": "uint256"}
                ],
                "name": "approve",
                "outputs": [{"name": "", "type": "bool"}],
                "stateMutability": "nonpayable",
                "type": "function"
            }]

            token_contract = web3.eth.contract(
                address=Web3.to_checksum_address(token_address),
                abi=erc20_approve_abi
            )

            approve_data = token_contract.encode_abi(
                fn_name="approve",
                args=[
                    Web3.to_checksum_address(across_quote.spoke_pool),
                    int(quote.from_amount)
                ]
            )

            nonce = web3.eth.get_transaction_count(wallet_data["address"])
            approve_tx = {
                "to": Web3.to_checksum_address(token_address),
                "data": approve_data,
                "value": 0,
                "gas": 60000,
                "gasPrice": web3.eth.gas_price,
                "nonce": nonce,
                "chainId": chain.chain_id,
            }

            signed_approve_hex = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
            approve_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_approve_hex.replace("0x", "")))
            logger.info(f"Across approval tx: {approve_hash.hex()}")

            # Wait for approval
            web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)

        # Build deposit transaction
        deposit_tx = self.across.build_deposit_calldata(
            across_quote,
            wallet_data["address"],
        )

        nonce = web3.eth.get_transaction_count(wallet_data["address"])
        deposit_tx["gas"] = 300000
        deposit_tx["gasPrice"] = web3.eth.gas_price
        deposit_tx["nonce"] = nonce
        deposit_tx["chainId"] = chain.chain_id

        signed_deposit_hex = await self.wallet_service.sign_evm_transaction(wallet, deposit_tx)
        deposit_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_deposit_hex.replace("0x", "")))

        logger.info(f"Across deposit tx: {deposit_hash.hex()}")
        return deposit_hash.hex()
    
    async def _execute_wormhole_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a bridge via Wormhole (Solana <-> EVM)."""
        is_solana_source = quote.from_chain.lower() == "solana"

        if is_solana_source:
            # Solana -> EVM: Not implemented yet (requires Solana signing)
            raise SwapError(
                "Solana to EVM bridging via Wormhole is not yet supported. "
                "Please bridge manually at portal.wormhole.com"
            )

        wallet = self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        # EVM -> Solana or EVM -> EVM
        chain = get_chain_by_name(quote.from_chain)
        web3 = rpc_manager.get_web3(quote.from_chain)

        # Get Wormhole quote
        wormhole_quote = await self.wormhole.get_quote(
            from_chain=quote.from_chain,
            to_chain=quote.to_chain,
            token=quote.from_token,
            amount=quote.from_amount,
        )

        # Step 1: Approve token for Token Bridge
        token_address = self.wormhole.get_token_address(quote.from_token, quote.from_chain)
        token_bridge = self.wormhole.get_token_bridge(quote.from_chain)

        erc20_approve_abi = [{
            "inputs": [
                {"name": "spender", "type": "address"},
                {"name": "amount", "type": "uint256"}
            ],
            "name": "approve",
            "outputs": [{"name": "", "type": "bool"}],
            "stateMutability": "nonpayable",
            "type": "function"
        }]

        token_contract = web3.eth.contract(
            address=Web3.to_checksum_address(token_address),
            abi=erc20_approve_abi
        )

        approve_data = token_contract.encode_abi(
            fn_name="approve",
            args=[
                Web3.to_checksum_address(token_bridge),
                int(quote.from_amount)
            ]
        )

        nonce = web3.eth.get_transaction_count(wallet_data["address"])
        approve_tx = {
            "to": Web3.to_checksum_address(token_address),
            "data": approve_data,
            "value": 0,
            "gas": 60000,
            "gasPrice": web3.eth.gas_price,
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        signed_approve_hex = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
        approve_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_approve_hex.replace("0x", "")))
        logger.info(f"Wormhole approval tx: {approve_hash.hex()}")

        # Wait for approval
        web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)

        # Step 2: Transfer tokens via Token Bridge
        transfer_tx = self.wormhole.build_transfer_calldata_evm(
            wormhole_quote,
            wallet_data["address"],
        )

        nonce = web3.eth.get_transaction_count(wallet_data["address"])
        transfer_tx["gas"] = 300000
        transfer_tx["gasPrice"] = web3.eth.gas_price
        transfer_tx["nonce"] = nonce
        transfer_tx["chainId"] = chain.chain_id

        signed_transfer_hex = await self.wallet_service.sign_evm_transaction(wallet, transfer_tx)
        transfer_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_transfer_hex.replace("0x", "")))

        logger.info(f"Wormhole transfer tx: {transfer_hash.hex()}")
        return transfer_hash.hex()

    async def _execute_sunswap_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via SunSwap V2 on TRON.

        Steps:
        1. Check & send TRC20 approval if needed (token -> token or token -> TRX)
        2. Build swap transaction via SunSwap V2 Router
        3. Sign and broadcast via TronGrid
        """
        wallet = self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        from_address = wallet_data["address"]
        from_token_address = get_token_address(quote.from_token, "tron")
        private_key_hex = self.wallet_service.get_tron_private_key(wallet)

        raw = quote.raw_quote
        path = raw.get("path", [])
        amount_in = int(quote.from_amount)
        amount_out_min = int(quote.to_amount_min)

        # Step 1: TRC20 approval if swapping a token (not native TRX)
        is_from_native = from_token_address.lower() in ("native", "trx", "")
        if not is_from_native:
            current_allowance = await self.sunswap.get_allowance(
                token_address=from_token_address,
                owner_address=from_address,
            )
            if current_allowance < amount_in:
                logger.info(f"SunSwap: approving {from_token_address} for Router")
                approve_tx = await self.sunswap.build_approve_transaction(
                    token_address=from_token_address,
                    owner_address=from_address,
                )
                approve_hash = await self.sunswap.sign_and_broadcast(approve_tx, private_key_hex)
                logger.info(f"SunSwap approval tx: {approve_hash}")
                # Wait briefly for approval to propagate
                await asyncio.sleep(3)

        # Step 2: Build swap transaction
        swap_tx = await self.sunswap.build_swap_transaction(
            from_address=from_address,
            from_token=from_token_address,
            to_token=get_token_address(quote.to_token, "tron"),
            amount_in=amount_in,
            amount_out_min=amount_out_min,
            path=path,
        )

        # Step 3: Sign and broadcast
        tx_hash = await self.sunswap.sign_and_broadcast(swap_tx, private_key_hex)
        logger.info(f"SunSwap swap tx: {tx_hash} ({quote.from_token}→{quote.to_token})")

        return tx_hash

    async def _execute_okx_dex_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via OKX DEX Aggregator.

        OKX returns transaction calldata — we sign and broadcast like Li.Fi.
        Supports EVM, Solana, and TRON chains.
        """
        wallet = self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        raw = quote.raw_quote
        tx_data = raw.get("tx_data")
        if not tx_data:
            # Need to fetch swap data with tx calldata
            chain_id = raw.get("chain_id") or OKX_CHAIN_IDS.get(quote.from_chain.lower())
            from_token_address = get_token_address(quote.from_token, quote.from_chain)
            to_token_address = get_token_address(quote.to_token, quote.to_chain)

            swap_result = await self.okx_dex.get_swap(
                chain_id=chain_id,
                from_token=from_token_address,
                to_token=to_token_address,
                amount=quote.from_amount,
                user_address=wallet_data["address"],
                slippage=0.5,
            )
            tx_data = swap_result.tx_data

        if not tx_data:
            raise SwapError("OKX DEX did not return transaction data")

        chain = get_chain_by_name(quote.from_chain)

        if chain.chain_type == ChainType.SOLANA:
            # Solana: OKX returns base64-encoded transaction
            tx_bytes = base64.b64decode(tx_data.get("data", ""))
            signed_tx = await self.wallet_service.sign_solana_transaction(wallet, tx_bytes)

            session = await get_http_session()
            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "sendTransaction",
                "params": [
                    base64.b64encode(signed_tx).decode(),
                    {"encoding": "base64", "skipPreflight": False}
                ]
            }
            async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
                result = await resp.json()
                if "error" in result:
                    raise SwapError(f"OKX DEX Solana tx failed: {result['error']}")
                return result["result"]

        elif chain.chain_type == ChainType.TRON:
            # TRON: sign and broadcast via TronGrid
            private_key_hex = self.wallet_service.get_tron_private_key(wallet)
            # OKX returns transaction data that needs to be broadcast
            tx_hash = await self.sunswap.sign_and_broadcast(tx_data, private_key_hex)
            logger.info(f"OKX DEX TRON swap tx: {tx_hash}")
            return tx_hash

        else:
            # EVM: standard tx signing
            web3 = self.wallet_service._get_web3(quote.from_chain)
            sender = Web3.to_checksum_address(wallet_data["address"])

            # Handle ERC20 approval if needed
            from_token_address = get_token_address(quote.from_token, quote.from_chain)
            spender = Web3.to_checksum_address(tx_data.get("to", ""))

            if from_token_address and from_token_address != NATIVE_TOKEN_ADDRESS:
                token_addr = Web3.to_checksum_address(from_token_address)
                erc20_abi = [
                    {"inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}], "name": "allowance", "outputs": [{"name": "", "type": "uint256"}], "type": "function", "stateMutability": "view"},
                    {"inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}], "name": "approve", "outputs": [{"name": "", "type": "bool"}], "type": "function", "stateMutability": "nonpayable"},
                ]
                token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
                amount_needed = int(quote.from_amount)
                current_allowance = token_contract.functions.allowance(sender, spender).call()

                if current_allowance < amount_needed:
                    nonce = web3.eth.get_transaction_count(sender)
                    max_approval = 2**256 - 1
                    approve_data = token_contract.functions.approve(spender, max_approval).build_transaction({
                        "from": sender,
                        "nonce": nonce,
                        "chainId": chain.chain_id,
                        "gasPrice": web3.eth.gas_price,
                    })
                    approve_tx = {
                        "to": token_addr,
                        "data": approve_data["data"],
                        "value": 0,
                        "gas": approve_data.get("gas", 60000),
                        "gasPrice": approve_data["gasPrice"],
                        "nonce": nonce,
                        "chainId": chain.chain_id,
                    }
                    signed_approve = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
                    approve_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_approve.replace("0x", "")))
                    logger.info(f"OKX DEX approval tx: {approve_hash.hex()}")
                    web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)

            nonce = web3.eth.get_transaction_count(sender)
            tx = {
                "to": spender,
                "data": tx_data.get("data", ""),
                "value": _parse_int(tx_data.get("value"), 0),
                "gas": _parse_int(tx_data.get("gas"), 500000),
                "gasPrice": _parse_int(tx_data.get("gasPrice"), web3.eth.gas_price),
                "nonce": nonce,
                "chainId": chain.chain_id,
            }

            signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
            tx_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))

            logger.info(f"OKX DEX swap tx: {tx_hash.hex()}")
            return tx_hash.hex()

    async def check_status(self, swap_tx: SwapTransaction) -> SwapTransaction:
        """
        Check the status of a swap transaction.
        
        Updates the SwapTransaction record and returns it.
        """
        if not swap_tx.tx_hash:
            return swap_tx
        
        if swap_tx.route_provider == "jupiter":
            # Check Solana transaction status
            status = await self._check_solana_tx_status(swap_tx.tx_hash)
        elif swap_tx.route_provider == "sunswap":
            # Check TRON transaction status
            status = await self._check_tron_tx_status(swap_tx.tx_hash)
        else:
            # Check via Li.Fi status API
            if swap_tx.from_chain != swap_tx.to_chain:
                status = await self._check_lifi_status(swap_tx)
            else:
                # Same-chain EVM swap
                status = await self._check_evm_tx_status(swap_tx)
        
        # Update database
        def _update_status():
            with get_session() as session:
                tx = session.query(SwapTransaction).filter(
                    SwapTransaction.id == swap_tx.id
                ).first()
                tx.status = status
                if status == SwapStatus.COMPLETED.value:
                    from datetime import datetime, timezone
                    tx.completed_at = datetime.now(timezone.utc)
        await run_in_db(_update_status)

        swap_tx.status = status
        return swap_tx
    
    async def _check_solana_tx_status(self, tx_hash: str) -> str:
        """Check Solana transaction status."""
        async with aiohttp.ClientSession() as session:
            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getTransaction",
                "params": [
                    tx_hash,
                    {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}
                ]
            }
            async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
                result = await resp.json()
                
                if "error" in result:
                    return SwapStatus.PENDING.value
                
                tx_data = result.get("result")
                if tx_data is None:
                    return SwapStatus.PENDING.value
                
                if tx_data.get("meta", {}).get("err") is not None:
                    return SwapStatus.FAILED.value
                
                return SwapStatus.COMPLETED.value

    async def _check_tron_tx_status(self, tx_hash: str) -> str:
        """Check TRON transaction status via TronGrid."""
        try:
            rpc_url = rpc_manager.get_rpc_url("tron") or "https://api.trongrid.io"
            headers = {"Content-Type": "application/json"}
            if hasattr(settings, "trongrid_api_key") and settings.trongrid_api_key:
                headers["TRON-PRO-API-KEY"] = settings.trongrid_api_key

            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{rpc_url}/wallet/gettransactioninfobyid",
                    json={"value": tx_hash},
                    headers=headers,
                ) as resp:
                    data = await resp.json()

                    if not data or not data.get("id"):
                        return SwapStatus.PENDING.value

                    receipt = data.get("receipt", {})
                    result = receipt.get("result", "")

                    if result == "SUCCESS":
                        return SwapStatus.COMPLETED.value
                    elif result in ("REVERT", "OUT_OF_ENERGY", "FAILED"):
                        return SwapStatus.FAILED.value
                    else:
                        return SwapStatus.PENDING.value
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            logger.debug(f"TRON status check transient error for {tx_hash}: {e}")
            return SwapStatus.PENDING.value
        except Exception as e:
            logger.error(f"TRON status check failed for {tx_hash}: {e}")
            return SwapStatus.FAILED.value

    async def _check_evm_tx_status(self, swap_tx: SwapTransaction) -> str:
        """Check EVM transaction status."""
        try:
            web3 = self.wallet_service._get_web3(swap_tx.from_chain)
            receipt = web3.eth.get_transaction_receipt(swap_tx.tx_hash)
            
            if receipt is None:
                return SwapStatus.PENDING.value
            
            if receipt["status"] == 1:
                return SwapStatus.COMPLETED.value
            else:
                return SwapStatus.FAILED.value
        except (ConnectionError, TimeoutError, OSError) as e:
            logger.debug(f"EVM status check transient error for {swap_tx.tx_hash}: {e}")
            return SwapStatus.PENDING.value
        except Exception as e:
            logger.error(f"EVM status check failed for {swap_tx.tx_hash}: {e}")
            return SwapStatus.FAILED.value

    async def _check_lifi_status(self, swap_tx: SwapTransaction) -> str:
        """Check cross-chain swap status via Li.Fi."""
        try:
            status = await self.lifi.get_status(
                tx_hash=swap_tx.tx_hash,
                from_chain=swap_tx.from_chain,
                to_chain=swap_tx.to_chain,
            )
            
            if status.status == "DONE":
                # Update destination tx hash
                if status.receiving_tx_hash:
                    def _update_dest_hash():
                        with get_session() as session:
                            tx = session.query(SwapTransaction).filter(
                                SwapTransaction.id == swap_tx.id
                            ).first()
                            tx.destination_tx_hash = status.receiving_tx_hash
                    await run_in_db(_update_dest_hash)
                
                return SwapStatus.COMPLETED.value
            elif status.status == "FAILED":
                return SwapStatus.FAILED.value
            else:
                return SwapStatus.CONFIRMING.value
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            logger.debug(f"Li.Fi status check transient error for {swap_tx.tx_hash}: {e}")
            return SwapStatus.CONFIRMING.value
        except Exception as e:
            logger.error(f"Li.Fi status check failed for {swap_tx.tx_hash}: {e}")
            return SwapStatus.FAILED.value

    async def execute_multi_swap(
        self,
        quotes_with_wallets: List[tuple[SwapQuote, int]],
        user_id: int,
        attempt_id: str,
    ) -> List[SwapTransaction]:
        """
        Execute multiple swaps concurrently across different wallets.
        
        Args:
            quotes_with_wallets: List of (SwapQuote, wallet_id) tuples
            user_id: Database user ID
            attempt_id: Base attempt ID for idempotency
            
        Returns:
            List of SwapTransaction records
        """
        tasks = []
        for i, (quote, wallet_id) in enumerate(quotes_with_wallets):
            # Create a unique idempotency key for each wallet in the set
            idempotency_key = f"multi:{user_id}:{wallet_id}:{attempt_id}:{i}"
            tasks.append(
                self.execute_swap(
                    quote=quote,
                    wallet_id=wallet_id,
                    user_id=user_id,
                    idempotency_key=idempotency_key,
                )
            )
        
        # Execute all swaps in parallel
        # Note: exceptions are captured so one failure doesn't stop others
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        swap_transactions = []
        for res in results:
            if isinstance(res, SwapTransaction):
                swap_transactions.append(res)
            else:
                # Log the error but keep the successful ones
                logger.error(f"Multi-swap sub-task failed: {res}")
                
        return swap_transactions
