"""Normalized LLM token usage across providers.

Providers report cached tokens in mutually incompatible ways, and getting this
wrong is a billing error in both directions:

  * **Anthropic** — `input_tokens`, `cache_read_input_tokens` and
    `cache_creation_input_tokens` are three SEPARATE counters. Reading only
    `input_tokens` under-counts a cached call, so we under-bill.
  * **OpenAI / xAI** — `prompt_tokens_details.cached_tokens` is a SUBSET of
    `prompt_tokens`. Billing the headline number charges full input price for
    tokens that cost ~0.1x, so we over-bill the user.
  * **DeepSeek** — `prompt_cache_hit_tokens` + `prompt_cache_miss_tokens` sum
    to `prompt_tokens`; cache hits cost ~0.02x.

This module defines the single normalized shape every call path converts to,
so the cost math in `llm_credit_service` never has to know which provider it
is pricing. `input_tokens` here always means **uncached, full-price input**.

See docs/research/llm-credits/03-provider-pricing.md for the verified
field names and multipliers.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class TokenUsage:
    """Provider-agnostic token counts for one completed LLM call."""

    input_tokens: int = 0  # uncached input, billed at full rate
    cached_read_tokens: int = 0  # input served from cache, billed at a discount
    cache_write_tokens: int = 0  # input written to cache, billed at a PREMIUM
    output_tokens: int = 0

    @property
    def total_input(self) -> int:
        """Every input token the provider processed, cached or not."""
        return self.input_tokens + self.cached_read_tokens + self.cache_write_tokens

    @property
    def is_empty(self) -> bool:
        """True when the provider reported no usage at all.

        Distinct from a genuinely zero-cost call: several OpenAI-compatible
        shims omit or rename usage fields, and a metered call that reports
        nothing must be billed at estimate rather than silently at $0.
        """
        return self.total_input == 0 and self.output_tokens == 0
