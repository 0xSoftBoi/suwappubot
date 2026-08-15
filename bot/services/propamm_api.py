"""PropAMM liquidity client, taken via Titan Builder.

PropAMMs ("proprietary AMMs") are private-liquidity pools that only settle
through Titan-built blocks. Titan's PropAMMRouter re-quotes every whitelisted
pAMM venue + Uniswap V3 in-tx and routes to the best, falling back to Uniswap
V3 transparently — so a taker gets "best pAMM OR UniV3" through one contract.

Ethereum mainnet only, same-chain swaps. Docs:
https://docs.titanbuilder.xyz/propamms/takers

Quoting: public JSON-RPC (no auth) via titan_getPammQuote — returns amounts as
HEX-encoded atomic units. Execution: PropAMMRouter proxy (both the ERC20
spender to approve AND the tx `to` target), swapV1/swapWithFeeV1.

NOTE (verified live, 2026-08-15): the quote RPC indexes trading pairs by WETH
and returns an "unknown pair" error for the native ETH sentinel
(0xEeee...EEeE) as tokenIn/tokenOut — unlike the router itself, which accepts
the sentinel directly (payable, msg.value == amountIn) per the docs. This
client transparently remaps the sentinel to WETH for the QUOTE call only;
callers (swap_engine) still speak the standard native sentinel everywhere
else, matching the KyberSwap/1inch/0x convention in this codebase.
"""

import logging
from typing import Optional
from dataclasses import dataclass

from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter
from bot.utils.performance import track_time, MetricNames
from bot.config.settings import settings

logger = logging.getLogger(__name__)

# Titan represents native ETH with the standard sentinel (matches
# KyberSwap/1inch/0x's convention) for EXECUTION (the router accepts it
# directly as tokenIn/tokenOut, payable).
PROPAMM_NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"

# Titan's quote RPC (titan_getPammQuote) indexes pairs by WETH, not the
# sentinel — verified live (returns "unknown pair" for the sentinel).
# QUOTE-ONLY remap; the router execution call still uses the sentinel.
PROPAMM_WETH_ETHEREUM = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"


@dataclass
class PropAMMQuote:
    """Quote response from Titan's titan_getPammQuote."""

    from_token: str
    to_token: str
    from_amount: str  # atomic units (as queried, before any WETH remap)
    to_amount: str  # atomic units
    pamm: Optional[str]  # whitelisted pAMM venue address that would fill this
    router: Optional[str]  # PropAMMRouter address Titan reports
    block_number: Optional[int]
    raw_response: dict


class PropAMMError(Exception):
    """Exception raised for PropAMM/Titan RPC errors. Treated as a skipped
    quote by the swap engine — never a user-facing crash."""

    def __init__(self, message: str, response: Optional[dict] = None):
        self.message = message
        self.response = response
        super().__init__(self.message)


class PropAMMAPI:
    """Client for PropAMM liquidity via the Titan Builder JSON-RPC (EVM,
    Ethereum mainnet only, no API key)."""

    def __init__(self):
        self.base_url = settings.titan_rpc_url

    @property
    def is_configured(self) -> bool:
        """PropAMM needs no key — it's gated behind an explicit enable flag so
        it ships dark and has a no-redeploy kill switch."""
        return bool(settings.propamm_enabled)

    @staticmethod
    def _quote_token(address: str) -> str:
        """Remap the native sentinel to WETH for the quote RPC only (Titan
        indexes pairs by WETH — see module docstring)."""
        if address and address.lower() == PROPAMM_NATIVE_TOKEN.lower():
            return PROPAMM_WETH_ETHEREUM
        return address

    @track_time(MetricNames.API_PROPAMM)
    async def _rpc_call(self, method: str, params: list) -> Optional[dict]:
        """POST a JSON-RPC 2.0 request to the Titan Builder RPC.

        Returns the `result` dict, or None when Titan reports a benign
        "no route" condition (e.g. unknown/untraded pair) — that is treated as
        a skipped quote, not an error. Any other JSON-RPC error or transport
        failure raises PropAMMError.
        """
        await api_limiter.wait_and_acquire("propamm")
        body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        session = await get_session()
        try:
            async with session.post(self.base_url, json=body) as response:
                if response.status != 200:
                    raise PropAMMError(f"Titan RPC HTTP {response.status}")
                data = await response.json()
        except PropAMMError:
            raise
        except Exception as e:
            raise PropAMMError(f"Titan RPC request failed: {e}")

        error = data.get("error")
        if error:
            message = str(error.get("message", "")) if isinstance(error, dict) else str(error)
            # Benign "no route for this pair" style responses -> skip quietly.
            if any(
                marker in message.lower()
                for marker in ("unknown pair", "no route", "not found", "no quote")
            ):
                logger.debug(f"Titan {method} — no route: {message}")
                return None
            raise PropAMMError(f"Titan RPC error: {message}", data)

        result = data.get("result")
        if not result:
            return None
        return result

    async def get_quote(
        self,
        token_in: str,
        token_out: str,
        amount_in: str,
    ) -> Optional[PropAMMQuote]:
        """Get a PropAMM quote via titan_getPammQuote.

        Args:
            token_in: Source token address (native ETH = PROPAMM_NATIVE_TOKEN;
                remapped internally to WETH for this call only)
            token_out: Destination token address (same native handling)
            amount_in: Input amount in smallest units (decimal string)

        Returns:
            PropAMMQuote, or None if Titan has no route for this pair
            (venue-unavailable — callers should treat this like a skipped
            quote, not an error).
        """
        try:
            amount_in_int = int(amount_in)
        except (TypeError, ValueError):
            raise PropAMMError(f"Invalid amount_in for PropAMM quote: {amount_in!r}")

        quote_token_in = self._quote_token(token_in)
        quote_token_out = self._quote_token(token_out)
        amount_in_hex = hex(amount_in_int)

        result = await self._rpc_call(
            "titan_getPammQuote",
            [quote_token_in, quote_token_out, amount_in_hex],
        )
        if not result:
            return None

        to_amount_raw = result.get("amountOut")
        if not to_amount_raw:
            return None

        try:
            to_amount = str(
                int(to_amount_raw, 16) if isinstance(to_amount_raw, str) else int(to_amount_raw)
            )
        except (TypeError, ValueError):
            raise PropAMMError(f"Unparseable amountOut from Titan: {to_amount_raw!r}", result)

        if to_amount == "0":
            return None

        block_number = None
        raw_block = result.get("blockNumber")
        if raw_block is not None:
            try:
                block_number = int(raw_block, 16) if isinstance(raw_block, str) else int(raw_block)
            except (TypeError, ValueError):
                block_number = None

        return PropAMMQuote(
            from_token=token_in,
            to_token=token_out,
            from_amount=amount_in,
            to_amount=to_amount,
            pamm=result.get("pamm"),
            router=result.get("router"),
            block_number=block_number,
            raw_response=result,
        )
