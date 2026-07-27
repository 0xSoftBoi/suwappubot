"""LayerZero / Stargate V2 API client for cross-chain transfers.

Uses the LayerZero OFT REST API for supported OFT tokens and
Stargate V2 pool contracts for USDC/USDT/ETH bridging.
"""

import asyncio
import logging
from typing import Optional, List
from dataclasses import dataclass

from bot.config.settings import settings
from bot.config.chains import get_chain_by_name
from bot.utils.http_client import get_session

logger = logging.getLogger(__name__)

# LayerZero OFT REST API (no API key required)
LZ_API_BASE = "https://metadata.layerzero-api.com/v1/metadata/experiment/ofts"

# Stargate V2 metadata API
STARGATE_API_URL = "https://mainnet.stargate-api.com/v1/metadata?version=v2"

# LayerZero Scan API for tracking
LAYERZERO_SCAN_API = "https://api-mainnet.layerzero-scan.com"

# LayerZero V2 Endpoint IDs (eid) per chain
LZ_ENDPOINT_IDS = {
    "ethereum": 30101,
    "bsc": 30102,
    "avalanche": 30106,
    "polygon": 30109,
    "arbitrum": 30110,
    "optimism": 30111,
    "fantom": 30112,
    "base": 30184,
    "linea": 30183,
    "mantle": 30181,
    "scroll": 30214,
    "gnosis": 30145,
    "tempo": 0,  # TODO: Update when LayerZero deploys on Tempo mainnet
}

# Stargate V2 pool addresses per chain (USDC, USDT, ETH)
# These are the StargatePool/StargateOFT contracts for V2
STARGATE_V2_POOLS = {
    "ethereum": {
        "USDC": "0xc026395860Db2d07ee33e05fE50ed7bD583189C7",
        "USDT": "0x933597a323Eb81cAe705C5bC29985172fd5A3973",
        "ETH": "0x77b2043768d28E9C9aB44E1aBfC95944bcE57931",
    },
    "arbitrum": {
        "USDC": "0xe8CDF27AcD73a434D661C84887215F7598e7d0d3",
        "USDT": "0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0",
        "ETH": "0xA45B5130f36CDcA45667738e2a258AB09f4A5f7F",
    },
    "optimism": {
        "USDC": "0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0",
        "USDT": "0x19cFCE47eD54a88614648DC3f19A5980097007dD",
        "ETH": "0xe8CDF27AcD73a434D661C84887215F7598e7d0d3",
    },
    "base": {
        "USDC": "0x27a16dc786820B16E5c9028b75B99F6f604b5d26",
        "ETH": "0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7",
    },
    "polygon": {
        "USDC": "0x9Aa02D4Fae7F58b8E8f34c66E756cC734DAc7fe4",
        "USDT": "0xd47b03ee6d86Cf251ee7860FB2ACf9f91B9fD4d7",
    },
    "bsc": {
        "USDT": "0x138EB30f73BC423c6455C53df6D89CB01d9eBc63",
    },
    "avalanche": {
        "USDC": "0x5634c4a5FEd09819E3c46D86A965Dd9447d86e47",
        "USDT": "0x12dC9256Acc9895B076f6638D628382881e62CeE",
    },
    "linea": {
        "ETH": "0x81F6138153d473E8c5EcebD3DC8Cd4903506B075",
    },
    "mantle": {
        "USDC": "0xAc290Ad4e0c891FDc295ca4F0a6214cf6dC6acDC",
        "USDT": "0xB715B85682B731dB9D5063187C450095c91C57FC",
        "ETH": "0x4c1d3Fc3fC3c177c3b633427c2F769276c547463",
    },
    "tempo": {
        # TODO: Add Stargate V2 pool addresses when deployed on Tempo
        # "USDC": "0x...",
        # "USDT": "0x...",
    },
}

