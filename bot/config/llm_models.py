"""Model catalog for direct multi-provider LLM calls + credit metering.

Maps a stable "friendly name" (what users pick / what's persisted on
`User.llm_model`) to a `ModelSpec`: which provider serves it, the wire model
id, the minimum subscription tier required to select it, and USD-per-1M-token
list pricing used by `bot/services/llm_credit_service.py` to meter usage.
Pricing is the provider's list price BEFORE the credit markup applied in the
credit service.

PRICES AND MODEL IDS GO STALE — TREAT THIS FILE AS PERISHABLE.
Verified 2026-08-04 (see docs/research/llm-credits/03-provider-pricing.md).
Within a single session of first authoring this catalog, two seeded model ids
were already dead in production (deepseek-chat retired 2026-07-24,
gemini-2.0-flash shut down 2026-06-01). `PRICE_TABLE_VERIFIED` below drives a
staleness warning; the long-term fix is to source prices from LiteLLM's
`model_prices_and_context_window.json` rather than hand-maintaining them
(see 04-metering-architecture.md §1-2).

Billing safety rule: when in doubt, round the price UP. Under-pricing a model
means the platform silently eats the delta on every call.
"""

import logging
from dataclasses import dataclass
from datetime import date
from typing import Optional

from bot.config.llm_providers import PROVIDERS, is_provider_available
from bot.models.subscription import SubscriptionTier

logger = logging.getLogger(__name__)

# Date the prices/model ids below were last checked against provider docs.
# `assert_price_table_fresh()` warns past PRICE_TABLE_MAX_AGE_DAYS.
PRICE_TABLE_VERIFIED = date(2026, 8, 4)
PRICE_TABLE_MAX_AGE_DAYS = 60

# Tier rank — higher number = more access (FREE < PRO < PREMIUM < ENTERPRISE).
_TIER_RANK = {
    SubscriptionTier.FREE: 0,
    SubscriptionTier.PRO: 1,
    SubscriptionTier.PREMIUM: 2,
    SubscriptionTier.ENTERPRISE: 3,
}


@dataclass(frozen=True)
class ModelSpec:
    """One selectable model entry in the catalog."""

    friendly_name: str
    provider: str  # key into bot.config.llm_providers.PROVIDERS
    model_id: str  # wire model id sent to the provider API
    min_tier: SubscriptionTier
    price_per_1m_input_usd: float
    price_per_1m_output_usd: float
    # Whether usage debits api_credits. Billing is governed by THIS flag, not
    # by min_tier — a FREE-selectable model can still be metered. Only the
    # cheap default rides the free daily caps unmetered.
    metered: bool = True

    def is_tier_allowed(self, user_tier: SubscriptionTier) -> bool:
        return _TIER_RANK.get(user_tier, 0) >= _TIER_RANK.get(self.min_tier, 0)


# Friendly name -> ModelSpec. Prices in USD per 1M tokens, verified 2026-08-04.
MODEL_CATALOG: dict = {
    # --- FREE tier: cheapest models, the default is unmetered -------------
    "deepseek-flash": ModelSpec(
        friendly_name="deepseek-flash",
        provider="deepseek",
        model_id="deepseek-v4-flash",  # deepseek-chat retired 2026-07-24
        min_tier=SubscriptionTier.FREE,
        price_per_1m_input_usd=0.14,
        price_per_1m_output_usd=0.28,
        metered=False,  # the free default — covered by the daily fallback caps
    ),
    "qwen-turbo": ModelSpec(
        friendly_name="qwen-turbo",
        provider="qwen",
        model_id="qwen-turbo",
        min_tier=SubscriptionTier.FREE,
        # UNVERIFIED against a primary Alibaba source (aggregator-only).
        price_per_1m_input_usd=0.05,
        price_per_1m_output_usd=0.20,
    ),
    "gemini-flash-lite": ModelSpec(
        friendly_name="gemini-flash-lite",
        provider="gemini",
        model_id="gemini-3.5-flash-lite",  # gemini-2.0-flash shut down 2026-06-01
        min_tier=SubscriptionTier.FREE,
        price_per_1m_input_usd=0.30,
        price_per_1m_output_usd=2.50,
    ),
    # --- PRO tier ---------------------------------------------------------
    "deepseek-pro": ModelSpec(
        friendly_name="deepseek-pro",
        provider="deepseek",
        model_id="deepseek-v4-pro",  # deepseek-reasoner retired 2026-07-24
        min_tier=SubscriptionTier.PRO,
        price_per_1m_input_usd=0.435,
        price_per_1m_output_usd=0.87,
    ),
    "qwen-plus": ModelSpec(
        friendly_name="qwen-plus",
        provider="qwen",
        model_id="qwen-plus",
        min_tier=SubscriptionTier.PRO,
        price_per_1m_input_usd=0.40,  # UNVERIFIED (aggregator-only)
        price_per_1m_output_usd=1.20,
    ),
    "gpt-mini": ModelSpec(
        friendly_name="gpt-mini",
        provider="openai",
        model_id="gpt-5-mini",  # gpt-4o-mini off the current pricing page
        min_tier=SubscriptionTier.PRO,
        price_per_1m_input_usd=0.25,
        price_per_1m_output_usd=2.00,
    ),
    "claude-haiku": ModelSpec(
        friendly_name="claude-haiku",
        provider="anthropic",
        model_id="claude-haiku-4-5",
        min_tier=SubscriptionTier.PRO,
        price_per_1m_input_usd=1.00,
        price_per_1m_output_usd=5.00,
    ),
    "grok-build": ModelSpec(
        friendly_name="grok-build",
        provider="xai",
        model_id="grok-build-0.1",  # grok-2-latest at risk (May 2026 retirements)
        min_tier=SubscriptionTier.PRO,
        price_per_1m_input_usd=1.00,
        price_per_1m_output_usd=2.00,
    ),
    # --- PREMIUM tier -----------------------------------------------------
    "claude-sonnet": ModelSpec(
        friendly_name="claude-sonnet",
        provider="anthropic",
        model_id="claude-sonnet-5",
        min_tier=SubscriptionTier.PREMIUM,
        # Intro pricing is $2/$10 through 2026-08-31, reverting to $3/$15.
        # Priced at the POST-intro rate deliberately: billing at the lower
        # intro rate would silently under-charge from 2026-09-01 onward.
        price_per_1m_input_usd=3.00,
        price_per_1m_output_usd=15.00,
    ),
    "gpt-flagship": ModelSpec(
        friendly_name="gpt-flagship",
        provider="openai",
        model_id="gpt-5.5",
        min_tier=SubscriptionTier.PREMIUM,
        price_per_1m_input_usd=5.00,
        price_per_1m_output_usd=30.00,
    ),
    "grok-4.5": ModelSpec(
        friendly_name="grok-4.5",
        provider="xai",
        model_id="grok-4.5",
        min_tier=SubscriptionTier.PREMIUM,
        price_per_1m_input_usd=2.00,
        price_per_1m_output_usd=6.00,
    ),
    "gemini-pro": ModelSpec(
        friendly_name="gemini-pro",
        provider="gemini",
        model_id="gemini-3.1-pro-preview",
        min_tier=SubscriptionTier.PREMIUM,
        price_per_1m_input_usd=2.00,
        price_per_1m_output_usd=12.00,
    ),
    "kimi-k3": ModelSpec(
        friendly_name="kimi-k3",
        provider="kimi",
        model_id="kimi-k3",
        min_tier=SubscriptionTier.PREMIUM,
        price_per_1m_input_usd=3.00,
        price_per_1m_output_usd=15.00,
    ),
}

