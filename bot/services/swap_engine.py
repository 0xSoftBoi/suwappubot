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
import json
import logging
from typing import Optional, List
from dataclasses import dataclass, field
from datetime import datetime, timezone
from web3 import Web3
import aiohttp
import base64

from bot.config.settings import settings
from bot.services.rpc_manager import rpc_manager
from bot.services.spending_limits import spending_limit_service
from bot.services.compliance import compliance_service, flashbots_relay
from bot.utils.cache import quote_cache
from bot.utils.performance import track_time, MetricNames
from bot.config.chains import CHAINS, ChainType, apply_min_gas_price, get_chain_by_name
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
from bot.services.tempo_fee_sponsor import tempo_fee_sponsor
from bot.services.okx_dex_api import OKXDEXAPI, OKXDEXQuote, OKXDEXError, OKX_CHAIN_IDS
from bot.services.oneinch_api import (
    OneInchAPI,
    OneInchQuote,
    OneInchError,
    ONEINCH_CHAIN_IDS,
    ONEINCH_NATIVE_TOKEN,
)
from bot.services.zerox_api import ZeroXAPI, ZeroXQuote, ZEROX_CHAIN_IDS, ZEROX_NATIVE_TOKEN
from bot.services.kyberswap_api import (
    KyberSwapAPI,
    KyberSwapQuote,
    KYBERSWAP_CHAIN_SLUGS,
    KYBERSWAP_NATIVE_TOKEN,
)
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


# Max ERC-20 approval value (2**256 - 1). Used when approval_mode == "unlimited".
MAX_UINT256 = 2**256 - 1

# Tokens whose `approve()` reverts when changing a NON-zero allowance directly to
# another non-zero value (the classic USDT mainnet pattern: require allowance to be
# reset to 0 first). In "exact" approval mode we may re-approve from a leftover
# non-zero allowance, so for these tokens we must send a 0-approval first. Keys are
# lowercased token contract addresses. In "unlimited" mode the first approval is
# from a (near-)zero allowance to max-uint, so this never triggers.
RESET_REQUIRED_TOKENS = {
    "0xdac17f958d2ee523a2206206994597c13d831ec7",  # USDT (Ethereum mainnet)
}


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
    timestamp: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )  # When quote was created
    expires_in: int = 30  # Quote expires in seconds
    # Platform fee (bps) applied to this quote, so the execution call can
    # re-send the SAME fee param and actually collect it (quote/exec must agree).
    platform_fee_bps: Optional[int] = None


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


