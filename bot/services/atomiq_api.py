"""Atomiq REST API client (BTC/Lightning ↔ Starknet bridge — Phase 3).

Contract: docs/integrations/atomiq-api.md (live-verified 2026-06-11).
Base URL: settings.atomiq_api_url (mainnet default, no auth).

Conventions:
- All amounts are raw base-unit STRINGS (sats = 8 decimals). Never floats.
- Token ids: BITCOIN-BTC, LIGHTNING-BTC, STARKNET-WBTC, STARKNET-strkBTC, ...
- No documented rate limits; we retry 5xx with exponential backoff.

Exception split:
- AtomiqError          — any API failure (base class)
- AtomiqClientError    — 4xx: the request itself is wrong (no retry)
- AtomiqServerError    — 5xx/transport after retries exhausted (retryable later)
"""

import asyncio
import logging
from typing import Optional

import httpx

from bot.config.settings import settings

logger = logging.getLogger(__name__)

# Exponential backoff for 5xx/transport errors: 1s, 2s, 4s between attempts.
MAX_ATTEMPTS = 4
BACKOFF_BASE_SECONDS = 1.0
REQUEST_TIMEOUT = 20.0


class AtomiqError(Exception):
    """Base exception for Atomiq API failures."""

    def __init__(self, message: str, response: Optional[dict] = None):
        self.message = message
        self.response = response
        super().__init__(self.message)


class AtomiqClientError(AtomiqError):
    """4xx — the request is malformed/rejected; retrying will not help."""


class AtomiqServerError(AtomiqError):
    """5xx or transport failure after retries — safe to retry later."""


class AtomiqAPI:
    """Async client for the Atomiq swap execution REST API."""

    def __init__(self, base_url: Optional[str] = None, client: Optional[httpx.AsyncClient] = None):
        self._base_url = base_url
        # Per-instance HTTP client (lazy-created on first use, reused across calls)
        self._client: Optional[httpx.AsyncClient] = client

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or getattr(self._client, "is_closed", False):
            self._client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
        return self._client

    @property
    def base_url(self) -> str:
        return (self._base_url or settings.atomiq_api_url).rstrip("/")

    async def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[dict] = None,
        json_data: Optional[dict] = None,
    ) -> dict:
        """Issue a request with exponential backoff on 5xx/transport errors."""
        url = f"{self.base_url}{endpoint}"
        last_error: Optional[Exception] = None
        for attempt in range(MAX_ATTEMPTS):
            if attempt:
                await asyncio.sleep(BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)))
            try:
                response = await self._get_client().request(
                    method, url, params=params, json=json_data
                )
            except (httpx.HTTPError, OSError) as e:
                last_error = e
                logger.warning(
                    "Atomiq transport error (%s %s, attempt %d/%d): %s",
                    method,
                    endpoint,
                    attempt + 1,
                    MAX_ATTEMPTS,
                    str(e)[:200],
                )
                continue

            try:
                data = response.json()
            except Exception:
                data = {"raw": response.text}

            if response.status_code >= 500:
                last_error = AtomiqServerError(
                    f"Atomiq server error ({response.status_code}) on {endpoint}", data
                )
                logger.warning(
                    "Atomiq 5xx (%s, attempt %d/%d): %s",
                    endpoint,
                    attempt + 1,
                    MAX_ATTEMPTS,
                    str(data)[:200],
                )
                continue
            if response.status_code >= 400:
                msg = (
                    data.get("msg") or data.get("error") or data if isinstance(data, dict) else data
                )
                raise AtomiqClientError(
                    f"Atomiq API error ({response.status_code}) on {endpoint}: {str(msg)[:300]}",
                    data if isinstance(data, dict) else None,
                )
            return data

        raise AtomiqServerError(
            f"Atomiq request failed after {MAX_ATTEMPTS} attempts: {endpoint} "
            f"({str(last_error)[:200]})"
        )

    # ------------------------------------------------------------------
    # Endpoints (per docs/integrations/atomiq-api.md)
    # ------------------------------------------------------------------

    async def get_supported_tokens(self, side: str = "INPUT") -> dict:
        """GET /getSupportedTokens?side=INPUT|OUTPUT."""
        return await self._request("GET", "/getSupportedTokens", params={"side": side})

    async def get_swap_limits(self, src_token: str, dst_token: str) -> dict:
        """GET /getSwapLimits → {input: {min, max: ApiAmount}, output: {min}}."""
        return await self._request(
            "GET", "/getSwapLimits", params={"srcToken": src_token, "dstToken": dst_token}
        )

    async def parse_address(self, address: str) -> dict:
        """GET /parseAddress → {address, type(BITCOIN|LIGHTNING|LNURL|STARKNET...), amount?, min?, max?}."""
        return await self._request("GET", "/parseAddress", params={"address": address})

    async def create_swap(
        self,
        src_token: str,
        dst_token: str,
        dst_address: str,
        amount: Optional[str] = None,
        amount_type: str = "EXACT_IN",
        src_address: Optional[str] = None,
        gas_amount: Optional[str] = None,
        payment_hash: Optional[str] = None,
        lightning_invoice_description: Optional[str] = None,
    ) -> dict:
        """POST /createSwap.

        Amounts are raw base-unit strings. `amount` may be omitted for BOLT11
        destinations (the invoice itself encodes the EXACT_OUT amount).
        `payment_hash` (sha256 hex of the 32-byte secret) is required for
        Lightning-inbound swaps.
        """
        body: dict = {
            "srcToken": src_token,
            "dstToken": dst_token,
            "amountType": amount_type,
            "dstAddress": dst_address,
        }
        if amount is not None:
            body["amount"] = str(amount)
        if src_address is not None:
            body["srcAddress"] = src_address
        if gas_amount is not None:
            body["gasAmount"] = str(gas_amount)
        if payment_hash is not None:
            body["paymentHash"] = payment_hash
        if lightning_invoice_description is not None:
            body["lightningInvoiceDescription"] = lightning_invoice_description
        return await self._request("POST", "/createSwap", json_data=body)

    async def get_swap_status(self, swap_id: str, secret: Optional[str] = None) -> dict:
        """GET /getSwapStatus — adds currentAction, requiresSecretReveal, is* flags.

        Pass `secret` (hex preimage) when the previous status response set
        requiresSecretReveal=true; the server uses it to complete the claim.
        """
        params: dict = {"swapId": swap_id}
        if secret is not None:
            params["secret"] = secret
        return await self._request("GET", "/getSwapStatus", params=params)

    async def submit_transaction(self, swap_id: str, signed_txs: list) -> dict:
        """POST /submitTransaction {swapId, signedTxs} → {txHashes}.

        Only used for actions whose semantics require RETURNING signed
        transactions to the server (the SignPSBT case — out of scope for
        Phase 3). SignSmartChainTransaction actions are executed on-chain
        directly by us instead.
        """
        return await self._request(
            "POST", "/submitTransaction", json_data={"swapId": swap_id, "signedTxs": signed_txs}
        )

    async def list_pending_swaps(self, signer: str, chain_id: str = "STARKNET") -> list:
        """GET /listPendingSwaps?signer=..&chainId=STARKNET."""
        data = await self._request(
            "GET", "/listPendingSwaps", params={"signer": signer, "chainId": chain_id}
        )
        if isinstance(data, list):
            return data
        return data.get("swaps", []) if isinstance(data, dict) else []


# Global instance
atomiq_api = AtomiqAPI()
