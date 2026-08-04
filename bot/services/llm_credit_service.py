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
from typing import Optional

from database.db import get_session, run_in_db
from bot.config.settings import settings
from bot.config.llm_models import ModelSpec
from bot.models.subscription import APICredit, Subscription, SubscriptionTier
from bot.models.user import User

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
                expired = sub.expires_at and sub.expires_at < datetime.now(timezone.utc)
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


def estimate_cost_usd(model: ModelSpec, input_tokens: int, output_tokens: int = 0) -> float:
    """USD cost for `input_tokens`/`output_tokens` against `model`'s list
    pricing, WITH the credit markup applied. This is the number actually
    debited from api_credits."""
    raw = (
        input_tokens / 1_000_000 * model.price_per_1m_input_usd
        + output_tokens / 1_000_000 * model.price_per_1m_output_usd
    )
    return raw * _markup()


async def get_balance(user_id: int) -> float:
    """Current api_credits balance for a user (0.0 if no row yet)."""

    def _read():
        with get_session() as session:
            credits = session.query(APICredit).filter(APICredit.user_id == user_id).first()
            return credits.balance if credits else 0.0

    return await run_in_db(_read)


async def check_allowance(
    user_id: int,
    model: ModelSpec,
    estimated_input_tokens: int = 500,
    estimated_output_tokens: int = 300,
) -> bool:
    """Pre-flight advisory check: does the user have enough balance to cover
    a call of roughly this size? Does NOT reserve/debit anything — callers
    MUST follow a successful provider call with `record_usage` using the
    ACTUAL token counts."""
    balance = await get_balance(user_id)
    estimated_cost = estimate_cost_usd(model, estimated_input_tokens, estimated_output_tokens)
    return balance >= estimated_cost


async def record_usage(
    user_id: int, model: ModelSpec, input_tokens: int, output_tokens: int
) -> UsageResult:
    """Atomically debit api_credits for ACTUAL usage after a provider call
    has already completed. Never blocks/refuses the debit on insufficient
    balance (the tokens are already spent) — it records the negative balance
    and logs loudly so operators can catch it, rather than silently eating
    the cost or raising after real work was already done."""
    cost_usd = estimate_cost_usd(model, input_tokens, output_tokens)

    def _debit():
        with get_session() as session:
            credits = (
                session.query(APICredit)
                .filter(APICredit.user_id == user_id)
                .with_for_update()
                .first()
            )
            if not credits:
                credits = APICredit(user_id=user_id, balance=0.0)
                session.add(credits)
                session.flush()

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
