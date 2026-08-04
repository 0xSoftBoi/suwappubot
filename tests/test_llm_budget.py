"""Tests for the cost-weighted LLM spend budget and cached-token billing.

MONEY-PATH: the budget bounds platform spend across replicas, and the cached
-token math decides what a user is charged. Both are pinned here.
"""

import pytest

from bot.config.llm_models import ModelSpec
from bot.models.subscription import SubscriptionTier
from bot.services import llm_credit_service
from bot.services.llm_usage import TokenUsage
from bot.utils import llm_budget as budget_mod
from bot.utils.llm_budget import LLMBudget, usd_to_micros

# Cheap model with DeepSeek-style caching: reads at 0.02x, no write premium.
CACHED = ModelSpec(
    friendly_name="test-cached",
    provider="deepseek",
    model_id="deepseek-v4-flash",
    min_tier=SubscriptionTier.FREE,
    price_per_1m_input_usd=1.0,
    price_per_1m_output_usd=2.0,
    cache_read_multiplier=0.02,
)

# Anthropic-style: reads 0.1x, writes cost a 1.25x PREMIUM.
WRITES = ModelSpec(
    friendly_name="test-writes",
    provider="anthropic",
    model_id="claude-x",
    min_tier=SubscriptionTier.FREE,
    price_per_1m_input_usd=1.0,
    price_per_1m_output_usd=2.0,
    cache_read_multiplier=0.1,
    cache_write_multiplier=1.25,
)


@pytest.fixture(autouse=True)
def _no_redis(monkeypatch):
    """Force the in-memory path — these tests pin the math, not Redis."""
    monkeypatch.setattr(LLMBudget, "_client", lambda self: None)
    budget_mod.llm_budget.reset()
    yield
    budget_mod.llm_budget.reset()


# ---------------------------------------------------------------------------
# Micro-dollar conversion
# ---------------------------------------------------------------------------


def test_usd_to_micros_rounds_up():
    """Rounding down would let a long tail of sub-micro-dollar calls escape
    the budget entirely."""
    assert usd_to_micros(1.0) == 1_000_000
    assert usd_to_micros(0.0000001) == 1  # rounds up, never to 0
    assert usd_to_micros(0.0) == 0


# ---------------------------------------------------------------------------
# Cached-token cost math
# ---------------------------------------------------------------------------


def test_cached_reads_are_cheaper_than_fresh_input(monkeypatch):
    monkeypatch.setattr(llm_credit_service.settings, "LLM_CREDIT_MARKUP", 1.0, raising=False)
    fresh = llm_credit_service.cost_of_usage(CACHED, TokenUsage(input_tokens=1_000_000))
    cached = llm_credit_service.cost_of_usage(CACHED, TokenUsage(cached_read_tokens=1_000_000))
    assert fresh == pytest.approx(1.0)
    assert cached == pytest.approx(0.02)  # 0.02x multiplier honored


def test_cache_writes_cost_a_premium(monkeypatch):
    """Anthropic cache writes are 1.25x base input — billing them at 1.0x
    would under-charge."""
    monkeypatch.setattr(llm_credit_service.settings, "LLM_CREDIT_MARKUP", 1.0, raising=False)
    cost = llm_credit_service.cost_of_usage(WRITES, TokenUsage(cache_write_tokens=1_000_000))
    assert cost == pytest.approx(1.25)


def test_all_four_buckets_are_summed(monkeypatch):
    monkeypatch.setattr(llm_credit_service.settings, "LLM_CREDIT_MARKUP", 1.0, raising=False)
    usage = TokenUsage(
        input_tokens=1_000_000,
        cached_read_tokens=1_000_000,
        cache_write_tokens=1_000_000,
        output_tokens=1_000_000,
    )
    # 1.0 + 0.1 + 1.25 + 2.0
    assert llm_credit_service.cost_of_usage(WRITES, usage) == pytest.approx(4.35)


def test_openai_style_cached_tokens_are_not_double_billed():
    """OpenAI reports cached_tokens as a SUBSET of prompt_tokens; the
    normalizer must subtract them so they aren't charged at full rate."""
    from bot.services.nl_intent_service import _openai_usage

    class _O:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    resp = _O(
        usage=_O(
            prompt_tokens=1000,
            completion_tokens=50,
            prompt_tokens_details=_O(cached_tokens=800),
        )
    )
    u = _openai_usage(resp)
    assert u.input_tokens == 200  # 1000 - 800 cached
    assert u.cached_read_tokens == 800
    assert u.total_input == 1000  # nothing invented, nothing lost


def test_deepseek_hit_miss_fields_are_understood():
    """DeepSeek uses prompt_cache_hit_tokens/miss instead of the OpenAI shape."""
    from bot.services.nl_intent_service import _openai_usage

    class _O:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    resp = _O(
        usage=_O(
            prompt_tokens=1000,
            completion_tokens=50,
            prompt_cache_hit_tokens=900,
            prompt_cache_miss_tokens=100,
        )
    )
    u = _openai_usage(resp)
    assert u.input_tokens == 100
    assert u.cached_read_tokens == 900


def test_anthropic_cache_buckets_are_additive():
    """Anthropic's input_tokens EXCLUDES cache buckets — reading only that
    field would under-bill every cached call."""
    from bot.services.nl_intent_service import _anthropic_usage

    class _O:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    resp = _O(
        usage=_O(
            input_tokens=200,
            cache_read_input_tokens=700,
            cache_creation_input_tokens=100,
            output_tokens=50,
        )
    )
    u = _anthropic_usage(resp)
    assert u.input_tokens == 200
    assert u.cached_read_tokens == 700
    assert u.cache_write_tokens == 100
    assert u.total_input == 1000


