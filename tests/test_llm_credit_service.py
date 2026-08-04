"""Tests for multi-provider LLM catalog resolution + credit metering.

MONEY-PATH: record_usage debits the shared api_credits balance, so the debit
math and atomicity-adjacent behaviors (row creation, lifetime_used, negative
balance handling) are pinned here against an in-memory sqlite DB.
"""

from contextlib import contextmanager

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.db import Base
from bot.config import llm_models
from bot.config.llm_models import MODEL_CATALOG, ModelSpec, resolve_model
from bot.models.subscription import APICredit, Subscription, SubscriptionTier
from bot.models.user import User
from bot.services import llm_credit_service

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def db_session_factory(monkeypatch):
    """In-memory sqlite wired into llm_credit_service's get_session/run_in_db."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)

    @contextmanager
    def fake_get_session():
        session = factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    async def fake_run_in_db(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    monkeypatch.setattr(llm_credit_service, "get_session", fake_get_session)
    monkeypatch.setattr(llm_credit_service, "run_in_db", fake_run_in_db)
    return factory


def _mk_user(factory, telegram_id=1111, llm_model=None):
    session = factory()
    user = User(telegram_id=telegram_id, llm_model=llm_model)
    session.add(user)
    session.commit()
    uid = user.id
    session.close()
    return uid


CHEAP = ModelSpec(
    friendly_name="test-cheap",
    provider="deepseek",
    model_id="deepseek-chat",
    min_tier=SubscriptionTier.FREE,
    price_per_1m_input_usd=1.0,
    price_per_1m_output_usd=2.0,
)


# ---------------------------------------------------------------------------
# Cost math
# ---------------------------------------------------------------------------


def test_estimate_cost_applies_prices_and_markup(monkeypatch):
    monkeypatch.setattr(llm_credit_service.settings, "LLM_CREDIT_MARKUP", 1.5, raising=False)
    # 1M in @ $1 + 0.5M out @ $2 = $2 raw, * 1.5 markup = $3
    cost = llm_credit_service.estimate_cost_usd(CHEAP, 1_000_000, 500_000)
    assert cost == pytest.approx(3.0)


def test_markup_defends_against_nonpositive(monkeypatch):
    monkeypatch.setattr(llm_credit_service.settings, "LLM_CREDIT_MARKUP", 0, raising=False)
    cost = llm_credit_service.estimate_cost_usd(CHEAP, 1_000_000, 0)
    assert cost == pytest.approx(1.0 * 1.5)  # falls back to default 1.5


# ---------------------------------------------------------------------------
# record_usage (MONEY-PATH debit)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_record_usage_debits_existing_balance(db_session_factory, monkeypatch):
    monkeypatch.setattr(llm_credit_service.settings, "LLM_CREDIT_MARKUP", 1.5, raising=False)
    uid = _mk_user(db_session_factory)
    session = db_session_factory()
    session.add(APICredit(user_id=uid, balance=10.0, lifetime_used=0.0))
    session.commit()
    session.close()

    result = await llm_credit_service.record_usage(uid, CHEAP, 1_000_000, 500_000)

    assert result.cost_usd == pytest.approx(3.0)
    assert result.new_balance_usd == pytest.approx(7.0)
    session = db_session_factory()
    row = session.query(APICredit).filter(APICredit.user_id == uid).one()
    assert row.balance == pytest.approx(7.0)
    assert row.lifetime_used == pytest.approx(3.0)
    session.close()


@pytest.mark.asyncio
async def test_record_usage_creates_row_and_allows_negative(db_session_factory, monkeypatch):
    monkeypatch.setattr(llm_credit_service.settings, "LLM_CREDIT_MARKUP", 1.5, raising=False)
    uid = _mk_user(db_session_factory)

    result = await llm_credit_service.record_usage(uid, CHEAP, 1_000_000, 0)

    # No pre-existing row: created on the fly, balance goes negative (tokens
    # were already spent — the debit must be recorded, not refused).
    assert result.new_balance_usd == pytest.approx(-1.5)


# ---------------------------------------------------------------------------
# check_allowance
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_allowance_rejects_empty_balance(db_session_factory):
    uid = _mk_user(db_session_factory)
    assert not await llm_credit_service.check_allowance(uid, CHEAP)


@pytest.mark.asyncio
async def test_check_allowance_passes_funded_balance(db_session_factory):
    uid = _mk_user(db_session_factory)
    session = db_session_factory()
    session.add(APICredit(user_id=uid, balance=5.0))
    session.commit()
    session.close()
    assert await llm_credit_service.check_allowance(uid, CHEAP)


# ---------------------------------------------------------------------------
# get_llm_user_context
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_user_context_defaults_to_free_and_reads_pref(db_session_factory):
    uid = _mk_user(db_session_factory, telegram_id=2222, llm_model="claude-haiku")
    ctx = await llm_credit_service.get_llm_user_context(2222)
    assert ctx is not None
    assert ctx.db_user_id == uid
    assert ctx.tier == SubscriptionTier.FREE
    assert ctx.llm_model_pref == "claude-haiku"


@pytest.mark.asyncio
async def test_user_context_active_subscription_tier(db_session_factory):
    uid = _mk_user(db_session_factory, telegram_id=3333)
    session = db_session_factory()
    session.add(Subscription(user_id=uid, tier=SubscriptionTier.PRO))
    session.commit()
    session.close()
    ctx = await llm_credit_service.get_llm_user_context(3333)
    assert ctx.tier == SubscriptionTier.PRO


@pytest.mark.asyncio
async def test_user_context_unknown_user_is_none(db_session_factory):
    assert await llm_credit_service.get_llm_user_context(999999) is None


# ---------------------------------------------------------------------------
# Catalog resolution
# ---------------------------------------------------------------------------


def _enable_keys(monkeypatch, providers):
    from bot.config import llm_providers

    def fake_get_api_key(name):
        return "k" if name in providers else ""

    monkeypatch.setattr(llm_providers, "get_api_key", fake_get_api_key)
    # llm_models imported is_provider_available by name
    monkeypatch.setattr(llm_models, "is_provider_available", lambda p: p in providers)


def test_resolve_model_default_free(monkeypatch):
    _enable_keys(monkeypatch, {"deepseek"})
    spec = resolve_model(SubscriptionTier.FREE, None)
    assert spec.friendly_name == "deepseek-chat"


def test_resolve_model_pref_honored_for_entitled_tier(monkeypatch):
    _enable_keys(monkeypatch, {"deepseek", "xai"})
    spec = resolve_model(SubscriptionTier.PRO, "grok-2")
    assert spec.friendly_name == "grok-2"


def test_resolve_model_pref_denied_below_tier(monkeypatch):
    _enable_keys(monkeypatch, {"deepseek", "xai"})
    spec = resolve_model(SubscriptionTier.FREE, "grok-2")
    assert spec.friendly_name == "deepseek-chat"


def test_resolve_model_skips_keyless_provider(monkeypatch):
    _enable_keys(monkeypatch, {"openai"})
    spec = resolve_model(SubscriptionTier.FREE, "deepseek-chat")
    assert spec.provider == "openai"


def test_resolve_model_no_provider_raises(monkeypatch):
    _enable_keys(monkeypatch, set())
    with pytest.raises(RuntimeError):
        resolve_model(SubscriptionTier.ENTERPRISE, None)


def test_catalog_tier_gating_consistency():
    # Every catalog entry's provider must exist in the registry.
    from bot.config.llm_providers import PROVIDERS

    for spec in MODEL_CATALOG.values():
        assert spec.provider in PROVIDERS
        assert spec.price_per_1m_input_usd > 0
        assert spec.price_per_1m_output_usd > 0


# ---------------------------------------------------------------------------
# Usage extraction shapes (nl_intent_service helpers)
# ---------------------------------------------------------------------------


class _Obj:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def test_anthropic_usage_shape():
    from bot.services.nl_intent_service import _anthropic_usage

    resp = _Obj(usage=_Obj(input_tokens=120, output_tokens=45))
    assert _anthropic_usage(resp) == (120, 45)
    assert _anthropic_usage(_Obj()) == (0, 0)


def test_openai_usage_shape():
    from bot.services.nl_intent_service import _openai_usage

    resp = _Obj(usage=_Obj(prompt_tokens=200, completion_tokens=80))
    assert _openai_usage(resp) == (200, 80)
    assert _openai_usage(_Obj(usage=None)) == (0, 0)
