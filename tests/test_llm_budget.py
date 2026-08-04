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
    # A nonsensical payload must round the price UP: bill the whole prompt at
    # full input rate rather than moving it all into the 0.02x cached bucket.
    assert u.input_tokens == 100
    assert u.cached_read_tokens == 0
    assert u.total_input == 100


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
async def test_empty_usage_does_not_refund_the_whole_reservation(monkeypatch):
    """Regression (CRITICAL): a provider that omits usage fields reported $0
    to the budget, refunding the entire reservation and making both spend caps
    a no-op. billable_usage must substitute the estimate BEFORE settlement."""
    from bot.services.llm_usage import billable_usage

    monkeypatch.setattr(
        llm_credit_service.settings, "LLM_BUDGET_PER_USER_DAILY_USD", 1.0, raising=False
    )
    monkeypatch.setattr(
        llm_credit_service.settings, "LLM_BUDGET_GLOBAL_DAILY_USD", 100.0, raising=False
    )
    ok, reserved = await llm_credit_service.reserve_budget(7, CACHED)
    assert ok

    billable = billable_usage(
        TokenUsage(),
        llm_credit_service.ESTIMATED_INPUT_TOKENS,
        llm_credit_service.ESTIMATED_OUTPUT_TOKENS,
    )
    assert not billable.is_empty  # estimate substituted
    actual = llm_credit_service.raw_cost_usd(CACHED, billable)
    assert actual > 0
    await llm_credit_service.settle_budget(7, reserved, actual)

    # The reservation must be substantially consumed, not handed back whole.
    from bot.utils.llm_budget import user_budget_key

    cap = usd_to_micros(1.0)
    allowed, remaining = await budget_mod.llm_budget.try_consume(user_budget_key(7), 0, cap)
    assert remaining < cap, "empty usage refunded the full reservation"


@pytest.mark.asyncio
async def test_overrun_is_charged_not_free(monkeypatch):
    """Regression (HIGH): settle only refunded, so a call costing more than
    its reservation was silently free from the budget's perspective."""
    monkeypatch.setattr(
        llm_credit_service.settings, "LLM_BUDGET_PER_USER_DAILY_USD", 1.0, raising=False
    )
    monkeypatch.setattr(
        llm_credit_service.settings, "LLM_BUDGET_GLOBAL_DAILY_USD", 100.0, raising=False
    )
    from bot.utils.llm_budget import user_budget_key

    cap = usd_to_micros(1.0)
    ok, reserved = await llm_credit_service.reserve_budget(8, CACHED)
    assert ok
    _, after_reserve = await budget_mod.llm_budget.try_consume(user_budget_key(8), 0, cap)

    # Actual came in at 10x the reservation.
    await llm_credit_service.settle_budget(8, reserved, (reserved * 10) / 1_000_000)
    _, after_settle = await budget_mod.llm_budget.try_consume(user_budget_key(8), 0, cap)
    assert after_settle < after_reserve, "overrun escaped the budget"


def test_budget_uses_raw_cost_not_marked_up(monkeypatch):
    """The budget bounds PLATFORM spend, so it must exclude the user markup —
    otherwise LLM_BUDGET_*_USD silently means 1/markup of what it says."""
    monkeypatch.setattr(llm_credit_service.settings, "LLM_CREDIT_MARKUP", 2.0, raising=False)
    usage = TokenUsage(input_tokens=1_000_000)
    assert llm_credit_service.cost_of_usage(CACHED, usage) == pytest.approx(2.0)
    assert llm_credit_service.raw_cost_usd(CACHED, usage) == pytest.approx(1.0)


def test_budget_capacity_scales_with_tier(monkeypatch):
    """A paying subscriber must not be throttled to the free-tier ceiling."""
    monkeypatch.setattr(
        llm_credit_service.settings, "LLM_BUDGET_PER_USER_DAILY_USD", 0.25, raising=False
    )
    free = llm_credit_service.user_budget_capacity_micros(SubscriptionTier.FREE)
    pro = llm_credit_service.user_budget_capacity_micros(SubscriptionTier.PRO)
    premium = llm_credit_service.user_budget_capacity_micros(SubscriptionTier.PREMIUM)
    assert free < pro < premium
    assert free == usd_to_micros(0.25)


def test_preflight_failure_classification():
    """Only provably-never-sent failures may refund; ambiguous ones (timeout,
    5xx) may already have been billed upstream."""
    from bot.services.nl_intent_service import _is_preflight_failure

    class APIConnectionError(Exception):
        pass

    class APITimeoutError(Exception):
        pass

    class RateLimitError(Exception):
        status_code = 429

    assert _is_preflight_failure(APIConnectionError())
    assert not _is_preflight_failure(APITimeoutError())
    assert not _is_preflight_failure(RateLimitError())
    assert not _is_preflight_failure(RuntimeError("malformed response"))


