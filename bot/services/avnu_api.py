"""AVNU API client for Starknet swaps (modeled on jupiter_api.py).

AVNU is the leading Starknet DEX aggregator. We use the REST API directly
(no SDK): GET /swap/v3/quotes with integrator-fee query params, then the
build endpoint to obtain calldata, then sign+send an approve+swap multicall
as a single v3 (STRK-fee) invoke via starknet_py.

starknet_py is only imported lazily inside execute_swap(), so this module
imports cleanly on interpreters without it (e.g. local Python 3.9).
"""

import logging
from dataclasses import dataclass
from typing import Optional

import httpx

from bot.config.settings import settings
from bot.config.starknet_addresses import AVNU_EXCHANGE
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

AVNU_BASE_URL = "https://starknet.api.avnu.fi"
# v3 quotes are confirmed live (richer fee object, integrator fee params work
# as GET query params). The v3 build path is the target; if AVNU returns 404
# we fall back to the verified v2 build endpoint.
# TODO(P1 verify): confirm /swap/v3/build on Sepolia; once confirmed, drop the
# v2 fallback below (one-line switch).
AVNU_QUOTES_ENDPOINT = "/swap/v3/quotes"
AVNU_BUILD_ENDPOINT = "/swap/v3/build"
AVNU_BUILD_ENDPOINT_FALLBACK = "/swap/v2/build"

AVNU_INTEGRATOR_NAME = "Suwappu"

U128_MASK = (1 << 128) - 1


def split_u256(value: int) -> tuple[int, int]:
    """Split an unsigned int into (low, high) u128 limbs for Cairo u256 calldata."""
    if value < 0:
        raise ValueError("u256 value must be non-negative")
    if value >> 256:
        raise ValueError("value does not fit in u256")
    return value & U128_MASK, value >> 128


@dataclass
class AvnuQuote:
    """Quote response from AVNU /swap/v3/quotes."""

    quote_id: str
    sell_token_address: str
    buy_token_address: str
    sell_amount: int
    buy_amount: int
    gas_fees_in_usd: float
    integrator_fees_bps: int
    raw_response: dict


class AvnuError(Exception):
    """Exception raised for AVNU API errors."""

    def __init__(self, message: str, response: Optional[dict] = None):
        self.message = message
        self.response = response
        super().__init__(self.message)


