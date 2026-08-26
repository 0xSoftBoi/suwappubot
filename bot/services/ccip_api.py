"""Chainlink CCIP (Cross-Chain Interoperability Protocol) client for cross-chain transfers."""

import logging
from typing import Optional, Dict, Any
from dataclasses import dataclass
from web3 import Web3

from bot.config.chains import get_chain_by_name
from bot.config.tokens import get_token_decimals
from bot.utils.rate_limiter import api_limiter
from bot.utils.performance import track_time

logger = logging.getLogger(__name__)


# CCIP Router addresses per chain
# These are the official Chainlink CCIP Router contracts
CCIP_ROUTERS = {
    "ethereum": "0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D",
    "polygon": "0x849c5ED5a80F5B408Dd4969b78c2C8fdf0565Bfe",
    "arbitrum": "0x141fa059441E0ca23ce184B6A78bafD2A517DdE8",
    "optimism": "0x3206695CaE29952f4b0c22a169725a865bc8Ce0f",
    "base": "0x881e3A65B4d4a04dD529061dd0071cf975F58bCD",
    "bsc": "0x34B03Cb9086d7D758AC55af71584F81A598759FE",
    "avalanche": "0xF4c7E640EdA248ef95972845a62bdC74237805dB",
}

# CCIP Chain Selectors (unique identifiers for each chain in CCIP)
CCIP_CHAIN_SELECTORS = {
    "ethereum": "5009297550715157269",
    "polygon": "4051577828743386545",
    "arbitrum": "4949039107694359620",
    "optimism": "3734403246176062136",
    "base": "15971525489660198786",
    "bsc": "11344663589394136015",
    "avalanche": "6433500567565415381",
}

# CCIP supported tokens (with their pool addresses)
# These are tokens that can be transferred via CCIP
CCIP_SUPPORTED_TOKENS = {
    "USDC": {
        "ethereum": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "polygon": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        "arbitrum": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        "optimism": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "avalanche": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    },
    "LINK": {
        "ethereum": "0x514910771AF9Ca656af840dff83E8264EcF986CA",
        "polygon": "0xb0897686c545045aFc77CF20eC7A532E3120E0F1",
        "arbitrum": "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
        "optimism": "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6",
        "base": "0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196",
        "avalanche": "0x5947BB275c521040051D82396192181b413227A3",
    },
    "WETH": {
        "ethereum": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        "polygon": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
        "arbitrum": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        "optimism": "0x4200000000000000000000000000000000000006",
        "base": "0x4200000000000000000000000000000000000006",
    },
    "WBTC": {
        "ethereum": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        "polygon": "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
        "arbitrum": "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
        "optimism": "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
    },
}

# CCIP fee token options
CCIP_FEE_TOKENS = {
    "LINK": "link",  # Pay fees in LINK (cheaper)
    "NATIVE": "native",  # Pay fees in native token (ETH/MATIC etc)
}


@dataclass
class CCIPQuote:
    """Quote for a CCIP cross-chain transfer."""

    from_chain: str
    to_chain: str
    from_token: str
    to_token: str
    from_amount: str
    from_amount_human: float
    to_amount: str
    to_amount_human: float
    fee_token: str  # "LINK" or "NATIVE"
    fee_amount: str
    fee_amount_human: float
    fee_usd: float
    estimated_time: int  # seconds
    router_address: str
    destination_chain_selector: str
    raw_data: Dict[str, Any]


@dataclass
class CCIPTransferData:
    """Transaction data for executing a CCIP transfer."""

    router_address: str
    destination_chain_selector: str
    receiver: str
    token_address: str
    amount: str
    fee_token: str
    data: str  # Encoded transaction data
    value: str  # Native token value for fees (if paying in native)
    gas_limit: int


class CCIPError(Exception):
    """Error from CCIP operations."""


