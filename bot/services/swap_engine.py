"""Swap engine that orchestrates multiple swap providers for best execution.

Provider Priority:
1. CoW Protocol - Same-chain EVM swaps with MEV protection and P2P matching
2. Socket - Super-aggregated cross-chain and same-chain swaps
3. Jupiter + Jito - Solana swaps with MEV protection via bundle submission
4. Circle CCTP - Native USDC cross-chain (zero bridge fee)
5. Across Protocol - Fast EVM bridges (~0.04% fee)
6. Wormhole - Solana <-> EVM bridging
7. Li.Fi - Aggregated fallback
8. LayerZero/Stargate - Same-token cross-chain bridges
9. Chainlink CCIP - Cross-chain token transfers
"""

import asyncio
import logging
from typing import Optional, List
from dataclasses import dataclass, field
from datetime import datetime
from web3 import Web3
import aiohttp
import base64

from bot.config.settings import settings
from bot.config.chains import CHAINS, ChainType, get_chain_by_name
from bot.config.tokens import get_token_address, get_token_decimals
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
from bot.services.tax_export import TaxExporter
from bot.services.token_security.simulation import simulation_service
from bot.services.x402_service import x402_service
from bot.services.wallet import WalletService
from bot.models.subscription import SubscriptionTier
from bot.models.user import Wallet
from bot.models.swap import SwapTransaction, SwapStatus
from bot.utils.quote_validator import quote_validator
from bot.utils.exceptions import SwapError
from database.db import get_session

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
    timestamp: datetime = field(default_factory=datetime.utcnow)  # When quote was created
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
        self.wallet_service = WalletService()
        self._wallet_locks: dict[int, asyncio.Lock] = {}  # Per-wallet locks
    
    def _is_solana_only_swap(self, from_chain: str, to_chain: str) -> bool:
        """Check if this is a Solana-to-Solana swap (use Jupiter)."""
        return from_chain == "solana" and to_chain == "solana"
    
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
        Get a swap quote from the appropriate provider.
        
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
            SwapQuote with unified quote data
        """
        amount_raw = self._get_token_amount_raw(amount, from_token, from_chain)
        
        if self._is_solana_only_swap(from_chain, to_chain):
            return await self._get_jupiter_quote(
                from_token, to_token, amount, amount_raw, from_address, int(slippage * 100)
            )
        else:
            return await self._get_lifi_quote(
                from_chain, to_chain, from_token, to_token,
                amount, amount_raw, from_address, to_address, slippage
            )
    
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
    
    async def _get_layerzero_quote(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        amount: float,
        amount_raw: str,
        slippage: float,
    ) -> SwapQuote:
        """Get quote from LayerZero/Stargate for cross-chain stablecoin transfers."""
        quote = await self.layerzero.get_quote(
            src_chain=from_chain,
            dst_chain=to_chain,
            token_symbol=token,
            amount=amount_raw,
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
            gas_cost_usd=quote.lz_fee_usd,
            fee_cost_usd=0,
            total_cost_usd=quote.lz_fee_usd,
            estimated_time=quote.estimated_time,
            price_impact=0,  # Typically 1:1 for stablecoins
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
        quotes = []
        amount_raw = self._get_token_amount_raw(amount, from_token, from_chain)
        
        # Get Li.Fi quote
        try:
            lifi_quote = await self._get_lifi_quote(
                from_chain, to_chain, from_token, to_token,
                amount, amount_raw, from_address, to_address, slippage
            )
            quotes.append(lifi_quote)
        except Exception as e:
            logger.debug(f"Li.Fi quote failed: {e}")
        
        # Get LayerZero quote if applicable (same token cross-chain)
        if self._is_layerzero_route(from_chain, to_chain, from_token, to_token):
            try:
                lz_quote = await self._get_layerzero_quote(
                    from_chain, to_chain, from_token, amount, amount_raw, slippage
                )
                quotes.append(lz_quote)
            except Exception as e:
                logger.debug(f"LayerZero quote failed: {e}")
        
        # Get Chainlink CCIP quote if applicable (same token cross-chain EVM)
        if self._is_ccip_route(from_chain, to_chain, from_token, to_token):
            try:
                ccip_quote = await self._get_ccip_quote(
                    from_chain, to_chain, from_token, amount, from_address, to_address
                )
                quotes.append(ccip_quote)
            except Exception as e:
                logger.debug(f"CCIP quote failed: {e}")
        
        # Sort by best output (highest to_amount_human)
        quotes.sort(key=lambda q: q.to_amount_human, reverse=True)
        
        return quotes
    
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
        # Prevent concurrent swaps from same wallet
        if wallet_id not in self._wallet_locks:
            self._wallet_locks[wallet_id] = asyncio.Lock()
        
        async with self._wallet_locks[wallet_id]:
            # Idempotency: if we already created/submitted this attempt, return it
            if idempotency_key:
                with get_session() as session:
                    existing = session.query(SwapTransaction).filter(
                        SwapTransaction.idempotency_key == idempotency_key
                    ).first()
                    if existing and existing.status not in [
                        SwapStatus.FAILED.value,
                        SwapStatus.CANCELLED.value,
                    ]:
                        return existing

            # Get wallet data within session
            with get_session() as session:
                wallet = session.query(Wallet).filter(Wallet.id == wallet_id).first()
                if not wallet:
                    raise SwapError("Wallet not found")
                
                # We'll use the wallet object directly for high-level signing
                wallet_address = wallet.address
                wallet_chain_type = wallet.chain_type
            
            # Validate quote freshness
            quote_validator.validate_quote_freshness(quote)
            
            # Validate balance
            await quote_validator.validate_balance(
                wallet_id=wallet_id,
                quote=quote,
                wallet_service=self.wallet_service,
            )
            
            # Validate gas
            await quote_validator.validate_gas(
                wallet_address=wallet_address,
                quote=quote,
                wallet_service=self.wallet_service,
            )
            
            # Create transaction record
            with get_session() as session:
                swap_tx = SwapTransaction(
                    user_id=user_id,
                    from_chain=quote.from_chain,
                    from_token=quote.from_token,
                    from_amount=quote.from_amount,
                    from_amount_usd=quote.from_amount_human,  # Assuming stablecoin
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
                swap_id = swap_tx.id
            
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
                        
                        with get_session() as session:
                            db_tx = session.query(SwapTransaction).filter(SwapTransaction.id == swap_id).first()
                            db_tx.status = SwapStatus.FAILED.value
                            db_tx.error_message = error_msg
                            session.commit() # Commit the status update
                        
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
                else:
                    tx_hash = await self._execute_lifi_swap(quote, wallet)
                
                # Clean up local references
                del wallet
                
                return swap_tx
                
            except Exception as e:
                import traceback
                traceback.print_exc()
                # Mark as failed
                # Clean up local references
                del wallet
                
                raise SwapError(f"Swap execution failed: {repr(e)}")
    
    async def _execute_lifi_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via Li.Fi."""
        tx_request = quote.raw_quote.get("transactionRequest", {})
        
        if not tx_request:
            raise SwapError("No transaction request in quote")
        
        chain = get_chain_by_name(quote.from_chain)
        
        if chain.chain_type == ChainType.SOLANA:
            # Solana transaction via Li.Fi
            tx_data = tx_request.get("data")
            if not tx_data:
                raise SwapError("No transaction data")
            
            tx_bytes = base64.b64decode(tx_data)
            signed_tx = self.wallet_service.sign_solana_transaction_raw(
                wallet_data["encrypted_private_key"], tx_bytes
            )
            
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
                async with session.post(settings.solana_rpc_url, json=payload) as resp:
                    result = await resp.json()
                    if "error" in result:
                        raise SwapError(f"Transaction failed: {result['error']}")
                    return result["result"]
        else:
            # EVM transaction
            web3 = self.wallet_service._get_web3(quote.from_chain)
            
            # Build transaction - parse hex values from Li.Fi
            tx = {
                "to": Web3.to_checksum_address(tx_request.get("to")),
                "data": tx_request.get("data"),
                "value": _parse_int(tx_request.get("value"), 0),
                "gas": _parse_int(tx_request.get("gasLimit"), 500000),
                "gasPrice": _parse_int(tx_request.get("gasPrice"), web3.eth.gas_price),
                "nonce": web3.eth.get_transaction_count(wallet_data["address"]),
                "chainId": chain.chain_id,
            }
            
            # Sign and send
            signed_tx = self.wallet_service.sign_evm_transaction_raw(
                wallet_data["encrypted_private_key"], tx
            )
            tx_hash = web3.eth.send_raw_transaction(bytes.fromhex(signed_tx.replace("0x", "")))
            
            return tx_hash.hex()
    
    async def _execute_jupiter_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via Jupiter."""
        # Get swap transaction from Jupiter
        swap_tx = await self.jupiter.get_swap_transaction(
            quote_response=quote.raw_quote,
            user_public_key=wallet_data["address"],
        )
        
        # Decode and sign transaction
        tx_bytes = base64.b64decode(swap_tx.swap_transaction)
        signed_tx = self.wallet_service.sign_solana_transaction_raw(
            wallet_data["encrypted_private_key"], tx_bytes
        )
        
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
            async with session.post(settings.solana_rpc_url, json=payload) as resp:
                result = await resp.json()
                if "error" in result:
                    raise SwapError(f"Transaction failed: {result['error']}")
                return result["result"]
    
    async def _execute_cow_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via CoW Protocol (MEV-protected batch auction).
        
        CoW swaps are gasless for the user - they sign an order and CoW submits it.
        Orders may be matched P2P (zero fees) or via solvers (protocol fee from output).
        """
        from bot.utils.encryption import decrypt_private_key
        from eth_account import Account
        from eth_account.messages import encode_typed_data
        
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
        
        # Decrypt private key
        private_key = decrypt_private_key(
            wallet_data["encrypted_private_key"],
            settings.encryption_key
        )
        
        try:
            # Sign the order using EIP-712
            account = Account.from_key(private_key)
            
            # Encode and sign the typed data
            encoded_message = encode_typed_data(full_message=typed_data)
            signed = account.sign_message(encoded_message)
            signature = signed.signature.hex()
            
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
            
        finally:
            private_key = None
    
    async def _execute_socket_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via Socket super-aggregator.
        
        Socket finds the absolute best route by comparing all bridges and DEXes.
        """
        from bot.utils.encryption import decrypt_private_key
        from bot.services.socket_api import SocketRoute
        
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
        web3 = Web3(Web3.HTTPProvider(chain.rpc_url))
        
        # Decrypt private key
        private_key = decrypt_private_key(
            wallet_data["encrypted_private_key"],
            settings.encryption_key
        )
        
        try:
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
                    
                    signed_approval = web3.eth.account.sign_transaction(approval_tx, private_key)
                    approval_hash = web3.eth.send_raw_transaction(signed_approval.rawTransaction)
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
            
            signed_tx = web3.eth.account.sign_transaction(tx, private_key)
            tx_hash = web3.eth.send_raw_transaction(signed_tx.rawTransaction)
            
            logger.info(f"Socket swap tx: {tx_hash.hex()}")
            return tx_hash.hex()
            
        finally:
            private_key = None
    
    async def _execute_jito_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a Solana swap via Jupiter with Jito MEV protection.
        
        Jito protects swaps from sandwich attacks by:
        1. Building a Jupiter swap transaction
        2. Adding a Jito tip instruction
        3. Submitting as a bundle to Jito block engine
        """
        from bot.utils.encryption import decrypt_private_key
        from solders.transaction import VersionedTransaction
        from solders.keypair import Keypair
        from solders.pubkey import Pubkey
        
        raw_quote = quote.raw_quote
        jupiter_quote = raw_quote.get("jupiter_quote", {})
        jito_tip = raw_quote.get("jito_tip", TipPriority.MEDIUM.value)
        
        # Get swap transaction from Jupiter
        swap_tx = await self.jupiter.get_swap_transaction(
            quote_response=jupiter_quote,
            user_public_key=wallet_data["address"],
        )
        
        # Decrypt private key
        private_key = decrypt_private_key(
            wallet_data["encrypted_private_key"],
            settings.encryption_key
        )
        
        try:
            # Decode the transaction
            tx_bytes = base64.b64decode(swap_tx.swap_transaction)
            
            # Create keypair from private key (for Solana)
            # Note: This assumes the encrypted key is the raw 32-byte seed
            keypair = Keypair.from_seed(bytes.fromhex(private_key) if len(private_key) == 64 else bytes(private_key))
            
            # Parse the transaction
            versioned_tx = VersionedTransaction.from_bytes(tx_bytes)
            
            # For Jito, we need to add a tip instruction and re-sign
            # The tip should be in the transaction already if using Jupiter's Jito integration
            # Otherwise, we need to reconstruct the transaction (complex)
            
            # For now, sign the existing transaction
            # In production, we'd want to add the tip instruction
            signed_bytes = bytes(keypair.sign_message(bytes(versioned_tx.message)))
            
            # Create signed transaction
            signed_tx_bytes = bytes(versioned_tx)
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
            signed_tx = self.wallet_service.sign_solana_transaction_raw(
                wallet_data["encrypted_private_key"], tx_bytes
            )
            
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
                async with session.post(settings.solana_rpc_url, json=payload) as resp:
                    result = await resp.json()
                    if "error" in result:
                        raise SwapError(f"Transaction failed: {result['error']}")
                    return result["result"]
        
        finally:
            private_key = None
    
    async def _execute_ccip_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a cross-chain transfer via Chainlink CCIP."""
        from bot.utils.encryption import decrypt_private_key
        from bot.services.ccip_api import CCIPQuote
        
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
        web3 = Web3(Web3.HTTPProvider(chain.rpc_url))
        
        # Decrypt private key
        private_key = decrypt_private_key(
            wallet_data["encrypted_private_key"],
            settings.encryption_key
        )
        
        try:
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
                
                signed_approval = web3.eth.account.sign_transaction(
                    approval_tx, private_key
                )
                approval_hash = web3.eth.send_raw_transaction(signed_approval.rawTransaction)
                
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
            signed_tx = web3.eth.account.sign_transaction(tx, private_key)
            tx_hash = web3.eth.send_raw_transaction(signed_tx.rawTransaction)
            
            logger.info(f"CCIP transfer tx: {tx_hash.hex()}")
            return tx_hash.hex()
            
        finally:
            # Clear private key from memory
            private_key = None
    
    async def _execute_layerzero_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a cross-chain transfer via LayerZero/Stargate."""
        from bot.utils.encryption import decrypt_private_key
        
        # Get transaction data from LayerZero
        tx_data = await self.layerzero.get_swap_transaction(
            src_chain=quote.from_chain,
            dst_chain=quote.to_chain,
            token_symbol=quote.from_token,
            amount=quote.from_amount,
            from_address=wallet_data["address"],
        )
        
        chain = get_chain_by_name(quote.from_chain)
        web3 = Web3(Web3.HTTPProvider(chain.rpc_url))
        
        # Decrypt private key
        private_key = decrypt_private_key(
            wallet_data["encrypted_private_key"],
            settings.encryption_key
        )
        
        try:
            nonce = web3.eth.get_transaction_count(wallet_data["address"])
            
            tx = {
                "to": Web3.to_checksum_address(tx_data.get("to")),
                "data": tx_data.get("data"),
                "value": _parse_int(tx_data.get("value", 0)),
                "gas": _parse_int(tx_data.get("gasLimit", 300000)),
                "gasPrice": _parse_int(tx_data.get("gasPrice")) or web3.eth.gas_price,
                "nonce": nonce,
                "chainId": chain.chain_id,
            }
            
            # Sign and send
            signed_tx = web3.eth.account.sign_transaction(tx, private_key)
            tx_hash = web3.eth.send_raw_transaction(signed_tx.rawTransaction)
            
            logger.info(f"LayerZero transfer tx: {tx_hash.hex()}")
            return tx_hash.hex()
            
        finally:
            # Clear private key from memory
            private_key = None
    
    async def _execute_cctp_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a USDC transfer via Circle CCTP (cheapest for USDC)."""
        from bot.utils.encryption import decrypt_private_key
        
        # Get CCTP quote data
        raw_data = quote.raw_quote
        
        chain = get_chain_by_name(quote.from_chain)
        web3 = Web3(Web3.HTTPProvider(chain.rpc_url))
        
        # Decrypt private key
        private_key = decrypt_private_key(
            wallet_data["encrypted_private_key"],
            settings.encryption_key
        )
        
        try:
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
            
            signed_approve = web3.eth.account.sign_transaction(approve_tx, private_key)
            approve_hash = web3.eth.send_raw_transaction(signed_approve.rawTransaction)
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
            
            signed_burn = web3.eth.account.sign_transaction(burn_tx, private_key)
            burn_hash = web3.eth.send_raw_transaction(signed_burn.rawTransaction)
            
            logger.info(f"CCTP burn tx: {burn_hash.hex()}")
            return burn_hash.hex()
            
        finally:
            private_key = None
    
    async def _execute_across_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a bridge via Across Protocol (cheap EVM bridges)."""
        from bot.utils.encryption import decrypt_private_key
        
        chain = get_chain_by_name(quote.from_chain)
        web3 = Web3(Web3.HTTPProvider(chain.rpc_url))
        
        # Decrypt private key
        private_key = decrypt_private_key(
            wallet_data["encrypted_private_key"],
            settings.encryption_key
        )
        
        try:
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
                
                signed_approve = web3.eth.account.sign_transaction(approve_tx, private_key)
                approve_hash = web3.eth.send_raw_transaction(signed_approve.rawTransaction)
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
            
            signed_deposit = web3.eth.account.sign_transaction(deposit_tx, private_key)
            deposit_hash = web3.eth.send_raw_transaction(signed_deposit.rawTransaction)
            
            logger.info(f"Across deposit tx: {deposit_hash.hex()}")
            return deposit_hash.hex()
            
        finally:
            private_key = None
    
    async def _execute_wormhole_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a bridge via Wormhole (Solana <-> EVM)."""
        from bot.utils.encryption import decrypt_private_key
        
        is_solana_source = quote.from_chain.lower() == "solana"
        
        if is_solana_source:
            # Solana -> EVM: Not implemented yet (requires Solana signing)
            raise SwapError("Solana to EVM via Wormhole not yet implemented")
        
        # EVM -> Solana or EVM -> EVM
        chain = get_chain_by_name(quote.from_chain)
        web3 = Web3(Web3.HTTPProvider(chain.rpc_url))
        
        # Decrypt private key
        private_key = decrypt_private_key(
            wallet_data["encrypted_private_key"],
            settings.encryption_key
        )
        
        try:
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
            
            signed_approve = web3.eth.account.sign_transaction(approve_tx, private_key)
            approve_hash = web3.eth.send_raw_transaction(signed_approve.rawTransaction)
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
            
            signed_transfer = web3.eth.account.sign_transaction(transfer_tx, private_key)
            transfer_hash = web3.eth.send_raw_transaction(signed_transfer.rawTransaction)
            
            logger.info(f"Wormhole transfer tx: {transfer_hash.hex()}")
            return transfer_hash.hex()
            
        finally:
            private_key = None
    
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
        else:
            # Check via Li.Fi status API
            if swap_tx.from_chain != swap_tx.to_chain:
                status = await self._check_lifi_status(swap_tx)
            else:
                # Same-chain EVM swap
                status = await self._check_evm_tx_status(swap_tx)
        
        # Update database
        with get_session() as session:
            tx = session.query(SwapTransaction).filter(
                SwapTransaction.id == swap_tx.id
            ).first()
            tx.status = status
            if status == SwapStatus.COMPLETED.value:
                from datetime import datetime
                tx.completed_at = datetime.utcnow()
        
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
            async with session.post(settings.solana_rpc_url, json=payload) as resp:
                result = await resp.json()
                
                if "error" in result:
                    return SwapStatus.PENDING.value
                
                tx_data = result.get("result")
                if tx_data is None:
                    return SwapStatus.PENDING.value
                
                if tx_data.get("meta", {}).get("err") is not None:
                    return SwapStatus.FAILED.value
                
                return SwapStatus.COMPLETED.value
    
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
        except Exception:
            return SwapStatus.PENDING.value
    
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
                    with get_session() as session:
                        tx = session.query(SwapTransaction).filter(
                            SwapTransaction.id == swap_tx.id
                        ).first()
                        tx.destination_tx_hash = status.receiving_tx_hash
                
                return SwapStatus.COMPLETED.value
            elif status.status == "FAILED":
                return SwapStatus.FAILED.value
            else:
                return SwapStatus.CONFIRMING.value
        except Exception:
            return SwapStatus.CONFIRMING.value
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
