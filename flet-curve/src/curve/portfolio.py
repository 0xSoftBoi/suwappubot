"""What an address is actually holding, across every pool on a chain."""

from __future__ import annotations

import asyncio
import dataclasses
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from wallet.base import WalletProvider
from wallet.erc20 import encode_balance_of

from . import abi
from .multicall import MULTICALL3, decode_uints, encode_aggregate3

#: Calls per batch. Both endpoints measured took all 1,713 at once, so this
#: is deliberately conservative: a chunk this size is ~67KB of calldata,
#: which no reasonable RPC refuses.
CHUNK = 300

#: Batches in flight. Six was the fastest measured and is polite enough for
#: a public endpoint that rate-limits by request.
CONCURRENCY = 6

#: Wei-per-unit for an LP token. Every Curve LP token is 18 decimals -- it
#: is minted by the pool, not by whoever made the coins.
LP_UNIT = 10**18


@dataclass(frozen=True, slots=True)
class Holding:
    """One pool, and what this address has in it."""

    address: str
    name: str
    chain: str
    #: Raw balances, in LP wei.
    wallet: int = 0
    staked: int = 0
    #: The pool's own numbers, for pricing the LP token.
    tvl: float = 0.0
    supply: float = 0.0
    #: `(address, symbol)` per coin. The address is what the token marks
    #: are drawn from -- curve-assets names its images by address -- so
    #: a symbol on its own would give lettered discs where the pool list
    #: shows real logos.
    coins: tuple[tuple[str, str], ...] = ()
    #: Kept so a remembered holding can be re-read on its own, before
    #: any pool list has loaded.
    lp_token: str = ""
    gauge: str = ""

    @property
    def symbols(self) -> tuple[str, ...]:
        return tuple(symbol for _address, symbol in self.coins)

    @property
    def total(self) -> int:
        return self.wallet + self.staked

    @property
    def lp_price(self) -> float:
        """USD per LP token, by the pool's own accounting."""
        return self.tvl / self.supply if self.supply else 0.0

    @property
    def value(self) -> float:
        """What the position is worth, in USD."""
        return self.total / LP_UNIT * self.lp_price

    @property
    def share(self) -> float:
        """The fraction of the pool this is, 0-1."""
        return (self.total / LP_UNIT) / self.supply if self.supply else 0.0


@dataclass(frozen=True, slots=True)
class Target:
    """A pool, and the two addresses worth asking about it."""

    address: str
    name: str
    chain: str
    lp_token: str
    gauge: str = ""
    tvl: float = 0.0
    supply: float = 0.0
    coins: tuple[tuple[str, str], ...] = field(default_factory=tuple)


def calls_for(targets: Sequence[Target]) -> list[str]:
    """The contracts to ask, in order: LP token, then gauge where there is one."""
    plan: list[str] = []
    for target in targets:
        plan.append(target.lp_token or target.address)
        if target.gauge:
            plan.append(target.gauge)
    return plan


def holdings_from(
    targets: Sequence[Target], answers: Sequence[int | None]
) -> list[Holding]:
    """Fold the flat answer list back into one row per pool."""
    wallet: dict[int, int] = {}
    staked: dict[int, int] = {}
    position = 0
    for index, target in enumerate(targets):
        wallet[index] = answers[position] or 0 if position < len(answers) else 0
        position += 1
        if target.gauge:
            staked[index] = answers[position] or 0 if position < len(answers) else 0
            position += 1

    found = [
        Holding(
            address=target.address,
            name=target.name,
            chain=target.chain,
            wallet=wallet.get(index, 0),
            staked=staked.get(index, 0),
            tvl=target.tvl,
            supply=target.supply,
            coins=target.coins,
            lp_token=target.lp_token,
            gauge=target.gauge,
        )
        for index, target in enumerate(targets)
        if wallet.get(index, 0) or staked.get(index, 0)
    ]
    found.sort(key=lambda holding: (holding.value, holding.total), reverse=True)
    return found


