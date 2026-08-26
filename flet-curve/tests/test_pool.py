"""`PoolContract` driven against a fake EIP-1193 provider."""

from __future__ import annotations

import pytest

from curve import abi
from curve.models import Pool
from curve.pool import PoolCallFailed, PoolContract
from wallet.base import RpcError, WalletProvider

ACCOUNT = "0x1111111111111111111111111111111111111111"
POOL_ADDRESS = "0x390f3595bCa2df7D23783DFd126427CCeb997BF4"
GAUGE = "0x4E6bB6B7447B7B2Aa268C16AB87F4Bb48BF57939"
LP_TOKEN = "0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490"


def word(value: int) -> str:
    return "0x" + f"{value:064x}"


class FakeProvider(WalletProvider):
    """Answers `eth_call` from a script and records every request."""

    def __init__(self, answers: dict[str, str] | None = None) -> None:
        self.answers = answers or {}
        self.calls: list[tuple[str, str]] = []
        self.sent: list[dict] = []
        self.default = word(0)
        self.raise_on_call: Exception | None = None

    async def request(self, method: str, params=None):
        params = params or []
        if method == "eth_call":
            to, data = params[0]["to"], params[0]["data"]
            self.calls.append((to, data))
            if self.raise_on_call is not None:
                raise self.raise_on_call
            return self.answers.get(data[:10], self.default)
        if method == "eth_sendTransaction":
            self.sent.append(params[0])
            return "0x" + "ab" * 32
        raise AssertionError(f"unexpected method {method}")


def make_pool(registry: str = "crvusd", *, gauge: str = GAUGE) -> Pool:
    return Pool.from_v2(
        {
            "address": POOL_ADDRESS,
            "pool_type": registry,
            "lp_token_address": LP_TOKEN,
            "gauges": [{"address": gauge, "is_killed": False}] if gauge else [],
            "coins": [
                {"symbol": "USDT", "address": "0x" + "aa" * 20, "decimals": 6},
                {"symbol": "crvUSD", "address": "0x" + "bb" * 20, "decimals": 18},
            ],
        }
    )


def contract(provider: FakeProvider, pool: Pool | None = None) -> PoolContract:
    return PoolContract(provider, pool or make_pool(), ACCOUNT)


# -- the empty-data guard --------------------------------------------------


async def test_empty_return_data_is_an_error_not_a_zero_quote() -> None:
    provider = FakeProvider()
    provider.default = "0x"
    with pytest.raises(PoolCallFailed, match="did not answer"):
        await contract(provider).get_dy(0, 1, 10**6)


async def test_bare_0x0_is_also_rejected() -> None:
    provider = FakeProvider()
    provider.default = "0x0"
    with pytest.raises(PoolCallFailed):
        await contract(provider).calc_withdraw_one_coin(10**18, 0)


async def test_a_genuine_zero_quote_is_still_returned() -> None:
    provider = FakeProvider({"0x" + abi.selector("get_dy(int128,int128,uint256)"): word(0)})
    assert await contract(provider).get_dy(0, 1, 10**6) == 0


async def test_rpc_errors_become_pool_errors() -> None:
    provider = FakeProvider()
    provider.raise_on_call = RpcError(-32000, "execution reverted")
    with pytest.raises(PoolCallFailed, match="execution reverted"):
        await contract(provider).get_dy(0, 1, 10**6)


# -- reads -----------------------------------------------------------------


async def test_get_dy_uses_the_stableswap_selector_for_a_stable_pool() -> None:
    provider = FakeProvider()
    provider.default = word(999)
    await contract(provider, make_pool("crvusd")).get_dy(0, 1, 1000)
    to, data = provider.calls[-1]
    assert to == POOL_ADDRESS
    assert data.startswith("0x" + abi.selector("get_dy(int128,int128,uint256)"))


async def test_get_dy_uses_the_crypto_selector_for_a_crypto_pool() -> None:
    provider = FakeProvider()
    provider.default = word(999)
    await contract(provider, make_pool("twocryptong")).get_dy(0, 1, 1000)
    _, data = provider.calls[-1]
    assert data.startswith("0x" + abi.selector("get_dy(uint256,uint256,uint256)"))


async def test_get_dy_short_circuits_on_zero_input() -> None:
    provider = FakeProvider()
    assert await contract(provider).get_dy(0, 1, 0) == 0
    assert provider.calls == []  # no pointless round trip


