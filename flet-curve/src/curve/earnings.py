"""What a position is earning, and what it has earned but not taken."""

from __future__ import annotations

import asyncio
import dataclasses
from dataclasses import dataclass, field

from wallet.base import WalletError, WalletProvider

from . import abi
from .models import Incentive
from .multicall import MULTICALL3, decode_uints, encode_aggregate3
from .rewards import CRV_DECIMALS, REWARDS

#: The share of a balance that earns CRV with no veCRV at all.
UNBOOSTED_SHARE = 0.4

#: The most a boost can be, which is `1 / UNBOOSTED_SHARE`.
MAX_BOOST = 1.0 / UNBOOSTED_SHARE

#: Calls per Multicall3 batch. Well under what `curve.portfolio` measured as
#: acceptable, because a portfolio is a handful of pools rather than a
#: thousand.
CHUNK = 200

#: Batches in flight, matching `curve.portfolio.CONCURRENCY`.
CONCURRENCY = 6

#: How many `reward_tokens(i)` to walk per gauge.
MAX_REWARD_TOKENS = 8


@dataclass(frozen=True, slots=True)
class Reward:
    """One reward token, and what is owed in it."""

    token: str
    symbol: str
    decimals: int
    amount: int = 0
    #: USD per whole token, or 0 where nothing published one.
    price: float = 0.0
    #: Minted by the Minter rather than streamed by the gauge -- which
    #: is what decides *which transaction claims it*, so it is a fact
    #: about the reward and not a guess to be made from its name.
    minted: bool = False

    @property
    def whole(self) -> float:
        return self.amount / 10**self.decimals

    @property
    def value(self) -> float:
        return self.whole * self.price


@dataclass(frozen=True, slots=True)
class Earning:
    """What one pool is paying this account, and what it owes it."""

    pool: str
    gauge: str = ""
    #: Raw LP, as `Holding` carries it.
    staked: int = 0
    wallet: int = 0
    #: The gauge's own boosted balance for this account.
    working: int = 0
    #: The pool's published rates: unboosted CRV and the boosted ceiling.
    crv_apr: float = 0.0
    crv_apr_max: float = 0.0
    #: One entry per incentive token, rather than their sum -- because
    #: the page shows them one per line, with the token's own mark
    #: beside it, and "6.2%" split three ways is three different reasons
    #: to be in a pool.
    incentives: tuple[Incentive, ...] = field(default_factory=tuple)
    rewards: tuple[Reward, ...] = field(default_factory=tuple)

    @property
    def total(self) -> int:
        return self.staked + self.wallet

    @property
    def boost(self) -> float:
        """1.0 to 2.5, or 0.0 when nothing is staked."""
        if self.staked <= 0 or self.working <= 0:
            return 0.0
        return min(self.working / (self.staked * UNBOOSTED_SHARE), MAX_BOOST)

    @property
    def staked_share(self) -> float:
        """How much of the position is actually earning rewards, 0-1."""
        return self.staked / self.total if self.total else 0.0

    @property
    def user_crv_apr(self) -> float:
        """The CRV rate this account gets, at its boost, on its whole position."""
        return self.crv_apr * self.boost * self.staked_share

    @property
    def incentive_apr(self) -> float:
        """Every streamed token's published rate, together."""
        return sum(incentive.apr for incentive in self.incentives)

    @property
    def user_incentive_apr(self) -> float:
        """Incentives are not boosted, but they are still staked-only."""
        return self.incentive_apr * self.staked_share

    def user_incentives(self) -> list[tuple[Incentive, float]]:
        """Each streamed token with the rate *this account* gets from it."""
        share = self.staked_share
        return [
            (incentive, incentive.apr * share)
            for incentive in self.incentives
            if incentive.apr * share > 0
        ]

    @property
    def user_apr(self) -> float:
        """Everything the gauge pays this account, as one rate."""
        return self.user_crv_apr + self.user_incentive_apr

    @property
    def claimable_value(self) -> float:
        return sum(reward.value for reward in self.rewards)

    @property
    def crv_owed(self) -> float:
        """Whole CRV waiting at the Minter, which is what a button says."""
        return sum(reward.whole for reward in self.rewards if reward.minted)

    @property
    def extras_value(self) -> float:
        """What the streamed tokens are worth. Zero if none was priced --
        which is not the same as nothing owed, so callers check
        `has_extras` before reading this as an amount.
        """
        return sum(reward.value for reward in self.rewards if not reward.minted)

    @property
    def has_crv(self) -> bool:
        """Is there CRV to mint here? Both halves matter."""
        return any(reward.minted and reward.amount > 0 for reward in self.rewards)

    @property
    def has_extras(self) -> bool:
        """Is there anything for `claim_rewards` to move?"""
        return any(not reward.minted and reward.amount > 0 for reward in self.rewards)