@pytest.mark.asyncio
async def test_degradation_warning_is_not_latched_forever(monkeypatch, caplog):
    """Regression (MEDIUM): warning latched once per process hid every later
    Redis flap, so operators never learned the cap went per-replica."""
    b = LLMBudget()
    monkeypatch.setattr(LLMBudget, "_client", lambda self: None)
    await b.try_consume("k", 1, 1000)
    await b.try_consume("k", 1, 1000)
    assert b.degraded_calls == 2  # counter always increments

    b._last_degraded_warning = 0.0  # simulate the interval elapsing
    with caplog.at_level("WARNING"):
        await b.try_consume("k", 1, 1000)
    assert any("PER-PROCESS budget" in r.message for r in caplog.records)


def test_worst_case_spec_is_the_priciest_model():
    """The legacy env-provider path reserves against this because the real
    model is unknown — it must over-reserve, never under."""
    from bot.config.llm_models import MODEL_CATALOG

    worst = llm_credit_service.worst_case_spec()
    for spec in MODEL_CATALOG.values():
        assert (
            spec.price_per_1m_input_usd + spec.price_per_1m_output_usd
            <= worst.price_per_1m_input_usd + worst.price_per_1m_output_usd
        )


def test_whisper_duration_estimate_is_conservative():
    """A lower assumed bitrate yields a longer duration, over-reserving."""
    from bot.services.whatsapp_voice import _ASSUMED_OPUS_BITRATE_BPS, WhatsAppVoiceHandler

    h = WhatsAppVoiceHandler()
    one_minute_bytes = _ASSUMED_OPUS_BITRATE_BPS * 60 // 8
    assert h._estimate_minutes(one_minute_bytes) == pytest.approx(1.0)
    # Real notes are often encoded higher (24kbps), so the same real duration
    # produces MORE bytes and thus a larger estimate — never smaller.
    assert h._estimate_minutes(one_minute_bytes * 2) > h._estimate_minutes(one_minute_bytes)


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


# ---------------------------------------------------------------------------
# End-to-end wiring (these verify the budget actually FIRES, not just compiles)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_legacy_env_provider_path_is_budgeted(monkeypatch):
    """Regression: the legacy fallthrough had no budget and no metering, so a
    transient DB error in _resolve_user_model silently converted the fleet to
    unmetered LLM calls."""
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock, patch

    from bot.services import nl_intent_service as n
    from bot.utils.llm_budget import user_budget_key

    resp = SimpleNamespace(
        content=[
            SimpleNamespace(
                type="tool_use",
                input={"action": "unknown", "confidence": 0.1, "amount_unit": "native"},
            )
        ],
        usage=SimpleNamespace(input_tokens=1100, output_tokens=90),
    )
    fake = MagicMock()
    fake.messages.create = AsyncMock(return_value=resp)

    cap = usd_to_micros(1.0)
    with (
        patch.object(n.settings, "LLM_MULTI_PROVIDER_ENABLED", True),
        patch.object(n.settings, "ANTHROPIC_API_KEY", "k"),
        patch.object(n.settings, "NL_TRADING_PROVIDER", "anthropic"),
        patch.object(n.settings, "LLM_BUDGET_PER_USER_DAILY_USD", 1.0),
        patch.object(n.settings, "LLM_BUDGET_GLOBAL_DAILY_USD", 100.0),
        patch("anthropic.AsyncAnthropic", return_value=fake),
        patch.object(n, "_resolve_user_model", AsyncMock(return_value=None)),
    ):
        await n.parse_trade_intent("please swap some of my crypto around", user_id=777)

    assert fake.messages.create.await_count == 1
    _, remaining = await budget_mod.llm_budget.try_consume(user_budget_key("tg:777"), 0, cap)
    assert remaining < cap, "legacy env-provider path escaped the spend budget"


@pytest.mark.asyncio
async def test_telegram_and_db_user_buckets_do_not_collide():
    """The legacy path keys on `tg:<telegram_id>` while the resolved path keys
    on the DB user id. Both are ints in practice, so the namespace prefix is
    what stops user A draining user B's allowance."""
    from bot.utils.llm_budget import user_budget_key

    cap = 1000
    await budget_mod.llm_budget.try_consume(user_budget_key("tg:777"), 400, cap)
    _, db_remaining = await budget_mod.llm_budget.try_consume(user_budget_key(777), 0, cap)
    assert db_remaining == cap, "tg:<id> and <id> resolved to the same bucket"


