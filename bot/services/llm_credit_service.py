"""LLM usage credit metering for direct multi-provider LLM calls.

MONEY-PATH: this module debits the SAME `api_credits` balance used elsewhere
in the bot (see `bot/models/subscription.py::APICredit`,
`bot/services/x402_service.py::use_credits`) — it is not a separate ledger.

Two-step usage:
  1. `check_allowance(...)` — pre-flight, advisory. Estimates cost from a
     rough token budget and compares against balance WITHOUT locking or
     debiting anything (real usage isn't known until the provider responds).
  2. `record_usage(...)` — post-flight, authoritative. Called with the
     ACTUAL input/output token counts the provider billed. Debits
     `api_credits.balance` atomically via `SELECT ... FOR UPDATE`, mirroring
     the row-lock pattern used in `bot/services/battle_service.py` and
     `bot/services/community_service.py` for balance mutations.

Failures in `record_usage` are LOUD (re-raised after logging), never
swallowed: by the time it's called, real provider tokens have already been
spent, so a silently-dropped debit would mean unmetered usage.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Tuple

from sqlalchemy.exc import IntegrityError

from database.db import get_session, run_in_db
from bot.config.settings import settings
from bot.config.llm_models import ModelSpec
from bot.models.subscription import APICredit, Subscription, SubscriptionTier
from bot.models.user import User
from bot.services.llm_usage import TokenUsage, billable_usage
from bot.utils.llm_budget import (
    GLOBAL_BUDGET_KEY,
    llm_budget,
    user_budget_key,
    usd_to_micros,
)

logger = logging.getLogger(__name__)

# Default markup applied on top of provider list price if settings.LLM_CREDIT_MARKUP
# is unset/non-positive (defensive — settings field itself defaults to 1.5).
_DEFAULT_MARKUP = 1.5


@dataclass(frozen=True)
class UsageResult:
    """Outcome of a metered LLM call, after markup."""

    input_tokens: int
    output_tokens: int
    cost_usd: float
    new_balance_usd: float


@dataclass(frozen=True)
class LLMUserContext:
    """DB identity + entitlements for one LLM caller, resolved from telegram_id.

    Handlers pass Telegram IDs around, but api_credits/subscriptions key on
    users.id — this is the single translation point for the LLM money path.
    """

    db_user_id: int
    tier: SubscriptionTier
    llm_model_pref: Optional[str]


async def get_llm_user_context(telegram_id) -> Optional[LLMUserContext]:
    """Resolve (users.id, effective tier, llm_model preference) for a Telegram
    user in one DB roundtrip. Returns None if the user doesn't exist yet.

    Tier mirrors x402_service.get_tier semantics: an expired subscription
    counts as FREE.
    """

    def _read():
        with get_session() as session:
            user = session.query(User).filter(User.telegram_id == int(telegram_id)).first()
            if user is None:
                return None
            tier = SubscriptionTier.FREE
            sub = session.query(Subscription).filter(Subscription.user_id == user.id).first()
            if sub is not None:
                # expires_at is a tz-naive DateTime column: comparing it raw
                # against an aware utcnow raises TypeError for every subscriber
                # with a non-NULL expiry. Normalize to aware-UTC first.
                exp = sub.expires_at
                if exp is not None and exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                expired = exp is not None and exp < datetime.now(timezone.utc)
                if not expired:
                    tier = sub.tier
            return LLMUserContext(db_user_id=user.id, tier=tier, llm_model_pref=user.llm_model)

    return await run_in_db(_read)


async def set_llm_model_pref(telegram_id, friendly_name: Optional[str]) -> bool:
    """Persist a user's model choice (None clears it). Returns False if the
    user row doesn't exist. Caller is responsible for validating the name
    against the catalog + tier before calling."""

    def _write():
        with get_session() as session:
            user = session.query(User).filter(User.telegram_id == int(telegram_id)).first()
            if user is None:
                return False
            user.llm_model = friendly_name
            return True

    return await run_in_db(_write)


def _markup() -> float:
    markup = getattr(settings, "LLM_CREDIT_MARKUP", _DEFAULT_MARKUP)
    return markup if markup and markup > 0 else _DEFAULT_MARKUP


def estimate_cost_usd(
    model: ModelSpec,
    input_tokens: int,
    output_tokens: int = 0,
    cached_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> float:
    """USD cost against `model`'s list pricing, WITH the credit markup applied.

    Four separately-priced token buckets, not two: cached reads are far
    cheaper than fresh input (0.1x on Anthropic/OpenAI, ~0.02x on DeepSeek)
    and cache writes cost a PREMIUM (1.25x on Anthropic). Billing cached reads
    at the full input rate over-charges the user for tokens we got at a
    discount; ignoring cache-write tokens under-charges.

    `input_tokens` must be the UNCACHED portion — see bot/services/llm_usage.py
    for how each provider's usage object is normalized to that contract.
    """
    raw = (
        input_tokens / 1_000_000 * model.price_per_1m_input_usd
        + cached_read_tokens / 1_000_000 * model.price_cached_read_per_1m()
        + cache_write_tokens / 1_000_000 * model.price_cache_write_per_1m()
        + output_tokens / 1_000_000 * model.price_per_1m_output_usd
    )
    return raw * _markup()


def cost_of_usage(model: ModelSpec, usage: TokenUsage) -> float:
    """Marked-up USD cost of a normalized TokenUsage."""
    return estimate_cost_usd(
        model,
        usage.input_tokens,
        usage.output_tokens,
        usage.cached_read_tokens,
        usage.cache_write_tokens,
    )


async def get_balance(user_id: int) -> float:
    """Current api_credits balance for a user (0.0 if no row yet)."""

    def _read():
        with get_session() as session:
            credits = session.query(APICredit).filter(APICredit.user_id == user_id).first()
            return credits.balance if credits else 0.0

    return await run_in_db(_read)


# Pre-flight token estimates. Real NL-intent calls ship the system prompt
# (~500 tok) plus the tool schema (~400 tok) plus user text/context, so 500
# would systematically underestimate by ~2-3x; calls are capped at
# max_tokens=300 output.
ESTIMATED_INPUT_TOKENS = 1500
ESTIMATED_OUTPUT_TOKENS = 300


async def check_allowance(
    user_id: int,
    model: ModelSpec,
    estimated_input_tokens: int = ESTIMATED_INPUT_TOKENS,
    estimated_output_tokens: int = ESTIMATED_OUTPUT_TOKENS,
) -> bool:
    """Pre-flight advisory check: does the user have enough balance to cover
    a call of roughly this size? Does NOT reserve/debit anything — callers
    MUST follow a successful provider call with `record_usage` using the
    ACTUAL token counts."""
    balance = await get_balance(user_id)
    estimated_cost = estimate_cost_usd(model, estimated_input_tokens, estimated_output_tokens)
    return balance >= estimated_cost


# Per-user spend budget multiplier by tier. The budget bounds PLATFORM spend;
# a paying subscriber with a funded balance must not be throttled to the same
# ceiling as an anonymous free user who has never swapped.
_TIER_BUDGET_MULTIPLIER = {
    SubscriptionTier.FREE: 1.0,
    SubscriptionTier.PRO: 5.0,
    SubscriptionTier.PREMIUM: 20.0,
    SubscriptionTier.ENTERPRISE: 100.0,
}


def raw_cost_usd(model: ModelSpec, usage: TokenUsage) -> float:
    """UNMARKED-UP provider cost — what the platform actually pays.

    The spend budget is denominated in real provider dollars, so
    LLM_BUDGET_*_USD means what it says. `cost_of_usage` (marked up) is what
    the *user* is charged; the two are deliberately different numbers.
    """
    markup = _markup()
    return cost_of_usage(model, usage) / markup if markup else 0.0


def user_budget_capacity_micros(tier: Optional[SubscriptionTier] = None) -> int:
    base = getattr(settings, "LLM_BUDGET_PER_USER_DAILY_USD", 0.0) or 0.0
    if base <= 0:
        return 0  # disabled / unlimited
    multiplier = _TIER_BUDGET_MULTIPLIER.get(tier or SubscriptionTier.FREE, 1.0)
    return usd_to_micros(base * multiplier)


def global_budget_capacity_micros() -> int:
    return usd_to_micros(getattr(settings, "LLM_BUDGET_GLOBAL_DAILY_USD", 0.0) or 0.0)


def worst_case_spec() -> ModelSpec:
    """The priciest catalog entry, used as a conservative cost basis when the
    real model is unknown (e.g. the legacy env-provider path).

    "Round the price UP": reserving against the most expensive model can only
    over-reserve, and the settlement returns the difference. Reserving against
    a cheap model would let an expensive unknown call slip the cap.
    """
    from bot.config.llm_models import MODEL_CATALOG

    return max(
        MODEL_CATALOG.values(),
        key=lambda s: s.price_per_1m_input_usd + s.price_per_1m_output_usd,
    )


async def reserve_budget(
    user_id: int, model: ModelSpec, tier: Optional[SubscriptionTier] = None
) -> Tuple[bool, int]:
    """Reserve a conservative cost estimate against the rolling spend buckets.

    Applies to EVERY catalog model, including the free default: the budget
    bounds what the *platform* spends, and a free-to-the-user call still costs
    real money. Distinct from `check_allowance`, which is about what the user
    can afford.

    Returns (allowed, reserved_micros). Both the per-user and platform-wide
    buckets must allow the call; if the global bucket refuses after the user
    bucket already consumed, the user's reservation is returned so a global
    backstop can't silently burn individual allowances.
    """
    estimated = raw_cost_usd(
        model,
        TokenUsage(input_tokens=ESTIMATED_INPUT_TOKENS, output_tokens=ESTIMATED_OUTPUT_TOKENS),
    )
    reserved = usd_to_micros(estimated)

    user_cap = user_budget_capacity_micros(tier)
    global_cap = global_budget_capacity_micros()

    ok, remaining = await llm_budget.try_consume(user_budget_key(user_id), reserved, user_cap)
    if not ok:
        logger.info(
            "llm_credit_service: user_id=%s hit the rolling LLM spend budget "
            "(need %d micros, %d left)",
            user_id,
            reserved,
            remaining,
        )
        return False, 0

    ok_global, remaining_global = await llm_budget.try_consume(
        GLOBAL_BUDGET_KEY, reserved, global_cap
    )
    if not ok_global:
        await llm_budget.refund(user_budget_key(user_id), reserved, user_cap)
        logger.warning(
            "llm_credit_service: PLATFORM-WIDE LLM spend budget exhausted "
            "(need %d micros, %d left) — degrading all callers",
            reserved,
            remaining_global,
        )
        return False, 0

    return True, reserved


async def settle_budget(
    user_id: int,
    reserved_micros: int,
    actual_usd: float,
    tier: Optional[SubscriptionTier] = None,
) -> None:
    """Reconcile a reservation against actual raw provider cost.

    Refunds the unused remainder, and — critically — CONSUMES the overrun when
    actual exceeded the estimate. The bucket went down by the reservation, not
    by actual, so without this an under-estimated call is silently free from
    the budget's perspective (SDK retries alone can bill the provider up to
    three times against one reservation).

    `actual_usd` must be RAW provider cost, matching the reservation's
    denomination — not the marked-up figure the user is charged.
    """
    if reserved_micros <= 0:
        return
    user_cap = user_budget_capacity_micros(tier)
    global_cap = global_budget_capacity_micros()

    delta = reserved_micros - usd_to_micros(actual_usd)
    if delta > 0:
        await llm_budget.refund(user_budget_key(user_id), delta, user_cap)
        await llm_budget.refund(GLOBAL_BUDGET_KEY, delta, global_cap)
        return
    if delta < 0:
        # Overrun: charge the difference. The allowed flag is ignored on
        # purpose — the spend already happened; this debits it against the
        # user's next-call headroom rather than letting it escape the cap.
        overrun = -delta
        logger.info(
            "llm_credit_service: user_id=%s call exceeded its reservation by "
            "%d micros — charging the overrun to the budget",
            user_id,
            overrun,
        )
        await llm_budget.try_consume(user_budget_key(user_id), overrun, user_cap)
        await llm_budget.try_consume(GLOBAL_BUDGET_KEY, overrun, global_cap)


async def record_usage(user_id: int, model: ModelSpec, usage: TokenUsage) -> UsageResult:
    """Atomically debit api_credits for ACTUAL usage after a provider call
    has already completed. Never blocks/refuses the debit on insufficient
    balance (the tokens are already spent) — it records the negative balance
    and logs loudly so operators can catch it, rather than silently eating
    the cost or raising after real work was already done."""
    if usage.is_empty:
        # A metered call that reports zero usage is a provider-shim quirk
        # (several OpenAI-compat endpoints omit/rename usage fields), not a
        # free call. Callers should already have normalized via
        # billable_usage() so the budget settles against the same number;
        # this is a defensive backstop for any other caller.
        logger.warning(
            "llm_credit_service: provider=%s model=%s returned no usage data — "
            "debiting pre-flight estimate (%d in / %d out) for user_id=%s",
            model.provider,
            model.model_id,
            ESTIMATED_INPUT_TOKENS,
            ESTIMATED_OUTPUT_TOKENS,
            user_id,
        )
        usage = billable_usage(usage, ESTIMATED_INPUT_TOKENS, ESTIMATED_OUTPUT_TOKENS)

    input_tokens = usage.input_tokens
    output_tokens = usage.output_tokens
    cost_usd = cost_of_usage(model, usage)

    def _locked_row(session):
        return (
            session.query(APICredit).filter(APICredit.user_id == user_id).with_for_update().first()
        )

    def _debit():
        with get_session() as session:
            credits = _locked_row(session)
            if not credits:
                # FOR UPDATE can't lock a row that doesn't exist: two
                # concurrent first-time calls can both reach the INSERT, and
                # user_id is UNIQUE — loser gets IntegrityError. Roll back
                # and re-read the winner's row under the lock instead of
                # dropping the debit.
                try:
                    credits = APICredit(user_id=user_id, balance=0.0)
                    session.add(credits)
                    session.flush()
                except IntegrityError:
                    session.rollback()
                    credits = _locked_row(session)
                    if credits is None:
                        raise

            credits.balance -= cost_usd
            credits.lifetime_used = (credits.lifetime_used or 0.0) + cost_usd
            return credits.balance

    try:
        new_balance = await run_in_db(_debit)
    except Exception:
        logger.exception(
            "llm_credit_service.record_usage: FAILED to debit already-spent LLM usage "
            "(user_id=%s provider=%s model=%s cost_usd=%.6f) — usage is UNMETERED",
            user_id,
            model.provider,
            model.model_id,
            cost_usd,
        )
        raise

    if new_balance < 0:
        logger.warning(
            "llm_credit_service: user_id=%s went negative on LLM credits (balance=%.6f) "
            "after provider=%s model=%s in=%d out=%d cost_usd=%.6f",
            user_id,
            new_balance,
            model.provider,
            model.model_id,
            input_tokens,
            output_tokens,
            cost_usd,
        )
    else:
        logger.info(
            "llm_credit_service: debited %.6f USD (user_id=%s provider=%s model=%s "
            "in=%d out=%d) new_balance=%.6f",
            cost_usd,
            user_id,
            model.provider,
            model.model_id,
            input_tokens,
            output_tokens,
            new_balance,
        )

    return UsageResult(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=cost_usd,
        new_balance_usd=new_balance,
    )
