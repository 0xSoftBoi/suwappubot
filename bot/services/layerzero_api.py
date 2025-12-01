"""LayerZero / Stargate API client for cross-chain swaps."""

from typing import Optional, List
from dataclasses import dataclass
from decimal import Decimal

from bot.config.settings import settings
from bot.config.chains import get_chain_by_name
from bot.utils.http_client import get_session

# Stargate (LayerZero) API endpoints
STARGATE_API_URL = "https://api.stargate.finance"
LAYERZERO_SCAN_API = "https://api-mainnet.layerzero-scan.com"

# LayerZero Chain IDs (different from EVM chain IDs)
LZ_CHAIN_IDS = {
    "ethereum": 101,
    "bsc": 102,
    "avalanche": 106,
    "polygon": 109,
    "arbitrum": 110,
    "optimism": 111,
    "fantom": 112,
    "base": 184,
}

# Stargate Pool IDs
STARGATE_POOLS = {
    "USDC": 1,
    "USDT": 2,
    "DAI": 3,
    "FRAX": 7,
    "USDD": 11,
    "ETH": 13,
    "sUSD": 14,
    "LUSD": 15,
    "MAI": 16,
    "METIS": 17,
    "metisUSDT": 19,
}

# Stargate Router addresses per chain
STARGATE_ROUTERS = {
    "ethereum": "0x8731d54E9D02c286767d56ac03e8037C07e01e98",
    "bsc": "0x4a364f8c717cAAD9A442737Eb7b8A55cc6cf18D8",
    "polygon": "0x45A01E4e04F14f7A4a6702c74187c5F6222033cd",
    "arbitrum": "0x53Bf833A5d6c4ddA888F69c22C88C9f356a41614",
    "optimism": "0xB0D502E938ed5f4df2E681fE6E419ff29631d62b",
    "base": "0x45f1A95A4D3f3836523F5c83673c797f4d4d263B",
    "avalanche": "0x45A01E4e04F14f7A4a6702c74187c5F6222033cd",
}


@dataclass
class LayerZeroQuote:
    """Quote for LayerZero/Stargate cross-chain transfer."""
    src_chain: str
    dst_chain: str
    src_pool_id: int
    dst_pool_id: int
    token_symbol: str
    amount_in: str
    amount_out: str
    amount_out_min: str
    lz_fee: str  # LayerZero messaging fee (in native token)
    lz_fee_usd: float
    estimated_time: int  # seconds
    router_address: str
    raw_data: dict


@dataclass
class LayerZeroStatus:
    """Status of a LayerZero transaction."""
    src_tx_hash: str
    dst_tx_hash: Optional[str]
    status: str  # INFLIGHT, DELIVERED, FAILED
    src_chain_id: int
    dst_chain_id: int
    raw_response: dict


class LayerZeroError(Exception):
    """Exception for LayerZero API errors."""
    def __init__(self, message: str, data: dict = None):
        super().__init__(message)
        self.data = data or {}