# Stargate V2 Router ABI (sendToken function)
STARGATE_SEND_ABI = [
    {
        "inputs": [
            {
                "components": [
                    {"name": "dstEid", "type": "uint32"},
                    {"name": "to", "type": "bytes32"},
                    {"name": "amountLD", "type": "uint256"},
                    {"name": "minAmountLD", "type": "uint256"},
                    {"name": "extraOptions", "type": "bytes"},
                    {"name": "composeMsg", "type": "bytes"},
                    {"name": "oftCmd", "type": "bytes"},
                ],
                "name": "_sendParam",
                "type": "tuple",
            },
            {
                "components": [
                    {"name": "nativeFee", "type": "uint256"},
                    {"name": "lzTokenFee", "type": "uint256"},
                ],
                "name": "_fee",
                "type": "tuple",
            },
            {"name": "_refundAddress", "type": "address"},
        ],
        "name": "sendToken",
        "outputs": [
            {
                "components": [
                    {"name": "guid", "type": "bytes32"},
                    {"name": "nonce", "type": "uint64"},
                    {
                        "components": [
                            {"name": "nativeFee", "type": "uint256"},
                            {"name": "lzTokenFee", "type": "uint256"},
                        ],
                        "name": "fee",
                        "type": "tuple",
                    },
                ],
                "name": "",
                "type": "tuple",
            },
        ],
        "stateMutability": "payable",
        "type": "function",
    },
    {
        "inputs": [
            {
                "components": [
                    {"name": "dstEid", "type": "uint32"},
                    {"name": "to", "type": "bytes32"},
                    {"name": "amountLD", "type": "uint256"},
                    {"name": "minAmountLD", "type": "uint256"},
                    {"name": "extraOptions", "type": "bytes"},
                    {"name": "composeMsg", "type": "bytes"},
                    {"name": "oftCmd", "type": "bytes"},
                ],
                "name": "_sendParam",
                "type": "tuple",
            },
            {"name": "_payInLzToken", "type": "bool"},
        ],
        "name": "quoteSend",
        "outputs": [
            {
                "components": [
                    {"name": "nativeFee", "type": "uint256"},
                    {"name": "lzTokenFee", "type": "uint256"},
                ],
                "name": "",
                "type": "tuple",
            },
        ],
        "stateMutability": "view",
        "type": "function",
    },
]