# On-chain decimals cache for raw-address destination tokens (paste-to-trade).
# Keyed by (chain_name, address) — decimals are intrinsic to the token, so this
# never needs invalidation.
_ONCHAIN_DECIMALS_CACHE: dict[tuple[str, str], int] = {}


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
        self.oneinch = OneInchAPI()
        self.zerox = ZeroXAPI()
        self.kyberswap = KyberSwapAPI()
        self.wallet_service = WalletService()
        self._wallet_locks: dict[int, asyncio.Lock] = {}  # Per-wallet locks
        self._wallet_locks_max = 1000  # Cap to prevent unbounded growth

        # Surface optional-provider config at startup so a silently-disabled
        # aggregator is loud, not invisible (OKX never races + never errors when
        # its creds are unset — that should be visible in the logs).
        try:
            okx_state = (
                "configured"
                if getattr(self.okx_dex, "is_configured", False)
                else "OFF (creds unset)"
            )
            oneinch_state = (
                "configured"
                if getattr(self.oneinch, "is_configured", False)
                else "OFF (creds unset)"
            )
            zerox_state = (
                "configured" if getattr(self.zerox, "is_configured", False) else "OFF (creds unset)"
            )
            kyber_state = (
                "ON"
                if getattr(self.kyberswap, "is_configured", False)
                else "OFF (KYBERSWAP_ENABLED unset)"
            )
            logger.info(
                "Swap aggregators ready — LiFi/CoW/Jupiter active; OKX=%s; 1inch=%s; 0x=%s; KyberSwap=%s",
                okx_state,
                oneinch_state,
                zerox_state,
                kyber_state,
            )
        except Exception:
            pass

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

    def _is_starknet_swap(self, from_chain: str, to_chain: str) -> bool:
        """Check if this is a Starknet-to-Starknet swap (use AVNU)."""
        return from_chain.lower() == "starknet" and to_chain.lower() == "starknet"

    def _is_starknet_cross_chain(self, from_chain: str, to_chain: str) -> bool:
        """Check if Starknet is involved in a cross-chain swap (not yet supported)."""
        chains = (from_chain.lower(), to_chain.lower())
        return "starknet" in chains and chains[0] != chains[1]

    def _is_goat_swap(self, from_chain: str, to_chain: str) -> bool:
        """Check if this is a GOAT-to-GOAT swap (use GOATSwap directly)."""
        return from_chain.lower() == "goat" and to_chain.lower() == "goat"

    def _is_goat_cross_chain(self, from_chain: str, to_chain: str) -> bool:
        """Check if GOAT is involved in a cross-chain swap (not yet supported)."""
        chains = (from_chain.lower(), to_chain.lower())
        return "goat" in chains and chains[0] != chains[1]

    def _is_citrea_swap(self, from_chain: str, to_chain: str) -> bool:
        """Check if this is a Citrea-to-Citrea swap (use JuiceSwap directly)."""
        return from_chain.lower() == "citrea" and to_chain.lower() == "citrea"

    def _is_citrea_cross_chain(self, from_chain: str, to_chain: str) -> bool:
        """Check if Citrea is involved in a cross-chain swap (not yet supported)."""
        chains = (from_chain.lower(), to_chain.lower())
        return "citrea" in chains and chains[0] != chains[1]

    def _is_ccip_route(
        self, from_chain: str, to_chain: str, from_token: str, to_token: str
    ) -> bool:
        """Check if this route can use Chainlink CCIP (same token cross-chain EVM)."""
        # CCIP is for same-token transfers across EVM chains
        if from_token != to_token:
            return False

        # Check if CCIP supports this route
        return self.ccip.is_supported_route(from_chain, to_chain, from_token)

    def _is_layerzero_route(
        self, from_chain: str, to_chain: str, from_token: str, to_token: str
    ) -> bool:
        """Check if this route can use LayerZero/Stargate (same stablecoin cross-chain)."""
        # LayerZero is good for same-token cross-chain transfers
        if from_token != to_token:
            return False
        return self.layerzero.is_supported_route(from_chain, to_chain, from_token)

    def _is_cctp_route(
        self, from_chain: str, to_chain: str, from_token: str, to_token: str
    ) -> bool:
        """Circle CCTP: zero-fee native USDC cross-chain (same token)."""
        if from_token != to_token:
            return False
        return self.cctp.is_supported_route(from_chain, to_chain, from_token)

    def _is_across_route(
        self, from_chain: str, to_chain: str, from_token: str, to_token: str
    ) -> bool:
        """Across: fast intent-based same-token cross-chain on supported EVM chains."""
        if from_token != to_token:
            return False
        return self.across.is_supported_route(from_chain, to_chain, from_token)

    def _is_wormhole_route(
        self, from_chain: str, to_chain: str, from_token: str, to_token: str
    ) -> bool:
        """Wormhole: same-token cross-chain incl. Solana<->EVM.

        Solana->EVM execution is not yet implemented (see #250 and
        _execute_wormhole_swap), so we do not offer that direction here — it
        would only be rejected at execution time.
        """
        if from_token != to_token:
            return False
        if from_chain.lower() == "solana":
            return False
        return self.wormhole.is_supported_route(from_chain, to_chain, from_token)

    def _is_cow_route(self, from_chain: str, to_chain: str) -> bool:
        """CoW Protocol: gasless, MEV-protected same-chain EVM swaps."""
        return from_chain.lower() == to_chain.lower() and self.cow.is_supported_chain(from_chain)

    def _is_socket_route(self, from_chain: str, to_chain: str) -> bool:
        """Socket/Bungee: super-aggregator across many EVM chains (same- or cross-chain)."""
        return self.socket.is_supported_chain(from_chain) and self.socket.is_supported_chain(
            to_chain
        )

    def _get_token_amount_raw(self, amount: float, token_symbol: str, chain_name: str) -> str:
        """Convert human-readable amount to raw amount string."""
        decimals = get_token_decimals(token_symbol, chain_name)
        # Use C++ core if available for faster conversion
        if USE_CPP_CORE:
            return suwappu_core.to_raw_amount(amount, decimals)
        raw = int(amount * (10**decimals))
        return str(raw)

    def _get_token_amount_human(self, amount_raw: str, token_symbol: str, chain_name: str) -> float:
        """Convert raw amount to human-readable float."""
        decimals = get_token_decimals(token_symbol, chain_name)
        # Use C++ core if available for faster conversion
        if USE_CPP_CORE:
            return suwappu_core.to_human_amount(amount_raw, decimals)
        return int(amount_raw) / (10**decimals)

    @staticmethod
    def _looks_like_raw_token(token: str) -> bool:
        """True when ``token`` is a raw contract address, not a registry symbol.

        Mirrors the passthrough rule in tokens.get_token_address: a 0x-hex
        address (>=42 chars) or a >=32-char base58 mint. For these, the registry
        decimals lookup falls back to 18, which mis-scales the human display of
        any token with different decimals (e.g. 6-dp USDC) — see
        _correct_destination_decimals.
        """
        if not token:
            return False
        return (token.startswith("0x") and len(token) >= 42) or len(token) >= 32

    async def _resolve_onchain_decimals(self, address: str, chain_name: str) -> Optional[int]:
        """Read a token's real decimals on-chain (cached). None on any failure.

        Used to correct the displayed receive-amount when a token is bought by
        raw address (paste-to-trade) and its decimals aren't in the registry.
        """
        key = (chain_name.lower(), address.lower())
        if key in _ONCHAIN_DECIMALS_CACHE:
            return _ONCHAIN_DECIMALS_CACHE[key]
        try:
            cfg = get_chain_by_name(chain_name)
            if cfg is None:
                return None
            if cfg.chain_type == ChainType.EVM:

                def _read() -> int:
                    w3 = rpc_manager.get_web3(chain_name)
                    contract = w3.eth.contract(
                        address=Web3.to_checksum_address(address),
                        abi=[
                            {
                                "constant": True,
                                "inputs": [],
                                "name": "decimals",
                                "outputs": [{"name": "", "type": "uint8"}],
                                "stateMutability": "view",
                                "type": "function",
                            }
                        ],
                    )
                    return int(contract.functions.decimals().call())

                dec = await asyncio.to_thread(_read)
            elif cfg.chain_type == ChainType.SOLANA:
                dec = await self._solana_mint_decimals(address)
            else:
                return None
            if dec is not None and 0 <= dec <= 36:
                _ONCHAIN_DECIMALS_CACHE[key] = dec
                return dec
        except Exception as e:
            logger.debug(f"on-chain decimals read failed for {address}@{chain_name}: {e}")
        return None

    async def _solana_mint_decimals(self, mint: str) -> Optional[int]:
        """Read an SPL mint's decimals via getTokenSupply. None on failure."""
        try:
            url = rpc_manager.get_rpc_url("solana")
            payload = {"jsonrpc": "2.0", "id": 1, "method": "getTokenSupply", "params": [mint]}
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url, json=payload, timeout=aiohttp.ClientTimeout(total=10)
                ) as resp:
                    data = await resp.json()
            return int(data["result"]["value"]["decimals"])
        except Exception as e:
            logger.debug(f"solana mint decimals read failed for {mint}: {e}")
            return None

    async def _correct_destination_decimals(
        self, quote, to_token: str, to_chain: str, amount: float
    ):
        """Fix the displayed receive-amount for a token bought by raw address.

        Providers convert the raw output amount to human using the registry
        decimals, which default to 18 for a raw address — so a 6-dp token shows
        a wildly wrong "you receive" figure (execution is unaffected; it uses the
        raw amounts). When the destination is a raw address, read its true
        decimals on-chain and rescale to_amount_human + exchange_rate. Ranking is
        unaffected (all providers mis-scaled identically), so correcting the
        chosen quote is sufficient. Never raises — display-only best effort.
        """
        try:
            if not self._looks_like_raw_token(to_token):
                return quote
            real = await self._resolve_onchain_decimals(to_token, to_chain)
            if real is None:
                return quote
            assumed = get_token_decimals(to_token, to_chain)
            if real == assumed:
                return quote
            corrected = int(quote.to_amount) / (10**real)
            quote.to_amount_human = corrected
            if amount and amount > 0:
                quote.exchange_rate = corrected / amount
            logger.info(
                f"Corrected receive-amount decimals for {to_token[:10]}… on "
                f"{to_chain}: {assumed} -> {real}"
            )
        except Exception as e:
            logger.debug(f"destination decimals correction skipped: {e}")
        return quote

    def _approval_amount(self, swap_amount: int) -> int:
        """Resolve the ERC-20 approval amount per the configured approval policy.

        - "unlimited" (default): max uint256, so the router is approved once and
          subsequent swaps skip the approval tx (fewer txs, but the full balance
          stays exposed to the router forever).
        - "exact": approve only the amount this swap will pull (token base units),
          so no standing allowance survives the swap.

        ``swap_amount`` MUST be the exact base-unit value the router will transfer
        from the user (i.e. the same value the allowance check compares against).
        """
        if str(getattr(settings, "approval_mode", "unlimited")).lower() == "exact":
            return int(swap_amount)
        return MAX_UINT256

    async def _send_reset_approval_if_needed(
        self,
        *,
        web3,
        token_contract,
        token_addr: str,
        spender: str,
        current_allowance: int,
        sender: str,
        chain_id: int,
        gas_price: int,
        nonce: int,
        wallet,
    ) -> int:
        """For USDT-style reset-required tokens in 'exact' mode, approve 0 first.

        Some tokens (USDT mainnet) revert ``approve`` when moving a NON-zero
        allowance directly to another non-zero value. This only matters in
        'exact' mode, where a re-approval can start from a leftover non-zero
        allowance. Sends a 0-approval tx (waiting for the receipt) and returns
        the next nonce to use. No-op (returns the same nonce) otherwise.
        """
        if str(getattr(settings, "approval_mode", "unlimited")).lower() != "exact":
            return nonce
        if current_allowance <= 0:
            return nonce
        if token_addr.lower() not in RESET_REQUIRED_TOKENS:
            return nonce

        reset_data = token_contract.functions.approve(spender, 0).build_transaction(
            {
                "from": sender,
                "nonce": nonce,
                "chainId": chain_id,
                "gasPrice": gas_price,
                "gas": 100_000,
            }
        )
        reset_tx = {
            "to": token_addr,
            "data": reset_data["data"],
            "value": 0,
            "gas": reset_data.get("gas", 60000),
            "gasPrice": gas_price,
            "nonce": nonce,
            "chainId": chain_id,
        }
        signed_reset = await self.wallet_service.sign_evm_transaction(wallet, reset_tx)
        reset_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_reset.replace("0x", "")))
        )
        logger.info(f"Reset-required token allowance zeroed first: {reset_hash.hex()}")
        await asyncio.to_thread(
            lambda: web3.eth.wait_for_transaction_receipt(reset_hash, timeout=120)
        )
        return nonce + 1

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
        platform_fee_bps: Optional[int] = None,
        user_id: Optional[int] = None,
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
            platform_fee_bps: Platform fee in basis points to collect on-chain.
                Takes precedence over user_id. Applied to fee-capable providers.
            user_id: When platform_fee_bps is not given, resolve the fee from this
                user's subscription tier so paid tiers get their discount on
                automated paths (copy, orders, etc.), not the flat default.

        Returns:
            SwapQuote with best output amount from all providers
        """
        # Resolve the platform fee so EVERY swap path collects — not just the
        # manual handler. Precedence: explicit platform_fee_bps > user's tier
        # (via user_id) > flat default. The snipe path does NOT route through
        # here (it has its own Jupiter calls), so it is not covered by this.
        # On-chain collection is still gated per-provider on a configured
        # collector, so this is a no-op until collectors are set.
        if platform_fee_bps is None:
            from bot.services.fee_service import fee_service

            tier = None
            if user_id is not None:
                try:
                    from bot.services.x402_service import x402_service

                    tier = await x402_service.get_tier(user_id)
                except Exception:
                    tier = None  # tier lookup failure → flat default, never block the quote
            platform_fee_bps = fee_service.get_fee_bps(tier)

        # Check quote cache — keyed on platform_fee_bps so quotes for different
        # tiers (different fee) never collide.
        cache_key = f"quote:{from_chain}:{to_chain}:{from_token}:{to_token}:{amount}:{slippage}:{from_address or 'none'}:fee{platform_fee_bps or 0}"
        cached = await quote_cache.get(cache_key)
        if cached is not None:
            return cached

        if self._is_tron_cross_chain(from_chain, to_chain):
            raise SwapError(
                "Cross-chain swaps from/to TRON are not yet supported. Phase 2 will add TRON bridging."
            )

        if self._is_starknet_cross_chain(from_chain, to_chain):
            raise SwapError(
                "Cross-chain swaps from/to Starknet are not yet supported. "
                "Phase 2 will add BTC/EVM bridging to Starknet."
            )

        if self._is_goat_cross_chain(from_chain, to_chain):
            raise SwapError(
                "Cross-chain swaps from/to GOAT Network are not yet supported "
                "(bridge via Symbiosis coming)."
            )

        if self._is_citrea_cross_chain(from_chain, to_chain):
            raise SwapError(
                "Cross-chain swaps from/to Citrea are not yet supported. "
                "Bridge BTC in via /btc (Lightning → Citrea cBTC)."
            )

        amount_raw = self._get_token_amount_raw(amount, from_token, from_chain)
        slippage_bps = int(slippage * 100)

        # Build list of eligible quote fetchers to race in parallel
        tasks = []

        if self._is_tempo_only_swap(from_chain, to_chain):
            tasks.append(
                self._get_tempo_dex_quote(from_token, to_token, amount, amount_raw, slippage)
            )

        if self._is_solana_only_swap(from_chain, to_chain):
            tasks.append(
                self._get_jupiter_quote(
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage_bps,
                    platform_fee_bps=platform_fee_bps,
                )
            )

        if self._is_tron_only_swap(from_chain, to_chain):
            tasks.append(
                self._get_sunswap_quote(from_token, to_token, amount, amount_raw, slippage_bps)
            )

        # Starknet-only swaps route EXCLUSIVELY through AVNU — no EVM aggregator
        # (LiFi/1inch/0x/Kyber/OKX/CoW/Socket) understands Starknet calldata.
        if self._is_starknet_swap(from_chain, to_chain):
            tasks.append(
                self._get_avnu_quote(
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage_bps,
                    platform_fee_bps=platform_fee_bps,
                )
            )

        # GOAT-only swaps route EXCLUSIVELY through GOATSwap (direct Uniswap V3
        # fork). GOAT (chain id 2345) is absent from EVERY aggregator chain map
        # (LiFi/1inch/0x/Kyber/OKX/CoW/Socket) — keep it out of those paths.
        if self._is_goat_swap(from_chain, to_chain):
            tasks.append(
                self._get_goatswap_quote(
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    slippage_bps,
                )
            )

        # Citrea-only swaps route EXCLUSIVELY through JuiceSwap (direct Uniswap
        # V3 fork). Citrea (chain id 4114) is absent from EVERY aggregator chain
        # map (LiFi/1inch/0x/Kyber/OKX/CoW/Socket) — keep it out of those paths.
        if self._is_citrea_swap(from_chain, to_chain):
            tasks.append(
                self._get_juiceswap_quote(
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    slippage_bps,
                )
            )

        # OKX DEX covers TRON, EVM, and Solana (same-chain only) — add if configured
        # (GOAT/Citrea excluded: not in OKX_CHAIN_IDS, routed via UniV3 forks above)
        if (
            self.okx_dex.is_configured
            and from_chain.lower() == to_chain.lower()
            and not self._is_starknet_swap(from_chain, to_chain)
            and not self._is_goat_swap(from_chain, to_chain)
            and not self._is_citrea_swap(from_chain, to_chain)
        ):
            tasks.append(
                self._get_okx_dex_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                    platform_fee_bps=platform_fee_bps,
                )
            )

        # 1inch (EVM same-chain only) — add if configured
        # (GOAT is intentionally absent from ONEINCH_CHAIN_IDS — GOATSwap only)
        if (
            self.oneinch.is_configured
            and from_chain.lower() == to_chain.lower()
            and ONEINCH_CHAIN_IDS.get(from_chain.lower())
        ):
            tasks.append(
                self._get_1inch_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                    platform_fee_bps=platform_fee_bps,
                )
            )

        # 0x Swap API v2 (EVM same-chain only) — add if configured
        # (GOAT is intentionally absent from ZEROX_CHAIN_IDS — GOATSwap only)
        if (
            self.zerox.is_configured
            and from_chain.lower() == to_chain.lower()
            and ZEROX_CHAIN_IDS.get(from_chain.lower())
        ):
            tasks.append(
                self._get_0x_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                    platform_fee_bps=platform_fee_bps,
                )
            )

        # KyberSwap (EVM same-chain only) — add if enabled (no key, gated on flag)
        # (GOAT is intentionally absent from KYBERSWAP_CHAIN_SLUGS — GOATSwap only)
        if (
            self.kyberswap.is_configured
            and from_chain.lower() == to_chain.lower()
            and KYBERSWAP_CHAIN_SLUGS.get(from_chain.lower())
        ):
            tasks.append(
                self._get_kyberswap_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                    platform_fee_bps=platform_fee_bps,
                )
            )

        # EVM routing: Li.Fi + LayerZero (not for Solana-only, TRON-only, Tempo-only,
        # Starknet, GOAT, or Citrea — Li.Fi has no chain id for GOAT/Citrea; the
        # direct UniV3-fork venues handle them)
        if (
            not self._is_solana_only_swap(from_chain, to_chain)
            and not self._is_tron_only_swap(from_chain, to_chain)
            and not self._is_tempo_only_swap(from_chain, to_chain)
            and not self._is_starknet_swap(from_chain, to_chain)
            and not self._is_goat_swap(from_chain, to_chain)
            and not self._is_citrea_swap(from_chain, to_chain)
        ):
            if self._is_layerzero_route(from_chain, to_chain, from_token, to_token):
                tasks.append(
                    self._get_layerzero_quote(
                        from_chain, to_chain, from_token, amount, amount_raw, from_address, slippage
                    )
                )
            tasks.append(
                self._get_lifi_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    to_address,
                    slippage,
                    platform_fee_bps=platform_fee_bps,
                )
            )

            # Additional providers — raced in parallel; best price wins.
            # CCTP: preferred for native USDC (zero fee).
            if self._is_cctp_route(from_chain, to_chain, from_token, to_token):
                tasks.append(
                    self._get_cctp_quote(
                        from_chain, to_chain, from_token, amount, amount_raw, slippage
                    )
                )
            # CCIP: same-token cross-chain EVM (#257 — was only in get_all_quotes).
            if self._is_ccip_route(from_chain, to_chain, from_token, to_token):
                tasks.append(
                    self._get_ccip_quote(
                        from_chain, to_chain, from_token, amount, from_address, to_address
                    )
                )
            # Across: fast intent-based cross-chain.
            if self._is_across_route(from_chain, to_chain, from_token, to_token):
                tasks.append(
                    self._get_across_quote(
                        from_chain,
                        to_chain,
                        from_token,
                        amount,
                        amount_raw,
                        from_address,
                        to_address,
                    )
                )
            # Wormhole: cross-chain incl. EVM->Solana (Solana->EVM gated, see #250).
            if self._is_wormhole_route(from_chain, to_chain, from_token, to_token):
                tasks.append(
                    self._get_wormhole_quote(from_chain, to_chain, from_token, amount, amount_raw)
                )
            # Whether we're charging a platform fee on this swap. CoW and Socket
            # don't carry our fee param, so if they were raced fee-free they'd win
            # on output and we'd route AROUND the fee (collect nothing). Exclude
            # them from the race whenever a fee is being charged; they still serve
            # fee-free swaps (fee off / no collector configured).
            charge_platform_fee = bool(platform_fee_bps and settings.fee_collector_address)

            # CoW: gasless, MEV-protected same-chain EVM swaps.
            if self._is_cow_route(from_chain, to_chain) and not charge_platform_fee:
                tasks.append(
                    self._get_cow_quote(
                        from_chain,
                        from_token,
                        to_token,
                        amount,
                        amount_raw,
                        from_address,
                        to_address,
                    )
                )
            # Socket: super-aggregator fallback across many EVM chains.
            if self._is_socket_route(from_chain, to_chain) and not charge_platform_fee:
                tasks.append(
                    self._get_socket_quote(
                        from_chain,
                        to_chain,
                        from_token,
                        to_token,
                        amount,
                        amount_raw,
                        from_address,
                        to_address,
                    )
                )

        # Adaptive timeout: 3s fast path, extend to 8s total if no fast results
        FAST_TIMEOUT = 3.0
        EXTENDED_TIMEOUT = 5.0  # additional seconds (8s total)

        wrapped_tasks = [asyncio.ensure_future(t) for t in tasks]
        quotes = []

        if wrapped_tasks:
            done, pending = await asyncio.wait(wrapped_tasks, timeout=FAST_TIMEOUT)
            quotes = self._extract_quotes(done)

            if not quotes and pending:
                logger.info(
                    "No quotes in %.0fs fast path, extending to %.0fs for %d pending providers",
                    FAST_TIMEOUT,
                    FAST_TIMEOUT + EXTENDED_TIMEOUT,
                    len(pending),
                )
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

        # Wormhole returns an optimistic 1:1 placeholder quote (no real fee netting),
        # so it would unfairly win this max() against aggregators that net out fees.
        # Prefer real quotes; fall back to Wormhole only when it's the sole route.
        # (CCTP's 1:1 is genuine — native USDC, zero fee — so it stays in the race.)
        ranked = [q for q in quotes if q.provider != "wormhole"] or quotes
        best = max(ranked, key=lambda q: q.to_amount_human)

        # Fix the displayed receive-amount when buying a token by raw address
        # (its real decimals aren't in the registry). Done after ranking — all
        # providers mis-scaled identically, so the winner is unchanged — and
        # before caching so every consumer sees the corrected figure.
        best = await self._correct_destination_decimals(best, to_token, to_chain, amount)

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
        platform_fee_bps: Optional[int] = None,
    ) -> SwapQuote:
        """Get quote from Li.Fi for cross-chain or EVM swaps."""
        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, to_chain)

        if not from_token_address or not to_token_address:
            raise SwapError(
                f"Token not supported: {from_token} on {from_chain} or {to_token} on {to_chain}"
            )

        # Li.Fi collects the integrator fee via its FeeCollection contract and
        # forwards it to the registered integrator wallet (set up at portal.li.fi).
        # Gate on fee_collector_address (our "fees are live" signal) like the other
        # aggregators — otherwise we'd degrade the user's quote for a fee nobody
        # collects. When live, pass the tier-correct rate so on-chain == displayed.
        lifi_fee = (
            (platform_fee_bps / 10_000.0)
            if (platform_fee_bps and settings.fee_collector_address)
            else 0.0
        )

        quote = await self.lifi.get_quote(
            integrator=settings.lifi_integrator_id,
            fee=lifi_fee,
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

    async def build_external_evm_swap(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        from_address: str,
        slippage: float,
    ):
        """Build the unsigned EVM transaction(s) for a NON-CUSTODIAL swap.

        The connected external wallet (MetaMask / WalletConnect / etc.) signs and
        broadcasts the transaction client-side — the server never holds a private
        key for it. We fetch a Li.Fi quote (the one same-chain EVM provider that
        returns ready-to-sign ``transactionRequest`` calldata at quote time) and
        surface it plus an ERC-20 approval tx when the sell token needs one.

        Returns ``(quote, payload)`` where ``payload`` is a JSON-serialisable dict
        with ``chainId``, the unsigned ``tx``, an optional ``approval`` tx, and the
        ``spender`` the approval targets. Numeric tx fields are hex quantity
        strings so they feed straight into ``wallet_sendTransaction``.
        """
        if not from_address or not from_address.startswith("0x") or len(from_address) != 42:
            raise SwapError("A connected EVM wallet address is required.")

        if from_chain.lower() != to_chain.lower():
            # Cross-chain needs the bridge step-runner (multiple txs across chains),
            # which can't be expressed as a single client-signed tx yet.
            raise SwapError("External wallets support same-chain EVM swaps for now.")

        chain = get_chain_by_name(from_chain)
        if not chain or chain.chain_type != ChainType.EVM:
            raise SwapError("External-wallet swaps are only supported on EVM chains.")

        amount_raw = self._get_token_amount_raw(amount, from_token, from_chain)

        quote = await self._get_lifi_quote(
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=to_token,
            amount=amount,
            amount_raw=amount_raw,
            from_address=from_address,
            to_address=from_address,
            slippage=slippage,
        )

        tx_request = quote.raw_quote.get("transactionRequest") or {}
        to_target = tx_request.get("to")
        call_data = tx_request.get("data")
        if not to_target or not call_data:
            raise SwapError("This route can't be signed by an external wallet yet.")

        web3 = self.wallet_service._get_web3(from_chain)
        sender = Web3.to_checksum_address(from_address)
        spender = Web3.to_checksum_address(to_target)

        swap_tx = {
            "to": spender,
            "data": call_data,
            "value": hex(_parse_int(tx_request.get("value"), 0)),
            "gas": hex(_parse_int(tx_request.get("gasLimit"), 500_000)),
            "chainId": chain.chain_id,
        }

        # ERC-20 approval: skip for native sells (ETH/BNB/etc.). We read the live
        # allowance with the user's address as owner — a pure view call, no key
        # needed — and only return an approval tx when it's short. NOTE: 'exact'
        # approval_mode on a reset-required token (e.g. USDT) would need a zero-out
        # approval first; the default 'unlimited' mode approves max once and is safe.
        approval = None
        from_token_address = get_token_address(from_token, from_chain)
        if from_token_address and from_token_address != NATIVE_TOKEN_ADDRESS:
            token_addr = Web3.to_checksum_address(from_token_address)
            erc20_abi = [
                {
                    "inputs": [
                        {"name": "owner", "type": "address"},
                        {"name": "spender", "type": "address"},
                    ],
                    "name": "allowance",
                    "outputs": [{"name": "", "type": "uint256"}],
                    "type": "function",
                    "stateMutability": "view",
                },
                {
                    "inputs": [
                        {"name": "spender", "type": "address"},
                        {"name": "amount", "type": "uint256"},
                    ],
                    "name": "approve",
                    "outputs": [{"name": "", "type": "bool"}],
                    "type": "function",
                    "stateMutability": "nonpayable",
                },
            ]
            token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
            amount_needed = int(amount_raw)
            try:
                current_allowance = await asyncio.to_thread(
                    lambda: token_contract.functions.allowance(sender, spender).call()
                )
            except Exception as exc:  # RPC hiccup — fail safe by requesting approval
                logger.warning(f"external swap allowance read failed ({exc}); requesting approval")
                current_allowance = 0

            if current_allowance < amount_needed:
                approve_amount = self._approval_amount(amount_needed)
                approve_data = token_contract.encode_abi("approve", args=[spender, approve_amount])
                approval = {
                    "to": token_addr,
                    "data": approve_data,
                    "value": "0x0",
                    "chainId": chain.chain_id,
                }

        payload = {
            "chainId": chain.chain_id,
            "tx": swap_tx,
            "approval": approval,
            "spender": spender,
        }
        return quote, payload

    async def build_external_solana_swap(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        from_address: str,
        slippage: float,
        priority_level: str = "medium",
        max_lamports: int = 1_000_000,
        jito_tip_lamports: Optional[int] = None,
        compute_unit_price_micro_lamports: Optional[int] = None,
    ):
        """Build the unsigned Solana transaction for a NON-CUSTODIAL swap.

        Phantom (or any Solana wallet) signs + sends the returned base64
        ``VersionedTransaction`` client-side — the server never holds the key.
        Jupiter builds the serialized swap tx for the connected pubkey at build
        time; there's no ERC-20-style approval step on Solana. Returns
        ``(quote, payload)`` with ``swapTransaction`` (base64) + ``chain``.

        ``priority_level``/``max_lamports`` set the Solana priority fee baked into
        the tx (landing speed under congestion). They flow from the caller's
        speed tier; the server holds the policy so caps can be tuned without a
        client deploy. When ``jito_tip_lamports`` is set, Jupiter bakes a Jito tip
        instead — the returned ``payload["jito"]`` is True and the client must
        submit the signed tx to the Jito block engine (POST /swap/submit-jito) for
        MEV-protected bundle landing rather than broadcasting via a normal RPC.
        ``compute_unit_price_micro_lamports`` (the client's live network estimate,
        e.g. from Helius) sets the exact per-CU priority price for the non-Jito
        path; it takes precedence over ``priority_level``/``max_lamports``.
        """
        try:
            import base58

            if len(base58.b58decode(from_address)) != 32:
                raise ValueError
        except Exception:
            raise SwapError("A connected Solana wallet address is required.")

        amount_raw = self._get_token_amount_raw(amount, from_token, "solana")
        slippage_bps = int(slippage * 100)

        quote = await self._get_jupiter_quote(
            from_token=from_token,
            to_token=to_token,
            amount=amount,
            amount_raw=amount_raw,
            from_address=from_address,
            slippage_bps=slippage_bps,
        )

        # Mirror _execute_jupiter_swap: only attach a feeAccount when the quote
        # itself reserved a platformFee, else Jupiter /swap rejects it.
        jup_fee_account = (
            self._jupiter_fee_account(quote.from_token, quote.to_token)
            if isinstance(quote.raw_quote, dict) and quote.raw_quote.get("platformFee")
            else None
        )
        swap_tx = await self.jupiter.get_swap_transaction(
            quote_response=quote.raw_quote,
            user_public_key=from_address,
            fee_account=jup_fee_account,
            priority_level=priority_level,
            max_lamports=max_lamports,
            jito_tip_lamports=jito_tip_lamports,
            compute_unit_price_micro_lamports=compute_unit_price_micro_lamports,
        )
        if not swap_tx.swap_transaction:
            raise SwapError("Jupiter did not return a swap transaction.")

        payload = {
            "chain": "solana",
            "swapTransaction": swap_tx.swap_transaction,
            "lastValidBlockHeight": swap_tx.last_valid_block_height,
            "jito": bool(jito_tip_lamports),
        }
        return quote, payload

    @staticmethod
    def _jupiter_referral_accounts() -> dict:
        """Map of mint -> Jupiter referral token account.

        Built from JUPITER_REFERRAL_ACCOUNTS (JSON: {mint: tokenAccount}) merged
        with the legacy single jupiter_referral_account/jupiter_referral_fee_mint
        pair. Supporting multiple mints lets us collect on every Solana pair —
        wSOL for SOL-paired trades (the bulk) AND USDC for USDC-paired trades.
        """
        accounts: dict = {}
        raw = getattr(settings, "jupiter_referral_accounts", None)
        if raw:
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    accounts.update({str(k): str(v) for k, v in parsed.items() if k and v})
            except (ValueError, TypeError):
                logger.warning("Invalid JUPITER_REFERRAL_ACCOUNTS JSON; ignoring")
        acct = settings.jupiter_referral_account
        mint = settings.jupiter_referral_fee_mint
        if acct and mint:
            accounts.setdefault(mint, acct)
        return accounts

    def _jupiter_fee_account(self, from_token: str, to_token: str) -> Optional[str]:
        """Return the Jupiter referral feeAccount IFF it can legally receive the
        fee for this pair.

        Jupiter requires the feeAccount's mint to equal the swap's input OR output
        mint (ExactIn). Referral token accounts are mint-specific, so we keep one
        per fee mint and pick the account matching whichever side of the pair is a
        configured fee mint. If neither side matches, we return None and take no
        fee — the swap still succeeds (rather than Jupiter rejecting it). The same
        predicate is used at quote and execution time so they always agree.
        """
        accounts = self._jupiter_referral_accounts()
        if not accounts:
            return None
        from_addr = get_token_address(from_token, "solana")
        to_addr = get_token_address(to_token, "solana")
        for addr in (from_addr, to_addr):
            if addr and addr in accounts:
                return accounts[addr]
        return None

    async def _get_jupiter_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage_bps: int,
        platform_fee_bps: Optional[int] = None,
    ) -> SwapQuote:
        """Get quote from Jupiter for Solana swaps."""
        from_token_address = get_token_address(from_token, "solana")
        to_token_address = get_token_address(to_token, "solana")

        if not from_token_address or not to_token_address:
            raise SwapError(f"Token not supported on Solana: {from_token} or {to_token}")

        # Only reserve a platform fee in the quote when a referral feeAccount can
        # actually receive it for THIS pair (mint must match input/output) —
        # otherwise the fee would be uncollectable and /swap would later fail.
        effective_fee_bps = (
            platform_fee_bps if self._jupiter_fee_account(from_token, to_token) else None
        )

        quote = await self.jupiter.get_quote(
            input_mint=from_token_address,
            output_mint=to_token_address,
            amount=amount_raw,
            slippage_bps=slippage_bps,
            platform_fee_bps=effective_fee_bps,
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
            platform_fee_bps=effective_fee_bps,
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

    async def _get_avnu_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage_bps: int,
        platform_fee_bps: Optional[int] = None,
    ) -> SwapQuote:
        """Get quote from AVNU for Starknet same-chain swaps."""
        from bot.services.avnu_api import avnu_api

        from_token_address = get_token_address(from_token, "starknet")
        to_token_address = get_token_address(to_token, "starknet")

        if not from_token_address or not to_token_address:
            raise SwapError(f"Token not supported on Starknet: {from_token} or {to_token}")

        # AVNU collects the integrator fee on-chain only when a recipient is
        # configured — otherwise pass no fee (don't degrade the quote for a fee
        # nobody collects).
        effective_fee_bps = platform_fee_bps if settings.avnu_fee_recipient else None

        quote = await avnu_api.get_quote(
            sell_token_address=from_token_address,
            buy_token_address=to_token_address,
            sell_amount=int(amount_raw),
            taker_address=from_address,
            integrator_fee_bps=effective_fee_bps,
        )

        if quote.buy_amount <= 0:
            raise SwapError(
                f"AVNU returned a zero buy amount for {from_token}→{to_token} — "
                "refusing to quote (min-out would be 0 = unlimited slippage)"
            )

        to_amount_human = self._get_token_amount_human(str(quote.buy_amount), to_token, "starknet")
        exchange_rate = to_amount_human / amount if amount > 0 else 0
        min_out = int(quote.buy_amount * (10_000 - slippage_bps) / 10_000)

        # Stash the user's slippage on the raw quote so execution uses the exact
        # tolerance from quote time instead of lossily re-deriving it from min_out.
        quote.raw_response["suwappu_slippage_bps"] = slippage_bps

        return SwapQuote(
            provider="avnu",
            from_chain="starknet",
            to_chain="starknet",
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=str(quote.buy_amount),
            to_amount_human=to_amount_human,
            to_amount_min=str(min_out),
            gas_cost_usd=quote.gas_fees_in_usd,
            fee_cost_usd=0,
            total_cost_usd=quote.gas_fees_in_usd,
            estimated_time=30,  # Starknet block time
            price_impact=0.0,
            exchange_rate=exchange_rate,
            raw_quote=quote.raw_response,
            platform_fee_bps=effective_fee_bps,
        )

    async def _get_goatswap_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        slippage_bps: int,
    ) -> SwapQuote:
        """Get quote from GOATSwap (direct Uniswap V3 fork) for GOAT-only swaps."""
        from bot.services.goatswap_api import goatswap_api

        return await self._get_univ3_fork_quote(
            goatswap_api, from_token, to_token, amount, amount_raw, slippage_bps
        )

    async def _get_juiceswap_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        slippage_bps: int,
    ) -> SwapQuote:
        """Get quote from JuiceSwap (direct Uniswap V3 fork) for Citrea-only swaps."""
        from bot.services.univ3_fork_api import juiceswap_api

        return await self._get_univ3_fork_quote(
            juiceswap_api, from_token, to_token, amount, amount_raw, slippage_bps
        )

    async def _get_univ3_fork_quote(
        self,
        venue_api,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        slippage_bps: int,
    ) -> SwapQuote:
        """Get a quote from a direct UniV3-fork venue (GOATSwap / JuiceSwap).

        Native BTC input ("BTC") is handled via the venue's wrapped-native token
        + msg.value; native output is rejected by the venue API (v1 — receive
        the wrapped-native token instead).
        """
        from bot.services.univ3_fork_api import compute_min_out

        venue = venue_api.venue
        chain_name = venue.chain_name

        from_token_address = get_token_address(from_token, chain_name)
        to_token_address = get_token_address(to_token, chain_name)

        if not from_token_address or not to_token_address:
            raise SwapError(
                f"Token not supported on {venue.display_name}'s chain "
                f"({chain_name}): {from_token} or {to_token}"
            )

        gs_quote = await venue_api.get_quote(
            token_in=from_token_address,
            token_out=to_token_address,
            amount_in=int(amount_raw),
        )

        if gs_quote.amount_out <= 0:
            raise SwapError(
                f"{venue.display_name} returned a zero output for "
                f"{from_token}→{to_token} — refusing to quote"
            )

        min_out = compute_min_out(gs_quote.amount_out, slippage_bps)
        to_amount_human = self._get_token_amount_human(
            str(gs_quote.amount_out), to_token, chain_name
        )
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        # Honest gas estimate: 300k gas * live gas price * cached BTC price
        # (both GOAT and Citrea gas are BTC-denominated, 18 decimals). The gas
        # price is one cheap eth_gasPrice on the same RPC the quote just used;
        # the BTC price comes ONLY from the price cache — no extra HTTP fetch at
        # quote time. If either is unavailable we report 0.0 and the UI shows
        # "varies" instead of a fabricated number. The venue's gas headroom
        # (Citrea L1 fee surcharge, +15%) is included in the display estimate.
        gas_cost_usd = 0.0
        try:
            from bot.services.rpc_manager import rpc_manager
            from bot.utils.cache import price_cache

            btc_price = await price_cache.get("price_BTC") or await price_cache.get("price_WBTC")
            if btc_price:
                web3 = rpc_manager.get_web3(chain_name)
                gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)
                gas_units = venue_api.apply_gas_headroom(300_000)
                gas_cost_usd = gas_units * gas_price / 1e18 * float(btc_price)
        except Exception as e:
            logger.debug(
                f"{venue.display_name} gas cost estimate unavailable (will display 'varies'): {e}"
            )

        raw = dict(gs_quote.raw_response)
        raw.update(
            {
                "token_in": gs_quote.token_in,
                "token_out": gs_quote.token_out,
                "amount_in": gs_quote.amount_in,
                "fee_tier": gs_quote.fee_tier,
                "native_in": gs_quote.native_in,
                "suwappu_slippage_bps": slippage_bps,
            }
        )

        return SwapQuote(
            provider=venue.name,
            from_chain=chain_name,
            to_chain=chain_name,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=str(gs_quote.amount_out),
            to_amount_human=to_amount_human,
            to_amount_min=str(min_out),
            gas_cost_usd=gas_cost_usd,  # 0.0 = unknown (no cached BTC price) → UI shows "varies"
            fee_cost_usd=0,
            total_cost_usd=gas_cost_usd,
            estimated_time=5,  # both GOAT and Citrea have ~2-5s blocks
            price_impact=0.0,
            exchange_rate=exchange_rate,
            raw_quote=raw,
        )

    async def _get_tempo_dex_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        slippage: float = 0.5,
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

        # Apply slippage to the min-out. The enshrined DEX barely moves on
        # stablecoin pairs, but `quote.amount_out` is the live quote — without a
        # tolerance any micro price drift between quote and execution reverts the
        # swap. Use the smaller of the caller's slippage and the Tempo default.
        slippage_pct = min(slippage, settings.tempo_swap_slippage_pct)
        min_amount_out = int(quote.amount_out * (1 - slippage_pct / 100))

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
            to_amount_min=str(min_amount_out),
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
        platform_fee_bps: Optional[int] = None,
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
            raise SwapError(
                f"Token not supported: {from_token} on {from_chain} or {to_token} on {to_chain}"
            )

        # Use lightweight /quote endpoint (tx data fetched at execution time)
        quote = await self.okx_dex.get_quote(
            chain_id=chain_id,
            from_token=from_token_address,
            to_token=to_token_address,
            amount=amount_raw,
            slippage=slippage,
            platform_fee_bps=platform_fee_bps,
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
            platform_fee_bps=platform_fee_bps,
        )

    @staticmethod
    def _to_1inch_token(address: str) -> str:
        """Map this codebase's native sentinel (0x000…0) to 1inch's (0xEeee…EEeE)."""
        if not address or address == NATIVE_TOKEN_ADDRESS:
            return ONEINCH_NATIVE_TOKEN
        return address

    async def _get_1inch_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage: float,
        platform_fee_bps: Optional[int] = None,
    ) -> SwapQuote:
        """Get quote from the 1inch Aggregation Protocol (EVM same-chain)."""
        chain_id = ONEINCH_CHAIN_IDS.get(from_chain.lower())
        if not chain_id:
            raise SwapError(f"1inch does not support chain: {from_chain}")

        if from_chain.lower() != to_chain.lower():
            raise SwapError("1inch only supports same-chain swaps")

        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, to_chain)

        if from_token_address is None or to_token_address is None:
            raise SwapError(f"Token not supported: {from_token} or {to_token} on {from_chain}")

        quote = await self.oneinch.get_quote(
            chain_id=chain_id,
            from_token=self._to_1inch_token(from_token_address),
            to_token=self._to_1inch_token(to_token_address),
            amount=amount_raw,
            slippage=slippage,
            platform_fee_bps=platform_fee_bps,
        )

        to_amount_human = self._get_token_amount_human(quote.to_amount, to_token, to_chain)
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        # Rough gas estimate in USD (1inch returns gas units when includeGas=true).
        gas_cost_usd = 0.0
        try:
            gas_cost_usd = float(quote.estimated_gas) * 1e-9 * 2000  # rough ETH estimate
            if from_chain.lower() in ("bsc", "polygon", "fantom", "gnosis"):
                gas_cost_usd *= 0.01
        except (ValueError, TypeError):
            pass

        return SwapQuote(
            provider="1inch",
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
            estimated_time=15,
            price_impact=quote.price_impact if hasattr(quote, "price_impact") else 0.0,
            exchange_rate=exchange_rate,
            platform_fee_bps=platform_fee_bps,
            raw_quote={
                "oneinch_quote": quote.raw_response,
                "tx_data": quote.tx_data,
                "chain_id": chain_id,
            },
        )

    @staticmethod
    def _to_0x_token(address: str) -> str:
        """Map this codebase's native sentinel (0x000…0) to 0x's (0xEeee…EEeE)."""
        if not address or address == NATIVE_TOKEN_ADDRESS:
            return ZEROX_NATIVE_TOKEN
        return address

    async def _get_0x_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage: float,
        platform_fee_bps: Optional[int] = None,
    ) -> SwapQuote:
        """Get quote from the 0x Swap API v2 (EVM same-chain)."""
        chain_id = ZEROX_CHAIN_IDS.get(from_chain.lower())
        if not chain_id:
            raise SwapError(f"0x does not support chain: {from_chain}")

        if from_chain.lower() != to_chain.lower():
            raise SwapError("0x only supports same-chain swaps")

        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, to_chain)

        if from_token_address is None or to_token_address is None:
            raise SwapError(f"Token not supported: {from_token} or {to_token} on {from_chain}")

        quote = await self.zerox.get_quote(
            chain_id=chain_id,
            from_token=self._to_0x_token(from_token_address),
            to_token=self._to_0x_token(to_token_address),
            amount=amount_raw,
            slippage=slippage,
            platform_fee_bps=platform_fee_bps,
        )

        to_amount_human = self._get_token_amount_human(quote.to_amount, to_token, to_chain)
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        # Rough gas estimate in USD (0x returns gas units in the response).
        gas_cost_usd = 0.0
        try:
            gas_cost_usd = float(quote.estimated_gas) * 1e-9 * 2000  # rough ETH estimate
            if from_chain.lower() in ("bsc", "polygon", "fantom", "gnosis"):
                gas_cost_usd *= 0.01
        except (ValueError, TypeError):
            pass

        return SwapQuote(
            provider="0x",
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
            estimated_time=15,
            price_impact=quote.price_impact if hasattr(quote, "price_impact") else 0.0,
            exchange_rate=exchange_rate,
            platform_fee_bps=platform_fee_bps,
            raw_quote={
                "zerox_quote": quote.raw_response,
                "tx_data": quote.tx_data,
                "chain_id": chain_id,
            },
        )

    @staticmethod
    def _to_kyber_token(address: str) -> str:
        """Map this codebase's native sentinel (0x000…0) to KyberSwap's (0xEeee…EEeE)."""
        if not address or address == NATIVE_TOKEN_ADDRESS:
            return KYBERSWAP_NATIVE_TOKEN
        return address

    async def _get_kyberswap_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage: float,
        platform_fee_bps: Optional[int] = None,
    ) -> SwapQuote:
        """Get quote from the KyberSwap Aggregator (EVM same-chain)."""
        chain_slug = KYBERSWAP_CHAIN_SLUGS.get(from_chain.lower())
        if not chain_slug:
            raise SwapError(f"KyberSwap does not support chain: {from_chain}")

        if from_chain.lower() != to_chain.lower():
            raise SwapError("KyberSwap only supports same-chain swaps")

        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, to_chain)

        if from_token_address is None or to_token_address is None:
            raise SwapError(f"Token not supported: {from_token} or {to_token} on {from_chain}")

        quote = await self.kyberswap.get_quote(
            chain_slug=chain_slug,
            from_token=self._to_kyber_token(from_token_address),
            to_token=self._to_kyber_token(to_token_address),
            amount=amount_raw,
            slippage=slippage,
            platform_fee_bps=platform_fee_bps,
        )

        to_amount_human = self._get_token_amount_human(quote.to_amount, to_token, to_chain)
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        # KyberSwap returns gasUsd directly — no heuristic needed.
        gas_cost_usd = quote.gas_usd

        return SwapQuote(
            provider="kyberswap",
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
            estimated_time=15,
            price_impact=0.0,
            exchange_rate=exchange_rate,
            platform_fee_bps=platform_fee_bps,
            raw_quote={
                "kyberswap_quote": quote.raw_response,
                "chain_slug": chain_slug,
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

    @staticmethod
    def _rate(to_amount_human: float, amount: float) -> float:
        return (to_amount_human / amount) if amount else 0.0

    async def _get_cctp_quote(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        amount: float,
        amount_raw: str,
        slippage: float,
    ) -> SwapQuote:
        """Circle CCTP quote (zero-fee 1:1 native USDC bridging)."""
        quote = await self.cctp.get_quote(
            from_chain=from_chain, to_chain=to_chain, amount=amount_raw, slippage=slippage
        )
        raw = dict(quote.raw_data or {})
        raw.update(
            {
                "token_messenger": quote.token_messenger,
                "message_transmitter": quote.message_transmitter,
                "destination_domain": quote.destination_domain,
                "usdc_address": quote.usdc_address,
            }
        )
        return SwapQuote(
            provider="cctp",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=token,
            to_token=token,
            from_amount=quote.from_amount,
            from_amount_human=amount,
            to_amount=quote.to_amount,
            to_amount_human=quote.to_amount_human,
            to_amount_min=quote.to_amount,  # 1:1
            gas_cost_usd=quote.gas_cost_usd,
            fee_cost_usd=quote.bridge_fee_usd,
            total_cost_usd=quote.total_cost_usd,
            estimated_time=quote.estimated_time,
            price_impact=0,
            exchange_rate=1.0,
            raw_quote=raw,
        )

    async def _get_across_quote(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        to_address: Optional[str],
    ) -> SwapQuote:
        """Across Protocol quote (intent-based cross-chain)."""
        quote = await self.across.get_quote(
            from_chain=from_chain,
            to_chain=to_chain,
            token=token,
            amount=amount_raw,
            from_address=from_address,
            to_address=to_address,
        )
        # Persist the intended recipient so execution deposits to it rather than
        # defaulting to the sender wallet (the SwapQuote itself carries no
        # recipient field). None means "same as sender", the prior behavior.
        raw_quote = dict(quote.raw_quote or {})
        if to_address:
            raw_quote["recipient"] = to_address
        return SwapQuote(
            provider="across",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=token,
            to_token=token,
            from_amount=quote.from_amount,
            from_amount_human=quote.from_amount_human,
            to_amount=quote.to_amount,
            to_amount_human=quote.to_amount_human,
            to_amount_min=quote.to_amount,
            gas_cost_usd=quote.gas_cost_usd,
            fee_cost_usd=quote.relay_fee_usd,
            total_cost_usd=quote.total_cost_usd,
            estimated_time=quote.estimated_fill_time,
            price_impact=0,
            exchange_rate=self._rate(quote.to_amount_human, amount),
            raw_quote=raw_quote,
        )

    async def _get_wormhole_quote(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        amount: float,
        amount_raw: str,
    ) -> SwapQuote:
        """Wormhole quote (cross-chain incl. EVM->Solana)."""
        quote = await self.wormhole.get_quote(
            from_chain=from_chain,
            to_chain=to_chain,
            token=token,
            amount=amount_raw,
        )
        return SwapQuote(
            provider="wormhole",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=token,
            to_token=token,
            from_amount=quote.from_amount,
            from_amount_human=quote.from_amount_human,
            to_amount=quote.to_amount,
            to_amount_human=quote.to_amount_human,
            to_amount_min=quote.to_amount,
            gas_cost_usd=quote.gas_cost_usd,
            fee_cost_usd=quote.relayer_fee_usd,
            total_cost_usd=quote.total_cost_usd,
            estimated_time=quote.estimated_time,
            price_impact=0,
            exchange_rate=self._rate(quote.to_amount_human, amount),
            raw_quote=quote.raw_data,
        )

    async def _get_cow_quote(
        self,
        from_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        to_address: Optional[str],
    ) -> SwapQuote:
        """CoW Protocol quote (gasless, MEV-protected, same-chain EVM)."""
        # CoW expects token *addresses* (it calls Web3.to_checksum_address
        # internally); resolve the symbols first, same as _get_lifi_quote.
        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, from_chain)
        quote = await self.cow.get_quote(
            chain=from_chain,
            from_token=from_token_address,
            to_token=to_token_address,
            amount=amount_raw,
            from_address=from_address,
            receiver=to_address,
        )
        return SwapQuote(
            provider="cow",
            from_chain=from_chain,
            to_chain=from_chain,
            from_token=from_token,
            to_token=to_token,
            from_amount=quote.from_amount,
            from_amount_human=amount,
            to_amount=quote.to_amount,
            to_amount_human=quote.to_amount_human,
            to_amount_min=quote.to_amount,
            gas_cost_usd=0.0,  # CoW is gasless (fee taken from sell token)
            fee_cost_usd=0.0,
            total_cost_usd=0.0,
            estimated_time=60,
            price_impact=0,
            exchange_rate=self._rate(quote.to_amount_human, amount),
            raw_quote=quote.raw_quote,
        )

    async def _get_socket_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        to_address: Optional[str],
    ) -> SwapQuote:
        """Socket/Bungee super-aggregator quote (best route across bridges+DEXes)."""
        # Socket passes from/to token straight through as address query params,
        # so resolve the symbols to addresses first (per-chain), like _get_lifi_quote.
        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, to_chain)
        quote = await self.socket.get_quote(
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token_address,
            to_token=to_token_address,
            from_amount=amount_raw,
            from_address=from_address,
            to_address=to_address,
        )
        route = quote.best_route
        if route is None:
            raise SocketError("Socket returned no viable route")
        raw = {
            "routeId": route.route_id,
            "bridgeName": route.bridge_name,
            **(route.raw_route or {}),
        }
        return SwapQuote(
            provider="socket",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=to_token,
            from_amount=route.from_amount,
            from_amount_human=amount,
            to_amount=route.to_amount,
            to_amount_human=route.to_amount_human,
            to_amount_min=route.to_amount,
            gas_cost_usd=route.gas_usd,
            fee_cost_usd=route.service_fee_usd,
            total_cost_usd=route.total_fee_usd,
            estimated_time=route.estimated_time_seconds,
            price_impact=0,
            exchange_rate=self._rate(route.to_amount_human, amount),
            raw_quote=raw,
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
        if not self._is_solana_only_swap(from_chain, to_chain) and not self._is_tron_only_swap(
            from_chain, to_chain
        ):
            tasks.append(
                self._get_lifi_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    to_address,
                    slippage,
                )
            )

        # LayerZero for same-token cross-chain
        if self._is_layerzero_route(from_chain, to_chain, from_token, to_token):
            tasks.append(
                self._get_layerzero_quote(
                    from_chain, to_chain, from_token, amount, amount_raw, from_address, slippage
                )
            )

        # CCIP for same-token cross-chain EVM
        if self._is_ccip_route(from_chain, to_chain, from_token, to_token):
            tasks.append(
                self._get_ccip_quote(
                    from_chain, to_chain, from_token, amount, from_address, to_address
                )
            )

        # CCTP — zero-fee native USDC
        if self._is_cctp_route(from_chain, to_chain, from_token, to_token):
            tasks.append(
                self._get_cctp_quote(from_chain, to_chain, from_token, amount, amount_raw, slippage)
            )

        # Across — fast intent-based cross-chain
        if self._is_across_route(from_chain, to_chain, from_token, to_token):
            tasks.append(
                self._get_across_quote(
                    from_chain, to_chain, from_token, amount, amount_raw, from_address, to_address
                )
            )

        # Wormhole — cross-chain incl. EVM->Solana (Solana->EVM gated, #250)
        if self._is_wormhole_route(from_chain, to_chain, from_token, to_token):
            tasks.append(
                self._get_wormhole_quote(from_chain, to_chain, from_token, amount, amount_raw)
            )

        # CoW — gasless, MEV-protected same-chain EVM
        if self._is_cow_route(from_chain, to_chain):
            tasks.append(
                self._get_cow_quote(
                    from_chain, from_token, to_token, amount, amount_raw, from_address, to_address
                )
            )

        # Socket — super-aggregator across many EVM chains
        if self._is_socket_route(from_chain, to_chain):
            tasks.append(
                self._get_socket_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    to_address,
                )
            )

        # Jupiter for Solana
        if self._is_solana_only_swap(from_chain, to_chain):
            tasks.append(
                self._get_jupiter_quote(
                    from_token, to_token, amount, amount_raw, from_address, slippage_bps
                )
            )

        # SunSwap for TRON
        if self._is_tron_only_swap(from_chain, to_chain):
            tasks.append(
                self._get_sunswap_quote(from_token, to_token, amount, amount_raw, slippage_bps)
            )

        # OKX DEX for all chains
        if self.okx_dex.is_configured and from_chain.lower() == to_chain.lower():
            tasks.append(
                self._get_okx_dex_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                )
            )

        # 1inch (EVM same-chain only)
        if (
            self.oneinch.is_configured
            and from_chain.lower() == to_chain.lower()
            and ONEINCH_CHAIN_IDS.get(from_chain.lower())
        ):
            tasks.append(
                self._get_1inch_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                )
            )

        # 0x Swap API v2 (EVM same-chain only)
        if (
            self.zerox.is_configured
            and from_chain.lower() == to_chain.lower()
            and ZEROX_CHAIN_IDS.get(from_chain.lower())
        ):
            tasks.append(
                self._get_0x_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                )
            )

        # KyberSwap (EVM same-chain only)
        if (
            self.kyberswap.is_configured
            and from_chain.lower() == to_chain.lower()
            and KYBERSWAP_CHAIN_SLUGS.get(from_chain.lower())
        ):
            tasks.append(
                self._get_kyberswap_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                )
            )

        quotes = await self._gather_quotes([asyncio.wait_for(t, timeout=8.0) for t in tasks])

        quotes.sort(key=lambda q: q.to_amount_human, reverse=True)
        return quotes

    @track_time(MetricNames.SWAP_EXECUTE)
    async def execute_swap(
        self,
        quote: SwapQuote,
        wallet_id: int,
        user_id: int,
        idempotency_key: Optional[str] = None,
        automated: bool = False,
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
        # Hard backstop BEFORE any provider dispatch: GOAT must NEVER execute via
        # the Li.Fi/EVM aggregator path — no aggregator supports chain id 2345.
        # Checked up-front so a mis-built quote fails before locks/DB/funds.
        if "goat" in (quote.from_chain.lower(), quote.to_chain.lower()):
            if quote.provider != "goatswap":
                raise SwapError(
                    f"GOAT swaps must route via GOATSwap (got provider '{quote.provider}')"
                )

        # Same hard backstop for Citrea: chain id 4114 is absent from every
        # aggregator — only the direct JuiceSwap path may execute.
        if "citrea" in (quote.from_chain.lower(), quote.to_chain.lower()):
            if quote.provider != "juiceswap":
                raise SwapError(
                    f"Citrea swaps must route via JuiceSwap (got provider '{quote.provider}')"
                )

        # Same hard backstop for Tempo: chain id 4217 is absent from every
        # external aggregator — same-chain Tempo swaps must execute on the
        # protocol-level enshrined DEX. Without this guard a tempo quote would
        # fall through to the Li.Fi/EVM path (which can't build a Tempo tx).
        if self._is_tempo_only_swap(quote.from_chain, quote.to_chain):
            if quote.provider != "tempo_dex":
                raise SwapError(
                    f"Tempo swaps must route via the enshrined DEX "
                    f"(got provider '{quote.provider}')"
                )

        # Prevent concurrent swaps from same wallet (with bounded growth)
        if wallet_id not in self._wallet_locks:
            if len(self._wallet_locks) >= self._wallet_locks_max:
                # Evict unlocked entries to prevent unbounded memory growth
                to_remove = [k for k, v in self._wallet_locks.items() if not v.locked()]
                for k in to_remove[: len(to_remove) // 2]:
                    del self._wallet_locks[k]
            self._wallet_locks[wallet_id] = asyncio.Lock()

        async with self._wallet_locks[wallet_id]:
            # Idempotency: if we already created/submitted this attempt, return it
            if idempotency_key:

                def _check_idempotency():
                    with get_session() as session:
                        existing = (
                            session.query(SwapTransaction)
                            .filter(SwapTransaction.idempotency_key == idempotency_key)
                            .first()
                        )
                        if existing and existing.status not in [
                            SwapStatus.FAILED.value,
                            SwapStatus.CANCELLED.value,
                        ]:
                            return existing
                        return None

                existing = await run_in_db(_check_idempotency)
                if existing:
                    return existing

            # Validate quote freshness first — reject a stale quote before doing
            # any DB work or moving funds (fail-fast).
            quote_validator.validate_quote_freshness(quote)

            # Get wallet data within session
            def _get_wallet():
                with get_session() as session:
                    wallet_obj = session.query(Wallet).filter(Wallet.id == wallet_id).first()
                    if not wallet_obj:
                        return None
                    return {
                        "id": wallet_obj.id,
                        "wallet_id": wallet_obj.id,
                        "user_id": wallet_obj.user_id,
                        "address": wallet_obj.address,
                        "chain_type": wallet_obj.chain_type,
                        "encrypted_private_key": wallet_obj.encrypted_private_key,
                    }

            wallet = await run_in_db(_get_wallet)
            if not wallet:
                raise SwapError("Wallet not found")

            # Authentication binding: the wallet must belong to the caller's
            # user_id before any funds move. Without this, a caller could supply
            # a wallet_id from one user and a user_id from another (e.g. via the
            # internal /agent/execute-swap endpoint) to swap on someone else's wallet.
            if wallet["user_id"] != user_id:
                raise SwapError(f"Wallet {wallet_id} does not belong to user {user_id}")

            wallet_address = wallet["address"]
            wallet_chain_type = wallet["chain_type"]
            wallet_encrypted_key = wallet["encrypted_private_key"]

            # Spending limits: enforced here at the engine — the single choke
            # point every swap entry path (Telegram, WhatsApp, agent API,
            # orders, copy trading) funnels through. Price lookups are
            # best-effort: an unknown price must not brick all swaps, so the
            # check is skipped (and logged) when the USD value is unknowable.
            from_amount_usd = await spending_limit_service.usd_value(
                quote.from_token, quote.from_amount_human
            )
            to_amount_usd = await spending_limit_service.usd_value(
                quote.to_token, quote.to_amount_human
            )
            if from_amount_usd is not None:
                allowed, reason = await run_in_db(
                    lambda: spending_limit_service.check(user_id, from_amount_usd)
                )
                if not allowed:
                    raise SwapError(f"🚫 {reason}")
            else:
                logger.warning(
                    f"Skipping spending-limit check for user {user_id}: "
                    f"no USD price for {quote.from_token}"
                )

            # Compliance screening (UBS × Nethermind PoC model): screen the
            # addresses this swap will touch — recipient, router/bridge contract
            # and token contracts — against the allow/block lists before any
            # funds move. No-op unless compliance_mode is monitor/enforce, and
            # only EVM (0x…) addresses are screened. See
            # docs/architecture/compliance-screening.md.
            if compliance_service.enabled:
                raw_q = quote.raw_quote or {}
                recipient = (
                    raw_q.get("recipient")
                    or raw_q.get("receiver")
                    or raw_q.get("toAddress")
                    or wallet_address
                )
                router = (
                    raw_q.get("router_address")
                    or raw_q.get("router")
                    or raw_q.get("to")
                    or getattr(quote, "router_address", None)
                )
                compliance_result = compliance_service.screen(
                    recipient=recipient,
                    router=router,
                    tokens=[quote.from_token, quote.to_token],
                    chain=quote.from_chain,
                )
                if not compliance_result.allowed:
                    raise SwapError(f"🚫 {compliance_result.reason}")

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
                        from_amount_usd=from_amount_usd,
                        to_chain=quote.to_chain,
                        to_token=quote.to_token,
                        to_amount=quote.to_amount,
                        to_amount_usd=to_amount_usd,
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
                if tier in [
                    SubscriptionTier.PRO,
                    SubscriptionTier.PREMIUM,
                    SubscriptionTier.ENTERPRISE,
                ]:
                    logger.info(f"Running Deep Simulation for user {user_id} on {quote.to_token}")

                    # We simulate with a small amount of SOL for the safety test
                    # Usually 0.1 SOL is enough to trigger most tax/revert logic
                    sim_amount = min(0.1, quote.from_amount_human)

                    sim_res = await simulation_service.simulate_swap_cycle(
                        token_mint=get_token_address(
                            quote.to_token, "solana"
                        ),  # Address from quote
                        amount_sol=sim_amount,
                        user_pubkey=wallet_address,
                    )

                    if not sim_res["is_safe"]:
                        error_msg = f"Deep Simulation Blocked: {sim_res.get('reason')} - {sim_res.get('error')}"
                        logger.warning(error_msg)

                        def _mark_sim_failed():
                            with get_session() as session:
                                db_tx = (
                                    session.query(SwapTransaction)
                                    .filter(SwapTransaction.id == swap_id)
                                    .first()
                                )
                                db_tx.status = SwapStatus.FAILED.value
                                db_tx.error_message = error_msg

                        await run_in_db(_mark_sim_failed)

                        raise SwapError(
                            f"⚠️ Safety simulation FAILED: {sim_res.get('reason')}. Trade blocked to protect your funds."
                        )

                    logger.info(
                        f"Deep Simulation PASSED for {quote.to_token}. Proceeding with trade."
                    )

            try:
                # Route to appropriate execution method based on provider
                if quote.provider == "tempo_dex":
                    tx_hash = await self._execute_tempo_dex_swap(quote, wallet, user_id, automated)
                elif quote.provider == "cow":
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
                elif quote.provider == "1inch":
                    tx_hash = await self._execute_1inch_swap(quote, wallet)
                elif quote.provider == "0x":
                    tx_hash = await self._execute_0x_swap(quote, wallet)
                elif quote.provider == "kyberswap":
                    tx_hash = await self._execute_kyberswap_swap(quote, wallet)
                elif quote.provider == "avnu":
                    tx_hash = await self._execute_avnu_swap(quote, wallet)
                elif quote.provider == "goatswap":
                    tx_hash = await self._execute_goatswap_swap(quote, wallet)
                elif quote.provider == "juiceswap":
                    tx_hash = await self._execute_juiceswap_swap(quote, wallet)
                elif quote.provider == "tempo_dex":
                    tx_hash = await self._execute_tempo_dex_swap(quote, wallet, user_id)
                # (GOAT/Citrea guards live at the top of execute_swap — any
                # goat/citrea quote reaching this dispatch is guaranteed
                # provider == "goatswap"/"juiceswap")
                elif "starknet" in (quote.from_chain.lower(), quote.to_chain.lower()):
                    # Hard guard: Starknet must NEVER fall into the Li.Fi/EVM path.
                    raise SwapError(
                        f"Starknet swaps must route via AVNU (got provider '{quote.provider}')"
                    )
                else:
                    tx_hash = await self._execute_lifi_swap(quote, wallet)

                # Persist tx_hash to the database record
                def _update_tx_hash():
                    with get_session() as session:
                        db_tx = (
                            session.query(SwapTransaction)
                            .filter(SwapTransaction.id == swap_id)
                            .first()
                        )
                        if db_tx:
                            db_tx.tx_hash = tx_hash
                            db_tx.status = SwapStatus.SUBMITTED.value

                await run_in_db(_update_tx_hash)

                # Record the outflow so spending-limit windows survive restarts.
                # Best-effort: the swap is already submitted, so a tracking
                # failure must not surface as a swap failure.
                if from_amount_usd is not None:
                    try:
                        await run_in_db(
                            lambda: spending_limit_service.record(
                                user_id, from_amount_usd, swap_id=swap_id
                            )
                        )
                    except Exception as e:
                        logger.warning(f"Failed to record spend event for swap {swap_id}: {e}")

                # Invalidate balance cache so user sees updated balance
                try:
                    from bot.utils.cache import balance_cache

                    await balance_cache.delete(f"bal:{wallet_address}:{wallet_chain_type}")
                except Exception as e:
                    logger.debug(f"Failed to invalidate balance cache: {e}")

                # Publish swap.submitted event
                await event_bus.publish(
                    "swap.submitted",
                    {
                        "userId": user_id,
                        "swapId": swap_id,
                        "txHash": tx_hash,
                        "fromChain": quote.from_chain,
                        "toChain": quote.to_chain,
                        "provider": quote.provider,
                    },
                )

                try:
                    from bot.services.copy_service import copy_service

                    await copy_service.handle_swap_submitted(swap_id)
                except Exception as e:
                    logger.warning(f"Copy-trading hook failed for swap {swap_id}: {e}")

                # Update the user's average-cost spot basis for the Positions /
                # PnL view. Best-effort — the swap already succeeded, so a
                # settlement error must never propagate.
                try:
                    await self._settle_user_position(user_id, quote)
                except Exception as e:
                    logger.warning(f"User-position settlement failed for swap {swap_id}: {e}")

                # Clean up local references
                wallet_encrypted_key = None

                # Re-fetch the updated record to return
                def _refetch():
                    with get_session() as session:
                        return (
                            session.query(SwapTransaction)
                            .filter(SwapTransaction.id == swap_id)
                            .first()
                        )

                swap_tx = await run_in_db(_refetch)

                return swap_tx

            except Exception as e:
                logger.error(f"Swap execution failed: {e}", exc_info=True)

                # Classify the failure cause for analytics (best-effort — never
                # let diagnosis raise over the original error).
                try:
                    from bot.services.error_guidance import classify_swap_failure

                    error_category = classify_swap_failure(
                        e,
                        {
                            "from_chain": quote.from_chain,
                            "to_chain": quote.to_chain,
                            "from_token": quote.from_token,
                            "is_cross_chain": quote.from_chain != quote.to_chain,
                        },
                    ).category
                except Exception:  # pragma: no cover - defensive
                    error_category = "unknown"

                # Mark as failed
                def _mark_failed():
                    with get_session() as session:
                        db_tx = (
                            session.query(SwapTransaction)
                            .filter(SwapTransaction.id == swap_id)
                            .first()
                        )
                        if db_tx:
                            db_tx.status = SwapStatus.FAILED.value
                            db_tx.error_message = str(e)
                            db_tx.error_category = error_category

                await run_in_db(_mark_failed)

                # Publish swap.failed event
                await event_bus.publish(
                    "swap.failed",
                    {
                        "userId": user_id,
                        "swapId": swap_id,
                        "error": str(e),
                        "fromChain": quote.from_chain,
                        "toChain": quote.to_chain,
                        "fromToken": quote.from_token,
                        "toToken": quote.to_token,
                    },
                )

                # Clean up local references
                wallet_encrypted_key = None

                raise SwapError(f"Swap execution failed: {repr(e)}")

    async def _execute_lifi_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via Li.Fi."""
        tx_request = quote.raw_quote.get("transactionRequest", {})

        if not tx_request:
            raise SwapError("No transaction request in quote")

        wallet = await self._get_wallet_for_signing(wallet_data)
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
            session = await get_http_session()
            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "sendTransaction",
                "params": [
                    base64.b64encode(signed_tx).decode(),
                    {"encoding": "base64", "skipPreflight": False},
                ],
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
            last_error = None
            for attempt in range(3):
                web3 = self.wallet_service._get_web3(quote.from_chain)
                try:
                    return await self._execute_lifi_evm_swap(
                        quote=quote,
                        wallet_data=wallet_data,
                        wallet=wallet,
                        chain=chain,
                        web3=web3,
                        tx_request=tx_request,
                    )
                except Exception as e:
                    last_error = e
                    if not self._is_retryable_rpc_error(e) or attempt == 2:
                        raise
                    self._report_web3_failure(quote.from_chain, web3, e)
                    await asyncio.sleep(0.25 * (attempt + 1))

            raise last_error

    async def _execute_lifi_evm_swap(
        self,
        quote: SwapQuote,
        wallet_data: dict,
        wallet: Wallet,
        chain,
        web3: Web3,
        tx_request: dict,
    ) -> str:
        """Execute an EVM Li.Fi route with a selected Web3 provider."""
        sender = Web3.to_checksum_address(wallet_data["address"])
        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))

        # ERC20 approval: if swapping a token (not native), approve the LiFi contract
        from_token_address = get_token_address(quote.from_token, quote.from_chain)
        spender = Web3.to_checksum_address(tx_request.get("to"))

        if from_token_address and from_token_address != NATIVE_TOKEN_ADDRESS:
            # Check native balance before attempting approval — need ETH for gas
            native_balance_wei = await asyncio.to_thread(lambda: web3.eth.get_balance(sender))
            # Floor to the chain's network minimum (Rootstock: 60M wei / 0.06 gwei)
            gas_price = apply_min_gas_price(
                quote.from_chain, await asyncio.to_thread(lambda: web3.eth.gas_price)
            )
            # Approval costs ~50k gas; swap ~200k gas; require enough for both
            min_gas_wei = gas_price * 300_000
            if native_balance_wei < min_gas_wei:
                native_symbol = chain.native_token if chain else "ETH"
                min_eth = min_gas_wei / 1e18
                raise SwapError(
                    f"Insufficient gas. You need at least {min_eth:.5f} {native_symbol} "
                    f"on {quote.from_chain.title()} to cover transaction fees. "
                    f"Send some {native_symbol} to your wallet first."
                )

            token_addr = Web3.to_checksum_address(from_token_address)
            erc20_abi = [
                {
                    "inputs": [
                        {"name": "owner", "type": "address"},
                        {"name": "spender", "type": "address"},
                    ],
                    "name": "allowance",
                    "outputs": [{"name": "", "type": "uint256"}],
                    "type": "function",
                    "stateMutability": "view",
                },
                {
                    "inputs": [
                        {"name": "spender", "type": "address"},
                        {"name": "amount", "type": "uint256"},
                    ],
                    "name": "approve",
                    "outputs": [{"name": "", "type": "bool"}],
                    "type": "function",
                    "stateMutability": "nonpayable",
                },
            ]
            token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
            amount_needed = int(quote.from_amount)
            current_allowance = await asyncio.to_thread(
                lambda: token_contract.functions.allowance(sender, spender).call()
            )

            if current_allowance < amount_needed:
                # 'exact' mode on a reset-required token (USDT mainnet): zero the
                # allowance first, since approve() reverts non-zero -> non-zero.
                nonce = await self._send_reset_approval_if_needed(
                    web3=web3,
                    token_contract=token_contract,
                    token_addr=token_addr,
                    spender=spender,
                    current_allowance=current_allowance,
                    sender=sender,
                    chain_id=chain.chain_id,
                    gas_price=gas_price,
                    nonce=nonce,
                    wallet=wallet,
                )
                max_approval = self._approval_amount(amount_needed)
                # Pass gas explicitly to skip eth_estimateGas simulation
                approve_data = token_contract.functions.approve(
                    spender, max_approval
                ).build_transaction(
                    {
                        "from": sender,
                        "nonce": nonce,
                        "chainId": chain.chain_id,
                        "gasPrice": gas_price,
                        "gas": 100_000,
                    }
                )
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
                approve_hash = await asyncio.to_thread(
                    lambda: web3.eth.send_raw_transaction(
                        bytes.fromhex(signed_approve.replace("0x", ""))
                    )
                )
                logger.info(f"LiFi approval tx: {approve_hash.hex()}")
                await asyncio.to_thread(
                    lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
                )
                nonce += 1

        # Re-fetch nonce to account for any approval tx or pending txs
        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))

        # Build swap transaction - parse hex values from Li.Fi
        tx = {
            "to": spender,
            "data": tx_request.get("data"),
            "value": _parse_int(tx_request.get("value"), 0),
            "gas": _parse_int(tx_request.get("gasLimit"), 500000),
            # Floor to the chain's network minimum (Rootstock has no EIP-1559 and
            # rejects gasPrice below 60M wei; LiFi-provided gasPrice is floored too)
            "gasPrice": apply_min_gas_price(
                quote.from_chain,
                _parse_int(
                    tx_request.get("gasPrice"),
                    await asyncio.to_thread(lambda: web3.eth.gas_price),
                ),
            ),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        # Sign and send (routes privately via Flashbots relay when configured;
        # falls back to public RPC on any relay error).
        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        return await self._broadcast_evm_tx(web3, signed_tx_hex, chain)

    async def _broadcast_evm_tx(self, web3: Web3, signed_tx_hex: str, chain) -> str:
        """Broadcast a signed EVM tx, routing privately when configured.

        Compliant routing (UBS × Nethermind PoC, stage 2): when
        ``compliance_routing_enabled`` and the chain has a Flashbots-compatible
        relay, submit the tx privately to block builders via
        ``eth_sendPrivateTransaction``. Any relay error falls back to the public
        ``send_raw_transaction`` path, so routing can never break a swap.

        Returns the 0x-prefixed transaction hash.
        """
        raw_bytes = bytes.fromhex(signed_tx_hex.replace("0x", ""))
        chain_id = getattr(chain, "chain_id", None)

        if isinstance(chain_id, int) and flashbots_relay.should_route(chain_id):
            try:
                current_block = await asyncio.to_thread(lambda: web3.eth.block_number)
            except Exception:
                current_block = None
            result = await flashbots_relay.send_private_transaction(
                signed_tx_hex, chain_id, current_block
            )
            if result.submitted and result.tx_hash:
                return result.tx_hash
            logger.warning(
                "Private routing unavailable (%s); falling back to public RPC",
                result.error,
            )

        tx_hash = await asyncio.to_thread(lambda: web3.eth.send_raw_transaction(raw_bytes))
        return tx_hash.hex()

    @staticmethod
    def _is_retryable_rpc_error(error: Exception) -> bool:
        message = str(error).lower()
        return (
            "429" in message
            or "too many requests" in message
            or "rate limit" in message
            or "timeout" in message
        )

    @staticmethod
    def _report_web3_failure(chain_name: str, web3: Web3, error: Exception) -> None:
        provider = getattr(web3, "provider", None)
        url = getattr(provider, "endpoint_uri", None)
        if url:
            rpc_manager.report_failure(chain_name, url, str(error)[:120])

    async def _execute_jupiter_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via Jupiter."""
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        # Attach feeAccount ONLY when the quote response itself reserved a
        # platformFee — otherwise Jupiter rejects a /swap that carries a
        # feeAccount with no matching reserved fee. Gating on the quoteResponse
        # (ground truth) keeps quote and execution in lockstep regardless of how
        # the quote was produced (direct, rehydrated, snipe, get_all_quotes).
        jup_fee_account = (
            self._jupiter_fee_account(quote.from_token, quote.to_token)
            if isinstance(quote.raw_quote, dict) and quote.raw_quote.get("platformFee")
            else None
        )
        swap_tx = await self.jupiter.get_swap_transaction(
            quote_response=quote.raw_quote,
            user_public_key=wallet_data["address"],
            fee_account=jup_fee_account,
        )

        # Decode and sign transaction
        tx_bytes = base64.b64decode(swap_tx.swap_transaction)
        signed_tx = await self.wallet_service.sign_solana_transaction(wallet, tx_bytes)

        # Submit to Solana
        session = await get_http_session()
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "sendTransaction",
            "params": [
                base64.b64encode(signed_tx).decode(),
                {"encoding": "base64", "skipPreflight": False},
            ],
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
        wallet = await self._get_wallet_for_signing(wallet_data)
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

        wallet = await self._get_wallet_for_signing(wallet_data)
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

                nonce = await asyncio.to_thread(
                    lambda: web3.eth.get_transaction_count(wallet_data["address"])
                )
                approval_tx = {
                    "to": Web3.to_checksum_address(approval_tx_data.get("to", token_address)),
                    "data": approval_tx_data.get("data", ""),
                    "value": 0,
                    "gas": 60000,
                    "gasPrice": await asyncio.to_thread(lambda: web3.eth.gas_price),
                    "nonce": nonce,
                    "chainId": chain.chain_id,
                }

                signed_approval_hex = await self.wallet_service.sign_evm_transaction(
                    wallet, approval_tx
                )
                approval_hash = await asyncio.to_thread(
                    lambda: web3.eth.send_raw_transaction(
                        bytes.fromhex(signed_approval_hex.replace("0x", ""))
                    )
                )
                logger.info(f"Socket approval tx: {approval_hash.hex()}")

                # Wait for approval
                await asyncio.to_thread(
                    lambda: web3.eth.wait_for_transaction_receipt(approval_hash, timeout=120)
                )

        # Execute the main transaction
        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(wallet_data["address"])
        )
        tx = {
            "to": Web3.to_checksum_address(socket_tx.to),
            "data": socket_tx.data,
            "value": int(socket_tx.value) if socket_tx.value else 0,
            "gas": int(socket_tx.gas_limit),
            "gasPrice": await asyncio.to_thread(lambda: web3.eth.gas_price),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info(f"Socket swap tx: {tx_hash.hex()}")
        return tx_hash.hex()

    async def _execute_jito_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a Solana swap via Jupiter with Jito MEV protection.

        Jito protects swaps from sandwich attacks by:
        1. Building a Jupiter swap transaction
        2. Adding a Jito tip instruction
        3. Submitting as a bundle to Jito block engine
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        raw_quote = quote.raw_quote
        jupiter_quote = raw_quote.get("jupiter_quote", {})
        jito_tip = raw_quote.get("jito_tip", TipPriority.MEDIUM.value)

        # Attach feeAccount only when the (jito-wrapped) jupiter quote reserved a
        # platformFee — same ground-truth gate as the standard path, so we never
        # send a feeAccount Jupiter would reject.
        jup_fee_account = (
            self._jupiter_fee_account(quote.from_token, quote.to_token)
            if isinstance(jupiter_quote, dict) and jupiter_quote.get("platformFee")
            else None
        )
        swap_tx = await self.jupiter.get_swap_transaction(
            quote_response=jupiter_quote,
            user_public_key=wallet_data["address"],
            fee_account=jup_fee_account,
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

            session = await get_http_session()
            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "sendTransaction",
                "params": [
                    base64.b64encode(signed_tx).decode(),
                    {"encoding": "base64", "skipPreflight": False},
                ],
            }
            async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
                result = await resp.json()
                if "error" in result:
                    raise SwapError(f"Transaction failed: {result['error']}")
                return result["result"]

    async def _execute_ccip_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a cross-chain transfer via Chainlink CCIP."""
        from bot.services.ccip_api import CCIPQuote

        wallet = await self._get_wallet_for_signing(wallet_data)
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
            nonce = await asyncio.to_thread(
                lambda: web3.eth.get_transaction_count(wallet_data["address"])
            )
            approval_tx["nonce"] = nonce
            approval_tx["chainId"] = chain.chain_id
            approval_tx["gasPrice"] = await asyncio.to_thread(lambda: web3.eth.gas_price)

            signed_approval_hex = await self.wallet_service.sign_evm_transaction(
                wallet, approval_tx
            )
            approval_hash = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(
                    bytes.fromhex(signed_approval_hex.replace("0x", ""))
                )
            )

            # Wait for approval
            logger.info(f"CCIP approval tx: {approval_hash.hex()}")
            await asyncio.to_thread(
                lambda: web3.eth.wait_for_transaction_receipt(approval_hash, timeout=120)
            )

        # Build CCIP transfer transaction
        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(wallet_data["address"])
        )

        tx = {
            "to": Web3.to_checksum_address(transfer_data.router_address),
            "data": transfer_data.data,
            "value": int(transfer_data.value),
            "gas": transfer_data.gas_limit,
            "gasPrice": await asyncio.to_thread(lambda: web3.eth.gas_price),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        # Sign and send
        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info(f"CCIP transfer tx: {tx_hash.hex()}")
        return tx_hash.hex()

    def _get_web3_with_fallback(self, chain_name: str) -> Web3:
        """Get a Web3 instance via RPCManager (health-tracked, auto-failover)."""
        from bot.services.rpc_manager import rpc_manager

        return rpc_manager.get_web3(chain_name)

    async def _execute_goatswap_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a GOAT-only swap via GOATSwap SwapRouter02 (multicall style)."""
        from bot.services.goatswap_api import goatswap_api

        return await self._execute_univ3_fork_swap(quote, wallet_data, goatswap_api)

    async def _execute_juiceswap_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a Citrea-only swap via JuiceSwap SwapRouter (deadline-in-struct)."""
        from bot.services.univ3_fork_api import juiceswap_api

        return await self._execute_univ3_fork_swap(quote, wallet_data, juiceswap_api)

    async def _execute_univ3_fork_swap(self, quote: SwapQuote, wallet_data: dict, venue_api) -> str:
        """Execute a same-chain swap on a direct UniV3-fork venue.

        Steps:
        1. Rebuild the venue quote from stored raw_quote data (no re-quote).
        2. ERC20 input: approve the exact amount to the router, wait for receipt.
           Native BTC input: no approval — amount rides as msg.value (router
           wraps into the wrapped-native token itself).
        3. exactInputSingle per the venue's router style (GOATSwap: wrapped in
           multicall(deadline); JuiceSwap: deadline inside the params struct)
           with amountOutMinimum from the quoted min-out.

        Gas: on top of the usual 1.3x estimate buffer, the venue's
        gas_headroom_pct is applied (Citrea: +15% — the L1 fee surcharge is not
        included in eth_estimateGas).
        """
        from bot.services.univ3_fork_api import UniV3ForkQuote

        venue = venue_api.venue
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        sender = wallet_data["address"]
        chain = get_chain_by_name(venue.chain_name)
        web3 = self._get_web3_with_fallback(venue.chain_name)
        raw = quote.raw_quote or {}

        gs_quote = UniV3ForkQuote(
            token_in=raw["token_in"],
            token_out=raw["token_out"],
            amount_in=int(raw["amount_in"]),
            amount_out=int(quote.to_amount),
            fee_tier=int(raw["fee_tier"]),
            native_in=bool(raw.get("native_in")),
        )
        amount_out_min = int(quote.to_amount_min)

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(Web3.to_checksum_address(sender))
        )
        gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)

        # Step 1: exact-amount ERC20 approval (skipped for native BTC input)
        if not gs_quote.native_in:
            approve_tx = venue_api.build_approve_tx(gs_quote.token_in, gs_quote.amount_in)
            approve_tx.update(
                {
                    "gas": venue_api.apply_gas_headroom(80_000),
                    "gasPrice": gas_price,
                    "nonce": nonce,
                    "chainId": chain.chain_id,
                }
            )
            signed_approve = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
            approve_hash = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(
                    bytes.fromhex(signed_approve.replace("0x", ""))
                )
            )
            logger.info(f"{venue.display_name} approval tx: {approve_hash.hex()}")
            receipt = await asyncio.to_thread(
                lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
            )
            if receipt["status"] != 1:
                raise SwapError(
                    f"{venue.display_name} ERC20 approval failed (tx: {approve_hash.hex()})"
                )
            nonce += 1

        # Step 2: swap via the venue router (style-specific calldata)
        swap_tx = venue_api.build_swap_tx(
            quote=gs_quote,
            recipient=sender,
            amount_out_min=amount_out_min,
        )

        gas_estimate = 300_000
        try:
            gas_estimate = await asyncio.to_thread(
                lambda: web3.eth.estimate_gas(
                    {
                        "from": Web3.to_checksum_address(sender),
                        "to": swap_tx["to"],
                        "data": swap_tx["data"],
                        "value": swap_tx["value"],
                    }
                )
            )
            gas_estimate = int(gas_estimate * 1.3)
        except Exception as e:
            logger.warning(f"{venue.display_name} gas estimate failed, using default 300k: {e}")

        # Venue headroom on top (Citrea: L1 fee surcharge not in estimateGas)
        gas_estimate = venue_api.apply_gas_headroom(gas_estimate)

        swap_tx.update(
            {
                "gas": gas_estimate,
                "gasPrice": gas_price,
                "nonce": nonce,
                "chainId": chain.chain_id,
            }
        )

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, swap_tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info(
            f"{venue.display_name} exactInputSingle: {tx_hash.hex()} "
            f"({quote.from_token}→{quote.to_token} fee tier {gs_quote.fee_tier}) — "
            f"fire-and-monitor: swap receipt NOT awaited here; final status comes "
            f"from the tx poller"
        )
        return tx_hash.hex()

    async def _execute_tempo_dex_swap(
        self,
        quote: SwapQuote,
        wallet_data: dict,
        user_id: Optional[int] = None,
        automated: bool = False,
    ) -> str:
        """Execute a same-chain stablecoin swap on Tempo's enshrined DEX.

        Steps:
        1. Rebuild the swap/approval calldata from stored raw_quote (no re-quote).
        2. Approve the exact input amount to the enshrined DEX, wait for receipt.
        3. Call swapExactAmountIn with a min-out that carries a small (10 bps)
           execution buffer below the quoted out — the enshrined stablecoin DEX
           has minimal slippage, but the quote stores min-out == quoted-out, so a
           tiny buffer avoids a revert (and wasted gas) if the price ticks between
           quote and execution.

        Tempo gas is paid in TIP-20 stablecoins via legacy gasPrice (no EIP-1559),
        which matches our EVM send path everywhere else.

        Gasless path: when fee sponsorship is enabled and this user is within the
        sponsorship limits, the whole approve+swap is submitted as ONE Tempo
        type-0x76 transaction co-signed by a sponsor (fee payer) so the user pays
        no gas — see _execute_sponsored_tempo_swap(). ANY failure there falls
        through to the normal user-paid path below; sponsorship never breaks a swap.
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        sender = wallet_data["address"]
        chain = get_chain_by_name("tempo")
        web3 = self._get_web3_with_fallback("tempo")
        raw = quote.raw_quote or {}

        amount_in = int(raw["amount_in"])
        # 10 bps execution buffer below the quoted/stored min-out (see docstring).
        min_amount_out = int(int(quote.to_amount_min) * 9990 // 10000)

        # --- Gasless (fee-payer) path, best-effort ---------------------------
        # Works for Turnkey wallets (sign via enclave) and local-key wallets alike.
        if user_id is not None and tempo_fee_sponsor.enabled:
            decision = tempo_fee_sponsor.check_sponsorship(user_id, tx_type="swap")
            if decision.should_sponsor:
                # Automated swaps (DCA/limit/snipe) sign with the user's scoped,
                # on-chain-capped access key if they granted one — no root key,
                # no re-auth. Manual swaps keep root signing.
                access_key = None
                if automated:
                    from bot.services.tempo_keychain import tempo_keychain_service

                    access_key = tempo_keychain_service.get_active_key(user_id)
                try:
                    tx_hash = await self._execute_sponsored_tempo_swap(
                        wallet=wallet,
                        sender=sender,
                        token_in=quote.from_token,
                        token_out=quote.to_token,
                        amount_in=amount_in,
                        min_amount_out=min_amount_out,
                        web3=web3,
                        chain_id=chain.chain_id,
                        access_key=access_key,
                    )
                    # Tempo gas is sub-$0.001; record against the daily budget.
                    tempo_fee_sponsor.record_sponsored_tx(user_id, fee_usd=0.001)
                    return tx_hash
                except Exception as e:
                    logger.warning(
                        f"Tempo sponsored (gasless) swap failed; "
                        f"falling back to user-paid path: {e}"
                    )
            else:
                logger.debug(f"Tempo sponsorship declined for {user_id}: {decision.reason}")

        txs = tempo_dex_api.build_swap_tx(
            token_in=quote.from_token,
            token_out=quote.to_token,
            amount_in=amount_in,
            min_amount_out=min_amount_out,
            sender=sender,
        )

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(Web3.to_checksum_address(sender))
        )
        gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)

        async def _send_and_wait(tx: dict, gas: int, label: str) -> None:
            """Sign, broadcast, and confirm a single legacy-gas Tempo tx."""
            nonlocal nonce
            tx = dict(tx)
            tx.update(
                {
                    "to": Web3.to_checksum_address(tx["to"]),
                    "value": tx.get("value", 0),
                    "gas": gas,
                    "gasPrice": gas_price,
                    "nonce": nonce,
                    "chainId": chain.chain_id,
                }
            )
            signed = await self.wallet_service.sign_evm_transaction(wallet, tx)
            sent = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed.replace("0x", "")))
            )
            logger.info(f"Tempo {label} tx: {sent.hex()}")
            rcpt = await asyncio.to_thread(
                lambda: web3.eth.wait_for_transaction_receipt(sent, timeout=120)
            )
            if rcpt["status"] != 1:
                raise SwapError(f"Tempo {label} failed (tx: {sent.hex()})")
            nonce += 1

        # Step 1: approval — gasless EIP-2612 permit (TIP-1004) when enabled and the
        # wallet can sign locally; otherwise a standard approve() tx. A permit folds
        # approval into the swap path and replaces the separate approve() send.
        token_in_addr = raw.get("token_in") or get_token_address(quote.from_token, "tempo")
        permit_used = False
        swap_source = txs
        if settings.tempo_use_permit and not wallet.is_turnkey_wallet and token_in_addr:
            owner_key = None
            try:
                from bot.services.tempo_tip20 import tempo_tip20

                owner_key = self.wallet_service.get_private_key(wallet)
                if not owner_key.startswith("0x"):
                    owner_key = "0x" + owner_key
                v, r, s, deadline = await tempo_tip20.build_permit_signature(
                    token_address=token_in_addr,
                    owner_key=owner_key,
                    spender=tempo_dex_api.dex_address,
                    value=amount_in,
                )
                permit_bundle = tempo_dex_api.build_permit_swap_tx(
                    token_in=quote.from_token,
                    token_out=quote.to_token,
                    amount_in=amount_in,
                    min_amount_out=min_amount_out,
                    sender=sender,
                    permit_v=v,
                    permit_r=r,
                    permit_s=s,
                    permit_deadline=deadline,
                )
                await _send_and_wait(permit_bundle["permit_tx"], 120_000, "permit")
                swap_source = permit_bundle
                permit_used = True
            except Exception as e:
                logger.warning(f"Tempo permit approval failed, falling back to approve(): {e}")
            finally:
                if owner_key:
                    owner_key = None  # scrub the raw key reference

        if not permit_used:
            await _send_and_wait(txs["approval_tx"], 80_000, "approval")

        # Step 2: swapExactAmountIn on the enshrined DEX.
        swap_tx = dict(swap_source["swap_tx"])
        gas_estimate = 250_000
        try:
            gas_estimate = await asyncio.to_thread(
                lambda: web3.eth.estimate_gas(
                    {
                        "from": Web3.to_checksum_address(sender),
                        "to": swap_tx["to"],
                        "data": swap_tx["data"],
                        "value": swap_tx["value"],
                    }
                )
            )
            gas_estimate = int(gas_estimate * 1.3)
        except Exception as e:
            logger.warning(f"Tempo DEX gas estimate failed, using default 250k: {e}")

        swap_tx.update(
            {
                "gas": gas_estimate,
                "gasPrice": gas_price,
                "nonce": nonce,
                "chainId": chain.chain_id,
            }
        )

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, swap_tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )
        logger.info(
            f"Tempo DEX swapExactAmountIn: {tx_hash.hex()} "
            f"({quote.from_token}→{quote.to_token}) — fire-and-monitor: swap receipt "
            f"NOT awaited here; final status comes from the tx poller"
        )
        return tx_hash.hex()

    async def _execute_sponsored_tempo_swap(
        self,
        *,
        wallet,
        sender: str,
        token_in: str,
        token_out: str,
        amount_in: int,
        min_amount_out: int,
        web3,
        chain_id: int,
        access_key=None,
    ) -> str:
        """Submit a gasless Tempo swap as ONE type-0x76 fee-payer transaction.

        When ``access_key`` (a TempoAccessKey) is given — the automated path — the
        sender slot is signed by the scoped, on-chain-capped access key
        (KeychainSignature) instead of the root wallet, so no root key or per-trade
        re-auth is needed. The sponsor still pays gas.

        approve(DEX, amount_in) + swapExactAmountIn are batched into a single
        Tempo Transaction:
          - the user (sender) signs the sender hash with fee_token omitted
            (``awaiting_fee_payer=True``),
          - a sponsor HotWallet counter-signs as fee payer, choosing the fee
            token (pathUSD) and paying gas,
          - the dual-signed tx is broadcast via ``eth_sendRawTransaction``.

        Uses the official ``pytempo`` SDK so the type-0x76 RLP layout and the
        domain-separated (0x76 sender / 0x78 fee-payer) secp256k1 signatures are
        not hand-rolled. Both signatures are produced through _tempo_signature(),
        which signs the pre-computed hash via Turnkey (enclave) for Turnkey wallets
        or a local key otherwise — so this works for production Turnkey users AND
        local-key dev. Raises on ANY failure so the caller falls back to the
        user-paid path — sponsorship must never break a swap.
        """
        import attrs
        from pytempo import TempoTransaction
        from pytempo.contracts import TIP20, StablecoinDEX, PATH_USD

        from bot.config.tokens import get_token_address
        from bot.models.custodial import HotWallet
        from bot.services.hot_wallet import hot_wallet_service
        from database.db import get_session

        addr_in = get_token_address(token_in, "tempo")
        addr_out = get_token_address(token_out, "tempo")
        if not addr_in or not addr_out:
            raise SwapError(f"Tempo token pair {token_in}/{token_out} not available")
        fee_token = get_token_address(tempo_fee_sponsor.fee_token, "tempo") or PATH_USD

        # Load the sponsor (fee payer) hot wallet by configured name. For a local-key
        # sponsor we pull the raw key here (off the event loop); a Turnkey sponsor
        # signs via the enclave and exposes no key.
        sponsor_name = tempo_fee_sponsor.sponsor_wallet_name

        def _load_sponsor():
            with get_session() as session:
                sw = (
                    session.query(HotWallet)
                    .filter(HotWallet.name == sponsor_name, HotWallet.is_active == True)
                    .first()
                )
                if not sw:
                    raise SwapError(f"Tempo fee-sponsor wallet '{sponsor_name}' not found/active")
                turnkey = sw.is_turnkey_wallet
                return (
                    sw.address,
                    turnkey,
                    (None if turnkey else hot_wallet_service.get_private_key(sw)),
                )

        sponsor_address, sponsor_turnkey, sponsor_key = await asyncio.to_thread(_load_sponsor)

        # Tempo T2: fee payer must not equal sender.
        if sponsor_address.lower() == sender.lower():
            raise SwapError("Tempo fee payer cannot equal sender")

        sender_turnkey = wallet.is_turnkey_wallet
        # Root key only needed when NOT using an access key (and not Turnkey).
        sender_key = (
            None
            if (sender_turnkey or access_key is not None)
            else self.wallet_service.get_private_key(wallet)
        )

        # nonce_key 0 == protocol nonce, which is the standard account nonce.
        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(Web3.to_checksum_address(sender))
        )
        gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price) or 2_000_000_000

        calls = (
            TIP20(Web3.to_checksum_address(addr_in)).approve(
                spender=StablecoinDEX.ADDRESS, amount=amount_in
            ),
            StablecoinDEX.swap_exact_amount_in(
                token_in=Web3.to_checksum_address(addr_in),
                token_out=Web3.to_checksum_address(addr_out),
                amount_in=amount_in,
                min_amount_out=min_amount_out,
            ),
        )

        tx = TempoTransaction.create(
            chain_id=chain_id,
            gas_limit=400_000,  # approve+swap on precompiles; ample headroom
            max_fee_per_gas=gas_price * 2,
            max_priority_fee_per_gas=gas_price,
            nonce=nonce,
            awaiting_fee_payer=True,  # sender does NOT commit to a fee token
            calls=calls,
        )

        # 1) Sign the 0x76 sender hash. Automated path: the scoped access key signs
        #    (KeychainSignature) on behalf of the root. Else the root wallet signs.
        if access_key is not None:
            from bot.services.tempo_keychain import tempo_keychain_service

            tx = tempo_keychain_service.sign_swap_with_access_key(tx, sender, access_key)
        else:
            sender_sig = await self._tempo_signature(
                address=sender,
                is_turnkey=sender_turnkey,
                raw_key=sender_key,
                hash32=tx.get_signing_hash(for_fee_payer=False),
            )
            tx = attrs.evolve(tx, sender_signature=sender_sig, sender_address=sender)

        # 2) Set the fee token, then the sponsor counter-signs the 0x78 hash (which
        #    commits to fee_token + sender_address).
        tx = attrs.evolve(tx, fee_token=fee_token)
        fee_payer_sig = await self._tempo_signature(
            address=sponsor_address,
            is_turnkey=sponsor_turnkey,
            raw_key=sponsor_key,
            hash32=tx.get_signing_hash(for_fee_payer=True),
        )
        tx = attrs.evolve(tx, fee_payer_signature=fee_payer_sig)

        raw = tx.encode()
        tx_hash = await asyncio.to_thread(lambda: web3.eth.send_raw_transaction(raw).hex())
        logger.info(
            f"Tempo gasless swap (type-0x76, fee payer {sponsor_address[:10]}…): "
            f"{tx_hash} ({token_in}→{token_out}) — fire-and-monitor: receipt NOT "
            f"awaited here; final status comes from the tx poller"
        )
        return tx_hash

    async def _tempo_signature(self, *, address: str, is_turnkey: bool, raw_key, hash32: bytes):
        """Sign a 32-byte Tempo signing hash, returning a pytempo ``Signature``.

        Turnkey wallets sign inside the enclave (no key leaves Turnkey); local-key
        wallets sign with eth_account — both yield the same canonical Signature so
        the caller attaches it via ``attrs.evolve`` regardless of provider.
        """
        if is_turnkey:
            from bot.services.tempo_turnkey_signer import sign_tempo_hash

            return await sign_tempo_hash(address, hash32)

        from eth_account import Account
        from pytempo.models import Signature

        key = raw_key if raw_key.startswith("0x") else "0x" + raw_key
        signed = Account.from_key(key).unsafe_sign_hash(hash32)
        return Signature(r=signed.r, s=signed.s, v=signed.v)

    async def _execute_layerzero_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a cross-chain transfer via LayerZero/Stargate V2.

        Steps:
        1. Rebuild tx from stored quote data (no extra RPC calls)
        2. Approve ERC20 spend to Stargate pool (wait for receipt)
        3. Call sendToken() on the Stargate pool contract
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
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

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(Web3.to_checksum_address(sender))
        )
        gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)

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
            approve_hash = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(
                    bytes.fromhex(signed_approve.replace("0x", ""))
                )
            )
            logger.info(f"Stargate approval tx: {approve_hash.hex()}")

            # Wait for approval to confirm (up to 60s)
            receipt = await asyncio.to_thread(
                lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=60)
            )
            if receipt["status"] != 1:
                raise SwapError(f"ERC20 approval failed (tx: {approve_hash.hex()})")
            logger.info(f"Stargate approval confirmed in block {receipt['blockNumber']}")
            nonce += 1

        # Step 2: sendToken on Stargate pool
        send_tx_data = tx_bundle["send_tx"]

        # Estimate gas with fallback
        gas_estimate = 350_000
        try:
            gas_estimate = await asyncio.to_thread(
                lambda: web3.eth.estimate_gas(
                    {
                        "from": Web3.to_checksum_address(sender),
                        "to": Web3.to_checksum_address(send_tx_data["to"]),
                        "data": send_tx_data["data"],
                        "value": send_tx_data["value"],
                    }
                )
            )
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
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info(
            f"Stargate V2 sendToken: {tx_hash.hex()} "
            f"({quote.from_chain}→{quote.to_chain} {quote.from_token})"
        )
        return tx_hash.hex()

    async def _execute_cctp_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a USDC transfer via Circle CCTP (cheapest for USDC)."""
        wallet = await self._get_wallet_for_signing(wallet_data)
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

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(wallet_data["address"])
        )
        approve_tx["gas"] = 60000
        approve_tx["gasPrice"] = await asyncio.to_thread(lambda: web3.eth.gas_price)
        approve_tx["nonce"] = nonce
        approve_tx["chainId"] = chain.chain_id

        signed_approve_hex = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
        approve_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(
                bytes.fromhex(signed_approve_hex.replace("0x", ""))
            )
        )
        logger.info(f"CCTP approval tx: {approve_hash.hex()}")

        # Wait for approval confirmation
        await asyncio.to_thread(
            lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
        )

        # Step 2: Execute depositForBurn
        burn_tx = self.cctp.build_burn_transaction(
            cctp_quote, wallet_data["address"], wallet_data["address"]  # Same recipient
        )

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(wallet_data["address"])
        )
        burn_tx["gas"] = 200000
        burn_tx["gasPrice"] = await asyncio.to_thread(lambda: web3.eth.gas_price)
        burn_tx["nonce"] = nonce
        burn_tx["chainId"] = chain.chain_id

        signed_burn_hex = await self.wallet_service.sign_evm_transaction(wallet, burn_tx)
        burn_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_burn_hex.replace("0x", "")))
        )

        logger.info(f"CCTP burn tx: {burn_hash.hex()}")
        return burn_hash.hex()

    async def _execute_across_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a bridge via Across Protocol (cheap EVM bridges)."""
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        chain = get_chain_by_name(quote.from_chain)
        web3 = rpc_manager.get_web3(quote.from_chain)

        # Honor the recipient captured at quote time; fall back to the sender.
        recipient = (quote.raw_quote or {}).get("recipient") or wallet_data["address"]

        # Get fresh quote with deposit data (for the same recipient)
        across_quote = await self.across.get_quote(
            from_chain=quote.from_chain,
            to_chain=quote.to_chain,
            token=quote.from_token,
            amount=quote.from_amount,
            from_address=wallet_data["address"],
            to_address=recipient,
        )

        # Check if token needs approval (not ETH)
        if (
            quote.from_token.upper() not in ["ETH", "WETH"]
            or self.across.get_token_address(quote.from_token, quote.from_chain)
            != "0x0000000000000000000000000000000000000000"
        ):
            # Approve token for SpokePool
            token_address = self.across.get_token_address(quote.from_token, quote.from_chain)

            erc20_approve_abi = [
                {
                    "inputs": [
                        {"name": "spender", "type": "address"},
                        {"name": "amount", "type": "uint256"},
                    ],
                    "name": "approve",
                    "outputs": [{"name": "", "type": "bool"}],
                    "stateMutability": "nonpayable",
                    "type": "function",
                }
            ]

            token_contract = web3.eth.contract(
                address=Web3.to_checksum_address(token_address), abi=erc20_approve_abi
            )

            approve_data = token_contract.encode_abi(
                "approve",
                args=[Web3.to_checksum_address(across_quote.spoke_pool), int(quote.from_amount)],
            )

            nonce = await asyncio.to_thread(
                lambda: web3.eth.get_transaction_count(wallet_data["address"])
            )
            approve_tx = {
                "to": Web3.to_checksum_address(token_address),
                "data": approve_data,
                "value": 0,
                "gas": 60000,
                "gasPrice": await asyncio.to_thread(lambda: web3.eth.gas_price),
                "nonce": nonce,
                "chainId": chain.chain_id,
            }

            signed_approve_hex = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
            approve_hash = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(
                    bytes.fromhex(signed_approve_hex.replace("0x", ""))
                )
            )
            logger.info(f"Across approval tx: {approve_hash.hex()}")

            # Wait for approval
            await asyncio.to_thread(
                lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
            )

        # Build deposit transaction — deposit to the intended recipient.
        deposit_tx = self.across.build_deposit_calldata(
            across_quote,
            wallet_data["address"],
            to_address=recipient,
        )

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(wallet_data["address"])
        )
        deposit_tx["gas"] = 300000
        deposit_tx["gasPrice"] = await asyncio.to_thread(lambda: web3.eth.gas_price)
        deposit_tx["nonce"] = nonce
        deposit_tx["chainId"] = chain.chain_id

        signed_deposit_hex = await self.wallet_service.sign_evm_transaction(wallet, deposit_tx)
        deposit_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(
                bytes.fromhex(signed_deposit_hex.replace("0x", ""))
            )
        )

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

        wallet = await self._get_wallet_for_signing(wallet_data)
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

        erc20_approve_abi = [
            {
                "inputs": [
                    {"name": "spender", "type": "address"},
                    {"name": "amount", "type": "uint256"},
                ],
                "name": "approve",
                "outputs": [{"name": "", "type": "bool"}],
                "stateMutability": "nonpayable",
                "type": "function",
            }
        ]

        token_contract = web3.eth.contract(
            address=Web3.to_checksum_address(token_address), abi=erc20_approve_abi
        )

        approve_data = token_contract.encode_abi(
            "approve", args=[Web3.to_checksum_address(token_bridge), int(quote.from_amount)]
        )

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(wallet_data["address"])
        )
        approve_tx = {
            "to": Web3.to_checksum_address(token_address),
            "data": approve_data,
            "value": 0,
            "gas": 60000,
            "gasPrice": await asyncio.to_thread(lambda: web3.eth.gas_price),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        signed_approve_hex = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
        approve_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(
                bytes.fromhex(signed_approve_hex.replace("0x", ""))
            )
        )
        logger.info(f"Wormhole approval tx: {approve_hash.hex()}")

        # Wait for approval
        await asyncio.to_thread(
            lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
        )

        # Step 2: Transfer tokens via Token Bridge
        transfer_tx = self.wormhole.build_transfer_calldata_evm(
            wormhole_quote,
            wallet_data["address"],
        )

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(wallet_data["address"])
        )
        transfer_tx["gas"] = 300000
        transfer_tx["gasPrice"] = await asyncio.to_thread(lambda: web3.eth.gas_price)
        transfer_tx["nonce"] = nonce
        transfer_tx["chainId"] = chain.chain_id

        signed_transfer_hex = await self.wallet_service.sign_evm_transaction(wallet, transfer_tx)
        transfer_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(
                bytes.fromhex(signed_transfer_hex.replace("0x", ""))
            )
        )

        logger.info(f"Wormhole transfer tx: {transfer_hash.hex()}")
        return transfer_hash.hex()

    async def _execute_sunswap_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via SunSwap V2 on TRON.

        Steps:
        1. Check & send TRC20 approval if needed (token -> token or token -> TRX)
        2. Build swap transaction via SunSwap V2 Router
        3. Sign and broadcast via TronGrid
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
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

    async def _execute_avnu_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a Starknet swap via AVNU.

        Routing (Phase 2):
        - Wallet undeployed or no STRK for gas → SNIP-29 paymaster path
          (deploy_and_invoke when undeployed; gas sponsored or paid in a
          held gas token). ONLY pre-submission paymaster failures
          (PaymasterUnavailableError) fall back to the direct path below;
          once the paymaster tx may have been dispatched
          (PaymasterSubmittedError) we never re-execute.
        - Otherwise: ensure deployed, then sign+send approve+swap as a single
          v3 (STRK-fee) multicall — the approval is exact-amount, never infinite.

        Key-material note: _zeroize_str scrubs only the private-key STRING;
        the int copies of the key held inside starknet_py's KeyPair (Python
        ints are immutable) cannot be zeroized and live until GC.
        """
        from bot.services.avnu_api import avnu_api, AvnuQuote, _to_int
        from bot.services.starknet.client import get_starknet_account
        from bot.services.starknet.paymaster import (
            PaymasterSubmittedError,
            PaymasterUnavailableError,
        )
        from bot.services.wallet import _zeroize_str

        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        sell_token_address = get_token_address(quote.from_token, "starknet")
        buy_token_address = get_token_address(quote.to_token, "starknet")
        if not sell_token_address or not buy_token_address:
            raise SwapError(
                f"Token not supported on Starknet: {quote.from_token} or {quote.to_token}"
            )

        # The approve amount must be AVNU's own sellAmount (the value the route
        # was built for), not our pre-quote input — they can differ.
        sell_amount = _to_int(quote.raw_quote.get("sellAmount"))
        if sell_amount <= 0:
            raise SwapError("AVNU quote is missing sellAmount — re-quote and try again")

        avnu_quote = AvnuQuote(
            quote_id=quote.raw_quote.get("quoteId", ""),
            sell_token_address=sell_token_address,
            buy_token_address=buy_token_address,
            sell_amount=sell_amount,
            buy_amount=int(quote.to_amount),
            gas_fees_in_usd=quote.gas_cost_usd,
            integrator_fees_bps=quote.platform_fee_bps or 0,
            raw_response=quote.raw_quote,
        )
        if not avnu_quote.quote_id:
            raise SwapError("AVNU quote is missing quoteId — re-quote and try again")

        # Use the exact slippage the user quoted with (stashed at quote time);
        # only fall back to the lossy min-out derivation for stale quotes.
        slippage_bps = quote.raw_quote.get("suwappu_slippage_bps")
        if slippage_bps is not None:
            slippage = max(0.001, int(slippage_bps) / 10_000)
        else:
            to_amount = int(quote.to_amount)
            to_amount_min = int(quote.to_amount_min)
            slippage = max(0.001, 1 - (to_amount_min / to_amount)) if to_amount > 0 else 0.005

        # Decide whether the gasless paymaster path applies: wallet not yet
        # deployed, or deployed but holding no STRK to self-pay v3 fees.
        use_paymaster = False
        deployed = True
        if settings.starknet_paymaster_enabled:
            try:
                deployed = await self.wallet_service.is_starknet_deployed(wallet.address)
                if deployed:
                    strk_balance = await self.wallet_service.get_starknet_token_balance(
                        "STRK", wallet.address
                    )
                    use_paymaster = strk_balance <= 0
                else:
                    use_paymaster = True
            except Exception as e:
                logger.warning("Paymaster eligibility check failed: %s", str(e)[:200])

        private_key = self.wallet_service.get_private_key(wallet)
        try:
            account = await get_starknet_account(private_key, wallet.address)

            paymaster_error: Optional[Exception] = None
            tx_hash: Optional[str] = None
            if use_paymaster:
                try:
                    tx_hash = await self._execute_avnu_swap_via_paymaster(
                        account, wallet, avnu_quote, slippage, deployed
                    )
                except PaymasterUnavailableError as e:
                    # Tx definitely NOT submitted — safe to fall back.
                    paymaster_error = e
                    logger.warning(
                        "AVNU paymaster swap failed before submission (%s); "
                        "falling back to direct execution",
                        str(e)[:200],
                    )
                except PaymasterSubmittedError as e:
                    # The paymaster tx MAY have landed — NEVER fire the direct
                    # path (double-execution risk). Poll briefly, then tell the
                    # user to check their balance.
                    logger.warning(
                        "AVNU paymaster swap dispatched without a usable response "
                        "(%s); refusing direct fallback",
                        str(e)[:200],
                    )
                    for _ in range(3):
                        await asyncio.sleep(5)
                        try:
                            if not deployed and await self.wallet_service.is_starknet_deployed(
                                wallet.address
                            ):
                                break
                            await account.get_nonce()
                        except Exception:
                            pass
                    raise SwapError(
                        "Your swap was submitted via the gasless paymaster but we did "
                        "not receive a confirmation — it may still confirm on-chain. "
                        "Check your balance shortly before retrying."
                    ) from e

            if tx_hash is None:
                try:
                    # Counterfactual accounts must be deployed before their first invoke
                    await self.wallet_service.ensure_starknet_deployed(wallet)
                    tx_hash = await avnu_api.execute_swap(account, avnu_quote, slippage=slippage)
                except Exception as direct_error:
                    if paymaster_error is not None:
                        raise SwapError(
                            "Starknet swap failed via both the gasless paymaster "
                            f"({str(paymaster_error)[:150]}) and direct execution "
                            f"({str(direct_error)[:150]})"
                        ) from direct_error
                    raise
        finally:
            _zeroize_str(private_key)

        logger.info(f"AVNU swap tx: {tx_hash} ({quote.from_token}→{quote.to_token})")
        return tx_hash

    async def _execute_avnu_swap_via_paymaster(
        self,
        account,
        wallet,
        avnu_quote,
        slippage: float,
        deployed: bool,
    ) -> str:
        """Execute an AVNU swap through the SNIP-29 paymaster.

        Gas token: sponsored when an API key is configured; otherwise the
        first of STRK → ETH → USDC that the paymaster supports AND the wallet
        holds. The sell token itself is used only as a last resort (gas fees
        would eat into the exact-approved sell amount and could revert the
        swap). Undeployed wallets go through deploy_and_invoke with the Argent
        deployment data derived from the account's stark pubkey.
        """
        from bot.config import starknet_addresses as sn
        from bot.services.avnu_api import avnu_api
        from bot.services.starknet.paymaster import avnu_paymaster, build_argent_deployment

        gas_token = None
        if not settings.avnu_paymaster_api_key:
            supported = await avnu_paymaster.get_supported_tokens()
            supported_addrs = set()
            for t in supported:
                addr = t.get("token_address") or t.get("tokenAddress") or t.get("address")
                if addr:
                    supported_addrs.add(int(str(addr), 16))
            # Priority: STRK → ETH → USDC (supported by the paymaster AND held).
            for symbol, token_addr in (("STRK", sn.STRK), ("ETH", sn.ETH), ("USDC", sn.USDC)):
                if int(token_addr, 16) not in supported_addrs:
                    continue
                try:
                    balance = await self.wallet_service.get_starknet_token_balance(
                        symbol, wallet.address
                    )
                except Exception as e:
                    logger.warning(
                        "Gas-token balance check failed for %s: %s", symbol, str(e)[:100]
                    )
                    continue
                if balance > 0:
                    gas_token = token_addr
                    break
            if gas_token is None:
                if int(str(avnu_quote.sell_token_address), 16) in supported_addrs:
                    gas_token = avnu_quote.sell_token_address
                    logger.warning(
                        "Paymaster gas will be paid in the sell token %s (last resort) — "
                        "fees reduce the exact-approved sell amount and the swap may revert",
                        avnu_quote.sell_token_address,
                    )
                else:
                    raise SwapError(
                        "Paymaster accepts none of your STRK/ETH/USDC balances "
                        "nor the sell token as gas token"
                    )

        deployment = None
        if not deployed:
            deployment = build_argent_deployment(wallet.address, account.signer.public_key)

        calls = await avnu_api.prepare_swap_calls(
            taker_address=hex(account.address), quote=avnu_quote, slippage=slippage
        )
        tx_hash = await avnu_paymaster.execute_calls_via_paymaster(
            account, calls, gas_token=gas_token, deployment=deployment
        )
        logger.info("AVNU paymaster swap submitted: %s", tx_hash)
        return tx_hash

    async def _execute_okx_dex_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via OKX DEX Aggregator.

        OKX returns transaction calldata — we sign and broadcast like Li.Fi.
        Supports EVM, Solana, and TRON chains.
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
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
                platform_fee_bps=quote.platform_fee_bps,
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
                    {"encoding": "base64", "skipPreflight": False},
                ],
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
                    {
                        "inputs": [
                            {"name": "owner", "type": "address"},
                            {"name": "spender", "type": "address"},
                        ],
                        "name": "allowance",
                        "outputs": [{"name": "", "type": "uint256"}],
                        "type": "function",
                        "stateMutability": "view",
                    },
                    {
                        "inputs": [
                            {"name": "spender", "type": "address"},
                            {"name": "amount", "type": "uint256"},
                        ],
                        "name": "approve",
                        "outputs": [{"name": "", "type": "bool"}],
                        "type": "function",
                        "stateMutability": "nonpayable",
                    },
                ]
                token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
                amount_needed = int(quote.from_amount)
                current_allowance = await asyncio.to_thread(
                    lambda: token_contract.functions.allowance(sender, spender).call()
                )

                if current_allowance < amount_needed:
                    nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
                    gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)
                    # 'exact' mode on a reset-required token (USDT mainnet): zero the
                    # allowance first, since approve() reverts non-zero -> non-zero.
                    nonce = await self._send_reset_approval_if_needed(
                        web3=web3,
                        token_contract=token_contract,
                        token_addr=token_addr,
                        spender=spender,
                        current_allowance=current_allowance,
                        sender=sender,
                        chain_id=chain.chain_id,
                        gas_price=gas_price,
                        nonce=nonce,
                        wallet=wallet,
                    )
                    max_approval = self._approval_amount(amount_needed)
                    approve_data = token_contract.functions.approve(
                        spender, max_approval
                    ).build_transaction(
                        {
                            "from": sender,
                            "nonce": nonce,
                            "chainId": chain.chain_id,
                            "gasPrice": gas_price,
                        }
                    )
                    approve_tx = {
                        "to": token_addr,
                        "data": approve_data["data"],
                        "value": 0,
                        "gas": approve_data.get("gas", 60000),
                        "gasPrice": approve_data["gasPrice"],
                        "nonce": nonce,
                        "chainId": chain.chain_id,
                    }
                    signed_approve = await self.wallet_service.sign_evm_transaction(
                        wallet, approve_tx
                    )
                    approve_hash = await asyncio.to_thread(
                        lambda: web3.eth.send_raw_transaction(
                            bytes.fromhex(signed_approve.replace("0x", ""))
                        )
                    )
                    logger.info(f"OKX DEX approval tx: {approve_hash.hex()}")
                    await asyncio.to_thread(
                        lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
                    )

            nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
            tx = {
                "to": spender,
                "data": tx_data.get("data", ""),
                "value": _parse_int(tx_data.get("value"), 0),
                "gas": _parse_int(tx_data.get("gas"), 500000),
                "gasPrice": _parse_int(
                    tx_data.get("gasPrice"), await asyncio.to_thread(lambda: web3.eth.gas_price)
                ),
                "nonce": nonce,
                "chainId": chain.chain_id,
            }

            signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
            tx_hash = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(
                    bytes.fromhex(signed_tx_hex.replace("0x", ""))
                )
            )

            logger.info(f"OKX DEX swap tx: {tx_hash.hex()}")
            return tx_hash.hex()

    async def _execute_1inch_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via the 1inch Aggregation Protocol (EVM-only).

        1inch returns ready-to-broadcast tx calldata ({to, data, value, gas, gasPrice});
        we handle ERC20 approval to the 1inch router, then sign and broadcast — the
        same flow as the OKX/Li.Fi EVM path.
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        chain_id = quote.raw_quote.get("chain_id") or ONEINCH_CHAIN_IDS.get(
            quote.from_chain.lower()
        )
        if not chain_id:
            raise SwapError(f"1inch does not support chain: {quote.from_chain}")

        from_token_address = get_token_address(quote.from_token, quote.from_chain)
        to_token_address = get_token_address(quote.to_token, quote.to_chain)

        # Always fetch fresh tx calldata at execution time (the race used /quote only).
        swap_result = await self.oneinch.get_swap(
            chain_id=chain_id,
            from_token=self._to_1inch_token(from_token_address),
            to_token=self._to_1inch_token(to_token_address),
            amount=quote.from_amount,
            user_address=wallet_data["address"],
            slippage=0.5,
            platform_fee_bps=quote.platform_fee_bps,
        )
        tx_data = swap_result.tx_data
        if not tx_data:
            raise SwapError("1inch did not return transaction data")

        chain = get_chain_by_name(quote.from_chain)
        web3 = self.wallet_service._get_web3(quote.from_chain)
        sender = Web3.to_checksum_address(wallet_data["address"])
        spender = Web3.to_checksum_address(tx_data.get("to", ""))

        # ERC20 approval to the 1inch router if spending a token (not native).
        if from_token_address and from_token_address != NATIVE_TOKEN_ADDRESS:
            token_addr = Web3.to_checksum_address(from_token_address)
            erc20_abi = [
                {
                    "inputs": [
                        {"name": "owner", "type": "address"},
                        {"name": "spender", "type": "address"},
                    ],
                    "name": "allowance",
                    "outputs": [{"name": "", "type": "uint256"}],
                    "type": "function",
                    "stateMutability": "view",
                },
                {
                    "inputs": [
                        {"name": "spender", "type": "address"},
                        {"name": "amount", "type": "uint256"},
                    ],
                    "name": "approve",
                    "outputs": [{"name": "", "type": "bool"}],
                    "type": "function",
                    "stateMutability": "nonpayable",
                },
            ]
            token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
            amount_needed = int(quote.from_amount)
            current_allowance = await asyncio.to_thread(
                lambda: token_contract.functions.allowance(sender, spender).call()
            )

            if current_allowance < amount_needed:
                nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
                gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)
                # 'exact' mode on a reset-required token (USDT mainnet): zero the
                # allowance first, since approve() reverts non-zero -> non-zero.
                nonce = await self._send_reset_approval_if_needed(
                    web3=web3,
                    token_contract=token_contract,
                    token_addr=token_addr,
                    spender=spender,
                    current_allowance=current_allowance,
                    sender=sender,
                    chain_id=chain.chain_id,
                    gas_price=gas_price,
                    nonce=nonce,
                    wallet=wallet,
                )
                max_approval = self._approval_amount(amount_needed)
                approve_data = token_contract.functions.approve(
                    spender, max_approval
                ).build_transaction(
                    {
                        "from": sender,
                        "nonce": nonce,
                        "chainId": chain.chain_id,
                        "gasPrice": gas_price,
                    }
                )
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
                approve_hash = await asyncio.to_thread(
                    lambda: web3.eth.send_raw_transaction(
                        bytes.fromhex(signed_approve.replace("0x", ""))
                    )
                )
                logger.info(f"1inch approval tx: {approve_hash.hex()}")
                await asyncio.to_thread(
                    lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
                )

        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
        tx = {
            "to": spender,
            "data": tx_data.get("data", ""),
            "value": _parse_int(tx_data.get("value"), 0),
            "gas": _parse_int(tx_data.get("gas"), 500000),
            "gasPrice": _parse_int(
                tx_data.get("gasPrice"), await asyncio.to_thread(lambda: web3.eth.gas_price)
            ),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info(f"1inch swap tx: {tx_hash.hex()}")
        return tx_hash.hex()

    async def _execute_0x_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via the 0x Swap API v2 allowance-holder flow (EVM-only).

        0x returns ready-to-broadcast tx calldata in `transaction` ({to, data,
        value, gas}). CRITICAL: the ERC20 spender to approve is the
        AllowanceHolder contract at `issues.allowance.spender` — NOT
        transaction.to, which is the Settler execution contract. We approve the
        spender, then sign and broadcast the tx to transaction.to — the same
        EVM flow as the OKX / Li.Fi / 1inch path.
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        chain_id = quote.raw_quote.get("chain_id") or ZEROX_CHAIN_IDS.get(quote.from_chain.lower())
        if not chain_id:
            raise SwapError(f"0x does not support chain: {quote.from_chain}")

        from_token_address = get_token_address(quote.from_token, quote.from_chain)
        to_token_address = get_token_address(quote.to_token, quote.to_chain)

        # Always fetch fresh tx calldata at execution time (the race used /price only).
        swap_result = await self.zerox.get_swap(
            chain_id=chain_id,
            from_token=self._to_0x_token(from_token_address),
            to_token=self._to_0x_token(to_token_address),
            amount=quote.from_amount,
            user_address=wallet_data["address"],
            slippage=0.5,
            platform_fee_bps=quote.platform_fee_bps,
        )
        tx_data = swap_result.tx_data
        if not tx_data:
            raise SwapError("0x did not return transaction data")

        chain = get_chain_by_name(quote.from_chain)
        web3 = self.wallet_service._get_web3(quote.from_chain)
        sender = Web3.to_checksum_address(wallet_data["address"])

        # 0x v2: the tx target (Settler) is transaction.to; the ERC20 spender to
        # approve is the AllowanceHolder at issues.allowance.spender — these differ.
        tx_to = Web3.to_checksum_address(tx_data.get("to", ""))

        # ERC20 approval to the 0x AllowanceHolder spender if spending a token
        # (not native). 0x sets issues.allowance to null when no approval is
        # needed (already approved) — guard against that.
        if from_token_address and from_token_address != NATIVE_TOKEN_ADDRESS:
            issues = swap_result.raw_response.get("issues") or {}
            allowance_issue = issues.get("allowance") or {}
            spender_raw = allowance_issue.get("spender")

            if spender_raw:
                spender = Web3.to_checksum_address(spender_raw)
                token_addr = Web3.to_checksum_address(from_token_address)
                erc20_abi = [
                    {
                        "inputs": [
                            {"name": "owner", "type": "address"},
                            {"name": "spender", "type": "address"},
                        ],
                        "name": "allowance",
                        "outputs": [{"name": "", "type": "uint256"}],
                        "type": "function",
                        "stateMutability": "view",
                    },
                    {
                        "inputs": [
                            {"name": "spender", "type": "address"},
                            {"name": "amount", "type": "uint256"},
                        ],
                        "name": "approve",
                        "outputs": [{"name": "", "type": "bool"}],
                        "type": "function",
                        "stateMutability": "nonpayable",
                    },
                ]
                token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
                amount_needed = int(quote.from_amount)
                current_allowance = await asyncio.to_thread(
                    lambda: token_contract.functions.allowance(sender, spender).call()
                )

                if current_allowance < amount_needed:
                    nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
                    gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)
                    # 'exact' mode on a reset-required token (USDT mainnet): zero the
                    # allowance first, since approve() reverts non-zero -> non-zero.
                    nonce = await self._send_reset_approval_if_needed(
                        web3=web3,
                        token_contract=token_contract,
                        token_addr=token_addr,
                        spender=spender,
                        current_allowance=current_allowance,
                        sender=sender,
                        chain_id=chain.chain_id,
                        gas_price=gas_price,
                        nonce=nonce,
                        wallet=wallet,
                    )
                    max_approval = self._approval_amount(amount_needed)
                    approve_data = token_contract.functions.approve(
                        spender, max_approval
                    ).build_transaction(
                        {
                            "from": sender,
                            "nonce": nonce,
                            "chainId": chain.chain_id,
                            "gasPrice": gas_price,
                        }
                    )
                    approve_tx = {
                        "to": token_addr,
                        "data": approve_data["data"],
                        "value": 0,
                        "gas": approve_data.get("gas", 60000),
                        "gasPrice": approve_data["gasPrice"],
                        "nonce": nonce,
                        "chainId": chain.chain_id,
                    }
                    signed_approve = await self.wallet_service.sign_evm_transaction(
                        wallet, approve_tx
                    )
                    approve_hash = await asyncio.to_thread(
                        lambda: web3.eth.send_raw_transaction(
                            bytes.fromhex(signed_approve.replace("0x", ""))
                        )
                    )
                    logger.info(f"0x approval tx (spender={spender}): {approve_hash.hex()}")
                    await asyncio.to_thread(
                        lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
                    )

        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
        tx = {
            "to": tx_to,
            "data": tx_data.get("data", ""),
            "value": _parse_int(tx_data.get("value"), 0),
            "gas": _parse_int(tx_data.get("gas"), 500000),
            "gasPrice": _parse_int(
                tx_data.get("gasPrice"), await asyncio.to_thread(lambda: web3.eth.gas_price)
            ),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info(f"0x swap tx: {tx_hash.hex()}")
        return tx_hash.hex()

    async def _execute_kyberswap_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via the KyberSwap Aggregator (EVM-only).

        KyberSwap's router is a single contract: it is both the ERC20 spender to
        approve AND the tx `to` target (simpler than 0x's Settler/AllowanceHolder
        split). We re-fetch a fresh route + build tx calldata at execution time,
        approve the router for token sells, then sign and broadcast.
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        chain_slug = quote.raw_quote.get("chain_slug") or KYBERSWAP_CHAIN_SLUGS.get(
            quote.from_chain.lower()
        )
        if not chain_slug:
            raise SwapError(f"KyberSwap does not support chain: {quote.from_chain}")

        from_token_address = get_token_address(quote.from_token, quote.from_chain)
        to_token_address = get_token_address(quote.to_token, quote.to_chain)

        # Re-fetch a fresh route + build tx calldata (routes expire).
        swap_result = await self.kyberswap.get_swap(
            chain_slug=chain_slug,
            from_token=self._to_kyber_token(from_token_address),
            to_token=self._to_kyber_token(to_token_address),
            amount=quote.from_amount,
            user_address=wallet_data["address"],
            slippage=0.5,
            platform_fee_bps=quote.platform_fee_bps,
        )
        tx_data = swap_result.tx_data
        if not tx_data:
            raise SwapError("KyberSwap did not return transaction data")

        chain = get_chain_by_name(quote.from_chain)
        web3 = self.wallet_service._get_web3(quote.from_chain)
        sender = Web3.to_checksum_address(wallet_data["address"])
        # Single contract: router is both the spender and the tx target.
        router = Web3.to_checksum_address(tx_data.get("to", ""))

        # ERC20 approval to the KyberSwap router for token sells (not native).
        if from_token_address and from_token_address != NATIVE_TOKEN_ADDRESS:
            token_addr = Web3.to_checksum_address(from_token_address)
            erc20_abi = [
                {
                    "inputs": [
                        {"name": "owner", "type": "address"},
                        {"name": "spender", "type": "address"},
                    ],
                    "name": "allowance",
                    "outputs": [{"name": "", "type": "uint256"}],
                    "type": "function",
                    "stateMutability": "view",
                },
                {
                    "inputs": [
                        {"name": "spender", "type": "address"},
                        {"name": "amount", "type": "uint256"},
                    ],
                    "name": "approve",
                    "outputs": [{"name": "", "type": "bool"}],
                    "type": "function",
                    "stateMutability": "nonpayable",
                },
            ]
            token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
            amount_needed = int(quote.from_amount)
            current_allowance = await asyncio.to_thread(
                lambda: token_contract.functions.allowance(sender, router).call()
            )

            if current_allowance < amount_needed:
                nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
                gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)
                # 'exact' mode on a reset-required token (USDT mainnet): zero the
                # allowance first, since approve() reverts non-zero -> non-zero.
                # The KyberSwap router is both spender and tx target.
                nonce = await self._send_reset_approval_if_needed(
                    web3=web3,
                    token_contract=token_contract,
                    token_addr=token_addr,
                    spender=router,
                    current_allowance=current_allowance,
                    sender=sender,
                    chain_id=chain.chain_id,
                    gas_price=gas_price,
                    nonce=nonce,
                    wallet=wallet,
                )
                max_approval = self._approval_amount(amount_needed)
                approve_data = token_contract.functions.approve(
                    router, max_approval
                ).build_transaction(
                    {
                        "from": sender,
                        "nonce": nonce,
                        "chainId": chain.chain_id,
                        "gasPrice": gas_price,
                    }
                )
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
                approve_hash = await asyncio.to_thread(
                    lambda: web3.eth.send_raw_transaction(
                        bytes.fromhex(signed_approve.replace("0x", ""))
                    )
                )
                logger.info(f"KyberSwap approval tx (router={router}): {approve_hash.hex()}")
                await asyncio.to_thread(
                    lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
                )

        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
        tx = {
            "to": router,
            "data": tx_data.get("data", ""),
            "value": _parse_int(tx_data.get("value"), 0),
            "gas": _parse_int(tx_data.get("gas"), 500000),
            "gasPrice": _parse_int(
                tx_data.get("gasPrice"), await asyncio.to_thread(lambda: web3.eth.gas_price)
            ),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info(f"KyberSwap swap tx: {tx_hash.hex()}")
        return tx_hash.hex()

    async def _estimate_swap_usd(self, quote: SwapQuote) -> float:
        """Best-effort USD value of a swap. Prefer a stablecoin leg (exact);
        otherwise price the to-token, then the from-token. Returns 0.0 if it
        can't be valued (caller then skips settlement rather than record garbage).
        """
        from bot.config.tokens import get_token_by_symbol
        from bot.services.price_service import price_service

        def _is_stable(sym: str) -> bool:
            cfg = get_token_by_symbol(sym)
            return bool(cfg and getattr(cfg, "is_stablecoin", False))

        from_qty = float(quote.from_amount_human or 0)
        to_qty = float(quote.to_amount_human or 0)

        if _is_stable(quote.to_token) and to_qty > 0:
            return to_qty
        if _is_stable(quote.from_token) and from_qty > 0:
            return from_qty
        for sym, qty in ((quote.to_token, to_qty), (quote.from_token, from_qty)):
            if qty <= 0:
                continue
            try:
                price = await asyncio.wait_for(price_service.get_price(sym), timeout=5)
            except Exception:
                price = None
            if price:
                return float(price) * qty
        return 0.0

    async def _settle_user_position(self, user_id: int, quote: SwapQuote) -> None:
        """Update the user's average-cost spot basis after a successful swap.

        A swap disposes from_token (realize PnL vs avg cost) and acquires
        to_token (add to cost basis); both legs share one USD value (value is
        conserved across a swap). Mirrors the copy-trading _settle_pnl. Keyed by
        (user, token, chain) so cross-chain swaps settle each leg on its chain.
        """
        from bot.models.positions import UserPosition

        swap_usd = await self._estimate_swap_usd(quote)
        if swap_usd <= 0:
            return

        from_token, from_chain = quote.from_token, quote.from_chain
        to_token, to_chain = quote.to_token, quote.to_chain
        from_qty = float(quote.from_amount_human or 0)
        to_qty = float(quote.to_amount_human or 0)

        def _work():
            with get_session() as session:
                # SELL leg: realize PnL on the disposed token vs tracked basis.
                if from_qty > 0:
                    pos = (
                        session.query(UserPosition)
                        .filter(
                            UserPosition.user_id == user_id,
                            UserPosition.token == from_token,
                            UserPosition.chain == from_chain,
                        )
                        .first()
                    )
                    if pos and pos.qty > 0:
                        avg_cost = pos.cost_usd / pos.qty
                        qty_sold = min(from_qty, pos.qty)
                        cost_of_sold = avg_cost * qty_sold
                        proceeds = swap_usd * (qty_sold / from_qty)  # tracked portion
                        pos.realized_pnl_usd = (pos.realized_pnl_usd or 0.0) + (
                            proceeds - cost_of_sold
                        )
                        pos.qty -= qty_sold
                        pos.cost_usd = max(0.0, pos.cost_usd - cost_of_sold)
                        if pos.qty <= 1e-12:
                            # Keep the row (preserves realized PnL) but zero the holding.
                            pos.qty = 0.0
                            pos.cost_usd = 0.0

                # BUY leg: add the acquired token to cost basis.
                if to_qty > 0:
                    pos = (
                        session.query(UserPosition)
                        .filter(
                            UserPosition.user_id == user_id,
                            UserPosition.token == to_token,
                            UserPosition.chain == to_chain,
                        )
                        .first()
                    )
                    if not pos:
                        pos = UserPosition(
                            user_id=user_id,
                            token=to_token,
                            chain=to_chain,
                            qty=0.0,
                            cost_usd=0.0,
                            realized_pnl_usd=0.0,
                        )
                        session.add(pos)
                    pos.qty += to_qty
                    pos.cost_usd += swap_usd

                session.commit()

        await run_in_db(_work)

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
                tx = session.query(SwapTransaction).filter(SwapTransaction.id == swap_tx.id).first()
                tx.status = status
                if status == SwapStatus.COMPLETED.value:
                    from datetime import datetime, timezone

                    tx.completed_at = datetime.now(timezone.utc)

        await run_in_db(_update_status)

        swap_tx.status = status
        return swap_tx

    async def _check_solana_tx_status(self, tx_hash: str) -> str:
        """Check Solana transaction status."""
        session = await get_http_session()
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTransaction",
            "params": [
                tx_hash,
                {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0},
            ],
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

            session = await get_http_session()
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
            receipt = await asyncio.to_thread(
                lambda: web3.eth.get_transaction_receipt(swap_tx.tx_hash)
            )

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
                            tx = (
                                session.query(SwapTransaction)
                                .filter(SwapTransaction.id == swap_tx.id)
                                .first()
                            )
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