class LayerZeroAPI:
    """Client for LayerZero/Stargate cross-chain transfers."""
    
    def __init__(self):
        self.stargate_url = STARGATE_API_URL
        self.scan_url = LAYERZERO_SCAN_API
    
    def get_lz_chain_id(self, chain_name: str) -> int:
        """Get LayerZero chain ID for a chain."""
        lz_id = LZ_CHAIN_IDS.get(chain_name.lower())
        if not lz_id:
            raise LayerZeroError(f"Chain not supported by LayerZero: {chain_name}")
        return lz_id
    
    def get_pool_id(self, token_symbol: str) -> int:
        """Get Stargate pool ID for a token."""
        pool_id = STARGATE_POOLS.get(token_symbol.upper())
        if not pool_id:
            raise LayerZeroError(f"Token not supported by Stargate: {token_symbol}")
        return pool_id
    
    def get_router_address(self, chain_name: str) -> str:
        """Get Stargate router address for a chain."""
        router = STARGATE_ROUTERS.get(chain_name.lower())
        if not router:
            raise LayerZeroError(f"No Stargate router for chain: {chain_name}")
        return router
    
    def is_supported_route(self, src_chain: str, dst_chain: str, token: str) -> bool:
        """Check if a route is supported by Stargate."""
        try:
            self.get_lz_chain_id(src_chain)
            self.get_lz_chain_id(dst_chain)
            self.get_pool_id(token)
            self.get_router_address(src_chain)
            return True
        except LayerZeroError:
            return False
    
    async def get_quote(
        self,
        src_chain: str,
        dst_chain: str,
        token_symbol: str,
        amount: str,
        slippage: float = 0.5,
    ) -> LayerZeroQuote:
        """
        Get a quote for Stargate cross-chain transfer.
        
        Args:
            src_chain: Source chain name
            dst_chain: Destination chain name  
            token_symbol: Token symbol (USDC, USDT, etc.)
            amount: Amount in smallest unit (wei)
            slippage: Slippage tolerance percentage
            
        Returns:
            LayerZeroQuote with transfer details
        """
        src_lz_id = self.get_lz_chain_id(src_chain)
        dst_lz_id = self.get_lz_chain_id(dst_chain)
        pool_id = self.get_pool_id(token_symbol)
        router = self.get_router_address(src_chain)
        
        # Calculate minimum amount with slippage
        amount_int = int(amount)
        slippage_factor = 1 - (slippage / 100)
        amount_out_min = str(int(amount_int * slippage_factor))
        
        # Estimate LayerZero fee (this would normally come from the contract)
        # For now, use approximate values
        lz_fee_estimates = {
            "ethereum": "0.001",  # ~0.001 ETH
            "polygon": "0.5",     # ~0.5 MATIC
            "bsc": "0.002",       # ~0.002 BNB
            "arbitrum": "0.0005", # ~0.0005 ETH
            "optimism": "0.0005", # ~0.0005 ETH
            "base": "0.0005",     # ~0.0005 ETH
        }
        
        lz_fee = lz_fee_estimates.get(src_chain.lower(), "0.001")
        
        # Estimate USD cost (rough estimate)
        native_prices = {
            "ethereum": 2000,
            "polygon": 0.8,
            "bsc": 300,
            "arbitrum": 2000,
            "optimism": 2000,
            "base": 2000,
        }
        native_price = native_prices.get(src_chain.lower(), 2000)
        lz_fee_usd = float(lz_fee) * native_price
        
        return LayerZeroQuote(
            src_chain=src_chain,
            dst_chain=dst_chain,
            src_pool_id=pool_id,
            dst_pool_id=pool_id,  # Usually same pool ID
            token_symbol=token_symbol,
            amount_in=amount,
            amount_out=amount,  # Stargate typically 1:1 for stablecoins
            amount_out_min=amount_out_min,
            lz_fee=lz_fee,
            lz_fee_usd=lz_fee_usd,
            estimated_time=120,  # ~2 minutes typical
            router_address=router,
            raw_data={
                "src_lz_chain_id": src_lz_id,
                "dst_lz_chain_id": dst_lz_id,
                "pool_id": pool_id,
                "slippage": slippage,
            }
        )
    
    def build_swap_calldata(
        self,
        quote: LayerZeroQuote,
        sender_address: str,
        receiver_address: str,
    ) -> dict:
        """
        Build the transaction data for Stargate swap.
        
        Returns:
            Transaction dict ready for signing
        """
        from web3 import Web3
        
        dst_lz_id = self.get_lz_chain_id(quote.dst_chain)
        
        # Stargate Router ABI for swap function
        # function swap(
        #     uint16 _dstChainId,
        #     uint256 _srcPoolId,
        #     uint256 _dstPoolId,
        #     address payable _refundAddress,
        #     uint256 _amountLD,
        #     uint256 _minAmountLD,
        #     lzTxObj memory _lzTxParams,
        #     bytes calldata _to,
        #     bytes calldata _payload
        # )
        
        # Encode the swap function call
        # This is a simplified version - full implementation would use web3.py
        
        return {
            "to": Web3.to_checksum_address(quote.router_address),
            "value": Web3.to_wei(quote.lz_fee, 'ether'),
            "data": self._encode_swap_data(
                dst_chain_id=dst_lz_id,
                src_pool_id=quote.src_pool_id,
                dst_pool_id=quote.dst_pool_id,
                refund_address=sender_address,
                amount=quote.amount_in,
                min_amount=quote.amount_out_min,
                receiver=receiver_address,
            ),
        }
    
    def _encode_swap_data(
        self,
        dst_chain_id: int,
        src_pool_id: int,
        dst_pool_id: int,
        refund_address: str,
        amount: str,
        min_amount: str,
        receiver: str,
    ) -> str:
        """Encode Stargate swap function call."""
        from web3 import Web3
        
        # Stargate Router swap function signature
        SWAP_FUNCTION_SIG = "0x9fbf10fc"  # swap(uint16,uint256,uint256,address,uint256,uint256,(uint256,uint256,bytes),bytes,bytes)
        
        # For a complete implementation, you'd use the full ABI encoding
        # This is a placeholder that shows the structure
        
        # In production, use web3.py contract encoding:
        # router = web3.eth.contract(address=router_address, abi=STARGATE_ROUTER_ABI)
        # data = router.encodeABI(fn_name='swap', args=[...])
        
        return SWAP_FUNCTION_SIG  # Placeholder
    
    async def get_transaction_status(self, src_tx_hash: str) -> LayerZeroStatus:
        """
        Get the status of a LayerZero transaction.
        
        Args:
            src_tx_hash: Source chain transaction hash
            
        Returns:
            LayerZeroStatus with delivery status
        """
        session = await get_session()
        
        url = f"{self.scan_url}/v1/messages/tx/{src_tx_hash}"
        
        async with session.get(url) as response:
            if response.status == 404:
                return LayerZeroStatus(
                    src_tx_hash=src_tx_hash,
                    dst_tx_hash=None,
                    status="PENDING",
                    src_chain_id=0,
                    dst_chain_id=0,
                    raw_response={},
                )
            
            data = await response.json()
            
            if not data.get("messages"):
                return LayerZeroStatus(
                    src_tx_hash=src_tx_hash,
                    dst_tx_hash=None,
                    status="PENDING",
                    src_chain_id=0,
                    dst_chain_id=0,
                    raw_response=data,
                )
            
            msg = data["messages"][0]
            
            return LayerZeroStatus(
                src_tx_hash=src_tx_hash,
                dst_tx_hash=msg.get("dstTxHash"),
                status=msg.get("status", "INFLIGHT"),
                src_chain_id=msg.get("srcChainId", 0),
                dst_chain_id=msg.get("dstChainId", 0),
                raw_response=data,
            )
    
    def get_supported_tokens(self) -> List[str]:
        """Get list of tokens supported by Stargate."""
        return list(STARGATE_POOLS.keys())
    
    def get_supported_chains(self) -> List[str]:
        """Get list of chains supported by LayerZero/Stargate."""
        return list(LZ_CHAIN_IDS.keys())


# Global instance
layerzero_api = LayerZeroAPI()

