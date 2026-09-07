"""Every write is built once and sent unchanged."""

from __future__ import annotations

import inspect

import pytest

from curve.models import Pool
from curve.pool import PoolContract
from wallet.base import WalletProvider

ACCOUNT = "0x1111111111111111111111111111111111111111"
POOL = "0x" + "22" * 20
LP = "0x" + "33" * 20
GAUGE = "0x" + "44" * 20


class Recorder(WalletProvider):
    """Records transactions, answers reads with a plausible word."""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.estimated: list[dict] = []

    async def request(self, method: str, params=None):
        params = params or []
        if method == "eth_chainId":
            return "0x1"
        if method == "eth_call":
            return "0x" + f"{10**18:064x}"
        if method == "eth_estimateGas":
            self.estimated.append(params[0])
            return "0x30d40"          # 200,000
        if method == "eth_sendTransaction":
            self.sent.append(params[0])
            return "0x" + "ab" * 32
        raise AssertionError(f"unexpected method {method}")


def contract() -> PoolContract:
    pool = Pool.from_v2(
        {
            "address": POOL,
            "pool_type": "stableswapng",
            "lp_token_address": LP,
            "chain_id": 1,
            "gauges": [GAUGE],
            "coins": [
                {"symbol": "USDT", "address": "0x" + "aa" * 20, "decimals": 6},
                {"symbol": "crvUSD", "address": "0x" + "bb" * 20, "decimals": 18},
            ],
        }
    ).merge_detail({"n_coins": 2})
    return PoolContract(Recorder(), pool, ACCOUNT)


#: Arguments for each write, by name. Anything `build_x` needs, keyed so a
#: new write without an entry fails the sweep below rather than being
#: silently skipped.
ARGUMENTS: dict[str, tuple] = {
    "approve": ("0x" + "aa" * 20, POOL, 10**18),
    "exchange": (0, 1, 10**6, 10**18),
    # A StableSwap metapool does its own underlying swap, so this one
    # needs no zap and the fixture pool can answer it.
    "exchange_underlying": (0, 1, 10**6, 10**18),
    "add_liquidity": ([10**6, 0], 10**18),
    "remove_liquidity": (10**18, [0, 0]),
    "remove_liquidity_one_coin": (10**18, 0, 10**6),
    "stake": (10**18,),
    "unstake": (10**18,),
    "claim_crv": (),
    "claim_rewards": (),
}

#: Writes whose `build_` needs a pool this fixture is not: the zap routes
#: want a metapool with a deposit zap, and deposit-and-stake wants a chain
#: with the stake zap deployed.
NEEDS_ANOTHER_POOL = {
    "zap_add_liquidity",
    "zap_remove_liquidity_one_coin",
    "deposit_and_stake",
}


def writes() -> list[str]:
    """Every `build_x` on the contract, by reflection."""
    return sorted(
        name[len("build_") :]
        for name, _ in inspect.getmembers(PoolContract, inspect.isfunction)
        if name.startswith("build_")
    )


def test_every_write_has_both_halves() -> None:
    for name in writes():
        assert hasattr(PoolContract, name), f"build_{name} has no sender"


def test_the_sweep_below_covers_every_write() -> None:
    assert set(writes()) == set(ARGUMENTS) | NEEDS_ANOTHER_POOL


@pytest.mark.parametrize("name", sorted(ARGUMENTS))
async def test_what_is_built_is_what_is_sent(name: str) -> None:
    pool = contract()
    args = ARGUMENTS[name]

    to, data = getattr(pool, f"build_{name}")(*args)
    await getattr(pool, name)(*args)

    sent = pool.provider.sent[-1]
    assert sent["to"] == to
    assert sent["data"] == data
    assert sent["from"] == ACCOUNT


@pytest.mark.parametrize("name", sorted(ARGUMENTS))
async def test_building_sends_nothing(name: str) -> None:
    pool = contract()
    getattr(pool, f"build_{name}")(*ARGUMENTS[name])
    assert pool.provider.sent == []


# -- the estimate -----------------------------------------------------------


async def test_the_estimate_asks_about_the_transaction_that_would_be_sent() -> None:
    pool = contract()
    built = pool.build_exchange(0, 1, 10**6, 10**18)

    gas = await pool.estimate_gas(built)

    assert gas == 200_000
    asked = pool.provider.estimated[-1]
    assert (asked["to"], asked["data"]) == built
    assert asked["from"] == ACCOUNT
    assert pool.provider.sent == [], "estimating is not sending"


async def test_an_estimate_that_reverts_is_no_number_rather_than_an_error() -> None:
    from wallet.base import RpcError

    class Refusing(Recorder):
        async def request(self, method: str, params=None):
            if method == "eth_estimateGas":
                raise RpcError(-32000, "execution reverted")
            return await super().request(method, params)

    pool = PoolContract(Refusing(), contract().pool, ACCOUNT)

    assert await pool.estimate_gas(pool.build_exchange(0, 1, 10**6, 1)) == 0


async def test_a_node_with_no_account_estimates_nothing() -> None:
    pool = PoolContract(Recorder(), contract().pool, "")

    assert await pool.estimate_gas(pool.build_exchange(0, 1, 10**6, 1)) == 0
    assert pool.provider.estimated == []
