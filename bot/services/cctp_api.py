"""Circle CCTP (Cross-Chain Transfer Protocol) client for native USDC bridging.

CCTP enables native USDC transfers across chains with ZERO bridge fees.
Only gas costs apply - this is the cheapest way to move USDC cross-chain.

Flow:
1. Burn USDC on source chain via TokenMessenger
2. Wait for Circle attestation (~1-2 minutes)
3. Mint USDC on destination chain via MessageTransmitter
"""

import logging
import asyncio
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from web3 import Web3

from bot.config.settings import settings
from bot.config.chains import get_chain_by_name, ChainType
from bot.config.tokens import get_token_address, get_token_decimals
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# Circle CCTP Attestation API
CCTP_ATTESTATION_API = "https://iris-api.circle.com/attestations"

# CCTP Domain IDs (Circle's chain identifiers)
CCTP_DOMAINS = {
    "ethereum": 0,
    "avalanche": 1,
    "optimism": 2,
    "arbitrum": 3,
    "base": 6,
    "polygon": 7,
}

# TokenMessenger contract addresses (for burning USDC)
TOKEN_MESSENGER_ADDRESSES = {
    "ethereum": "0xBd3fa81B58Ba92a82136038B25aDec7066af3155",
    "avalanche": "0x6B25532e1060CE10cc3B0A99e5683b91BFDe6982",
    "optimism": "0x2B4069517957735bE00ceE0fadAE88a26365528f",
    "arbitrum": "0x19330d10D9Cc8751218eaf51E8885D058642E08A",
    "base": "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",
    "polygon": "0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE",
}

# MessageTransmitter contract addresses (for receiving/minting USDC)
MESSAGE_TRANSMITTER_ADDRESSES = {
    "ethereum": "0x0a992d191DEeC32aFe36203Ad87D7d289a738F81",
    "avalanche": "0x8186359aF5F57FbB40c6b14A588d2A59C0C29880",
    "optimism": "0x4D41f22c5a0e5c74090899E5a8Fb597a8842b3e8",
    "arbitrum": "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca",
    "base": "0xAD09780d193884d503182aD4588450C416D6F9D4",
    "polygon": "0xF3be9355363857F3e001be68856A2f96b4C39Ba9",
}

# Native USDC addresses on each chain
NATIVE_USDC_ADDRESSES = {
    "ethereum": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "avalanche": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    "optimism": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    "arbitrum": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "polygon": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
}

# TokenMessenger ABI (minimal for depositForBurn)
TOKEN_MESSENGER_ABI = [
    {
        "inputs": [
            {"name": "amount", "type": "uint256"},
            {"name": "destinationDomain", "type": "uint32"},
            {"name": "mintRecipient", "type": "bytes32"},
            {"name": "burnToken", "type": "address"}
        ],
        "name": "depositForBurn",
        "outputs": [{"name": "nonce", "type": "uint64"}],
        "stateMutability": "nonpayable",
        "type": "function"
    }
]

