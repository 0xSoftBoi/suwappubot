"""GOATSwap API — direct Uniswap V3-fork routing on GOAT Network (chain id 2345).

GOAT is a Bitcoin L2 whose native gas token is BTC with **18 decimals** (ETH-style
native units, not 8-decimal satoshi units). No aggregator (Li.Fi / 1inch / 0x /
Kyber / OKX / CoW / Socket) supports GOAT, so same-chain swaps route directly
against GOATSwap, a standard Uniswap V3 fork:

- SwapRouter02: 0x0d230A6A3E49301F0Ef9663982a529412EAAFAf4
- QuoterV2:     0xa58536246beEB4E68C84caFFC07C87aB5F9f7A16
- (V2 Router02  0xc6189404eACa8a96A9B26eCc6c892568f55deD9E — unused in v1)

v1 scope (documented design decision):
- ERC20 → ERC20: approve exact amount to SwapRouter02, then exactInputSingle.
- native BTC → ERC20: supported. tokenIn = WGBTC and the input amount is sent as
  msg.value; SwapRouter02's standard `pay()` path wraps the native balance into
  WGBTC (WETH9 slot) automatically. No approval needed.
- ERC20 → native BTC: NOT supported in v1 (would require a multicall with
  unwrapWETH9 + sweep). Users receive WGBTC instead — swap to WGBTC explicitly.

Quotes are single-hop via QuoterV2.quoteExactInputSingle (eth_call), trying fee
tiers [3000, 500, 10000] and picking the best output.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from web3 import Web3

logger = logging.getLogger(__name__)

GOAT_CHAIN_ID = 2345

# Verified GOATSwap contract addresses (GOAT mainnet)
GOATSWAP_SWAP_ROUTER02 = "0x0d230A6A3E49301F0Ef9663982a529412EAAFAf4"
GOATSWAP_QUOTER_V2 = "0xa58536246beEB4E68C84caFFC07C87aB5F9f7A16"
GOATSWAP_V2_ROUTER02 = "0xc6189404eACa8a96A9B26eCc6c892568f55deD9E"  # unused in v1

# WGBTC wraps GOAT's native BTC (18 decimals) — the chain's WETH9 equivalent
WGBTC_ADDRESS = "0xbC10000000000000000000000000000000000000"
NATIVE_BTC_ADDRESS = "0x0000000000000000000000000000000000000000"

# Uniswap V3 fee tiers to probe, most-liquid-first
FEE_TIERS = [3000, 500, 10000]

# Minimal ABIs — only the functions we call
QUOTER_V2_ABI = [
    {
        "name": "quoteExactInputSingle",
        "type": "function",
        "stateMutability": "nonpayable",  # called via eth_call only
        "inputs": [
            {
                "name": "params",
                "type": "tuple",
                "components": [
                    {"name": "tokenIn", "type": "address"},
                    {"name": "tokenOut", "type": "address"},
                    {"name": "amountIn", "type": "uint256"},
                    {"name": "fee", "type": "uint24"},
                    {"name": "sqrtPriceLimitX96", "type": "uint160"},
                ],
            }
        ],
        "outputs": [
            {"name": "amountOut", "type": "uint256"},
            {"name": "sqrtPriceX96After", "type": "uint160"},
            {"name": "initializedTicksCrossed", "type": "uint32"},
            {"name": "gasEstimate", "type": "uint256"},
        ],
    }
]

# SwapRouter02's ExactInputSingleParams has NO deadline field; the deadline is
# enforced via multicall(uint256 deadline, bytes[] data) — standard convention.
SWAP_ROUTER02_ABI = [
    {
        "name": "exactInputSingle",
        "type": "function",
        "stateMutability": "payable",
        "inputs": [
            {
                "name": "params",
                "type": "tuple",
                "components": [
                    {"name": "tokenIn", "type": "address"},
                    {"name": "tokenOut", "type": "address"},
                    {"name": "fee", "type": "uint24"},
                    {"name": "recipient", "type": "address"},
                    {"name": "amountIn", "type": "uint256"},
                    {"name": "amountOutMinimum", "type": "uint256"},
                    {"name": "sqrtPriceLimitX96", "type": "uint160"},
                ],
            }
        ],
        "outputs": [{"name": "amountOut", "type": "uint256"}],
    },
    {
        "name": "multicall",
        "type": "function",
        "stateMutability": "payable",
        "inputs": [
            {"name": "deadline", "type": "uint256"},
            {"name": "data", "type": "bytes[]"},
        ],
        "outputs": [{"name": "results", "type": "bytes[]"}],
    },
]

ERC20_ABI = [
    {
        "name": "approve",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "outputs": [{"name": "", "type": "bool"}],
    }
]


class GoatSwapError(Exception):
    """GOATSwap-specific error."""


@dataclass
class GoatSwapQuote:
    """A single-hop GOATSwap quote."""

    token_in: str  # effective ERC20 tokenIn (WGBTC when native_in)
    token_out: str
    amount_in: int
    amount_out: int
    fee_tier: int
    native_in: bool = False  # input is native BTC, passed as msg.value
    gas_estimate: int = 250_000
    raw_response: dict = field(default_factory=dict)


def _is_native(address: Optional[str]) -> bool:
    return not address or address.lower() == NATIVE_BTC_ADDRESS


def compute_min_out(amount_out: int, slippage_bps: int) -> int:
    """amountOutMinimum from slippage tolerance in basis points."""
    if amount_out <= 0:
        raise GoatSwapError("Cannot compute min-out from a zero/negative quote")
    return amount_out * (10_000 - slippage_bps) // 10_000


class GoatSwapAPI:
    """Minimal direct client for GOATSwap (Uniswap V3 fork) on GOAT Network."""

    def _get_web3(self) -> Web3:
        from bot.services.rpc_manager import rpc_manager

        return rpc_manager.get_web3("goat")

    # ------------------------------------------------------------------ quote

    async def get_quote(
        self,
        token_in: str,
        token_out: str,
        amount_in: int,
        web3: Optional[Web3] = None,
    ) -> GoatSwapQuote:
        """Quote a single-hop swap, trying all fee tiers and picking the best.

        Native BTC input is normalized to WGBTC (the router wraps msg.value).
        Native BTC output is rejected in v1 — quote to WGBTC instead.
        """
        if amount_in <= 0:
            raise GoatSwapError("amount_in must be positive")

        native_in = _is_native(token_in)
        if native_in:
            token_in = WGBTC_ADDRESS
        if _is_native(token_out):
            raise GoatSwapError(
                "Swapping to native BTC is not supported yet — swap to WGBTC instead "
                "(it wraps native BTC 1:1)."
            )
        if token_in.lower() == token_out.lower():
            raise GoatSwapError("tokenIn and tokenOut are the same token")

        w3 = web3 or self._get_web3()
        quoter = w3.eth.contract(
            address=Web3.to_checksum_address(GOATSWAP_QUOTER_V2), abi=QUOTER_V2_ABI
        )
        params_base = {
            "tokenIn": Web3.to_checksum_address(token_in),
            "tokenOut": Web3.to_checksum_address(token_out),
            "amountIn": int(amount_in),
            "sqrtPriceLimitX96": 0,
        }

        async def _try_fee(fee: int):
            params = dict(params_base, fee=fee)
            try:
                result = await asyncio.to_thread(
                    quoter.functions.quoteExactInputSingle(
                        (
                            params["tokenIn"],
                            params["tokenOut"],
                            params["amountIn"],
                            params["fee"],
                            params["sqrtPriceLimitX96"],
                        )
                    ).call
                )
                return fee, result
            except Exception as e:  # pool may not exist at this tier
                logger.debug(f"GOATSwap quote failed at fee tier {fee}: {e}")
                return fee, None

        results = await asyncio.gather(*[_try_fee(fee) for fee in FEE_TIERS])

        best_fee, best_out, best_gas = None, 0, 250_000
        for fee, result in results:
            if result is None:
                continue
            amount_out = int(result[0])
            if amount_out > best_out:
                best_fee, best_out = fee, amount_out
                best_gas = int(result[3]) if len(result) > 3 else 250_000

        if best_fee is None or best_out <= 0:
            raise GoatSwapError(
                f"No GOATSwap pool found for this pair (tried fee tiers {FEE_TIERS})"
            )

        return GoatSwapQuote(
            token_in=Web3.to_checksum_address(token_in),
            token_out=Web3.to_checksum_address(token_out),
            amount_in=int(amount_in),
            amount_out=best_out,
            fee_tier=best_fee,
            native_in=native_in,
            gas_estimate=best_gas,
            raw_response={
                "fee_tier": best_fee,
                "amount_out": best_out,
                "native_in": native_in,
            },
        )

    # -------------------------------------------------------------- build txs

    def build_approve_tx(self, token: str, amount: int) -> dict:
        """Exact-amount ERC20 approval to SwapRouter02 (data only; caller adds
        nonce/gas/chainId and signs)."""
        # Codec-only Web3 (no provider) is fine for ABI encoding
        erc20 = Web3().eth.contract(address=Web3.to_checksum_address(token), abi=ERC20_ABI)
        data = erc20.functions.approve(
            Web3.to_checksum_address(GOATSWAP_SWAP_ROUTER02), int(amount)
        )._encode_transaction_data()
        return {
            "to": Web3.to_checksum_address(token),
            "data": data,
            "value": 0,
        }

    def build_swap_tx(
        self,
        quote: GoatSwapQuote,
        recipient: str,
        amount_out_min: int,
        deadline: Optional[int] = None,
    ) -> dict:
        """Build the SwapRouter02 swap transaction.

        Encodes exactInputSingle wrapped in multicall(deadline, [...]) — the
        standard SwapRouter02 deadline convention. For native BTC input the
        amount rides as msg.value and the router wraps it into WGBTC itself.
        """
        if deadline is None:
            deadline = int(time.time()) + 600  # 10 minutes
        router = Web3().eth.contract(
            address=Web3.to_checksum_address(GOATSWAP_SWAP_ROUTER02), abi=SWAP_ROUTER02_ABI
        )
        inner = router.functions.exactInputSingle(
            (
                quote.token_in,
                quote.token_out,
                quote.fee_tier,
                Web3.to_checksum_address(recipient),
                quote.amount_in,
                int(amount_out_min),
                0,  # sqrtPriceLimitX96
            )
        )._encode_transaction_data()
        data = router.functions.multicall(
            deadline, [bytes.fromhex(inner[2:])]
        )._encode_transaction_data()
        return {
            "to": Web3.to_checksum_address(GOATSWAP_SWAP_ROUTER02),
            "data": data,
            "value": quote.amount_in if quote.native_in else 0,
        }


goatswap_api = GoatSwapAPI()
