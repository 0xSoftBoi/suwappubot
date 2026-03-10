"""Internal API client for calling TypeScript API (api-ts) from Python bot.

Establishes the bridge for the Python bot to call api-ts endpoints
for operations that should be consolidated in the TypeScript layer.

Usage:
    from bot.services.api_client import api_client

    # Get a swap quote via api-ts
    quote = await api_client.get_quote(
        from_chain="ethereum", to_chain="base",
        from_token="0x...", to_token="0x...",
        from_amount="1000000000000000000",
        from_address="0x..."
    )

    # Check swap status
    status = await api_client.get_swap_status(swap_id=123)
"""

import logging
import os
from typing import Any, Optional

import aiohttp

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = aiohttp.ClientTimeout(total=30)


class InternalAPIClient:
    """HTTP client for calling api-ts internal endpoints."""

    def __init__(self):
        self._base_url: str = ""
        self._api_key: str = ""
        self._session: Optional[aiohttp.ClientSession] = None

    async def init(self):
        """Initialize the client with env vars."""
        self._base_url = os.getenv(
            "INTERNAL_API_URL", "http://localhost:8000"
        ).rstrip("/")
        self._api_key = os.getenv("INTERNAL_API_KEY", "")

        if not self._api_key:
            logger.warning(
                "[APIClient] INTERNAL_API_KEY not set, internal API calls will fail"
            )

        self._session = aiohttp.ClientSession(
            timeout=DEFAULT_TIMEOUT,
            headers={
                "X-Internal-Key": self._api_key,
                "Content-Type": "application/json",
            },
        )
        logger.info(f"[APIClient] Initialized (base_url={self._base_url})")

    async def close(self):
        """Close the HTTP session."""
        if self._session:
            await self._session.close()

    async def _request(
        self,
        method: str,
        path: str,
        params: Optional[dict] = None,
        json_data: Optional[dict] = None,
    ) -> dict:
        """Make an authenticated request to api-ts.

        Raises:
            APIClientError: If the request fails or returns non-200.
        """
        if not self._session:
            await self.init()

        url = f"{self._base_url}{path}"

        try:
            async with self._session.request(
                method, url, params=params, json=json_data
            ) as resp:
                body = await resp.json()

                if resp.status >= 400:
                    error_msg = body.get("error", resp.reason)
                    raise APIClientError(
                        f"api-ts returned {resp.status}: {error_msg}",
                        status=resp.status,
                        body=body,
                    )

                return body

        except aiohttp.ClientError as e:
            raise APIClientError(f"Request to api-ts failed: {e}") from e

    # ─── Swap Endpoints ──────────────────────────────────────

    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        from_amount: str,
        from_address: str,
        slippage: float = 0.03,
    ) -> dict:
        """Get a swap quote from api-ts.

        Returns the full quote object including transactionRequest for execution.
        """
        return await self._request(
            "GET",
            "/internal/swap/quote",
            params={
                "fromChain": from_chain,
                "toChain": to_chain,
                "fromToken": from_token,
                "toToken": to_token,
                "fromAmount": from_amount,
                "fromAddress": from_address,
                "slippage": str(slippage),
            },
        )

    async def get_swap_status(self, swap_id: int) -> dict:
        """Check the status of a swap by ID."""
        return await self._request("GET", f"/internal/swap/status/{swap_id}")

    async def create_swap_record(self, swap_data: dict) -> dict:
        """Create a swap record in the database via api-ts."""
        return await self._request("POST", "/internal/swap/record", json_data=swap_data)

    async def update_swap_status(
        self,
        swap_id: int,
        status: str,
        tx_hash: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> dict:
        """Update a swap record's status."""
        payload: dict[str, Any] = {"status": status}
        if tx_hash:
            payload["txHash"] = tx_hash
        if error_message:
            payload["errorMessage"] = error_message

        return await self._request(
            "PATCH", f"/internal/swap/{swap_id}", json_data=payload
        )

    # ─── User Endpoints ──────────────────────────────────────

    async def get_user(self, user_id: int) -> dict:
        """Get user data from api-ts."""
        return await self._request("GET", f"/internal/user/{user_id}")

    async def sync_user(self, user_data: dict) -> dict:
        """Sync user data to api-ts (create or update)."""
        return await self._request("POST", "/internal/user/sync", json_data=user_data)

    # ─── Token Endpoints ─────────────────────────────────────

    async def get_token_price(self, chain: str, token_address: str) -> dict:
        """Get token price from api-ts."""
        return await self._request(
            "GET",
            "/internal/token/price",
            params={"chain": chain, "address": token_address},
        )

    # ─── Health ──────────────────────────────────────────────

    async def health_check(self) -> dict:
        """Check api-ts health."""
        return await self._request("GET", "/health")


class APIClientError(Exception):
    """Error from internal API calls."""

    def __init__(self, message: str, status: int = 0, body: Optional[dict] = None):
        super().__init__(message)
        self.status = status
        self.body = body or {}


# Global instance
api_client = InternalAPIClient()