# ERC20 approve ABI
ERC20_APPROVE_ABI = [
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


@dataclass
class LayerZeroQuote:
    """Quote for LayerZero/Stargate cross-chain transfer."""

    src_chain: str
    dst_chain: str
    token_symbol: str
    amount_in: str
    amount_out: str
    amount_out_min: str
    native_fee: str  # LZ messaging fee in native token (wei)
    native_fee_usd: float
    estimated_time: int  # seconds
    pool_address: str  # Stargate pool contract
    dst_eid: int  # LayerZero destination endpoint ID
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
    """Client for LayerZero/Stargate V2 cross-chain transfers.

    Uses Stargate V2 pool contracts for USDC/USDT/ETH bridging.
    Calls quoteSend() on-chain for accurate fee quotes, then
    builds sendToken() transactions for execution.
    """

    def __init__(self):
        self.scan_url = LAYERZERO_SCAN_API

    def get_dst_eid(self, chain_name: str) -> int:
        """Get LayerZero V2 endpoint ID for a chain."""
        eid = LZ_ENDPOINT_IDS.get(chain_name.lower())
        if not eid:
            raise LayerZeroError(f"Chain not supported: {chain_name}")
        return eid

    def get_pool_address(self, chain_name: str, token_symbol: str) -> Optional[str]:
        """Get Stargate V2 pool address for a token on a chain."""
        chain_pools = STARGATE_V2_POOLS.get(chain_name.lower(), {})
        return chain_pools.get(token_symbol.upper())

    def is_supported_route(self, src_chain: str, dst_chain: str, token: str) -> bool:
        """Check if a Stargate V2 route is supported."""
        try:
            self.get_dst_eid(src_chain)
            self.get_dst_eid(dst_chain)
            src_pool = self.get_pool_address(src_chain, token)
            dst_pool = self.get_pool_address(dst_chain, token)
            return src_pool is not None and dst_pool is not None
        except LayerZeroError:
            return False

    async def get_quote(
        self,
        src_chain: str,
        dst_chain: str,
        token_symbol: str,
        amount: str,
        from_address: str,
        slippage: float = 0.5,
    ) -> LayerZeroQuote:
        """
        Get a quote by calling quoteSend() on the Stargate V2 pool contract.

        Args:
            src_chain: Source chain name
            dst_chain: Destination chain name
            token_symbol: Token symbol (USDC, USDT, ETH)
            amount: Amount in smallest unit (wei)
            from_address: Sender address
            slippage: Slippage tolerance percentage
        """
        from web3 import Web3
        import random as _rand

        pool_address = self.get_pool_address(src_chain, token_symbol)
        if not pool_address:
            raise LayerZeroError(f"No Stargate pool for {token_symbol} on {src_chain}")

        dst_eid = self.get_dst_eid(dst_chain)
        chain = get_chain_by_name(src_chain)

        from bot.services.rpc_manager import rpc_manager

        web3 = rpc_manager.get_web3(src_chain)

        pool = web3.eth.contract(
            address=Web3.to_checksum_address(pool_address),
            abi=STARGATE_SEND_ABI,
        )

        amount_int = int(amount)
        slippage_factor = 1 - (slippage / 100)
        min_amount = int(amount_int * slippage_factor)

        # Pad address to bytes32 for LayerZero
        to_bytes32 = Web3.to_bytes(hexstr=from_address).rjust(32, b"\x00")

        send_param = (
            dst_eid,
            to_bytes32,
            amount_int,
            min_amount,
            b"",  # extraOptions (empty = default gas)
            b"",  # composeMsg
            b"",  # oftCmd (empty = taxi mode)
        )

        try:
            # Blocking RPC call — run off the event loop so the quote fan-out
            # (asyncio.gather in router.py) isn't serialized behind it.
            fee = await asyncio.to_thread(
                lambda: pool.functions.quoteSend(send_param, False).call()
            )
            native_fee = fee[0]  # nativeFee in wei
        except Exception as e:
            logger.warning(f"quoteSend failed for {token_symbol} {src_chain}->{dst_chain}: {e}")
            # Fallback estimate
            native_fee = web3.to_wei(0.001, "ether")

        # Estimate USD cost
        native_prices = {
            "ethereum": 2000,
            "polygon": 0.8,
            "bsc": 300,
            "arbitrum": 2000,
            "optimism": 2000,
            "base": 2000,
            "avalanche": 35,
            "fantom": 0.5,
            "linea": 2000,
            "mantle": 0.5,
            "scroll": 2000,
            "gnosis": 1,
            "tempo": 1,  # Gas is in USD stablecoins, so 1 USD = 1 USD
        }
        native_price = native_prices.get(src_chain.lower(), 2000)
        native_fee_eth = float(web3.from_wei(native_fee, "ether"))
        native_fee_usd = native_fee_eth * native_price

        return LayerZeroQuote(
            src_chain=src_chain,
            dst_chain=dst_chain,
            token_symbol=token_symbol,
            amount_in=amount,
            amount_out=str(min_amount),  # Conservative estimate
            amount_out_min=str(min_amount),
            native_fee=str(native_fee),
            native_fee_usd=native_fee_usd,
            estimated_time=120,
            pool_address=pool_address,
            dst_eid=dst_eid,
            raw_data={
                "send_param": {
                    "dstEid": dst_eid,
                    "to": from_address,
                    "amountLD": amount_int,
                    "minAmountLD": min_amount,
                },
                "native_fee": str(native_fee),
            },
        )

    def build_send_transaction(
        self,
        quote: LayerZeroQuote,
        sender_address: str,
    ) -> dict:
        """Build the sendToken() transaction for execution.

        Returns dict with:
            - approval_tx: ERC20 approve transaction (if token, not ETH)
            - send_tx: The actual sendToken transaction data
        """
        from web3 import Web3

        chain = get_chain_by_name(quote.src_chain)
        web3 = rpc_manager.get_web3(quote.src_chain)

        pool_address = Web3.to_checksum_address(quote.pool_address)
        pool = web3.eth.contract(address=pool_address, abi=STARGATE_SEND_ABI)

        to_bytes32 = Web3.to_bytes(hexstr=sender_address).rjust(32, b"\x00")

        send_param = (
            quote.dst_eid,
            to_bytes32,
            int(quote.amount_in),
            int(quote.amount_out_min),
            b"",  # extraOptions
            b"",  # composeMsg
            b"",  # oftCmd
        )

        fee = (int(quote.native_fee), 0)  # (nativeFee, lzTokenFee)

        # Build sendToken calldata
        send_data = pool.encode_abi(
            "sendToken",
            args=[send_param, fee, Web3.to_checksum_address(sender_address)],
        )

        result = {
            "send_tx": {
                "to": pool_address,
                "data": send_data,
                "value": int(quote.native_fee),  # Pay LZ fee in native token
            },
        }

        # For non-ETH tokens, need ERC20 approval to the pool
        if quote.token_symbol.upper() != "ETH":
            from bot.config.tokens import get_token_address

            token_address = get_token_address(quote.token_symbol, quote.src_chain)
            if token_address:
                token_contract = web3.eth.contract(
                    address=Web3.to_checksum_address(token_address),
                    abi=ERC20_APPROVE_ABI,
                )
                approve_data = token_contract.encode_abi(
                    "approve",
                    args=[pool_address, int(quote.amount_in)],
                )
                result["approval_tx"] = {
                    "to": Web3.to_checksum_address(token_address),
                    "data": approve_data,
                    "value": 0,
                }

        return result

    async def get_transaction_status(self, src_tx_hash: str) -> LayerZeroStatus:
        """Get the status of a LayerZero transaction via LZ Scan."""
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

    def get_supported_tokens(self, chain_name: str = None) -> List[str]:
        """Get supported tokens, optionally filtered by chain."""
        if chain_name:
            return list(STARGATE_V2_POOLS.get(chain_name.lower(), {}).keys())
        all_tokens = set()
        for pools in STARGATE_V2_POOLS.values():
            all_tokens.update(pools.keys())
        return list(all_tokens)

    def get_supported_chains(self) -> List[str]:
        """Get chains supported by Stargate V2."""
        return list(LZ_ENDPOINT_IDS.keys())


# Global instance
layerzero_api = LayerZeroAPI()