class AvnuAPI:
    """Client for the AVNU DEX aggregator API on Starknet."""

    def __init__(self):
        self.base_url = AVNU_BASE_URL
        self.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    async def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[dict] = None,
        json_data: Optional[dict] = None,
    ) -> dict:
        """Make an API request to AVNU."""
        await api_limiter.wait_and_acquire("avnu")
        url = f"{self.base_url}{endpoint}"
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.request(
                method, url, params=params, json=json_data, headers=self.headers
            )
            try:
                data = response.json()
            except Exception:
                data = {"raw": response.text}
            if response.status_code == 404:
                raise AvnuNotFoundError(f"AVNU endpoint not found: {endpoint}", data)
            if response.status_code >= 400:
                messages = data.get("messages") if isinstance(data, dict) else None
                error_msg = messages or (data.get("error") if isinstance(data, dict) else data)
                raise AvnuError(f"AVNU API error ({response.status_code}): {error_msg}", data)
            return data

    def _quote_params(
        self,
        sell_token_address: str,
        buy_token_address: str,
        sell_amount: int,
        taker_address: Optional[str] = None,
        integrator_fee_bps: Optional[int] = None,
        integrator_fee_recipient: Optional[str] = None,
    ) -> dict:
        """Build /swap/v3/quotes query params (pure — unit-testable).

        Integrator fee params are only attached when BOTH a non-zero bps and a
        recipient are configured — AVNU rejects a fee with no recipient, and a
        fee nobody collects would just degrade the user's quote.
        """
        params = {
            "sellTokenAddress": sell_token_address,
            "buyTokenAddress": buy_token_address,
            "sellAmount": hex(sell_amount),
        }
        if taker_address:
            params["takerAddress"] = taker_address
        if integrator_fee_bps and integrator_fee_recipient:
            params["integratorFees"] = hex(integrator_fee_bps)
            params["integratorFeeRecipient"] = integrator_fee_recipient
            params["integratorName"] = AVNU_INTEGRATOR_NAME
        return params

    async def get_quote(
        self,
        sell_token_address: str,
        buy_token_address: str,
        sell_amount: int,
        taker_address: Optional[str] = None,
        integrator_fee_bps: Optional[int] = None,
        integrator_fee_recipient: Optional[str] = None,
    ) -> AvnuQuote:
        """Get the best AVNU quote for a Starknet swap.

        Args:
            sell_token_address: Sell token contract address (felt hex)
            buy_token_address: Buy token contract address (felt hex)
            sell_amount: Sell amount in base units (int)
            taker_address: User's Starknet account address
            integrator_fee_bps: Our integrator fee in bps (None = settings default)
            integrator_fee_recipient: Fee recipient (None = settings default)
        """
        if integrator_fee_bps is None:
            integrator_fee_bps = settings.avnu_integrator_fee_bps
        if integrator_fee_recipient is None:
            integrator_fee_recipient = settings.avnu_fee_recipient

        params = self._quote_params(
            sell_token_address=sell_token_address,
            buy_token_address=buy_token_address,
            sell_amount=sell_amount,
            taker_address=taker_address,
            integrator_fee_bps=integrator_fee_bps,
            integrator_fee_recipient=integrator_fee_recipient,
        )
        data = await self._request("GET", AVNU_QUOTES_ENDPOINT, params=params)

        quotes = data if isinstance(data, list) else data.get("quotes", [])
        if not quotes:
            raise AvnuError("AVNU returned no quotes", data if isinstance(data, dict) else None)
        best = quotes[0]

        fee_obj = best.get("fee") or {}
        integrator_bps_raw = fee_obj.get("integratorFeesBps", best.get("integratorFees", 0))

        return AvnuQuote(
            quote_id=best.get("quoteId", ""),
            sell_token_address=best.get("sellTokenAddress", sell_token_address),
            buy_token_address=best.get("buyTokenAddress", buy_token_address),
            sell_amount=_to_int(best.get("sellAmount", sell_amount)),
            buy_amount=_to_int(best.get("buyAmount", 0)),
            gas_fees_in_usd=float(best.get("gasFeesInUsd", 0) or 0),
            integrator_fees_bps=_to_int(integrator_bps_raw),
            raw_response=best,
        )

    async def build_swap(
        self,
        quote_id: str,
        taker_address: str,
        slippage: float = 0.005,
    ) -> dict:
        """Build swap calldata from a quote (POST build endpoint).

        Tries /swap/v3/build first; on 404 falls back to /swap/v2/build.

        Returns the raw build response containing the call(s) to execute:
        {"chainId": ..., "calls": [{"contractAddress", "entrypoint", "calldata"}]}
        (v2 returns a single call as top-level contractAddress/entrypoint/calldata —
        normalize_calls() handles both shapes.)
        """
        payload = {
            "quoteId": quote_id,
            "takerAddress": taker_address,
            "slippage": slippage,
            # Phase 1: self-paid STRK gas, no gasless/paymaster build.
            "includeApprove": False,
        }
        try:
            return await self._request("POST", AVNU_BUILD_ENDPOINT, json_data=payload)
        except AvnuNotFoundError:
            logger.warning(
                "AVNU %s returned 404; falling back to %s",
                AVNU_BUILD_ENDPOINT,
                AVNU_BUILD_ENDPOINT_FALLBACK,
            )
            return await self._request("POST", AVNU_BUILD_ENDPOINT_FALLBACK, json_data=payload)

    @staticmethod
    def normalize_calls(build_response: dict) -> list[dict]:
        """Normalize a build response to a list of {to, selector_name, calldata_ints}."""
        raw_calls = build_response.get("calls")
        if not raw_calls:
            # v2 shape: single call at the top level
            raw_calls = [build_response]
        calls = []
        for c in raw_calls:
            calldata = [_to_int(x) for x in (c.get("calldata") or [])]
            calls.append(
                {
                    "to": c.get("contractAddress", AVNU_EXCHANGE),
                    "entrypoint": c.get("entrypoint", "multi_route_swap"),
                    "calldata": calldata,
                }
            )
        return calls

    async def execute_swap(
        self,
        account,
        quote: AvnuQuote,
        slippage: float = 0.005,
    ) -> str:
        """Build, sign and send the swap as ONE approve+swap multicall (v3/STRK gas).

        The approve is exact-amount (never infinite): u256(sell_amount) split
        into low/high limbs, spender = the AVNU exchange (or the build call's
        target). Returns the transaction hash (hex string).
        """
        from starknet_py.hash.selector import get_selector_from_name
        from starknet_py.net.client_models import Call

        build = await self.build_swap(
            quote_id=quote.quote_id,
            taker_address=hex(account.address),
            slippage=slippage,
        )
        swap_calls_raw = self.normalize_calls(build)
        if not swap_calls_raw:
            raise AvnuError("AVNU build returned no calls", build)

        spender = _to_int(swap_calls_raw[0]["to"])
        low, high = split_u256(quote.sell_amount)
        approve_call = Call(
            to_addr=_to_int(quote.sell_token_address),
            selector=get_selector_from_name("approve"),
            calldata=[spender, low, high],
        )
        swap_calls = [
            Call(
                to_addr=_to_int(c["to"]),
                selector=get_selector_from_name(c["entrypoint"]),
                calldata=c["calldata"],
            )
            for c in swap_calls_raw
        ]

        response = await account.execute_v3(
            calls=[approve_call] + swap_calls,
            auto_estimate=True,
        )
        tx_hash = hex(response.transaction_hash)
        logger.info("AVNU swap submitted: %s", tx_hash)
        return tx_hash


class AvnuNotFoundError(AvnuError):
    """Raised when an AVNU endpoint returns 404 (drives v3→v2 build fallback)."""


def _to_int(value) -> int:
    """Parse an int that may arrive as int, hex string, or decimal string."""
    if value is None:
        return 0
    if isinstance(value, int):
        return value
    s = str(value).strip()
    if s.lower().startswith("0x"):
        return int(s, 16)
    return int(s)


# Global instance
avnu_api = AvnuAPI()