@dataclass(frozen=True, slots=True)
class ClaimPlan:
    """The transactions "claim everything" actually comes to."""

    #: `(minter, [gauge, ...])` per transaction, already chunked.
    crv: tuple[tuple[str, tuple[str, ...]], ...] = field(default_factory=tuple)
    #: Every gauge owing an incentive token, claimed in one batch.
    extras: tuple[str, ...] = field(default_factory=tuple)

    @property
    def transactions(self) -> int:
        return len(self.crv) + (1 if self.extras else 0)


def claim_plan(chain_id: int, earnings: list[Earning]) -> ClaimPlan:
    """What to send to collect everything owed across a portfolio."""
    entry = REWARDS.get(chain_id)
    crv_gauges = [e.gauge for e in earnings if e.gauge and e.has_crv]
    batches: list[tuple[str, tuple[str, ...]]] = []
    if entry is not None and crv_gauges:
        size = entry.mint_many_size
        batches = [
            (entry.minter, tuple(crv_gauges[start : start + size]))
            for start in range(0, len(crv_gauges), size)
        ]
    return ClaimPlan(
        crv=tuple(batches),
        extras=tuple(e.gauge for e in earnings if e.gauge and e.has_extras),
    )




# -- reading ---------------------------------------------------------------


async def _batch(
    provider: WalletProvider, calls: list[tuple[str, str]]
) -> list[int | None]:
    """One Multicall3 round. `None` per call that failed."""
    batches = [calls[start : start + CHUNK] for start in range(0, len(calls), CHUNK)]
    answers: list[list[int | None]] = [[] for _ in batches]
    gate = asyncio.Semaphore(CONCURRENCY)

    async def run(number: int, chunk: list[tuple[str, str]]) -> None:
        try:
            async with gate:
                raw = await provider.call(MULTICALL3, encode_aggregate3(chunk))
            answers[number] = decode_uints(raw, len(chunk))
        except Exception:
            answers[number] = [None] * len(chunk)

    await asyncio.gather(*[run(n, chunk) for n, chunk in enumerate(batches)])
    return [value for group in answers for value in group]


def _word_to_address(value: int) -> str:
    return "0x" + f"{value:040x}"


