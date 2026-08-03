"""NEAR Intents 1-Click API bridge provider.

https://1click.chaindefuser.com — an intent-based cross-chain solver network.
Settlement model is `deposit_address`: the quote returns a generated deposit
address; the user sends funds there and a solver fills the order off-chain.
There is NO transaction to build/sign for this provider — do not attempt to
construct one.
"""

import logging
import re
import time
from typing import Any, Dict, List, Optional

from bot.config.settings import settings
from bot.services.bridge.base import (
    BridgeError,
    BridgeProvider,
    BridgeQuote,
    normalize_amount,
    validate_address_for_chain,
)
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

NEAR_INTENTS_BASE_URL = "https://1click.chaindefuser.com"

# A NEAR-side account id (implicit hex-64 account or a named .near account),
# NOT an EVM 0x-40-hex address. Used to sanity-check appFees.recipient before
# sending it — 1-Click expects the fee recipient to be a NEAR account.
_NEAR_ACCOUNT_RE = re.compile(r"^([a-z0-9_-]+\.near|[a-f0-9]{64})$")

# How long the cached /v0/tokens registry is trusted before re-fetching.
_TOKEN_CACHE_TTL_SECONDS = 300


class NearIntentsError(BridgeError):
    """Exception for NEAR Intents 1-Click API errors."""


