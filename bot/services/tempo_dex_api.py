"""Tempo Enshrined Stablecoin DEX client.

Tempo has a native, protocol-level DEX at a precompiled address
for optimal stablecoin-to-stablecoin swaps (e.g. USDC <-> USDT).
Uses uint128 amounts (not uint256).
"""

import asyncio
import logging
import random
from dataclasses import dataclass
from typing import Optional

from web3 import Web3

from bot.config.settings import settings
from bot.config.tokens import get_token_address, TOKENS
from bot.services.layerzero_api import ERC20_APPROVE_ABI

logger = logging.getLogger(__name__)

# Tempo enshrined DEX contract (pre-deployed system contract)
TEMPO_DEX_ADDRESS = "0xDEc0000000000000000000000000000000000000"

# Tempo payment lane transaction type
TEMPO_TX_TYPE_PAYMENT_LANE = "0x7A"

# ABI for the enshrined stablecoin DEX
# Note: All amount params are uint128, not uint256
TEMPO_DEX_ABI = [
    {
        "inputs": [
            {"name": "tokenIn", "type": "address"},
            {"name": "tokenOut", "type": "address"},
            {"name": "amountIn", "type": "uint128"},
            {"name": "minAmountOut", "type": "uint128"},
            {"name": "recipient", "type": "address"},
        ],
        "name": "swapExactAmountIn",
        "outputs": [{"name": "amountOut", "type": "uint128"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "tokenIn", "type": "address"},
            {"name": "tokenOut", "type": "address"},
            {"name": "amountOut", "type": "uint128"},
            {"name": "maxAmountIn", "type": "uint128"},
            {"name": "recipient", "type": "address"},
        ],
        "name": "swapExactAmountOut",
        "outputs": [{"name": "amountIn", "type": "uint128"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "tokenIn", "type": "address"},
            {"name": "tokenOut", "type": "address"},
            {"name": "amountIn", "type": "uint128"},
        ],
        "name": "quoteSwapExactAmountIn",
        "outputs": [{"name": "amountOut", "type": "uint128"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "tokenIn", "type": "address"},
            {"name": "tokenOut", "type": "address"},
            {"name": "amountOut", "type": "uint128"},
        ],
        "name": "quoteSwapExactAmountOut",
        "outputs": [{"name": "amountIn", "type": "uint128"}],
        "stateMutability": "view",
        "type": "function",
    },
]


def _get_tempo_web3() -> Web3:
    """Get a Web3 instance connected to Tempo with RPC fallback."""
    rpc_str = getattr(settings, "tempo_rpc_url", "") or ""
    rpc_urls = [u.strip() for u in rpc_str.split(",") if u.strip()]
    random.shuffle(rpc_urls)

    for url in rpc_urls:
        try:
            w3 = Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 10}))
            w3.eth.block_number
            return w3
        except Exception as e:
            logger.debug(f"Tempo RPC {url[:40]}... failed: {e}")
            continue
    raise ConnectionError("All Tempo RPCs failed")


@dataclass
class TempoDexQuote:
    """Quote from the Tempo enshrined stablecoin DEX."""
    token_in: str
    token_in_address: str
    token_out: str
    token_out_address: str
    amount_in: int
    amount_out: int
    amount_in_human: float
    amount_out_human: float
    price_impact: float  # Estimated price impact percentage