async def test_calc_token_amount_falls_back_to_the_older_signature() -> None:
    with_flag = "0x" + abi.selector("calc_token_amount(uint256[2],bool)")
    without = "0x" + abi.selector("calc_token_amount(uint256[2])")
    provider = FakeProvider({with_flag: "0x", without: word(4242)})
    provider.default = "0x"
    assert await contract(provider).calc_token_amount([1, 0]) == 4242
    dynamic = "0x" + abi.selector("calc_token_amount(uint256[],bool)")
    assert [d[:10] for _, d in provider.calls] == [with_flag, dynamic, without]


async def test_calc_token_amount_skips_the_call_when_nothing_is_entered() -> None:
    provider = FakeProvider()
    assert await contract(provider).calc_token_amount([0, 0]) == 0
    assert provider.calls == []


async def test_balance_of_allows_a_real_zero() -> None:
    provider = FakeProvider()
    provider.default = word(0)
    assert await contract(provider).balance_of("0x" + "cc" * 20) == 0


async def test_staked_balance_is_zero_without_a_gauge() -> None:
    provider = FakeProvider()
    pool = make_pool(gauge="")
    assert await contract(provider, pool).staked_balance() == 0
    assert provider.calls == []


# -- writes ----------------------------------------------------------------


async def test_exchange_sends_the_expected_transaction() -> None:
    provider = FakeProvider()
    await contract(provider).exchange(0, 1, 1000, 995)
    tx = provider.sent[-1]
    assert tx["from"] == ACCOUNT
    assert tx["to"] == POOL_ADDRESS
    assert tx["value"] == "0x0"
    assert tx["data"] == abi.encode_exchange(0, 1, 1000, 995, stableswap=True)
    assert "gas" not in tx and "nonce" not in tx


async def test_add_liquidity_encodes_every_coin() -> None:
    provider = FakeProvider()
    await contract(provider).add_liquidity([1000, 2000], 42)
    assert provider.sent[-1]["data"] == abi.encode_add_liquidity([1000, 2000], 42)


async def test_stake_targets_the_gauge_not_the_pool() -> None:
    provider = FakeProvider()
    await contract(provider).stake(500)
    tx = provider.sent[-1]
    assert tx["to"] == GAUGE
    assert tx["data"] == abi.encode_gauge_deposit(500)


async def test_unstake_targets_the_gauge() -> None:
    provider = FakeProvider()
    await contract(provider).unstake(500)
    assert provider.sent[-1]["data"] == abi.encode_gauge_withdraw(500)


async def test_staking_without_a_gauge_is_refused_before_sending() -> None:
    provider = FakeProvider()
    pool = make_pool(gauge="")
    with pytest.raises(PoolCallFailed, match="no gauge"):
        await contract(provider, pool).stake(1)
    assert provider.sent == []


async def test_approve_is_for_an_exact_amount_not_unlimited() -> None:
    provider = FakeProvider()
    token = "0x" + "cc" * 20
    await contract(provider).approve(token, POOL_ADDRESS, 12345)
    tx = provider.sent[-1]
    assert tx["to"] == token
    assert tx["data"] == abi.encode_approve(POOL_ADDRESS, 12345)
    assert abi.decode_uint("0x" + tx["data"][74:]) == 12345
    assert abi.decode_uint("0x" + tx["data"][74:]) != abi.MAX_UINT256


# -- fees ------------------------------------------------------------------
# Curve states fees as a fraction of 1e10.


async def test_the_flat_fee_is_read_from_the_pool() -> None:
    provider = FakeProvider({"0x" + abi.selector("fee()"): word(1_500_000)})
    assert await contract(provider).fee() == 1_500_000


async def test_a_pair_fee_is_used_when_the_pool_has_one() -> None:
    provider = FakeProvider(
        {
            "0x" + abi.selector("dynamic_fee(int128,int128)"): word(1_000_283),
            "0x" + abi.selector("fee()"): word(1_000_000),
        }
    )
    pool = contract(provider)
    assert await pool.pair_fee(0, 1) == 1_000_283
    assert not any(abi.selector("fee()") in data for _to, data in provider.calls)


async def test_empty_data_from_dynamic_fee_falls_back_to_the_flat_one() -> None:
    provider = FakeProvider({"0x" + abi.selector("fee()"): word(4_577_514)})
    provider.default = "0x"
    assert await contract(provider).pair_fee(0, 1) == 4_577_514


