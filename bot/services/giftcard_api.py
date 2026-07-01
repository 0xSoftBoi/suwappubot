"""Bitrefill-style gift card API client scaffold.

SCAFFOLD — NOT FUNCTIONAL.
Blocked on: BITREFILL_API_KEY env var + a live Bitrefill (or equivalent) merchant
account.  Every method raises GiftCardUnavailableError when the key is absent, so
no fake purchases or fund movements can occur.

When credentials are available:
  1. Set BITREFILL_API_KEY (and optionally BITREFILL_API_SECRET) in the environment.
  2. Remove the scaffold warnings here once the HTTP calls have been tested against
     the real Bitrefill REST API (https://www.bitrefill.com/api/4/).
  3. Route a money-path-reviewer Opus pass over this file + giftcard.py before merge.

Bitrefill v4 API base: https://www.bitrefill.com/api/4/
Auth: Basic auth — API key as username, secret as password (or key-only for read endpoints).
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from bot.config.settings import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Public exception — the handler catches this to show the "coming soon" UI.
# ---------------------------------------------------------------------------


class GiftCardUnavailableError(Exception):
    """Raised when the gift card feature is disabled (no credentials) or the
    provider returns an unrecoverable error.  The caller must NOT debit any
    balance when this is raised.
    """


# ---------------------------------------------------------------------------
# Data-transfer objects (will be populated from real API JSON when live)
# ---------------------------------------------------------------------------


@dataclass
class GiftCardProduct:
    """A product/brand available for purchase."""

    id: str  # Bitrefill product slug, e.g. "amazon-us"
    name: str  # Human-readable brand name, e.g. "Amazon (US)"
    category: str  # e.g. "shopping", "gaming", "food"
    currency_code: str  # e.g. "USD"
    denominations: list[float] = field(default_factory=list)  # Fixed values if any
    min_value: Optional[float] = None  # For ranged products
    max_value: Optional[float] = None
    recipient_type: str = "email"  # "email" | "phone" | "direct"


@dataclass
class GiftCardOrder:
    """An order returned by create_order() or get_order()."""

    order_id: str
    product_id: str
    value_usd: float
    status: str  # "pending" | "payment_received" | "complete" | "cancelled" | "refunded"
    payment_address: Optional[str] = None  # crypto address to pay (if not custodial)
    payment_amount_btc: Optional[str] = None  # payment amount in BTC (Bitrefill native)
    redemption_code: Optional[str] = None  # filled only when status == "complete"
    redemption_url: Optional[str] = None
    expires_at: Optional[str] = None  # ISO-8601 string


# ---------------------------------------------------------------------------
# Feature-gate helper
# ---------------------------------------------------------------------------


def _require_api_key() -> str:
    """Return the API key or raise GiftCardUnavailableError.

    This is called at the start of every API method so that no network I/O
    (and certainly no fund movement) occurs when credentials are absent.
    """
    key = getattr(settings, "bitrefill_api_key", None)
    if not key:
        raise GiftCardUnavailableError(
            "Gift card feature is disabled: BITREFILL_API_KEY is not configured. "
            "Set the env var and obtain a merchant account at https://www.bitrefill.com/api/."
        )
    return key


# ---------------------------------------------------------------------------
# API client
# ---------------------------------------------------------------------------


class BitrefillClient:
    """Minimal Bitrefill v4 REST client.

    SCAFFOLD — all methods raise GiftCardUnavailableError until
    BITREFILL_API_KEY is set.  HTTP implementation stubs are clearly marked
    with TODO so they are easy to find and complete.

    The client is intentionally stateless (no connection pool kept at module
    level) so it can be instantiated per-request or as a singleton without
    lifecycle concerns.
    """

    BASE_URL = "https://www.bitrefill.com/api/4"

    # ------------------------------------------------------------------
    # Catalogue
    # ------------------------------------------------------------------

    async def list_products(
        self,
        category: Optional[str] = None,
        country: str = "US",
        limit: int = 50,
    ) -> list[GiftCardProduct]:
        """Fetch available gift card products.

        Args:
            category: Optional category filter (e.g. "shopping", "gaming").
            country:  ISO-3166-1 alpha-2 country code for the recipient.
            limit:    Maximum number of products to return (1–200).

        Returns:
            List of GiftCardProduct instances.

        Raises:
            GiftCardUnavailableError: Always, until BITREFILL_API_KEY is set.
        """
        _require_api_key()

        # TODO: implement when credentials exist
        # GET /products?country={country}&limit={limit}&category={category}
        # Auth: Basic (api_key, api_secret or "")
        # Response: {"data": [{"id": ..., "name": ..., "currency": ..., ...}, ...]}
        # Map response JSON → list[GiftCardProduct]
        raise GiftCardUnavailableError("list_products: SCAFFOLD — not implemented")

    async def get_product(self, product_id: str) -> GiftCardProduct:
        """Fetch details for a single product by ID.

        Args:
            product_id: Bitrefill product slug, e.g. "amazon-us".

        Raises:
            GiftCardUnavailableError: Always, until BITREFILL_API_KEY is set.
        """
        _require_api_key()

        # TODO: GET /products/{product_id}
        # Response: {"id": ..., "name": ..., "prices": [...], ...}
        raise GiftCardUnavailableError("get_product: SCAFFOLD — not implemented")

    # ------------------------------------------------------------------
    # Order lifecycle (MONEY PATH — see comment below)
    # ------------------------------------------------------------------

    async def create_order(
        self,
        product_id: str,
        value: float,
        payment_method: str = "bitcoin",
        user_email: Optional[str] = None,
        send_to: Optional[str] = None,
    ) -> GiftCardOrder:
        """Place a gift card order with Bitrefill.

        MONEY PATH NOTE: This method MUST only be called after the caller has
        confirmed the user's custodial balance is sufficient and has placed a
        hold/reservation.  Funds must NOT be permanently debited until the
        returned order.status transitions to "payment_received" or "complete"
        (verified via get_order()).  On any GiftCardUnavailableError or
        unexpected exception the caller must release the hold and refund.

        Args:
            product_id:     Bitrefill product slug.
            value:          Gift card face value in USD.
            payment_method: "bitcoin" | "lightning" | "ethereum" | "usdc" | ...
                            (depends on Bitrefill account's enabled methods).
            user_email:     Recipient email (for email-type cards).
            send_to:        Recipient phone/address (for other types).

        Returns:
            GiftCardOrder with payment instructions and order_id.

        Raises:
            GiftCardUnavailableError: Always, until BITREFILL_API_KEY is set.
        """
        _require_api_key()

        # TODO: implement when credentials exist
        # POST /orders/
        # Body: {"productId": product_id, "value": value, "paymentMethod": payment_method,
        #        "email": user_email, "sendTo": send_to, "operatorId": "<your-operator-id>"}
        # Response: {"id": ..., "status": "payment_received", "payment": {...}, ...}
        # Map response → GiftCardOrder
        #
        # IMPORTANT: the response "payment" object contains the crypto address/amount to
        # pay.  For custodial-flow: debit the user's custodial balance here (in the caller,
        # bot/handlers/giftcard.py) ONLY after this method returns without raising, and
        # ONLY for the confirmed invoice amount.  If this method raises, no debit occurs.
        raise GiftCardUnavailableError("create_order: SCAFFOLD — not implemented")

    async def get_order(self, order_id: str) -> GiftCardOrder:
        """Poll the status of an existing order.

        Use to check when a pending order transitions to "complete" and to
        retrieve the redemption code once fulfilled.

        Args:
            order_id: The order_id returned by create_order().

        Raises:
            GiftCardUnavailableError: Always, until BITREFILL_API_KEY is set.
        """
        _require_api_key()

        # TODO: GET /orders/{order_id}
        # Response: {"id": ..., "status": ..., "giftcodes": [{"code": ...}], ...}
        # Map response → GiftCardOrder (populate redemption_code when status=="complete")
        raise GiftCardUnavailableError("get_order: SCAFFOLD — not implemented")

    # ------------------------------------------------------------------
    # Internal helpers (to be fleshed out alongside the TODOs above)
    # ------------------------------------------------------------------

    def _auth_headers(self, api_key: str) -> dict[str, Any]:
        """Build Basic-auth headers for Bitrefill v4.

        Bitrefill uses HTTP Basic auth: username=api_key, password=api_secret
        (or empty string for read-only endpoints).
        """
        import base64

        secret = getattr(settings, "bitrefill_api_secret", "") or ""
        token = base64.b64encode(f"{api_key}:{secret}".encode()).decode()
        return {
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    async def _get(self, path: str, params: Optional[dict] = None) -> dict:
        """Perform an authenticated GET request.  Stubbed for the scaffold."""
        # TODO: replace with aiohttp / httpx call using bot.utils.http_client pattern
        raise GiftCardUnavailableError("HTTP client not wired: SCAFFOLD")

    async def _post(self, path: str, body: dict) -> dict:
        """Perform an authenticated POST request.  Stubbed for the scaffold."""
        # TODO: replace with aiohttp / httpx call using bot.utils.http_client pattern
        raise GiftCardUnavailableError("HTTP client not wired: SCAFFOLD")


# ---------------------------------------------------------------------------
# Module-level singleton (follows the pattern used by okx_dex_api, zerox_api, etc.)
# ---------------------------------------------------------------------------

bitrefill_client = BitrefillClient()


def is_giftcard_enabled() -> bool:
    """Return True iff BITREFILL_API_KEY is present in settings.

    Use this as a cheap feature-gate check before entering any conversation
    state so the handler can show "coming soon" without importing the full client.
    """
    return bool(getattr(settings, "bitrefill_api_key", None))