async def scan(
    provider: WalletProvider,
    targets: Sequence[Target],
    account: str,
    *,
    on_progress: Callable[[int, int], None] | None = None,
    chunk: int = CHUNK,
    concurrency: int = CONCURRENCY,
) -> list[Holding]:
    """Read every balance and return what is not zero."""
    plan = calls_for(targets)
    if not plan:
        return []
    balances = await _batched(
        provider, plan, encode_balance_of(account), chunk, concurrency, on_progress
    )
    holdings = holdings_from(targets, balances)
    return await with_supply(provider, holdings)


async def with_supply(
    provider: WalletProvider, holdings: Sequence[Holding]
) -> list[Holding]:
    """Fill in each LP token's supply, which is what prices the position."""
    if not holdings:
        return list(holdings)
    supplies = await _batched(
        provider,
        [holding.lp_token or holding.address for holding in holdings],
        abi.encode_total_supply(),
        CHUNK,
        1,
        None,
    )
    priced = [
        dataclasses.replace(holding, supply=supply / LP_UNIT) if supply else holding
        for holding, supply in zip(holdings, supplies, strict=False)
    ]
    priced.sort(key=lambda holding: (holding.value, holding.total), reverse=True)
    return priced


async def _batched(
    provider: WalletProvider,
    contracts: Sequence[str],
    data: str,
    chunk: int,
    concurrency: int,
    on_progress: Callable[[int, int], None] | None,
) -> list[int | None]:
    """The same call against many contracts, in batches, concurrently."""
    batches = [contracts[i : i + chunk] for i in range(0, len(contracts), chunk)]
    answers: list[list[int | None]] = [[] for _ in batches]
    done = 0
    gate = asyncio.Semaphore(max(1, concurrency))

    async def run(number: int, batch: Sequence[str]) -> None:
        nonlocal done
        async with gate:
            result = await provider.call(
                MULTICALL3, encode_aggregate3([(target, data) for target in batch])
            )
        answers[number] = decode_uints(result, len(batch))
        done += len(batch)
        if on_progress is not None:
            on_progress(done, len(contracts))

    await asyncio.gather(*[run(n, batch) for n, batch in enumerate(batches)])
    return [value for group in answers for value in group]


# -- what to remember between visits ---------------------------------------
# A scan is fast but not instant, and the answer barely changes between one
# visit and the next.


def to_json(holdings: Sequence[Holding], account: str, chain: str) -> dict[str, Any]:
    """The shape that goes into storage. Small: positions, not pools."""
    return {
        "account": account.lower(),
        "chain": chain,
        "holdings": [
            {
                "address": holding.address,
                "name": holding.name,
                "wallet": str(holding.wallet),
                "staked": str(holding.staked),
                "tvl": holding.tvl,
                "supply": holding.supply,
                "coins": [list(coin) for coin in holding.coins],
                "lp_token": holding.lp_token,
                "gauge": holding.gauge,
            }
            for holding in holdings
        ],
    }


def from_json(payload: Any, account: str, chain: str) -> list[Holding]:
    """Read it back, for this account and chain only."""
    if not isinstance(payload, dict):
        return []
    if payload.get("account") != account.lower() or payload.get("chain") != chain:
        return []
    holdings = []
    for raw in payload.get("holdings") or []:
        try:
            holdings.append(
                Holding(
                    address=str(raw["address"]),
                    name=str(raw.get("name") or ""),
                    chain=chain,
                    wallet=int(raw.get("wallet") or 0),
                    staked=int(raw.get("staked") or 0),
                    tvl=float(raw.get("tvl") or 0.0),
                    supply=float(raw.get("supply") or 0.0),
                    coins=tuple(
                        (str(coin[0]), str(coin[1]))
                        for coin in raw.get("coins") or ()
                        if isinstance(coin, (list, tuple)) and len(coin) == 2
                    ),
                    lp_token=str(raw.get("lp_token") or ""),
                    gauge=str(raw.get("gauge") or ""),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    return holdings


def targets_for(holdings: Sequence[Holding]) -> list[Target]:
    """Targets for a quick refresh of rows that are already on screen."""
    return [
        Target(
            address=holding.address,
            name=holding.name,
            chain=holding.chain,
            lp_token=holding.lp_token or holding.address,
            gauge=holding.gauge,
            tvl=holding.tvl,
            coins=holding.coins,
        )
        for holding in holdings
    ]