async def test_a_reverting_dynamic_fee_falls_back_too() -> None:

    class Reverting(FakeProvider):
        async def request(self, method, params=None):
            data = (params or [{}])[0].get("data", "")
            if data.startswith("0x" + abi.selector("dynamic_fee(int128,int128)")):
                raise RpcError(3, "execution reverted")
            return await super().request(method, params)

    provider = Reverting({"0x" + abi.selector("fee()"): word(1_500_000)})
    assert await contract(provider).pair_fee(0, 1) == 1_500_000


async def test_the_pair_is_encoded_into_the_dynamic_fee_call() -> None:
    provider = FakeProvider(
        {"0x" + abi.selector("dynamic_fee(int128,int128)"): word(1_000_283)}
    )
    await contract(provider).pair_fee(1, 2)
    _to, data = provider.calls[-1]
    body = data[10:]
    assert int(body[:64], 16) == 1
    assert int(body[64:128], 16) == 2


# -- array shapes ----------------------------------------------------------
# StableSwap-NG takes a Vyper `DynArray`, so its amounts are `uint256[]`
# where every other implementation takes `uint256[N]`.


def ng_pool() -> Pool:
    return make_pool(registry="stableswapng")


async def test_an_ng_pool_is_quoted_with_a_dynamic_array() -> None:
    dynamic = "0x" + abi.selector("calc_token_amount(uint256[],bool)")
    provider = FakeProvider({dynamic: word(98)})
    provider.default = "0x"
    assert await contract(provider, ng_pool()).calc_token_amount([1, 0]) == 98


async def test_a_classic_pool_is_quoted_with_a_fixed_array() -> None:
    fixed = "0x" + abi.selector("calc_token_amount(uint256[2],bool)")
    provider = FakeProvider({fixed: word(77)})
    provider.default = "0x"
    assert await contract(provider).calc_token_amount([1, 0]) == 77


async def test_an_unknown_registry_is_asked_rather_than_assumed() -> None:
    dynamic = "0x" + abi.selector("calc_token_amount(uint256[],bool)")
    provider = FakeProvider({dynamic: word(5)})
    provider.default = "0x"
    pool = make_pool(registry="some-new-factory-2027")
    assert not pool.dynamic_arrays  # not what the registry implied
    assert await contract(provider, pool).calc_token_amount([1, 0]) == 5
    assert pool.dynamic_arrays, "the answer should be remembered"


async def test_the_deposit_is_sent_in_the_shape_that_answered() -> None:
    dynamic = "0x" + abi.selector("calc_token_amount(uint256[],bool)")
    provider = FakeProvider({dynamic: word(5)})
    provider.default = "0x"
    pool = make_pool(registry="some-new-factory-2027")
    bound = contract(provider, pool)

    await bound.calc_token_amount([1, 0])
    await bound.add_liquidity([1, 0], 0)
    assert provider.sent[-1]["data"].startswith(
        "0x" + abi.selector("add_liquidity(uint256[],uint256)")
    )


async def test_a_dynamic_deposit_carries_an_offset_and_a_length() -> None:
    provider = FakeProvider()
    await contract(provider, ng_pool()).add_liquidity([7, 9], 3)
    data = provider.sent[-1]["data"]
    words = [int(data[10:][i : i + 64], 16) for i in range(0, len(data) - 10, 64)]
    assert words == [0x40, 3, 2, 7, 9]


async def test_a_dynamic_withdrawal_carries_them_too() -> None:
    provider = FakeProvider()
    await contract(provider, ng_pool()).remove_liquidity(5, [1, 2])
    data = provider.sent[-1]["data"]
    words = [int(data[10:][i : i + 64], 16) for i in range(0, len(data) - 10, 64)]
    assert words == [5, 0x40, 2, 1, 2]
    assert data.startswith("0x" + abi.selector("remove_liquidity(uint256,uint256[])"))


async def test_a_classic_deposit_stays_inline() -> None:
    provider = FakeProvider()
    await contract(provider).add_liquidity([7, 9], 3)
    data = provider.sent[-1]["data"]
    assert data.startswith("0x" + abi.selector("add_liquidity(uint256[2],uint256)"))
    words = [int(data[10:][i : i + 64], 16) for i in range(0, len(data) - 10, 64)]
    assert words == [7, 9, 3]


async def test_the_index_width_still_follows_the_family() -> None:
    assert make_pool(registry="stableswapng").is_stableswap
    assert make_pool(registry="crvusd").is_stableswap
    assert make_pool(registry="main").is_stableswap
    assert not make_pool(registry="twocryptong").is_stableswap
    assert not make_pool(registry="factory_tricrypto").is_stableswap
    assert not make_pool(registry="crypto").is_stableswap