class ChainlinkCCIPAPI:
    """Client for Chainlink CCIP cross-chain transfers."""

    # Router ABI for getting fees and building transfers
    ROUTER_ABI = [
        {
            "inputs": [
                {"name": "destinationChainSelector", "type": "uint64"},
                {
                    "components": [
                        {"name": "receiver", "type": "bytes"},
                        {"name": "data", "type": "bytes"},
                        {
                            "name": "tokenAmounts",
                            "type": "tuple[]",
                            "components": [
                                {"name": "token", "type": "address"},
                                {"name": "amount", "type": "uint256"},
                            ],
                        },
                        {"name": "feeToken", "type": "address"},
                        {"name": "extraArgs", "type": "bytes"},
                    ],
                    "name": "message",
                    "type": "tuple",
                },
            ],
            "name": "getFee",
            "outputs": [{"name": "fee", "type": "uint256"}],
            "stateMutability": "view",
            "type": "function",
        },
        {
            "inputs": [
                {"name": "destinationChainSelector", "type": "uint64"},
                {
                    "components": [
                        {"name": "receiver", "type": "bytes"},
                        {"name": "data", "type": "bytes"},
                        {
                            "name": "tokenAmounts",
                            "type": "tuple[]",
                            "components": [
                                {"name": "token", "type": "address"},
                                {"name": "amount", "type": "uint256"},
                            ],
                        },
                        {"name": "feeToken", "type": "address"},
                        {"name": "extraArgs", "type": "bytes"},
                    ],
                    "name": "message",
                    "type": "tuple",
                },
            ],
            "name": "ccipSend",
            "outputs": [{"name": "messageId", "type": "bytes32"}],
            "stateMutability": "payable",
            "type": "function",
        },
        {
            "inputs": [{"name": "chainSelector", "type": "uint64"}],
            "name": "isChainSupported",
            "outputs": [{"name": "", "type": "bool"}],
            "stateMutability": "view",
            "type": "function",
        },
    ]

    # ERC20 ABI for approvals
    ERC20_ABI = [
        {
            "inputs": [
                {"name": "spender", "type": "address"},
                {"name": "amount", "type": "uint256"},
            ],
            "name": "approve",
            "outputs": [{"name": "", "type": "bool"}],
            "stateMutability": "nonpayable",
            "type": "function",
        },
        {
            "inputs": [
                {"name": "owner", "type": "address"},
                {"name": "spender", "type": "address"},
            ],
            "name": "allowance",
            "outputs": [{"name": "", "type": "uint256"}],
            "stateMutability": "view",
            "type": "function",
        },
    ]

    def _get_web3(self, chain: str) -> Web3:
        """Get Web3 instance for chain via RPCManager."""
        from bot.services.rpc_manager import rpc_manager

        return rpc_manager.get_web3(chain)

    def is_supported_route(self, from_chain: str, to_chain: str, token: str) -> bool:
        """Check if a route is supported by CCIP."""
        # Check chains
        if from_chain not in CCIP_ROUTERS or to_chain not in CCIP_ROUTERS:
            return False

        if from_chain not in CCIP_CHAIN_SELECTORS or to_chain not in CCIP_CHAIN_SELECTORS:
            return False

        # Check token
        if token not in CCIP_SUPPORTED_TOKENS:
            return False

        token_addresses = CCIP_SUPPORTED_TOKENS[token]
        if from_chain not in token_addresses or to_chain not in token_addresses:
            return False

        return True

    def get_supported_tokens(self, from_chain: str, to_chain: str) -> list:
        """Get list of tokens supported for a route."""
        supported = []
        for token, addresses in CCIP_SUPPORTED_TOKENS.items():
            if from_chain in addresses and to_chain in addresses:
                supported.append(token)
        return supported

    @track_time("ccip_quote")
    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        amount: float,
        from_address: str,
        to_address: Optional[str] = None,
        fee_token: str = "NATIVE",
    ) -> CCIPQuote:
        """
        Get a quote for a CCIP cross-chain transfer.

        Args:
            from_chain: Source chain name
            to_chain: Destination chain name
            token: Token symbol (e.g., "USDC", "LINK")
            amount: Amount to transfer
            from_address: Sender address
            to_address: Receiver address (defaults to from_address)
            fee_token: "LINK" or "NATIVE" for fee payment

        Returns:
            CCIPQuote with fee and transfer details
        """
        await api_limiter.wait_and_acquire("rpc")

        if not self.is_supported_route(from_chain, to_chain, token):
            raise CCIPError(f"Route not supported: {token} from {from_chain} to {to_chain}")

        to_address = to_address or from_address

        # Get chain configs
        router_address = CCIP_ROUTERS[from_chain]
        dest_selector = CCIP_CHAIN_SELECTORS[to_chain]
        token_address = CCIP_SUPPORTED_TOKENS[token][from_chain]

        # Get token decimals
        decimals = get_token_decimals(token, from_chain) or 18
        amount_raw = int(amount * (10**decimals))

        # Get Web3 instance
        w3 = self._get_web3(from_chain)

        # Build router contract
        router = w3.eth.contract(
            address=Web3.to_checksum_address(router_address), abi=self.ROUTER_ABI
        )

        # Determine fee token address
        if fee_token == "LINK" and "LINK" in CCIP_SUPPORTED_TOKENS:
            fee_token_address = CCIP_SUPPORTED_TOKENS["LINK"].get(
                from_chain, "0x0000000000000000000000000000000000000000"
            )
        else:
            fee_token_address = "0x0000000000000000000000000000000000000000"  # Native
            fee_token = "NATIVE"

        # Build message struct for fee estimation
        message = {
            "receiver": Web3.to_bytes(hexstr=to_address).rjust(32, b"\x00"),
            "data": b"",
            "tokenAmounts": [(Web3.to_checksum_address(token_address), amount_raw)],
            "feeToken": Web3.to_checksum_address(fee_token_address),
            "extraArgs": b"",
        }

        try:
            # Get fee estimate
            fee = router.functions.getFee(int(dest_selector), message).call()

            # Convert fee to human readable
            if fee_token == "LINK":
                fee_decimals = 18
                fee_human = fee / (10**fee_decimals)
                # Estimate USD (LINK ~$15)
                fee_usd = fee_human * 15
            else:
                chain_config = get_chain_by_name(from_chain)  # noqa: F841
                fee_decimals = 18
                fee_human = fee / (10**fee_decimals)
                # Estimate USD based on chain
                native_prices = {
                    "ethereum": 2000,
                    "polygon": 1,
                    "arbitrum": 2000,
                    "optimism": 2000,
                    "base": 2000,
                    "bsc": 300,
                    "avalanche": 35,
                }
                fee_usd = fee_human * native_prices.get(from_chain, 1000)

            # CCIP transfers are 1:1 for same token
            to_amount_human = amount
            to_amount_raw = amount_raw

            # Estimated time (CCIP typically takes 5-20 minutes)
            estimated_time = 900  # 15 minutes average

            return CCIPQuote(
                from_chain=from_chain,
                to_chain=to_chain,
                from_token=token,
                to_token=token,
                from_amount=str(amount_raw),
                from_amount_human=amount,
                to_amount=str(to_amount_raw),
                to_amount_human=to_amount_human,
                fee_token=fee_token,
                fee_amount=str(fee),
                fee_amount_human=fee_human,
                fee_usd=fee_usd,
                estimated_time=estimated_time,
                router_address=router_address,
                destination_chain_selector=dest_selector,
                raw_data={
                    "message": {
                        "receiver": to_address,
                        "tokenAddress": token_address,
                        "amount": str(amount_raw),
                        "feeToken": fee_token_address,
                    },
                    "fee": str(fee),
                },
            )

        except Exception as e:
            logger.error(f"CCIP quote error: {e}")
            raise CCIPError(f"Failed to get CCIP quote: {str(e)}")

    async def build_transfer_tx(
        self,
        quote: CCIPQuote,
        from_address: str,
        to_address: Optional[str] = None,
    ) -> CCIPTransferData:
        """
        Build transaction data for CCIP transfer.

        Args:
            quote: CCIPQuote from get_quote
            from_address: Sender address
            to_address: Receiver address

        Returns:
            CCIPTransferData with transaction details
        """
        to_address = to_address or from_address

        w3 = self._get_web3(quote.from_chain)

        router = w3.eth.contract(
            address=Web3.to_checksum_address(quote.router_address), abi=self.ROUTER_ABI
        )

        # Get token address
        token_address = CCIP_SUPPORTED_TOKENS[quote.from_token][quote.from_chain]

        # Fee token address
        if quote.fee_token == "LINK":
            fee_token_address = CCIP_SUPPORTED_TOKENS["LINK"].get(
                quote.from_chain, "0x0000000000000000000000000000000000000000"
            )
            value = 0
        else:
            fee_token_address = "0x0000000000000000000000000000000000000000"
            value = int(quote.fee_amount)

        # Build message
        message = (
            Web3.to_bytes(hexstr=to_address).rjust(32, b"\x00"),  # receiver
            b"",  # data
            [(Web3.to_checksum_address(token_address), int(quote.from_amount))],  # tokenAmounts
            Web3.to_checksum_address(fee_token_address),  # feeToken
            b"",  # extraArgs
        )

        # Encode ccipSend call
        tx_data = router.encode_abi(
            "ccipSend", args=[int(quote.destination_chain_selector), message]
        )

        return CCIPTransferData(
            router_address=quote.router_address,
            destination_chain_selector=quote.destination_chain_selector,
            receiver=to_address,
            token_address=token_address,
            amount=quote.from_amount,
            fee_token=quote.fee_token,
            data=tx_data,
            value=str(value),
            gas_limit=500000,  # CCIP transfers need more gas
        )

    async def get_approval_tx(
        self,
        chain: str,
        token: str,
        owner: str,
        amount: int,
    ) -> Optional[Dict]:
        """
        Get approval transaction if needed.

        Returns transaction dict or None if already approved.
        """
        if token not in CCIP_SUPPORTED_TOKENS:
            return None

        token_address = CCIP_SUPPORTED_TOKENS[token].get(chain)
        router_address = CCIP_ROUTERS.get(chain)

        if not token_address or not router_address:
            return None

        w3 = self._get_web3(chain)

        token_contract = w3.eth.contract(
            address=Web3.to_checksum_address(token_address), abi=self.ERC20_ABI
        )

        # Check current allowance
        allowance = token_contract.functions.allowance(
            Web3.to_checksum_address(owner), Web3.to_checksum_address(router_address)
        ).call()

        if allowance >= amount:
            return None  # Already approved

        # Build approval tx
        approve_data = token_contract.encode_abi(
            "approve", args=[Web3.to_checksum_address(router_address), 2**256 - 1]  # Max approval
        )

        return {
            "to": token_address,
            "data": approve_data,
            "value": "0",
            "gas": 60000,
        }

    async def get_transfer_status(
        self,
        message_id: str,
        from_chain: str,
    ) -> Dict[str, Any]:
        """
        Get status of a CCIP transfer.

        Note: This requires indexing CCIP events or using a service
        like Chainlink's CCIP Explorer API.
        """
        # For now, return a placeholder
        # In production, would query CCIP Explorer or index events
        return {
            "message_id": message_id,
            "status": "pending",
            "source_chain": from_chain,
        }


# Global instance
ccip_api = ChainlinkCCIPAPI()
