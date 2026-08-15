"""Generic Uniswap V3-fork direct routing client.

Generalizes the original GOATSwap client (bot/services/goatswap_api.py, now a
thin shim over this module) into a per-venue configurable client used for
chains that NO aggregator (Li.Fi / 1inch / 0x / Kyber / OKX / CoW / Socket)
supports:

- GOATSwap on GOAT Network (chain id 2345): SwapRouter02 — the
  ExactInputSingleParams struct has NO deadline field; the deadline is
  enforced by wrapping the call in multicall(uint256 deadline, bytes[]).
- JuiceSwap on Citrea (chain id 4114): plain V1-style SwapRouter — the
  deadline lives INSIDE the ExactInputSingleParams struct and there is NO
  multicall wrapper.

v1 scope per venue (documented design decision):
- ERC20 → ERC20: approve exact amount to the router, then exactInputSingle.
- native → ERC20: supported. tokenIn = the wrapped-native token and the input
  amount is sent as msg.value; the router's standard `pay()` path wraps the
  native balance (WETH9 slot) automatically. No approval needed.
- ERC20 → native: NOT supported in v1 (would require unwrapWETH9 + sweep).
  Users receive the wrapped-native token instead.

Quotes are single-hop via QuoterV2.quoteExactInputSingle (eth_call), trying
fee tiers [3000, 500, 10000] in parallel and picking the best output.

Citrea gas note: Citrea is EIP-1559-capable, but the L1 (Bitcoin) fee
surcharge is NOT included in eth_estimateGas results — the JuiceSwap venue
therefore carries gas_headroom_pct=15 and executors must apply
`apply_gas_headroom()` on top of their usual estimate buffer.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from web3 import Web3

logger = logging.getLogger(__name__)

NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000"

# Uniswap V3 fee tiers — ALL tiers are probed in parallel and the best output
# wins; the list order carries no priority (see get_quote's asyncio.gather)
FEE_TIERS = [3000, 500, 10000]

# Router calling conventions
ROUTER02_MULTICALL = "router02_multicall"  # SwapRouter02: multicall(deadline, [...])
ROUTER_V1_DEADLINE_IN_PARAMS = "router_v1_deadline_in_params"  # deadline in struct

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
# NOTE: SwapRouter02 actually exposes three multicall overloads
# (multicall(bytes[]), multicall(uint256 deadline, bytes[]) and
# multicall(bytes32 previousBlockhash, bytes[])); only the deadline-bearing
# overload is declared here, so ABI dispatch is unambiguous by construction.
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

# Original (V1-style) SwapRouter: deadline INSIDE ExactInputSingleParams,
# called directly — no multicall wrapper. This is JuiceSwap's convention.
SWAP_ROUTER_V1_ABI = [
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
                    {"name": "deadline", "type": "uint256"},
                    {"name": "amountIn", "type": "uint256"},
                    {"name": "amountOutMinimum", "type": "uint256"},
                    {"name": "sqrtPriceLimitX96", "type": "uint160"},
                ],
            }
        ],
        "outputs": [{"name": "amountOut", "type": "uint256"}],
    }
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


# Module-level, provider-less Web3 instance used purely as an ABI codec for
# offline calldata encoding (build_approve_tx / build_swap_tx). Constructing
# Web3() per call is surprisingly expensive (middleware stack init); this
# instance never touches the network so it is safe to share.
_CODEC_W3 = Web3()


class UniV3ForkError(Exception):
    """UniV3-fork venue error (GOATSwap / JuiceSwap)."""


@dataclass(frozen=True)
class UniV3Venue:
    """One Uniswap V3-fork deployment we route directly against."""

    name: str  # provider id used in SwapQuote.provider ("goatswap"/"juiceswap")
    display_name: str
    chain_name: str  # rpc_manager / chains.py key
    chain_id: int
    router_address: str
    quoter_address: str
    wrapped_native_address: str  # the venue's WETH9 slot
    wrapped_native_symbol: str
    router_style: str  # ROUTER02_MULTICALL | ROUTER_V1_DEADLINE_IN_PARAMS
    # Extra % headroom executors MUST apply on top of eth_estimateGas
    # (Citrea: the L1 fee surcharge is not in eth_estimateGas → 15).
    gas_headroom_pct: int = 0


@dataclass
class UniV3ForkQuote:
    """A single-hop quote from a UniV3-fork venue."""

    token_in: str  # effective ERC20 tokenIn (wrapped-native when native_in)
    token_out: str
    amount_in: int
    amount_out: int
    fee_tier: int
    native_in: bool = False  # input is the native coin, passed as msg.value
    gas_estimate: int = 250_000
    raw_response: dict = field(default_factory=dict)


def _is_native(address: Optional[str]) -> bool:
    return not address or address.lower() == NATIVE_ADDRESS


def compute_min_out(amount_out: int, slippage_bps: int) -> int:
    """amountOutMinimum from slippage tolerance in basis points."""
    if amount_out <= 0:
        raise UniV3ForkError("Cannot compute min-out from a zero/negative quote")
    return amount_out * (10_000 - slippage_bps) // 10_000


class UniV3ForkAPI:
    """Minimal direct client for a configured Uniswap V3-fork venue."""

    def __init__(self, venue: UniV3Venue):
        self.venue = venue

    def _get_web3(self) -> Web3:
        from bot.services.rpc_manager import rpc_manager

        return rpc_manager.get_web3(self.venue.chain_name)

    def apply_gas_headroom(self, gas: int) -> int:
        """Apply the venue's fee headroom to a gas estimate.

        On Citrea the L1 (Bitcoin DA) fee surcharge is NOT reflected in
        eth_estimateGas, so JuiceSwap carries gas_headroom_pct=15 — without it
        transactions can run out of fee budget at inclusion time.
        """
        return int(gas) * (100 + self.venue.gas_headroom_pct) // 100

    # ------------------------------------------------------------------ quote

    async def get_quote(
        self,
        token_in: str,
        token_out: str,
        amount_in: int,
        web3: Optional[Web3] = None,
    ) -> UniV3ForkQuote:
        """Quote a single-hop swap, trying all fee tiers and picking the best.

        Native input is normalized to the wrapped-native token (the router
        wraps msg.value). Native output is rejected in v1 — quote to the
        wrapped-native token instead.
        """
        venue = self.venue
        if amount_in <= 0:
            raise UniV3ForkError("amount_in must be positive")

        native_in = _is_native(token_in)
        if native_in:
            token_in = venue.wrapped_native_address
        if _is_native(token_out):
            raise UniV3ForkError(
                f"Swapping to the native coin is not supported yet — swap to "
                f"{venue.wrapped_native_symbol} instead (it wraps the native coin 1:1)."
            )
        if token_in.lower() == token_out.lower():
            raise UniV3ForkError("tokenIn and tokenOut are the same token")

        w3 = web3 or self._get_web3()
        quoter = w3.eth.contract(
            address=Web3.to_checksum_address(venue.quoter_address), abi=QUOTER_V2_ABI
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
                logger.debug(f"{venue.display_name} quote failed at fee tier {fee}: {e}")
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
            raise UniV3ForkError(
                f"No {venue.display_name} pool found for this pair (tried fee tiers {FEE_TIERS})"
            )

        return UniV3ForkQuote(
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
        """Exact-amount ERC20 approval to the venue router (data only; caller
        adds nonce/gas/chainId and signs)."""
        # Codec-only Web3 (no provider, module-cached) is fine for ABI encoding
        erc20 = _CODEC_W3.eth.contract(address=Web3.to_checksum_address(token), abi=ERC20_ABI)
        data = erc20.functions.approve(
            Web3.to_checksum_address(self.venue.router_address), int(amount)
        )._encode_transaction_data()
        return {
            "to": Web3.to_checksum_address(token),
            "data": data,
            "value": 0,
        }

    def build_swap_tx(
        self,
        quote: UniV3ForkQuote,
        recipient: str,
        amount_out_min: int,
        deadline: Optional[int] = None,
    ) -> dict:
        """Build the router swap transaction, honoring the venue's style.

        ROUTER02_MULTICALL (GOATSwap): exactInputSingle (no deadline in the
        struct) wrapped in multicall(deadline, [...]).
        ROUTER_V1_DEADLINE_IN_PARAMS (JuiceSwap): exactInputSingle called
        directly with the deadline INSIDE ExactInputSingleParams — no multicall.

        For native input the amount rides as msg.value and the router wraps it
        into the wrapped-native token itself.
        """
        venue = self.venue
        if deadline is None:
            deadline = int(time.time()) + 600  # 10 minutes

        if venue.router_style == ROUTER02_MULTICALL:
            router = _CODEC_W3.eth.contract(
                address=Web3.to_checksum_address(venue.router_address), abi=SWAP_ROUTER02_ABI
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
        elif venue.router_style == ROUTER_V1_DEADLINE_IN_PARAMS:
            router = _CODEC_W3.eth.contract(
                address=Web3.to_checksum_address(venue.router_address), abi=SWAP_ROUTER_V1_ABI
            )
            data = router.functions.exactInputSingle(
                (
                    quote.token_in,
                    quote.token_out,
                    quote.fee_tier,
                    Web3.to_checksum_address(recipient),
                    int(deadline),
                    quote.amount_in,
                    int(amount_out_min),
                    0,  # sqrtPriceLimitX96
                )
            )._encode_transaction_data()
        else:  # pragma: no cover - config error
            raise UniV3ForkError(f"Unknown router style: {venue.router_style}")

        return {
            "to": Web3.to_checksum_address(venue.router_address),
            "data": data,
            "value": quote.amount_in if quote.native_in else 0,
        }


# ---------------------------------------------------------------------------
# Venue configs
# ---------------------------------------------------------------------------

# GOATSwap on GOAT Network (verified GOAT mainnet addresses)
GOAT_VENUE = UniV3Venue(
    name="goatswap",
    display_name="GOATSwap",
    chain_name="goat",
    chain_id=2345,
    router_address="0x0d230A6A3E49301F0Ef9663982a529412EAAFAf4",  # SwapRouter02
    quoter_address="0xa58536246beEB4E68C84caFFC07C87aB5F9f7A16",  # QuoterV2
    wrapped_native_address="0xbC10000000000000000000000000000000000000",  # WGBTC
    wrapped_native_symbol="WGBTC",
    router_style=ROUTER02_MULTICALL,
    gas_headroom_pct=0,
)

# JuiceSwap on Citrea (docs.juiceswap.com/smart-contracts, verified):
# plain V1-style SwapRouter — deadline INSIDE ExactInputSingleParams, no
# multicall wrapper. Factory listed for reference only (unused in v1).
JUICESWAP_FACTORY = "0xd809b1285aDd8eeaF1B1566Bf31B2B4C4Bba8e82"
JUICESWAP_V2_ROUTER = "0x6BDea31C89E0A202cE84b5752BB2e827B39984ae"  # unused in v1
CITREA_VENUE = UniV3Venue(
    name="juiceswap",
    display_name="JuiceSwap",
    chain_name="citrea",
    chain_id=4114,
    router_address="0x565eD3D57fe40f78A46f348C220121AE093c3cF8",  # SwapRouter (V1-style)
    quoter_address="0x428f20dd8926Eabe19653815Ed0BE7D6c36f8425",  # QuoterV2
    wrapped_native_address="0x3100000000000000000000000000000000000006",  # WcBTC
    wrapped_native_symbol="WCBTC",
    router_style=ROUTER_V1_DEADLINE_IN_PARAMS,
    # Citrea L1 fee surcharge is NOT included in eth_estimateGas — add 15%.
    gas_headroom_pct=15,
)

juiceswap_api = UniV3ForkAPI(CITREA_VENUE)
