"""Wormhole/Portal API client for Solana-to-EVM bridging.

Wormhole is the primary bridge for transferring assets between Solana and EVM chains.
It uses Guardian-signed VAAs (Verified Action Approvals) for secure cross-chain messaging.

Key features:
- Native Solana <-> EVM bridging
- Supports SOL, USDC, USDT, and wrapped ETH
- Secure via distributed Guardian network
"""

import logging
import asyncio
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from decimal import Decimal

from bot.config.settings import settings
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# Wormhole API endpoints
WORMHOLE_API_URL = "https://api.wormholescan.io/api/v1"
PORTAL_API_URL = "https://portalbridge.com/api/v1"

# Wormhole Chain IDs (different from EVM chain IDs)
WORMHOLE_CHAIN_IDS = {
    "solana": 1,
    "ethereum": 2,
    "bsc": 4,
    "polygon": 5,
    "avalanche": 6,
    "fantom": 10,
    "arbitrum": 23,
    "optimism": 24,
    "base": 30,
}

# Token Bridge addresses per chain
TOKEN_BRIDGE_ADDRESSES = {
    "solana": "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb",
    "ethereum": "0x3ee18B2214AFF97000D974cf647E7C347E8fa585",
    "bsc": "0xB6F6D86a8f9879A9c87f643768d9efc38c1Da6E7",
    "polygon": "0x5a58505a96D1dbf8dF91cB21B54419FC36e93fdE",
    "avalanche": "0x0e082F06FF657D94310cB8cE8B0D9a04541d8052",
    "arbitrum": "0x0b2402144Bb366A632D14B83F244D2e0e21bD39c",
    "optimism": "0x1D68124e65faFC907325e3EDbF8c4d84499DAa8b",
    "base": "0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627",
}

# Core Bridge addresses (for message verification)
CORE_BRIDGE_ADDRESSES = {
    "solana": "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth",
    "ethereum": "0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B",
    "bsc": "0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B",
    "polygon": "0x7A4B5a56256163F07b2C80A7cA55aBE66c4ec4d7",
    "avalanche": "0x54a8e5f9c4CbA08F9943965859F6c34eAF03E26c",
    "arbitrum": "0xa5f208e072434bC67592E4C49C1B991BA79BCA46",
    "optimism": "0xEe91C335eab126dF5fDB3797EA9d6aD93aeC9722",
    "base": "0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6",
}

# Supported tokens with Wormhole wrapped addresses
WORMHOLE_TOKENS = {
    "SOL": {
        "solana": "So11111111111111111111111111111111111111112",  # Native
        "ethereum": "0xD31a59c85aE9D8edEFeC411D448f90841571b89c",
        "arbitrum": "0x2bcC6D6CdBbDC0a4071e48bb3B969b06B3330c07",
        "base": "0x1C61629598e4a901136a81BC138E5828dc150d67",
    },
    "USDC": {
        "solana": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "ethereum": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "arbitrum": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "polygon": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    },
    "USDT": {
        "solana": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
        "ethereum": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        "arbitrum": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        "polygon": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    },
    "WETH": {
        "solana": "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",  # Wormhole wrapped ETH
        "ethereum": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        "arbitrum": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        "base": "0x4200000000000000000000000000000000000006",
        "optimism": "0x4200000000000000000000000000000000000006",
    },
}


@dataclass
class WormholeQuote:
    """Quote for Wormhole bridge transfer."""

    from_chain: str
    to_chain: str
    from_token: str
    to_token: str
    from_amount: str
    to_amount: str
    from_amount_human: float
    to_amount_human: float
    relayer_fee: str
    relayer_fee_usd: float
    gas_cost_usd: float
    total_cost_usd: float
    estimated_time: int  # seconds
    source_token_address: str
    dest_token_address: str
    token_bridge: str
    wormhole_chain_id: int
    raw_data: Dict[str, Any]


@dataclass
class WormholeVAA:
    """Verified Action Approval from Wormhole Guardians."""

    vaa_bytes: str
    emitter_chain: int
    emitter_address: str
    sequence: int
    hash: str


@dataclass
class WormholeStatus:
    """Status of a Wormhole transfer."""

    tx_hash: str
    status: str  # PENDING, VAA_READY, REDEEMED, FAILED
    vaa: Optional[WormholeVAA]
    redeem_tx_hash: Optional[str]
    raw_response: Dict[str, Any]