async def read_earnings(
    provider: WalletProvider,
    account: str,
    positions: list[Earning],
    *,
    crv_price: float = 0.0,
    token_meta: dict[str, tuple[str, int, float]] | None = None,
) -> list[Earning]:
    """Fill in each position's boost and what it is owed."""
    meta = {key.lower(): value for key, value in (token_meta or {}).items()}
    staked = [p for p in positions if p.gauge and p.staked > 0]
    if not staked or not account:
        return positions
    earning_pools = {p.pool for p in staked}

    first: list[tuple[str, str]] = []
    for position in staked:
        first += [
            (position.gauge, abi.encode_working_balances(account)),
            (position.gauge, abi.encode_claimable_tokens(account)),
            (position.gauge, abi.encode_reward_count()),
        ]
    answers = await _batch(provider, first)

    working: dict[str, int] = {}
    crv_owed: dict[str, int] = {}
    counts: dict[str, int] = {}
    #: Positions whose reads all failed. `None` is not zero, and the two
    #: are indistinguishable once they reach the page: "unclaimed $0.00"
    #: is what a working read of nothing looks like.
    unread = 0
    for index, position in enumerate(staked):
        base = index * 3
        if answers[base + 1] is None and answers[base + 2] is None:
            unread += 1
        working[position.pool] = answers[base] or 0
        crv_owed[position.pool] = answers[base + 1] or 0
        counts[position.pool] = min(answers[base + 2] or 0, MAX_REWARD_TOKENS)

    if unread == len(staked):
        # Every one of them: that is the transport, not the gauges. The
        # caller says so; showing a page of zeros would say the opposite.
        raise WalletError("Could not read what these gauges owe.")

    token_calls: list[tuple[str, str]] = []
    asked_for: list[str] = []
    for position in staked:
        for slot in range(counts[position.pool]):
            token_calls.append((position.gauge, abi.encode_reward_tokens(slot)))
            asked_for.append(position.pool)
    token_answers = await _batch(provider, token_calls) if token_calls else []
    tokens: dict[str, list[str]] = {position.pool: [] for position in staked}
    for pool, answer in zip(asked_for, token_answers, strict=True):
        if answer:
            tokens[pool].append(_word_to_address(answer))

    owed_calls: list[tuple[str, str]] = []
    pairs: list[tuple[str, str]] = []
    for position in staked:
        for token in tokens[position.pool]:
            owed_calls.append(
                (position.gauge, abi.encode_claimable_reward(account, token))
            )
            pairs.append((position.pool, token))
    owed_answers = await _batch(provider, owed_calls) if owed_calls else []
    owed = {
        pair: (answer or 0)
        for pair, answer in zip(pairs, owed_answers, strict=True)
    }

    filled: list[Earning] = []
    for position in positions:
        if position.pool not in earning_pools:
            filled.append(position)
            continue
        rewards: list[Reward] = []
        crv = crv_owed.get(position.pool, 0)
        if crv > 0:
            rewards.append(
                Reward("", "CRV", CRV_DECIMALS, crv, crv_price, minted=True)
            )
        for token in tokens.get(position.pool, []):
            amount = owed.get((position.pool, token), 0)
            if amount <= 0:
                continue
            symbol, decimals, price = meta.get(token.lower(), ("?", 18, 0.0))
            rewards.append(Reward(token, symbol, decimals, amount, price))
        filled.append(
            dataclasses.replace(
                position,
                working=working.get(position.pool, 0),
                rewards=tuple(rewards),
            )
        )
    return filled


def seed_from_detail(earning: Earning, detail: dict) -> tuple[Earning, dict]:
    """Take the published rates off a pool payload."""
    extras = [
        entry
        for entry in (detail.get("extra_rewards_apr") or [])
        if (entry.get("symbol") or "").upper() != "CRV"
    ]
    meta = {
        (entry.get("address") or "").lower(): (
            entry.get("symbol") or "?",
            int(entry.get("decimals") or 18),
            float(entry.get("price") or 0.0),
        )
        for entry in extras
        if entry.get("address")
    }
    return (
        dataclasses.replace(
            earning,
            crv_apr=float(detail.get("crv_apr") or 0.0),
            crv_apr_max=float(detail.get("crv_apr_boosted") or 0.0),
            incentives=tuple(Incentive.from_v2(entry) for entry in extras),
        ),
        meta,
    )


async def send_claims(
    provider: WalletProvider, account: str, plan: ClaimPlan, *, crv: bool = True
) -> list[str]:
    """Send a plan, returning one hash per transaction, in order."""
    sent: list[str] = []
    if crv:
        for minter, gauges in plan.crv:
            slots = next(
                (r.mint_many_size for r in REWARDS.values() if r.minter == minter), 32
            )
            sent.append(
                await provider.send_transaction(
                    {
                        "from": account,
                        "to": minter,
                        "value": "0x0",
                        "data": abi.encode_mint_many(list(gauges), slots),
                    }
                )
            )
        return sent
    if plan.extras:
        calls = [
            (gauge, abi.encode_claim_rewards_for(account)) for gauge in plan.extras
        ]
        sent.append(
            await provider.send_transaction(
                {
                    "from": account,
                    "to": MULTICALL3,
                    "value": "0x0",
                    "data": encode_aggregate3(calls, allow_failure=False),
                }
            )
        )
    return sent