def test_malformed_cached_count_cannot_go_negative():
    from bot.services.nl_intent_service import _openai_usage

    class _O:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    resp = _O(usage=_O(prompt_tokens=100, completion_tokens=0, prompt_cache_hit_tokens=999))
    u = _openai_usage(resp)
    assert u.input_tokens == 0  # clamped, never negative
    assert u.cached_read_tokens == 100


# ---------------------------------------------------------------------------
# Token bucket behavior
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bucket_allows_until_exhausted():
    b = LLMBudget()
    cap = 1000
    for _ in range(10):
        allowed, _ = await b.try_consume("k", 100, cap)
        assert allowed
    allowed, remaining = await b.try_consume("k", 100, cap)
    assert not allowed
    assert remaining < 100


@pytest.mark.asyncio
async def test_bucket_is_cost_weighted_not_call_counted():
    """An expensive call must drain the bucket far faster than a cheap one —
    the property flat call-counting cannot express."""
    b = LLMBudget()
    cap = 1000
    cheap_ok, _ = await b.try_consume("cheap", 1, cap)
    expensive_ok, expensive_left = await b.try_consume("exp", 900, cap)
    assert cheap_ok and expensive_ok
    # One expensive call left almost nothing; one cheap call barely dented it.
    _, cheap_left = await b.try_consume("cheap", 0, cap)
    assert cheap_left > expensive_left


@pytest.mark.asyncio
async def test_zero_capacity_means_unlimited():
    b = LLMBudget()
    allowed, _ = await b.try_consume("k", 10**9, 0)
    assert allowed


@pytest.mark.asyncio
async def test_refund_returns_unused_reservation():
    b = LLMBudget()
    cap = 1000
    await b.try_consume("k", 500, cap)
    await b.refund("k", 400, cap)
    # 500 consumed, 400 returned -> ~900 available, so a 600 call fits.
    allowed, _ = await b.try_consume("k", 600, cap)
    assert allowed


@pytest.mark.asyncio
async def test_refund_cannot_exceed_capacity():
    b = LLMBudget()
    cap = 1000
    await b.try_consume("k", 100, cap)
    await b.refund("k", 10_000, cap)
    allowed, remaining = await b.try_consume("k", 0, cap)
    assert remaining <= cap


@pytest.mark.asyncio
async def test_bucket_refills_over_time(monkeypatch):
    b = LLMBudget()
    cap, window = 1000, 100  # 10 units/second
    await b.try_consume("k", 1000, cap, window)
    denied, _ = await b.try_consume("k", 500, cap, window)
    assert not denied

    real_time = budget_mod.time.time

    monkeypatch.setattr(budget_mod.time, "time", lambda: real_time() + 60)
    allowed, _ = await b.try_consume("k", 500, cap, window)
    assert allowed  # ~600 refilled after 60s


@pytest.mark.asyncio
async def test_limiter_failure_never_blocks_the_feature(monkeypatch):
    """A limiter that raises must degrade to the in-memory path, not take
    natural-language trading offline."""

    class Boom:
        async def eval(self, *a, **kw):
            raise RuntimeError("redis exploded")

    b = LLMBudget()
    monkeypatch.setattr(LLMBudget, "_client", lambda self: Boom())
    allowed, _ = await b.try_consume("k", 1, 1000)
    assert allowed


# ---------------------------------------------------------------------------
# reserve/settle integration
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reserve_then_settle_returns_unused(monkeypatch):
    monkeypatch.setattr(
        llm_credit_service.settings, "LLM_BUDGET_PER_USER_DAILY_USD", 1.0, raising=False
    )
    monkeypatch.setattr(
        llm_credit_service.settings, "LLM_BUDGET_GLOBAL_DAILY_USD", 100.0, raising=False
    )
    ok, reserved = await llm_credit_service.reserve_budget(1, CACHED)
    assert ok and reserved > 0
    # Actual came in far under the estimate — most of it should come back.
    await llm_credit_service.settle_budget(1, reserved, 0.0)
    ok2, _ = await llm_credit_service.reserve_budget(1, CACHED)
    assert ok2


@pytest.mark.asyncio
async def test_global_denial_refunds_the_user_bucket(monkeypatch):
    """If the platform-wide backstop refuses after the user bucket already
    consumed, the user must not silently lose their allowance."""
    monkeypatch.setattr(
        llm_credit_service.settings, "LLM_BUDGET_PER_USER_DAILY_USD", 1.0, raising=False
    )
    monkeypatch.setattr(
        llm_credit_service.settings, "LLM_BUDGET_GLOBAL_DAILY_USD", 0.0000001, raising=False
    )
    ok, reserved = await llm_credit_service.reserve_budget(42, CACHED)
    assert not ok
    assert reserved == 0

    # The user's own bucket must be intact. Consume nearly the whole per-user
    # capacity directly: this only fits if the reservation was handed back.
    from bot.utils.llm_budget import user_budget_key

    cap = usd_to_micros(1.0)
    allowed, _ = await budget_mod.llm_budget.try_consume(user_budget_key(42), cap - 1000, cap)
    assert allowed, "user allowance was burned by a global-backstop denial"
