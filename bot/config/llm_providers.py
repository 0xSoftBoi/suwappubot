"""Multi-provider LLM registry for direct (non-router) LLM calls.

Each entry describes how to reach one provider: which env-backed setting
holds the API key, the base_url (None means the SDK's own default), and the
"call style" used to invoke it — either the native Anthropic Messages API
(tool-use) or an OpenAI-compatible chat.completions API (function-calling).
Every non-Anthropic provider here exposes an OpenAI-compatible endpoint, so
`openai.AsyncOpenAI(base_url=...)` works for all of them.

This module is intentionally free of any network/session code — it is pure
configuration, consumed by bot/config/llm_models.py (model catalog +
resolution) and bot/services/nl_intent_service.py (actual calls).

CAPABILITY GATING: nl_intent_service forces a specific tool call and reads
token usage off every response. Not every OpenAI-compatible shim supports
both. Providers whose forced-tool-choice support has NOT been verified
against a live call are marked `forced_tool_choice_verified=False` and are
excluded from model resolution unless explicitly opted in via
settings.LLM_ALLOW_UNVERIFIED_PROVIDERS — a wrong answer here means the
parse silently degrades to the fail-safe clarification on every call.
"""

from dataclasses import dataclass
from typing import Optional

from bot.config.settings import settings

CallStyle = str  # "anthropic" | "openai_compatible"

ANTHROPIC = "anthropic"
OPENAI_COMPATIBLE = "openai_compatible"


@dataclass(frozen=True)
class ProviderConfig:
    """Static description of one LLM provider."""

    name: str
    call_style: CallStyle
    base_url: Optional[str]  # None => SDK default endpoint
    env_key_attr: str  # attribute name on `settings` holding the API key
    # True only where forced tool choice + usage accounting are confirmed
    # against a live call. See docs/research/llm-credits/03-provider-pricing.md.
    forced_tool_choice_verified: bool = False
    # Providers that report cached-token counts under non-OpenAI field names.
    # DeepSeek uses prompt_cache_hit_tokens / prompt_cache_miss_tokens rather
    # than prompt_tokens_details.cached_tokens.
    nonstandard_usage_fields: bool = False


PROVIDERS: dict = {
    "anthropic": ProviderConfig(
        name="anthropic",
        call_style=ANTHROPIC,
        base_url=None,
        env_key_attr="ANTHROPIC_API_KEY",
        forced_tool_choice_verified=True,  # tool_choice={"type":"tool",...}
    ),
    "openai": ProviderConfig(
        name="openai",
        call_style=OPENAI_COMPATIBLE,
        base_url=None,
        env_key_attr="OPENAI_API_KEY",
        forced_tool_choice_verified=True,
    ),
    "xai": ProviderConfig(
        name="xai",
        call_style=OPENAI_COMPATIBLE,
        base_url="https://api.x.ai/v1",
        env_key_attr="XAI_API_KEY",
        # Usage is OpenAI-shaped; forced tool_choice unconfirmed in primary docs.
        forced_tool_choice_verified=False,
    ),
    "gemini": ProviderConfig(
        name="gemini",
        call_style=OPENAI_COMPATIBLE,
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        env_key_attr="GEMINI_API_KEY",
        # Reported to reject tool_choice values other than "none"/"auto" on the
        # OpenAI-compat endpoint — would break forced tool calling. Needs a live
        # smoke test before enabling.
        forced_tool_choice_verified=False,
    ),
    "qwen": ProviderConfig(
        name="qwen",
        call_style=OPENAI_COMPATIBLE,
        # INTERNATIONAL endpoint. dashscope.aliyuncs.com (no -intl) is the
        # China/Beijing region — a different account and billing entity.
        base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        env_key_attr="QWEN_API_KEY",
        forced_tool_choice_verified=False,
    ),
    "kimi": ProviderConfig(
        name="kimi",
        call_style=OPENAI_COMPATIBLE,
        base_url="https://api.moonshot.ai/v1",  # .cn is the China region
        env_key_attr="KIMI_API_KEY",
        forced_tool_choice_verified=False,
    ),
    "deepseek": ProviderConfig(
        name="deepseek",
        call_style=OPENAI_COMPATIBLE,
        base_url="https://api.deepseek.com",
        env_key_attr="DEEPSEEK_API_KEY",
        forced_tool_choice_verified=True,
        nonstandard_usage_fields=True,
    ),
}


def get_api_key(provider: str) -> str:
    """Return the configured API key for `provider`, or "" if unknown/unset."""
    cfg = PROVIDERS.get(provider)
    if cfg is None:
        return ""
    return getattr(settings, cfg.env_key_attr, "") or ""


def supports_forced_tools(provider: str) -> bool:
    """True if this provider can be trusted with a forced tool call.

    Unverified providers are usable only when explicitly opted in, so a
    silently-degrading parse can't be introduced just by setting an API key.
    """
    cfg = PROVIDERS.get(provider)
    if cfg is None:
        return False
    if cfg.forced_tool_choice_verified:
        return True
    return bool(getattr(settings, "LLM_ALLOW_UNVERIFIED_PROVIDERS", False))


def is_provider_available(provider: str) -> bool:
    """True if `provider` has a configured API key AND can be trusted with the
    forced-tool-call contract nl_intent_service depends on."""
    return bool(get_api_key(provider)) and supports_forced_tools(provider)