class NearIntentsBridge(BridgeProvider):
    """Client for the NEAR Intents 1-Click API.

    Guess/assumption flag: the exact request/response field names below
    (originAsset, destinationAsset, appFees, deadline, depositAddress, etc.)
    follow the publicly documented 1-Click API shape as of the code-review
    date, but have NOT been verified against a live call in this session
    (no live network calls were made). Treat field names as best-effort until
    confirmed against a real response.
    """

    def __init__(self):
        self.base_url = NEAR_INTENTS_BASE_URL
        self._token_cache: Optional[List[Dict[str, Any]]] = None
        self._token_cache_fetched_at: float = 0.0

    @property
    def name(self) -> str:
        return "near_intents"

    @property
    def enabled(self) -> bool:
        return bool(settings.near_intents_api_key)

    def is_supported_route(
        self, from_chain: str, to_chain: str, token: Optional[str] = None
    ) -> bool:
        # Cheap, synchronous check only. If we don't have a cached asset
        # registry yet, we optimistically allow the route through and defer
        # the real support decision to get_quote (which fails closed once
        # the registry is available — see _resolve_asset_id). Once a cache
        # exists, use it to reject unsupported routes early.
        if from_chain.lower() == to_chain.lower():
            return False
        if self._token_cache is None or not token:
            return True
        origin = self._find_asset_id_sync(from_chain, token)
        dest = self._find_asset_id_sync(to_chain, token)
        return origin is not None and dest is not None

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if settings.near_intents_api_key:
            headers["Authorization"] = f"Bearer {settings.near_intents_api_key}"
        return headers

    def _find_asset_id_sync(self, chain: str, symbol: str) -> Optional[str]:
        """Look up a defuse asset id in the (already-fetched) cache only.

        No network call — used by the cheap synchronous is_supported_route
        check. Returns None if the cache is empty or no exact match exists.
        """
        if not self._token_cache:
            return None
        chain_l = chain.lower()
        symbol_u = symbol.upper()
        for entry in self._token_cache:
            entry_chain = str(entry.get("blockchain", "")).lower()
            entry_symbol = str(entry.get("symbol", "")).upper()
            if entry_chain == chain_l and entry_symbol == symbol_u:
                return entry.get("assetId")
        return None

    async def _get_token_registry(self) -> List[Dict[str, Any]]:
        """Fetch and cache the 1-Click /v0/tokens asset registry.

        Failing to fetch returns an empty list (never raises) so callers can
        fail closed (no exact match => unsupported) rather than crashing the
        whole quote path.
        """
        now = time.monotonic()
        if self._token_cache is not None and (now - self._token_cache_fetched_at) < (
            _TOKEN_CACHE_TTL_SECONDS
        ):
            return self._token_cache

        session = await get_session()
        try:
            async with session.get(
                f"{self.base_url}/v0/tokens", headers=self._headers()
            ) as response:
                if response.status != 200:
                    logger.warning(f"NEAR Intents /v0/tokens failed ({response.status})")
                    return self._token_cache or []
                data = await response.json()
        except Exception as e:
            logger.debug(f"NEAR Intents /v0/tokens error: {e}")
            return self._token_cache or []

        tokens = data if isinstance(data, list) else data.get("tokens", [])
        if not isinstance(tokens, list):
            tokens = []
        self._token_cache = tokens
        self._token_cache_fetched_at = now
        return tokens

    async def _resolve_asset_id(self, chain: str, symbol: str) -> Optional[str]:
        """Resolve a (chain, symbol) pair to a 1-Click defuse asset id
        (e.g. `nep141:...`) against the live/cached /v0/tokens registry.

        Returns None on no exact match — callers MUST treat that as
        "unsupported route" and refuse to quote, never guess/construct an
        id from the chain+symbol strings directly.
        """
        tokens = await self._get_token_registry()
        chain_l = chain.lower()
        symbol_u = symbol.upper()
        for entry in tokens:
            entry_chain = str(entry.get("blockchain", "")).lower()
            entry_symbol = str(entry.get("symbol", "")).upper()
            if entry_chain == chain_l and entry_symbol == symbol_u:
                asset_id = entry.get("assetId")
                if asset_id:
                    return asset_id
        return None

    def _build_app_fees(self, from_amount: str) -> Optional[List[Dict[str, Any]]]:
        """Build the appFees payload, or None if it should be omitted.

        Fails closed: any misconfiguration (out-of-range bps, non-NEAR
        recipient, missing recipient) skips appFees entirely rather than
        sending a malformed/dangerous fee instruction.
        """
        recipient = settings.near_intents_fee_recipient
        bps = settings.near_intents_fee_bps
        if not recipient:
            return None
        if not (0 <= bps <= 100):
            logger.warning(
                f"NEAR Intents fee_bps {bps} out of allowed range [0, 100]; skipping appFees"
            )
            return None
        if bps == 0:
            return None
        if not _NEAR_ACCOUNT_RE.match(recipient):
            logger.warning(
                "NEAR Intents fee recipient does not look like a NEAR account "
                f"({recipient!r}); 1-Click expects a NEAR-side account, not an EVM "
                "address — skipping appFees"
            )
            return None
        return [{"recipient": recipient, "fee": bps}]

    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        from_amount: str,
        from_address: str,
        to_address: Optional[str] = None,
        slippage_bps: int = 50,
    ) -> Optional[BridgeQuote]:
        if not self.enabled:
            return None
        if slippage_bps <= 0:
            logger.debug(
                f"NEAR Intents quote rejected: slippage_bps must be > 0, got {slippage_bps}"
            )
            return None
        if not self.is_supported_route(from_chain, to_chain, from_token):
            return None

        try:
            from_amount = normalize_amount(from_amount)
        except ValueError as e:
            logger.debug(f"NEAR Intents quote rejected: {e}")
            return None

        origin_asset = await self._resolve_asset_id(from_chain, from_token)
        destination_asset = await self._resolve_asset_id(to_chain, from_token)
        if origin_asset is None or destination_asset is None:
            logger.debug(
                f"NEAR Intents quote rejected: no exact asset registry match for "
                f"{from_chain}/{from_token} -> {to_chain}/{from_token}"
            )
            return None

        # Cross-format destination validation (#2): never fall back to
        # from_address for recipient/refundTo on a route that crosses
        # address formats.
        if to_address:
            if not validate_address_for_chain(to_address, to_chain):
                logger.debug(
                    f"NEAR Intents quote rejected: to_address fails {to_chain} format check"
                )
                return None
            recipient = to_address
        else:
            if not validate_address_for_chain(from_address, to_chain):
                logger.debug(
                    "NEAR Intents quote rejected: no to_address and from_address does not "
                    f"match {to_chain} address format"
                )
                return None
            recipient = from_address

        if not validate_address_for_chain(from_address, from_chain):
            logger.debug(
                f"NEAR Intents quote rejected: from_address fails {from_chain} format check"
            )
            return None

        await api_limiter.wait_and_acquire("near_intents")
        session = await get_session()

        body: Dict[str, Any] = {
            # Routing/quoting only — dry=True never mints a live deposit
            # intent. Only commit_quote() (called at execution time) uses
            # dry=False to obtain a usable deposit address.
            "dry": True,
            "originAsset": origin_asset,
            "destinationAsset": destination_asset,
            "amount": from_amount,
            "refundTo": from_address,
            "recipient": recipient,
            "slippageTolerance": slippage_bps,  # 1-Click's units are already bps.
        }
        app_fees = self._build_app_fees(from_amount)
        if app_fees:
            body["appFees"] = app_fees

        try:
            async with session.post(
                f"{self.base_url}/v0/quote", json=body, headers=self._headers()
            ) as response:
                if response.status != 200:
                    text = await response.text()
                    logger.warning(f"NEAR Intents quote failed ({response.status}): {text}")
                    return None
                data = await response.json()
        except Exception as e:
            logger.debug(f"NEAR Intents quote error: {e}")
            return None

        return self._parse_quote_response(
            data,
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            from_amount=from_amount,
            slippage_bps=slippage_bps,
            expect_deposit_address=False,
        )

    async def commit_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        from_amount: str,
        from_address: str,
        to_address: Optional[str] = None,
        slippage_bps: int = 50,
    ) -> Optional[BridgeQuote]:
        """Re-quote with `dry: False` at EXECUTION time only.

        This is the ONLY method in this class that mints a live deposit
        intent / usable deposit address. Routing/quoting (get_quote) always
        uses dry=True and must never be used to obtain a deposit address to
        send funds to.
        """
        if not self.enabled:
            return None
        if slippage_bps <= 0:
            return None
        if not self.is_supported_route(from_chain, to_chain, from_token):
            return None

        try:
            from_amount = normalize_amount(from_amount)
        except ValueError as e:
            logger.debug(f"NEAR Intents commit_quote rejected: {e}")
            return None

        origin_asset = await self._resolve_asset_id(from_chain, from_token)
        destination_asset = await self._resolve_asset_id(to_chain, from_token)
        if origin_asset is None or destination_asset is None:
            return None

        if to_address:
            if not validate_address_for_chain(to_address, to_chain):
                return None
            recipient = to_address
        else:
            if not validate_address_for_chain(from_address, to_chain):
                return None
            recipient = from_address

        if not validate_address_for_chain(from_address, from_chain):
            return None

        await api_limiter.wait_and_acquire("near_intents")
        session = await get_session()

        body: Dict[str, Any] = {
            "dry": False,
            "originAsset": origin_asset,
            "destinationAsset": destination_asset,
            "amount": from_amount,
            "refundTo": from_address,
            "recipient": recipient,
            "slippageTolerance": slippage_bps,
        }
        app_fees = self._build_app_fees(from_amount)
        if app_fees:
            body["appFees"] = app_fees

        try:
            async with session.post(
                f"{self.base_url}/v0/quote", json=body, headers=self._headers()
            ) as response:
                if response.status != 200:
                    text = await response.text()
                    logger.warning(f"NEAR Intents commit failed ({response.status}): {text}")
                    return None
                data = await response.json()
        except Exception as e:
            logger.debug(f"NEAR Intents commit error: {e}")
            return None

        return self._parse_quote_response(
            data,
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            from_amount=from_amount,
            slippage_bps=slippage_bps,
            expect_deposit_address=True,
        )

    def _parse_quote_response(
        self,
        data: Dict[str, Any],
        *,
        from_chain: str,
        to_chain: str,
        from_token: str,
        from_amount: str,
        slippage_bps: int,
        expect_deposit_address: bool,
    ) -> Optional[BridgeQuote]:
        quote_data = data.get("quote", data)
        deposit_address = quote_data.get("depositAddress")
        amount_out_raw = quote_data.get("amountOut")
        time_estimate = quote_data.get("timeEstimate", 60)

        if amount_out_raw is None:
            logger.debug(f"NEAR Intents quote missing amountOut: {data}")
            return None
        try:
            amount_out = int(normalize_amount(amount_out_raw))
        except ValueError as e:
            logger.debug(f"NEAR Intents quote has unparseable amountOut: {e}")
            return None

        # Sanity band: a same-symbol transfer losing more than half its
        # value means something is wrong upstream.
        if amount_out < int(from_amount) // 2:
            logger.warning(
                f"NEAR Intents quote rejected: amountOut {amount_out} is less than half "
                f"from_amount {from_amount}"
            )
            return None

        if deposit_address:
            # The deposit address is on the ORIGIN chain (user sends funds
            # there), so validate it against from_chain's format.
            if not validate_address_for_chain(deposit_address, from_chain):
                logger.warning(
                    f"NEAR Intents quote rejected: depositAddress fails {from_chain} "
                    "format check"
                )
                return None
        elif expect_deposit_address:
            logger.debug(f"NEAR Intents commit_quote missing required depositAddress: {data}")
            return None

        provider_min_raw = quote_data.get("minAmountOut")
        floor = amount_out * (10000 - slippage_bps) // 10000
        if provider_min_raw is None:
            to_amount_min = floor
        else:
            try:
                provider_min = int(normalize_amount(provider_min_raw))
            except ValueError:
                provider_min = floor
            to_amount_min = min(provider_min, floor)

        return BridgeQuote(
            provider=self.name,
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=from_token,
            from_amount=from_amount,
            to_amount=str(amount_out),
            to_amount_min=str(to_amount_min),
            gas_cost_usd=0.0,  # Gas is paid by the solver, not the user.
            fee_cost_usd=float(quote_data.get("feeUsd", 0) or 0),
            estimated_time=int(time_estimate),
            transaction_request={},
            raw_response=data,
            settlement="deposit_address",
            deposit_address=deposit_address,
            trust_model="solver",
        )

    async def get_status(self, tracking_id: str) -> Dict[str, Any]:
        """Poll transfer status by deposit address (`tracking_id`)."""
        session = await get_session()
        try:
            async with session.get(
                f"{self.base_url}/v0/status",
                params={"depositAddress": tracking_id},
                headers=self._headers(),
            ) as response:
                if response.status != 200:
                    return {"status": "UNKNOWN"}
                return await response.json()
        except Exception as e:
            logger.debug(f"NEAR Intents status error: {e}")
            return {"status": "UNKNOWN"}


# Global instance
near_intents_api = NearIntentsBridge()
