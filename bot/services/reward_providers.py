"""Reward fulfillment provider abstraction for the async marketplace.

The rewards store routes synchronous, own-product redemptions (subscriptions, fee
discounts) through ``points_service`` directly. Async marketplace categories
(gift_card / travel / merch / donation / experience) instead create a
``RedemptionOrder`` and hand it to a :class:`RewardProvider`, which talks to an
external fulfillment service.

Ships SANDBOXED/DISABLED: the only wired provider is :class:`SandboxProvider`, gated
on ``settings.rewards_marketplace_enabled`` (False by default). While disabled it
returns ``('failed', None, 'provider not configured')`` so the redemption is refunded
and the user's points are never lost. When enabled (sandbox mode) it returns
``('fulfilled', 'sandbox-<order_id>', None)`` so the full lifecycle is testable
without any external call.

Real providers (Tremendous, Bitrefill, Duffel, ...) are documented TODOs below — they
are NOT wired. Adding one means: implement a ``RewardProvider`` subclass that calls the
external API in ``fulfill()`` and point the relevant category at it in
``PROVIDER_FOR_CATEGORY``.
"""

import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# fulfill() result: (status, provider_ref, error)
#   status in {'fulfilled', 'failed'}
FulfillResult = Tuple[str, Optional[str], Optional[str]]


class RewardProvider:
    """Base fulfillment provider. Subclasses talk to an external service."""

    name: str = "base"

    def is_enabled(self) -> bool:
        """Whether this provider can currently fulfill orders."""
        return False

    def fulfill(self, order, payload: Optional[dict]) -> FulfillResult:
        """Attempt to fulfill ``order``.

        Returns ``(status, provider_ref, error)``:
          - ``('fulfilled', provider_ref, None)`` on success
          - ``('failed', None, reason)`` otherwise (caller refunds the points)

        MUST NOT raise for an ordinary provider decline — return a 'failed' tuple
        so the caller's refund path runs inside the same transaction. (An unexpected
        exception is still handled by the caller's refund-on-failure, but providers
        should prefer the explicit tuple.)
        """
        raise NotImplementedError


class SandboxProvider(RewardProvider):
    """Disabled-by-default sandbox provider — no external calls.

    - ``is_enabled()`` reflects ``settings.rewards_marketplace_enabled`` (False default).
    - ``fulfill()`` while disabled → ``('failed', None, 'provider not configured')``
      so the redemption refunds.
    - ``fulfill()`` while enabled → ``('fulfilled', 'sandbox-<order_id>', None)`` so the
      end-to-end lifecycle (debit → order → fulfilled) is testable without a real API.
    """

    name = "sandbox"

    def is_enabled(self) -> bool:
        try:
            from bot.config.settings import settings

            return bool(settings.rewards_marketplace_enabled)
        except Exception as e:  # never let a config import error crash redemption
            logger.warning(f"SandboxProvider.is_enabled config read failed: {e}")
            return False

    def fulfill(self, order, payload: Optional[dict]) -> FulfillResult:
        if not self.is_enabled():
            return ("failed", None, "provider not configured")
        return ("fulfilled", f"sandbox-{order.id}", None)


# Singleton provider instances.
_SANDBOX = SandboxProvider()

# Category -> provider registry. Async marketplace categories all route to the
# sandbox provider for now. Real providers are TODOs, intentionally NOT wired:
#   gift_card -> Tremendous / Bitrefill
#   travel    -> Duffel
#   merch     -> (print-on-demand / fulfillment partner)
#   donation  -> (donation processor)
#   experience-> (experiences partner)
PROVIDER_FOR_CATEGORY = {
    "gift_card": _SANDBOX,
    "travel": _SANDBOX,
    "merch": _SANDBOX,
    "donation": _SANDBOX,
    "experience": _SANDBOX,
}

# Categories that fulfill asynchronously via a RewardProvider (vs. own_product, which
# redeems synchronously through points_service).
ASYNC_CATEGORIES = frozenset(PROVIDER_FOR_CATEGORY.keys())


def get_provider_for_category(category: str) -> Optional[RewardProvider]:
    """Return the provider wired for ``category``, or None if not a marketplace category."""
    return PROVIDER_FOR_CATEGORY.get(category)
