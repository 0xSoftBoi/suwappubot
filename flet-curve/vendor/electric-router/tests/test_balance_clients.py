"""`read_balances` asks two different kinds of contract, and it matters which.

Four calls per coin: the pool's `balances()` in both spellings, and the coin's
`balanceOf(pool)` and `decimals()`.  The last two go to the **token**.

A caller reading pools out of a warmed local EVM has the pools' storage and not
the tokens'.  An unloaded account answers `balanceOf` with zero, which reads as
a pool holding nothing, and `check_reserves_are_real` drops it as insolvent --
so pointing the whole pass at the local EVM took five pools off gnosis and left
no path from WXDAI to EURe at all.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from erouter.core.transport import Answer, Status
from erouter.dev.universe import read_balances


@dataclass
class Coin:
    """A dataclass because `read_balances` `replace()`s it to fix decimals."""

    address: str
    decimals: int = 18
    symbol: str = "X"


@dataclass
class Pool:
    address: str = "0x" + "aa" * 20
    coins: list = field(default_factory=lambda: [Coin("0x" + "b1" * 20),
                                                 Coin("0x" + "b2" * 20)])
    n_coins: int = 2
    balances: tuple = ()
    held: tuple = ()
    name: str = "pool"


class Client:
    """Answers every call, and remembers who was asked."""

    def __init__(self, value):
        self.value = value
        self.targets: list[str] = []

    def raw(self, calls):
        self.targets.extend(c.to.lower() for c in calls)
        return [Answer(Status.VALUE, self.value.to_bytes(32, "big")) for _ in calls]


def test_token_reads_go_to_the_token_client():
    pool = Pool()
    pools_client = Client(10**21)
    tokens_client = Client(10**21)

    read_balances([pool], pools_client, None, None, token_client=tokens_client)

    assert set(pools_client.targets) == {pool.address.lower()}, (
        "the pool client must only ever be asked about the pool")
    assert set(tokens_client.targets) == {c.address.lower() for c in pool.coins}, (
        "balanceOf and decimals belong to the coin")


def test_one_client_still_answers_everything():
    """The default has to keep working: most callers have only the wire."""
    pool = Pool()
    only = Client(10**21)
    read_balances([pool], only, None, None)
    assert {pool.address.lower()} < set(only.targets)
    assert {c.address.lower() for c in pool.coins} <= set(only.targets)


def test_the_pool_still_gets_its_balances():
    """Splitting the batch must not shuffle the answers."""
    pool = Pool()
    read_balances([pool], Client(7), None, None, token_client=Client(9))
    assert [int(b) for b in pool.balances] == [7, 7]
    assert [int(h) for h in pool.held] == [9, 9], "held comes from the coin"
