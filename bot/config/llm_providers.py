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
    default_model: str
    env_key_attr: str  # attribute name on `settings` holding the API key


PROVIDERS: dict = {
    "anthropic": ProviderConfig(
        name="anthropic",
        call_style=ANTHROPIC,
        base_url=None,
        default_model="claude-haiku-4-5-20251001",
        env_key_attr="ANTHROPIC_API_KEY",
    ),
    "openai": ProviderConfig(
        name="openai",
        call_style=OPENAI_COMPATIBLE,
        base_url=None,
        default_model="gpt-4o-mini",
        env_key_attr="OPENAI_API_KEY",
    ),
    "xai": ProviderConfig(
        name="xai",
        call_style=OPENAI_COMPATIBLE,
        base_url="https://api.x.ai/v1",
        default_model="grok-2-latest",
        env_key_attr="XAI_API_KEY",
    ),
    "gemini": ProviderConfig(
        name="gemini",
        call_style=OPENAI_COMPATIBLE,
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        default_model="gemini-2.0-flash",
        env_key_attr="GEMINI_API_KEY",
    ),
    "qwen": ProviderConfig(
        name="qwen",
        call_style=OPENAI_COMPATIBLE,
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        default_model="qwen-plus",
        env_key_attr="QWEN_API_KEY",
    ),
    "kimi": ProviderConfig(
        name="kimi",
        call_style=OPENAI_COMPATIBLE,
        base_url="https://api.moonshot.ai/v1",
        default_model="moonshot-v1-8k",
        env_key_attr="KIMI_API_KEY",
    ),
    "deepseek": ProviderConfig(
        name="deepseek",
        call_style=OPENAI_COMPATIBLE,
        base_url="https://api.deepseek.com",
        default_model="deepseek-chat",
        env_key_attr="DEEPSEEK_API_KEY",
    ),
}

# Provider used when no user preference is set and no other signal applies.
DEFAULT_PROVIDER = "deepseek"


def get_api_key(provider: str) -> str:
    """Return the configured API key for `provider`, or "" if unknown/unset."""
    cfg = PROVIDERS.get(provider)
    if cfg is None:
        return ""
    return getattr(settings, cfg.env_key_attr, "") or ""


def is_provider_available(provider: str) -> bool:
    """True if `provider` is known to the registry and has a non-empty API key."""
    return bool(get_api_key(provider))


def available_providers() -> list:
    """List of provider names that currently have a configured API key."""
    return [name for name in PROVIDERS if is_provider_available(name)]