class TempoDexAPI:
    """Client for Tempo's enshrined stablecoin DEX.

    The enshrined DEX is a protocol-level contract for optimal
    stablecoin-to-stablecoin swaps with minimal fees and slippage.
    """

    def __init__(self):
        self.dex_address = TEMPO_DEX_ADDRESS

    def is_supported_pair(self, token_in: str, token_out: str) -> bool:
        """Check if both tokens are stablecoins available on Tempo."""
        in_cfg = TOKENS.get(token_in.upper())
        out_cfg = TOKENS.get(token_out.upper())
        if not (in_cfg and in_cfg.is_stablecoin and out_cfg and out_cfg.is_stablecoin):
            return False
        return bool(get_token_address(token_in, "tempo")) and bool(get_token_address(token_out, "tempo"))

    async def get_quote(
        self,
        token_in: str,
        token_out: str,
        amount_in: int,
    ) -> TempoDexQuote:
        """Get a quote from the enshrined DEX.

        Args:
            token_in: Input token symbol (e.g. "USDC")
            token_out: Output token symbol (e.g. "USDT")
            amount_in: Amount in smallest unit (e.g. 1000000 for 1 USDC)
        """
        addr_in = get_token_address(token_in, "tempo")
        addr_out = get_token_address(token_out, "tempo")
        if not addr_in or not addr_out:
            raise ValueError(f"Token pair {token_in}/{token_out} not available on Tempo")

        web3 = _get_tempo_web3()
        dex = web3.eth.contract(
            address=Web3.to_checksum_address(self.dex_address),
            abi=TEMPO_DEX_ABI,
        )

        # uint128 max = 2^128 - 1
        max_uint128 = (2**128) - 1
        if amount_in > max_uint128:
            raise ValueError(f"Amount exceeds uint128 max: {amount_in}")

        try:
            loop = asyncio.get_event_loop()
            amount_out = await loop.run_in_executor(
                None,
                lambda: dex.functions.quoteSwapExactAmountIn(
                    Web3.to_checksum_address(addr_in),
                    Web3.to_checksum_address(addr_out),
                    amount_in,
                ).call(),
            )
        except Exception as e:
            logger.error(f"Tempo DEX quote failed: {e}")
            raise

        # Calculate human-readable amounts
        token_in_cfg = TOKENS.get(token_in.upper())
        token_out_cfg = TOKENS.get(token_out.upper())
        decimals_in = token_in_cfg.decimals if token_in_cfg else 6
        decimals_out = token_out_cfg.decimals if token_out_cfg else 6

        amount_in_human = amount_in / (10 ** decimals_in)
        amount_out_human = amount_out / (10 ** decimals_out)

        # Estimate price impact (stablecoin-to-stablecoin should be near 0)
        price_impact = abs(1 - (amount_out_human / amount_in_human)) * 100 if amount_in_human > 0 else 0

        return TempoDexQuote(
            token_in=token_in.upper(),
            token_in_address=addr_in,
            token_out=token_out.upper(),
            token_out_address=addr_out,
            amount_in=amount_in,
            amount_out=amount_out,
            amount_in_human=amount_in_human,
            amount_out_human=amount_out_human,
            price_impact=price_impact,
        )

    def build_swap_tx(
        self,
        token_in: str,
        token_out: str,
        amount_in: int,
        min_amount_out: int,
        sender: str,
    ) -> dict:
        """Build a swap transaction for the enshrined DEX.

        Returns dict with:
            - approval_tx: ERC20 approve transaction
            - swap_tx: The actual swap transaction data
        """
        addr_in = get_token_address(token_in, "tempo")
        addr_out = get_token_address(token_out, "tempo")
        if not addr_in or not addr_out:
            raise ValueError(f"Token pair {token_in}/{token_out} not available on Tempo")

        web3 = _get_tempo_web3()
        dex = web3.eth.contract(
            address=Web3.to_checksum_address(self.dex_address),
            abi=TEMPO_DEX_ABI,
        )

        swap_data = dex.encode_abi(
            "swapExactAmountIn",
            args=[
                Web3.to_checksum_address(addr_in),
                Web3.to_checksum_address(addr_out),
                amount_in,
                min_amount_out,
                Web3.to_checksum_address(sender),
            ],
        )

        result = {
            "swap_tx": {
                "to": Web3.to_checksum_address(self.dex_address),
                "data": swap_data,
                "value": 0,
            },
        }

        # Build approval tx for token_in -> DEX
        token_contract = web3.eth.contract(
            address=Web3.to_checksum_address(addr_in),
            abi=ERC20_APPROVE_ABI,
        )
        approve_data = token_contract.encode_abi(
            "approve",
            args=[Web3.to_checksum_address(self.dex_address), amount_in],
        )
        result["approval_tx"] = {
            "to": Web3.to_checksum_address(addr_in),
            "data": approve_data,
            "value": 0,
        }

        return result


# Global instance
tempo_dex_api = TempoDexAPI()