def test_structured_cost_logs_have_no_reserved_attribute_collisions():
    """logging raises KeyError if an `extra` key shadows a LogRecord attribute
    — that would crash the money path at the moment it records a charge."""
    import logging

    from bot.config.llm_models import MODEL_CATALOG
    from bot.services.nl_intent_service import _log_llm_cost
    from bot.services.whatsapp_voice import WhatsAppVoiceHandler

    reserved = set(vars(logging.LogRecord("n", 1, "p", 1, "m", (), None)).keys()) | {
        "message",
        "asctime",
        "taskName",
    }

    _log_llm_cost(
        user_key="tg:1",
        spec=MODEL_CATALOG["deepseek-flash"],
        usage=TokenUsage(input_tokens=900, cached_read_tokens=200, output_tokens=80),
        raw_usd=0.00042,
        metered=True,
    )
    WhatsAppVoiceHandler()._log_transcription_cost("+15551234567", 96000, 0.006)

    for key in ("event", "user_key", "provider", "model", "input_tokens", "raw_cost_usd"):
        assert key not in reserved


# ---------------------------------------------------------------------------
# Final review fixes (F1-F6)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_force_consume_can_drive_the_bucket_negative():
    """F4: an overrun larger than what's left must still land. try_consume
    no-ops in exactly that case, which is the case that matters."""
    b = LLMBudget()
    cap = 1000
    await b.try_consume("k", 950, cap)  # 50 left
    await b.force_consume("k", 500, cap)  # overrun far exceeds remaining
    allowed, _ = await b.try_consume("k", 1, cap)
    assert not allowed, "overrun evaporated instead of eating future headroom"


def test_worst_case_spec_uses_the_real_token_mix(monkeypatch):
    """F5: ranking by an unweighted price sum can pick the wrong model when
    the mix is input-heavy (~1100 in / ~100 out)."""
    from bot.config import llm_models as lm

    output_heavy = ModelSpec(
        friendly_name="output-heavy",
        provider="deepseek",
        model_id="oh",
        min_tier=SubscriptionTier.FREE,
        price_per_1m_input_usd=0.5,
        price_per_1m_output_usd=60.0,  # sum = 60.5 (highest)
    )
    input_heavy = ModelSpec(
        friendly_name="input-heavy",
        provider="deepseek",
        model_id="ih",
        min_tier=SubscriptionTier.FREE,
        price_per_1m_input_usd=30.0,
        price_per_1m_output_usd=30.0,  # sum = 60.0 (lower) but costlier for us
    )
    monkeypatch.setattr(
        lm, "MODEL_CATALOG", {"output-heavy": output_heavy, "input-heavy": input_heavy}
    )
    # Ranked under the real reserve estimate (ESTIMATED_INPUT_TOKENS /
    # ESTIMATED_OUTPUT_TOKENS), input-heavy costs more despite the lower
    # unweighted price sum.
    assert llm_credit_service.worst_case_spec().friendly_name == "input-heavy"


def test_legacy_path_cost_log_does_not_invent_invoice_lines(caplog):
    """F3: on the legacy path the catalog spec is only a cost BASIS. Logging
    its provider/model would fabricate rows that can never match an invoice."""
    from bot.config.llm_models import MODEL_CATALOG
    from bot.services.nl_intent_service import _log_llm_cost

    with caplog.at_level("INFO"):
        _log_llm_cost(
            user_key="tg:1",
            spec=MODEL_CATALOG["gpt-flagship"],
            usage=TokenUsage(input_tokens=1100, output_tokens=100),
            raw_usd=0.0085,
            metered=False,
            wire_model="claude-haiku-4-5-20251001",
            estimated=True,
        )
    rec = next(r for r in caplog.records if getattr(r, "event", None) == "llm_cost")
    assert rec.model == "claude-haiku-4-5-20251001", "logged the stand-in, not the real model"
    assert rec.raw_cost_usd is None, "priced a model that was never called"
    assert rec.cost_basis == "worst_case"


def test_whisper_settles_against_provider_duration(monkeypatch):
    """F1: byte-count duration is codec-dependent and the SENDER picks the
    codec, so the reservation must be reconciled against Whisper's reported
    duration rather than trusted."""
    import asyncio

    from bot.services.whatsapp_voice import _WHISPER_USD_PER_MINUTE, WhatsAppVoiceHandler

    h = WhatsAppVoiceHandler()
    # 4.5 MB assumed at 16kbps -> 37.5 min estimate.
    est = h._estimate_minutes(4_500_000) * _WHISPER_USD_PER_MINUTE
    # Real content was 126 minutes (AMR-NB in the same bytes): 3.4x the estimate.
    actual = (126 * 60 / 60.0) * _WHISPER_USD_PER_MINUTE
    assert actual > est * 3, "test premise: real duration far exceeds the estimate"

    settled = {}

    async def fake_settle(key, reserved, actual_usd, tier=None):
        settled["actual"] = actual_usd

    async def no_tier(_):
        return None

    monkeypatch.setattr(llm_credit_service, "settle_budget", fake_settle)
    monkeypatch.setattr(WhatsAppVoiceHandler, "_resolve_tier", lambda self, n: no_tier(n))
    asyncio.run(h._settle_transcription_budget("+1555", 1000, actual))
    assert settled["actual"] == pytest.approx(actual)