class WormholeError(Exception):
    """Exception for Wormhole API errors."""

    def __init__(self, message: str, data: Optional[Dict] = None):
        super().__init__(message)
        self.data = data or {}


class WormholeAPI:
    """Client for Wormhole/Portal cross-chain bridging.

    Wormhole specializes in Solana <-> EVM transfers, filling a gap
    that Li.Fi and other EVM-focused aggregators don't handle well.
    """

    def __init__(self):
        self.api_url = WORMHOLE_API_URL
        self.portal_url = PORTAL_API_URL

    def is_supported_route(self, from_chain: str, to_chain: str, token: str) -> bool:
        """Check if Wormhole supports this route."""
        from_chain_l = from_chain.lower()
        to_chain_l = to_chain.lower()
        token_u = token.upper()

        # Check chains
        if from_chain_l not in WORMHOLE_CHAIN_IDS:
            return False
        if to_chain_l not in WORMHOLE_CHAIN_IDS:
            return False

        if from_chain_l == to_chain_l:
            return False

        # Wormhole is most valuable for Solana routes
        is_solana_route = from_chain_l == "solana" or to_chain_l == "solana"

        # Check token availability
        if token_u not in WORMHOLE_TOKENS:
            return False

        token_chains = WORMHOLE_TOKENS[token_u]
        return from_chain_l in token_chains and to_chain_l in token_chains

    def is_solana_route(self, from_chain: str, to_chain: str) -> bool:
        """Check if this is a Solana-involved route."""
        return from_chain.lower() == "solana" or to_chain.lower() == "solana"

    def get_wormhole_chain_id(self, chain: str) -> int:
        """Get Wormhole chain ID."""
        chain_id = WORMHOLE_CHAIN_IDS.get(chain.lower())
        if chain_id is None:
            raise WormholeError(f"Chain not supported by Wormhole: {chain}")
        return chain_id

    def get_token_bridge(self, chain: str) -> str:
        """Get Token Bridge address for a chain."""
        address = TOKEN_BRIDGE_ADDRESSES.get(chain.lower())
        if not address:
            raise WormholeError(f"No Token Bridge for chain: {chain}")
        return address

    def get_token_address(self, token: str, chain: str) -> str:
        """Get token address on a chain."""
        token_u = token.upper()
        chain_l = chain.lower()

        if token_u not in WORMHOLE_TOKENS:
            raise WormholeError(f"Token not supported: {token}")

        address = WORMHOLE_TOKENS[token_u].get(chain_l)
        if not address:
            raise WormholeError(f"Token {token} not available on {chain}")

        return address

    def get_supported_tokens(self) -> List[str]:
        """Get list of supported tokens."""
        return list(WORMHOLE_TOKENS.keys())

    def get_supported_chains(self) -> List[str]:
        """Get list of supported chains."""
        return list(WORMHOLE_CHAIN_IDS.keys())

    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        amount: str,
    ) -> WormholeQuote:
        """
        Get a quote for Wormhole transfer.

        Args:
            from_chain: Source chain name
            to_chain: Destination chain name
            token: Token symbol
            amount: Amount in smallest unit

        Returns:
            WormholeQuote with transfer details
        """
        if not self.is_supported_route(from_chain, to_chain, token):
            raise WormholeError(f"Route not supported: {token} from {from_chain} to {to_chain}")

        source_token = self.get_token_address(token, from_chain)
        dest_token = self.get_token_address(token, to_chain)
        token_bridge = self.get_token_bridge(from_chain)
        wh_chain_id = self.get_wormhole_chain_id(to_chain)

        # Wormhole typically charges minimal relayer fee
        # The main cost is gas on both chains
        is_solana_src = from_chain.lower() == "solana"
        is_solana_dst = to_chain.lower() == "solana"

        # Gas estimates
        if is_solana_src:
            gas_cost = 0.01  # Solana is very cheap
        else:
            gas_estimates = {
                "ethereum": 5.0,
                "arbitrum": 0.30,
                "optimism": 0.30,
                "base": 0.20,
                "polygon": 0.10,
            }
            gas_cost = gas_estimates.get(from_chain.lower(), 1.0)

        # Add destination gas for redeem
        if is_solana_dst:
            gas_cost += 0.01
        else:
            dest_gas = {
                "ethereum": 5.0,
                "arbitrum": 0.30,
                "optimism": 0.30,
                "base": 0.20,
                "polygon": 0.10,
            }
            gas_cost += dest_gas.get(to_chain.lower(), 1.0)

        # Relayer fee (optional, user can self-relay)
        relayer_fee = "0"
        relayer_fee_usd = 0.0

        # Calculate amounts
        amount_int = int(amount)

        # Get decimals
        decimals_map = {
            "SOL": 9,
            "USDC": 6,
            "USDT": 6,
            "WETH": 18,
        }
        decimals = decimals_map.get(token.upper(), 18)

        from_amount_human = amount_int / (10**decimals)
        to_amount_human = from_amount_human  # 1:1 for same token

        return WormholeQuote(
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=token,
            to_token=token,
            from_amount=amount,
            to_amount=amount,  # 1:1 transfer
            from_amount_human=from_amount_human,
            to_amount_human=to_amount_human,
            relayer_fee=relayer_fee,
            relayer_fee_usd=relayer_fee_usd,
            gas_cost_usd=gas_cost,
            total_cost_usd=gas_cost + relayer_fee_usd,
            estimated_time=300,  # ~5 minutes for Guardian signatures
            source_token_address=source_token,
            dest_token_address=dest_token,
            token_bridge=token_bridge,
            wormhole_chain_id=wh_chain_id,
            raw_data={
                "provider": "wormhole",
                "from_wh_chain": self.get_wormhole_chain_id(from_chain),
                "to_wh_chain": wh_chain_id,
            },
        )

    async def get_vaa(
        self,
        tx_hash: str,
        from_chain: str,
        max_attempts: int = 60,
        poll_interval: int = 5,
    ) -> Optional[WormholeVAA]:
        """
        Wait for and retrieve VAA from Wormhole Guardians.

        Args:
            tx_hash: Source chain transaction hash
            from_chain: Source chain name
            max_attempts: Maximum polling attempts
            poll_interval: Seconds between polls

        Returns:
            WormholeVAA if available
        """
        wh_chain_id = self.get_wormhole_chain_id(from_chain)

        session = await get_session()

        for attempt in range(max_attempts):
            await api_limiter.wait_and_acquire("wormhole")

            try:
                # Query Wormholescan for VAA
                url = f"{self.api_url}/vaas"
                params = {
                    "txHash": tx_hash,
                    "chainId": wh_chain_id,
                }

                async with session.get(url, params=params) as response:
                    if response.status == 404:
                        await asyncio.sleep(poll_interval)
                        continue

                    data = await response.json()

                    vaas = data.get("data", [])
                    if vaas:
                        vaa_data = vaas[0]
                        return WormholeVAA(
                            vaa_bytes=vaa_data.get("vaa", ""),
                            emitter_chain=vaa_data.get("emitterChain", 0),
                            emitter_address=vaa_data.get("emitterAddress", ""),
                            sequence=vaa_data.get("sequence", 0),
                            hash=vaa_data.get("hash", ""),
                        )

                    await asyncio.sleep(poll_interval)

            except Exception as e:
                logger.warning(f"VAA poll error: {e}")
                await asyncio.sleep(poll_interval)

        return None

    async def get_transfer_status(
        self,
        tx_hash: str,
        from_chain: str,
    ) -> WormholeStatus:
        """
        Get the status of a Wormhole transfer.

        Args:
            tx_hash: Source chain transaction hash
            from_chain: Source chain name

        Returns:
            WormholeStatus with transfer details
        """
        await api_limiter.wait_and_acquire("wormhole")

        session = await get_session()
        wh_chain_id = self.get_wormhole_chain_id(from_chain)

        try:
            # Check for VAA
            url = f"{self.api_url}/vaas"
            params = {"txHash": tx_hash, "chainId": wh_chain_id}

            async with session.get(url, params=params) as response:
                data = await response.json() if response.status == 200 else {}

                vaas = data.get("data", [])

                if not vaas:
                    return WormholeStatus(
                        tx_hash=tx_hash,
                        status="PENDING",
                        vaa=None,
                        redeem_tx_hash=None,
                        raw_response=data,
                    )

                vaa_data = vaas[0]
                vaa = WormholeVAA(
                    vaa_bytes=vaa_data.get("vaa", ""),
                    emitter_chain=vaa_data.get("emitterChain", 0),
                    emitter_address=vaa_data.get("emitterAddress", ""),
                    sequence=vaa_data.get("sequence", 0),
                    hash=vaa_data.get("hash", ""),
                )

                # Check if redeemed
                is_redeemed = vaa_data.get("isCompleted", False)

                return WormholeStatus(
                    tx_hash=tx_hash,
                    status="REDEEMED" if is_redeemed else "VAA_READY",
                    vaa=vaa,
                    redeem_tx_hash=vaa_data.get("targetTxHash"),
                    raw_response=data,
                )

        except Exception as e:
            logger.error(f"Status check error: {e}")
            return WormholeStatus(
                tx_hash=tx_hash,
                status="PENDING",
                vaa=None,
                redeem_tx_hash=None,
                raw_response={},
            )

    def build_transfer_calldata_evm(
        self,
        quote: WormholeQuote,
        from_address: str,
        to_address: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Build EVM transfer transaction for Wormhole.

        This creates a transaction to lock/burn tokens on the source EVM chain.
        """
        from web3 import Web3

        to_address = to_address or from_address

        # Token Bridge transferTokens function
        TRANSFER_TOKENS_ABI = [
            {
                "inputs": [
                    {"name": "token", "type": "address"},
                    {"name": "amount", "type": "uint256"},
                    {"name": "recipientChain", "type": "uint16"},
                    {"name": "recipient", "type": "bytes32"},
                    {"name": "arbiterFee", "type": "uint256"},
                    {"name": "nonce", "type": "uint32"},
                ],
                "name": "transferTokens",
                "outputs": [{"name": "sequence", "type": "uint64"}],
                "stateMutability": "payable",
                "type": "function",
            }
        ]

        token_bridge = Web3().eth.contract(
            address=Web3.to_checksum_address(quote.token_bridge), abi=TRANSFER_TOKENS_ABI
        )

        # Convert recipient to bytes32
        if quote.to_chain.lower() == "solana":
            # For Solana, use base58-decoded address padded to 32 bytes
            import base58

            recipient_bytes = base58.b58decode(to_address)
            recipient_bytes32 = recipient_bytes.ljust(32, b"\x00")
        else:
            # For EVM, pad address to 32 bytes
            recipient_bytes32 = Web3.to_bytes(hexstr=to_address).rjust(32, b"\x00")

        import random

        nonce = random.randint(0, 2**32 - 1)

        data = token_bridge.encode_abi(
            "transferTokens",
            args=[
                Web3.to_checksum_address(quote.source_token_address),
                int(quote.from_amount),
                quote.wormhole_chain_id,
                recipient_bytes32,
                0,  # No arbiter fee
                nonce,
            ],
        )

        return {
            "to": Web3.to_checksum_address(quote.token_bridge),
            "data": data,
            "value": 0,  # Wormhole fee is paid separately
        }

    def build_redeem_calldata_evm(
        self,
        to_chain: str,
        vaa: WormholeVAA,
    ) -> Dict[str, Any]:
        """
        Build EVM redeem transaction to complete the bridge.

        This creates a transaction to mint/unlock tokens on the destination chain.
        """
        from web3 import Web3

        token_bridge_addr = self.get_token_bridge(to_chain)

        # completeTransfer function
        COMPLETE_TRANSFER_ABI = [
            {
                "inputs": [{"name": "encodedVm", "type": "bytes"}],
                "name": "completeTransfer",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function",
            }
        ]

        token_bridge = Web3().eth.contract(
            address=Web3.to_checksum_address(token_bridge_addr), abi=COMPLETE_TRANSFER_ABI
        )

        data = token_bridge.encode_abi(
            "completeTransfer", args=[Web3.to_bytes(hexstr=vaa.vaa_bytes)]
        )

        return {
            "to": Web3.to_checksum_address(token_bridge_addr),
            "data": data,
            "value": 0,
        }


# Global instance
wormhole_api = WormholeAPI()