DEFAULT_MODEL_NAME = "deepseek-flash"


def price_table_age_days(today: Optional[date] = None) -> int:
    """Days since the catalog prices were last verified against provider docs."""
    return ((today or date.today()) - PRICE_TABLE_VERIFIED).days


def assert_price_table_fresh(today: Optional[date] = None) -> bool:
    """Log a warning if the price table is older than PRICE_TABLE_MAX_AGE_DAYS.

    Returns True when fresh. Deliberately non-fatal: a stale table should
    page an operator, not take natural-language trading offline.
    """
    age = price_table_age_days(today)
    if age > PRICE_TABLE_MAX_AGE_DAYS:
        logger.warning(
            "llm_models: price table last verified %s (%d days ago, max %d) — "
            "model ids and prices drift fast; re-verify against provider docs "
            "(see docs/research/llm-credits/03-provider-pricing.md)",
            PRICE_TABLE_VERIFIED.isoformat(),
            age,
            PRICE_TABLE_MAX_AGE_DAYS,
        )
        return False
    return True


def get_model(friendly_name: Optional[str]) -> Optional[ModelSpec]:
    """Look up a catalog entry by friendly name, or None if unknown."""
    if not friendly_name:
        return None
    return MODEL_CATALOG.get(friendly_name)


def selectable_models(user_tier: SubscriptionTier) -> list:
    """Catalog entries this tier may select that are also actually usable."""
    return [
        spec
        for spec in MODEL_CATALOG.values()
        if spec.is_tier_allowed(user_tier) and is_provider_available(spec.provider)
    ]


def resolve_model(user_tier: SubscriptionTier, user_pref: Optional[str] = None) -> ModelSpec:
    """Resolve the ModelSpec to actually use for a request.

    Preference order:
    1. `user_pref` if it names a catalog entry the user's tier is entitled to
       AND whose provider is usable (key configured + forced-tool-call support).
    2. `DEFAULT_MODEL_NAME` if usable.
    3. The first usable, tier-allowed catalog entry in declaration order —
       a last-resort fallback so a request doesn't die purely because the
       default provider's key is unset in this environment.

    Raises RuntimeError when nothing is usable; callers treat that as
    "LLM unavailable" and fall back to the legacy env-provider path.
    """
    candidates = []
    if user_pref:
        spec = MODEL_CATALOG.get(user_pref)
        if spec is not None:
            candidates.append(spec)

    default_spec = MODEL_CATALOG.get(DEFAULT_MODEL_NAME)
    if default_spec is not None:
        candidates.append(default_spec)

    candidates.extend(MODEL_CATALOG.values())

    for spec in candidates:
        if not spec.is_tier_allowed(user_tier):
            continue
        if not is_provider_available(spec.provider):
            continue
        return spec

    raise RuntimeError(
        "llm_models.resolve_model: no catalog model is both tier-allowed and "
        "has a usable provider (API key configured + forced tool calling)"
    )