def test_whisper_budget_not_gated_on_unrelated_catalog_flag(monkeypatch):
    """F2: Whisper runs on OPENAI_API_KEY and has nothing to do with
    multi-provider routing — gating it on that flag left it unmetered by
    default, which is the hole it was supposed to close."""
    import inspect

    from bot.services import whatsapp_voice

    src = inspect.getsource(whatsapp_voice.WhatsAppVoiceHandler._reserve_transcription_budget)
    assert "LLM_MULTI_PROVIDER_ENABLED" not in src
    assert "budget_capacity_micros" in src


# ---------------------------------------------------------------------------
# External reviewer (cubic) findings
# ---------------------------------------------------------------------------


def test_partial_usage_does_not_bill_the_missing_side_at_zero():
    """P1: a response reporting output but omitting input was treated as
    'non-empty', so every missing input token cost $0. Each side must be
    repaired independently."""
    from bot.services.llm_usage import billable_usage

    # Output reported, input missing -> input substituted, output preserved.
    out_only = billable_usage(TokenUsage(output_tokens=90), 1500, 300)
    assert out_only.input_tokens == 1500
    assert out_only.output_tokens == 90

    # Input reported, output missing -> output substituted, input preserved.
    in_only = billable_usage(TokenUsage(input_tokens=1100), 1500, 300)
    assert in_only.input_tokens == 1100
    assert in_only.output_tokens == 300

    # Cached-only input still counts as reported input.
    cached = billable_usage(TokenUsage(cached_read_tokens=800, output_tokens=50), 1500, 300)
    assert cached.cached_read_tokens == 800
    assert cached.input_tokens == 0

    # Fully absent -> full estimate.
    empty = billable_usage(TokenUsage(), 1500, 300)
    assert (empty.input_tokens, empty.output_tokens) == (1500, 300)

    # Fully reported -> untouched.
    full = TokenUsage(input_tokens=10, output_tokens=20)
    assert billable_usage(full, 1500, 300) is full


def test_partial_usage_is_actually_charged(monkeypatch):
    """The repaired usage must produce a non-zero cost, not just a non-zero
    token count."""
    monkeypatch.setattr(llm_credit_service.settings, "LLM_CREDIT_MARKUP", 1.0, raising=False)
    from bot.services.llm_usage import billable_usage

    repaired = billable_usage(TokenUsage(output_tokens=90), 1500, 300)
    cost = llm_credit_service.cost_of_usage(CACHED, repaired)
    # 1500 input @ $1/1M dominates; must not be output-only.
    assert cost > llm_credit_service.cost_of_usage(CACHED, TokenUsage(output_tokens=90))


@pytest.mark.asyncio
async def test_degraded_memory_map_is_bounded():
    """P2: during a Redis outage every distinct key was retained forever,
    letting traffic grow process memory without bound."""
    b = LLMBudget()
    monkeypatch_cap = 50
    b.MAX_MEMORY_KEYS = monkeypatch_cap
    for i in range(monkeypatch_cap * 3):
        await b.try_consume(f"user:{i}", 1, 1000)
    assert len(b._memory) <= monkeypatch_cap


@pytest.mark.asyncio
async def test_force_consume_applies_to_a_missing_bucket():
    """P1: force_consume routed through the refund path, whose Lua returns -1
    WITHOUT writing when the hash is absent — silently dropping an
    already-incurred charge."""
    b = LLMBudget()
    cap = 1000
    # No prior try_consume: the bucket does not exist yet.
    await b.force_consume("never-seen", 400, cap)
    allowed, remaining = await b.try_consume("never-seen", 0, cap)
    assert remaining <= cap - 400, "overrun was dropped on a missing bucket"


def test_budget_disabled_keeps_the_legacy_daily_cap(monkeypatch):
    """P1: with multi-provider on but BOTH ceilings set to 0, the budget
    enforces nothing — dropping the legacy cap too would leave LLM calls
    entirely unbounded."""
    import inspect

    from bot.services import nl_intent_service as n

    src = inspect.getsource(n.parse_trade_intent)
    assert "_budget_active" in src
    # The legacy cap must be conditioned on the budget actually enforcing.
    assert "LLM_BUDGET_PER_USER_DAILY_USD" in src
    assert "LLM_BUDGET_GLOBAL_DAILY_USD" in src


def test_negative_whisper_duration_cannot_refund_more_than_reserved():
    """P2: a malformed negative duration produced a negative cost, and
    settlement would then refund MORE than was reserved."""
    import inspect

    from bot.services import whatsapp_voice

    src = inspect.getsource(whatsapp_voice.WhatsAppVoiceHandler.handle_voice)
    assert "duration_s >= 0" in src