# MessageTransmitter ABI (minimal for receiveMessage)
MESSAGE_TRANSMITTER_ABI = [
    {
        "inputs": [
            {"name": "message", "type": "bytes"},
            {"name": "attestation", "type": "bytes"}
        ],
        "name": "receiveMessage",
        "outputs": [{"name": "success", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function"
    }
]

# ERC20 approve ABI
ERC20_APPROVE_ABI = [
    {
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"}
        ],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function"
    }
]


@dataclass
class CCTPQuote:
    """Quote for Circle CCTP transfer."""
    from_chain: str
    to_chain: str
    from_amount: str
    to_amount: str  # Same as from_amount (1:1 for native USDC)
    to_amount_human: float
    gas_cost_usd: float
    bridge_fee_usd: float  # Always 0 for CCTP
    total_cost_usd: float
    estimated_time: int  # seconds
    token_messenger: str
    message_transmitter: str
    destination_domain: int
    usdc_address: str
    raw_data: Dict[str, Any]


@dataclass
class CCTPStatus:
    """Status of a CCTP transfer."""
    message_hash: str
    status: str  # PENDING, ATTESTED, COMPLETE, FAILED
    attestation: Optional[str]
    raw_response: Dict[str, Any]


class CCTPError(Exception):
    """Exception for CCTP errors."""
    def __init__(self, message: str, data: Optional[Dict] = None):
        super().__init__(message)
        self.data = data or {}


class CircleCCTPAPI:
    """Client for Circle CCTP native USDC bridging.
    
    CCTP is the cheapest way to bridge USDC cross-chain because:
    - Zero bridge fee (only gas)
    - Native USDC on both chains (no wrapped tokens)
    - Backed by Circle directly
    """
    
    def __init__(self):
        self.attestation_url = CCTP_ATTESTATION_API
    
    def is_supported_route(self, from_chain: str, to_chain: str, token: str) -> bool:
        """Check if CCTP supports this route."""
        if token.upper() != "USDC":
            return False
        return (
            from_chain.lower() in CCTP_DOMAINS and
            to_chain.lower() in CCTP_DOMAINS and
            from_chain.lower() != to_chain.lower()
        )
    
    def get_supported_chains(self) -> List[str]:
        """Get list of CCTP-supported chains."""
        return list(CCTP_DOMAINS.keys())
    
    def get_domain_id(self, chain: str) -> int:
        """Get CCTP domain ID for a chain."""
        domain = CCTP_DOMAINS.get(chain.lower())
        if domain is None:
            raise CCTPError(f"Chain not supported by CCTP: {chain}")
        return domain
    
    def get_token_messenger(self, chain: str) -> str:
        """Get TokenMessenger address for a chain."""
        address = TOKEN_MESSENGER_ADDRESSES.get(chain.lower())
        if not address:
            raise CCTPError(f"No TokenMessenger for chain: {chain}")
        return address
    
    def get_message_transmitter(self, chain: str) -> str:
        """Get MessageTransmitter address for a chain."""
        address = MESSAGE_TRANSMITTER_ADDRESSES.get(chain.lower())
        if not address:
            raise CCTPError(f"No MessageTransmitter for chain: {chain}")
        return address
    
    def get_usdc_address(self, chain: str) -> str:
        """Get native USDC address for a chain."""
        address = NATIVE_USDC_ADDRESSES.get(chain.lower())
        if not address:
            raise CCTPError(f"No native USDC on chain: {chain}")
        return address
    
    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        amount: str,
        slippage: float = 0.5,
    ) -> CCTPQuote:
        """
        Get a quote for CCTP USDC transfer.
        
        Args:
            from_chain: Source chain name
            to_chain: Destination chain name
            amount: Amount in smallest unit (6 decimals for USDC)
            slippage: Not used for CCTP (always 1:1)
            
        Returns:
            CCTPQuote with transfer details
        """
        if not self.is_supported_route(from_chain, to_chain, "USDC"):
            raise CCTPError(f"Route not supported: USDC from {from_chain} to {to_chain}")
        
        # Get addresses
        token_messenger = self.get_token_messenger(from_chain)
        message_transmitter = self.get_message_transmitter(to_chain)
        dest_domain = self.get_domain_id(to_chain)
        usdc_address = self.get_usdc_address(from_chain)
        
        # CCTP is always 1:1 for USDC (no slippage, no bridge fee)
        amount_human = int(amount) / 1e6  # USDC has 6 decimals
        
        # Estimate gas cost (varies by chain)
        gas_estimates_usd = {
            "ethereum": 5.0,
            "arbitrum": 0.30,
            "optimism": 0.30,
            "base": 0.20,
            "polygon": 0.10,
            "avalanche": 0.50,
        }
        gas_cost = gas_estimates_usd.get(from_chain.lower(), 1.0)
        
        return CCTPQuote(
            from_chain=from_chain,
            to_chain=to_chain,
            from_amount=amount,
            to_amount=amount,  # 1:1 transfer
            to_amount_human=amount_human,
            gas_cost_usd=gas_cost,
            bridge_fee_usd=0.0,  # CCTP has no bridge fee!
            total_cost_usd=gas_cost,
            estimated_time=120,  # ~2 minutes for attestation
            token_messenger=token_messenger,
            message_transmitter=message_transmitter,
            destination_domain=dest_domain,
            usdc_address=usdc_address,
            raw_data={
                "provider": "cctp",
                "from_domain": self.get_domain_id(from_chain),
                "to_domain": dest_domain,
            }
        )
    
    def build_approve_transaction(
        self,
        quote: CCTPQuote,
        from_address: str,
    ) -> Dict[str, Any]:
        """Build USDC approval transaction for TokenMessenger."""
        usdc_contract = Web3().eth.contract(
            address=Web3.to_checksum_address(quote.usdc_address),
            abi=ERC20_APPROVE_ABI
        )
        
        data = usdc_contract.encode_abi(
            fn_name="approve",
            args=[
                Web3.to_checksum_address(quote.token_messenger),
                int(quote.from_amount)
            ]
        )
        
        return {
            "to": Web3.to_checksum_address(quote.usdc_address),
            "data": data,
            "value": 0,
        }
    
    def build_burn_transaction(
        self,
        quote: CCTPQuote,
        from_address: str,
        to_address: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Build the depositForBurn transaction for CCTP.
        
        Args:
            quote: CCTPQuote from get_quote
            from_address: Sender address
            to_address: Recipient address (defaults to from_address)
            
        Returns:
            Transaction dict ready for signing
        """
        to_address = to_address or from_address
        
        # Convert recipient to bytes32 (padded address)
        recipient_bytes32 = Web3.to_bytes(hexstr=to_address).rjust(32, b'\x00')
        
        token_messenger = Web3().eth.contract(
            address=Web3.to_checksum_address(quote.token_messenger),
            abi=TOKEN_MESSENGER_ABI
        )
        
        data = token_messenger.encode_abi(
            fn_name="depositForBurn",
            args=[
                int(quote.from_amount),
                quote.destination_domain,
                recipient_bytes32,
                Web3.to_checksum_address(quote.usdc_address)
            ]
        )
        
        return {
            "to": Web3.to_checksum_address(quote.token_messenger),
            "data": data,
            "value": 0,
        }
    
    async def get_attestation(
        self,
        message_hash: str,
        max_attempts: int = 60,
        poll_interval: int = 2,
    ) -> CCTPStatus:
        """
        Wait for and retrieve Circle attestation for a burn transaction.
        
        Args:
            message_hash: The message hash from the burn transaction logs
            max_attempts: Maximum polling attempts
            poll_interval: Seconds between polls
            
        Returns:
            CCTPStatus with attestation if available
        """
        session = await get_session()
        
        for attempt in range(max_attempts):
            await api_limiter.wait_and_acquire("cctp")
            
            url = f"{self.attestation_url}/{message_hash}"
            
            try:
                async with session.get(url) as response:
                    if response.status == 404:
                        # Not ready yet
                        await asyncio.sleep(poll_interval)
                        continue
                    
                    data = await response.json()
                    
                    status = data.get("status", "pending")
                    attestation = data.get("attestation")
                    
                    if status == "complete" and attestation:
                        return CCTPStatus(
                            message_hash=message_hash,
                            status="ATTESTED",
                            attestation=attestation,
                            raw_response=data,
                        )
                    
                    await asyncio.sleep(poll_interval)
                    
            except Exception as e:
                logger.warning(f"Attestation poll error: {e}")
                await asyncio.sleep(poll_interval)
        
        return CCTPStatus(
            message_hash=message_hash,
            status="PENDING",
            attestation=None,
            raw_response={},
        )
    
    def build_receive_transaction(
        self,
        to_chain: str,
        message: bytes,
        attestation: str,
    ) -> Dict[str, Any]:
        """
        Build the receiveMessage transaction to mint USDC on destination.
        
        Args:
            to_chain: Destination chain name
            message: Original message bytes from burn tx
            attestation: Attestation from Circle API
            
        Returns:
            Transaction dict ready for signing
        """
        message_transmitter_addr = self.get_message_transmitter(to_chain)
        
        message_transmitter = Web3().eth.contract(
            address=Web3.to_checksum_address(message_transmitter_addr),
            abi=MESSAGE_TRANSMITTER_ABI
        )
        
        data = message_transmitter.encode_abi(
            fn_name="receiveMessage",
            args=[message, Web3.to_bytes(hexstr=attestation)]
        )
        
        return {
            "to": Web3.to_checksum_address(message_transmitter_addr),
            "data": data,
            "value": 0,
        }
    
    @staticmethod
    def extract_message_hash_from_logs(logs: List[Dict]) -> Optional[str]:
        """Extract the message hash from burn transaction logs."""
        # MessageSent event topic
        MESSAGE_SENT_TOPIC = Web3.keccak(text="MessageSent(bytes)").hex()
        
        for log in logs:
            if log.get("topics") and log["topics"][0].hex() == MESSAGE_SENT_TOPIC:
                # The message is in the data field
                message_data = log.get("data", "0x")
                # Hash the message to get message_hash
                return Web3.keccak(hexstr=message_data).hex()
        
        return None


# Global instance
cctp_api = CircleCCTPAPI()

