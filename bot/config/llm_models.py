"""Model catalog for direct multi-provider LLM calls + credit metering.

Maps a stable "friendly name" (what users pick / what's persisted on
`User.llm_model`) to a `ModelSpec`: which provider serves it, the wire model
id, the minimum subscription tier required to select it, and USD-per-1M-token
list pricing (input/output) used by `bot/services/llm_credit_service.py` to
meter usage. Pricing is the provider's own list price BEFORE the credit
markup applied in the credit service.

`deepseek-chat` is the default model: cheapest, no tier gate, always
selectable as long as `DEEPSEEK_API_KEY` is configured.
"""

from dataclasses import dataclass
from typing import Optional

from bot.config.llm_providers import PROVIDERS, is_provider_available
from bot.models.subscription import SubscriptionTier

# Tier rank — higher number = more access. Mirrors bot/services/fee_service.py
# ordering (FREE < PRO < PREMIUM < ENTERPRISE).
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
    # by min_tier — a FREE-selectable model can still be metered (e.g.
    # claude-haiku costs 12x deepseek output). Only the cheap default rides
    # the free daily caps unmetered.
    metered: bool = True

    def is_tier_allowed(self, user_tier: SubscriptionTier) -> bool:
        return _TIER_RANK.get(user_tier, 0) >= _TIER_RANK.get(self.min_tier, 0)


# Friendly name -> ModelSpec. Prices are provider list prices in USD per 1M
# tokens as of catalog authoring; update here (additive, no migration needed)
# as providers change pricing.
MODEL_CATALOG: dict = {
    "deepseek-chat": ModelSpec(
        friendly_name="deepseek-chat",
        provider="deepseek",
        model_id="deepseek-chat",
        min_tier=SubscriptionTier.FREE,
        price_per_1m_input_usd=0.28,
        price_per_1m_output_usd=0.42,
        metered=False,  # the free default — covered by the daily fallback caps
    ),
    "deepseek-reasoner": ModelSpec(
        friendly_name="deepseek-reasoner",
        provider="deepseek",
        model_id="deepseek-reasoner",
        min_tier=SubscriptionTier.PRO,
        price_per_1m_input_usd=0.55,
        price_per_1m_output_usd=2.19,
    ),
    "claude-haiku": ModelSpec(
        friendly_name="claude-haiku",
        provider="anthropic",
        model_id="claude-haiku-4-5-20251001",
        min_tier=SubscriptionTier.FREE,
        price_per_1m_input_usd=1.00,
        price_per_1m_output_usd=5.00,
    ),
    "claude-sonnet": ModelSpec(
        friendly_name="claude-sonnet",
        provider="anthropic",
        model_id="claude-sonnet-4-5-20250929",
        min_tier=SubscriptionTier.PREMIUM,
        price_per_1m_input_usd=3.00,
        price_per_1m_output_usd=15.00,
    ),
    "gpt-4o-mini": ModelSpec(
        friendly_name="gpt-4o-mini",
        provider="openai",
        model_id="gpt-4o-mini",
        min_tier=SubscriptionTier.FREE,
        price_per_1m_input_usd=0.15,
        price_per_1m_output_usd=0.60,
    ),
    "gpt-4o": ModelSpec(
        friendly_name="gpt-4o",
        provider="openai",
        model_id="gpt-4o",
        min_tier=SubscriptionTier.PREMIUM,
        price_per_1m_input_usd=2.50,
        price_per_1m_output_usd=10.00,
    ),
    "grok-2": ModelSpec(
        friendly_name="grok-2",
        provider="xai",
        model_id="grok-2-latest",
        min_tier=SubscriptionTier.PRO,
        price_per_1m_input_usd=2.00,
        price_per_1m_output_usd=10.00,
    ),
    "gemini-flash": ModelSpec(
        friendly_name="gemini-flash",
        provider="gemini",
        model_id="gemini-2.0-flash",
        min_tier=SubscriptionTier.FREE,
        price_per_1m_input_usd=0.10,
        price_per_1m_output_usd=0.40,
    ),
    "qwen-plus": ModelSpec(
        friendly_name="qwen-plus",
        provider="qwen",
        model_id="qwen-plus",
        min_tier=SubscriptionTier.PRO,
        price_per_1m_input_usd=0.40,
        price_per_1m_output_usd=1.20,
    ),
    "kimi-8k": ModelSpec(
        friendly_name="kimi-8k",
        provider="kimi",
        model_id="moonshot-v1-8k",
        min_tier=SubscriptionTier.PRO,
        price_per_1m_input_usd=0.20,
        price_per_1m_output_usd=2.00,
    ),
}

DEFAULT_MODEL_NAME = "deepseek-chat"


def get_model(friendly_name: Optional[str]) -> Optional[ModelSpec]:
    """Look up a catalog entry by friendly name, or None if unknown."""
    if not friendly_name:
        return None
    return MODEL_CATALOG.get(friendly_name)


def resolve_model(user_tier: SubscriptionTier, user_pref: Optional[str] = None) -> ModelSpec:
    """Resolve the ModelSpec to actually use for a request.

    Preference order:
    1. `user_pref` if it names a catalog entry the user's tier is entitled to
       AND whose provider has a configured API key.
    2. `DEFAULT_MODEL_NAME` (deepseek-chat) if its provider key is configured.
    3. The first catalog entry (in declaration order) that the user's tier
       is entitled to AND whose provider key is configured — a last-resort
       fallback so a request never dies purely because deepseek's key is
       unset in this environment.

    Never returns None: callers (llm_credit_service / nl_intent_service)
    can rely on always getting a usable ModelSpec, or should treat a raised
    RuntimeError (no provider configured at all) as "LLM unavailable".
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
        "has a configured provider API key"
    )
