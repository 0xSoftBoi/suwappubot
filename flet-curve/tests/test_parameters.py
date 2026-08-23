"""The pool's own numbers: which ones exist, and what they mean."""

from __future__ import annotations

from typing import Any

import pytest

from curve import abi, explorers
from curve.models import Coin, Pool
from curve.multicall import (
    AGGREGATE3,
    MULTICALL3,
    decode_aggregate3,
    decode_uints,
    encode_aggregate3,
)
from curve.parameters import (
    BY_KEY,
    PARAMETERS,
    Kind,
    Readings,
    format_value,
    rate_rows,
    rows,
)
from curve.pool import (
    ARRAY_PARAMETERS,
    INDEXED_PARAMETERS,
    PoolCallFailed,
    PoolContract,
    _parameter_plan,
)
from wallet.base import WalletError

# -- scales ----------------------------------------------------------------


@pytest.mark.parametrize(
    "kind,raw,expected",
    [
        # A, as Curve's own UI shows it: a plain integer carrying
        # whatever multiplier its family uses.
        (Kind.INTEGER, 4_000, "4,000"),               # 3pool
        (Kind.INTEGER, 1_707_629, "1,707,629"),       # tricryptoUSDC
        # Fees are tenths of a basis point: 1e10 is 100%.
        (Kind.PERCENT, 1_500_000, "0.0150%"),         # 3pool: 0.015%
        (Kind.PERCENT, 3_825_607, "0.0383%"),         # tricryptoUSDC
        (Kind.PERCENT, 146_000_000, "1.4600%"),       # YB cbBTC: 1.46%
        (Kind.PERCENT, 30_000_000, "0.3000%"),        # an out_fee
        # 1e18 fixed point.
        (Kind.RATIO, 11_809_167_828_997, "1.18092e-05"),   # tricrypto gamma
        (Kind.RATIO, 500_000_000_000_000, "0.0005"),       # its fee_gamma
        (Kind.RATIO, 65_003_125_444_859_976_272_179, "65,003.1"),  # BTC price
        # 1e10 fixed point, and read as a multiplier rather than a rate.
        (Kind.MULTIPLIER, 100_000_000_000, "10x"),    # PayPool, off peg
        (Kind.MULTIPLIER, 20_000_000_000, "2x"),
        # 1e18 again, shown to twelve places instead of six digits.
        (Kind.PRECISE, 1_039_823_717_356_571_085, "1.039823717357"),  # 3pool
        (Kind.PRECISE, 1_078_054_572_865_277_880, "1.078054572865"),  # stETH-ng
        (Kind.PRECISE, 1_035_070_122_939_955_419, "1.035070122940"),  # tricryptoUSDC
        (Kind.PRECISE, 10**18, "1.000000000000"),     # a pool deployed this block
    ],
)
def test_each_scale_is_the_one_that_parameter_uses(kind, raw, expected) -> None:
    assert format_value(kind, raw) == expected


# -- the virtual price -----------------------------------------------------


def test_the_virtual_price_keeps_the_digits_that_move() -> None:
    readings = (
        1_039_823_717_356_571_085,  # 3pool
        1_039_823_717_344_705_400,  # 3pool, an earlier read
        1_039_823_717_400_000_000,  # and one in between
    )
    assert len({format_value(Kind.RATIO, raw) for raw in readings}) == 1
    assert len({format_value(Kind.PRECISE, raw) for raw in readings}) == 3


def test_the_places_are_fixed_rather_than_trimmed() -> None:
    assert format_value(Kind.PRECISE, 1_100_000_000_000_000_000) == "1.100000000000"
    assert format_value(Kind.PRECISE, 2 * 10**18) == "2.000000000000"


def test_the_twelfth_place_is_exact_rather_than_a_float() -> None:
    raw = 1_311_012_269_028_500_073

    assert format_value(Kind.PRECISE, raw) == "1.311012269029"
    assert f"{raw / 10**18:,.12f}" == "1.311012269028"


def test_it_is_read_off_the_pool_like_every_other_row() -> None:
    assert any(p.key == "get_virtual_price" for p in PARAMETERS)
    assert abi.encode_parameter("get_virtual_price") == "0xbb7b8b80"


def test_every_family_implements_it() -> None:
    stable = rows({"A": 4_000, "fee": 1_500_000, "get_virtual_price": 10**18})
    crypto = rows({"A": 1_707_629, "gamma": 11_809_167_828_997, "get_virtual_price": 10**18})

    assert [p.key for p, _ in stable][-1] == "get_virtual_price"
    assert [p.key for p, _ in crypto][-1] == "get_virtual_price"


def test_an_empty_pool_has_no_virtual_price_rather_than_a_zero() -> None:
    assert [p.key for p, _ in rows({"A": 200, "fee": 4_000_000})] == ["A", "fee"]


def test_a_multiplier_stays_ascii() -> None:
    assert format_value(Kind.MULTIPLIER, 20_000_000_000).isascii()


# -- which parameters a pool has -------------------------------------------


def test_rows_are_in_table_order_and_skip_what_is_missing() -> None:
    stable = rows({"A": 4_000, "fee": 1_500_000})
    assert [parameter.key for parameter, _ in stable] == ["A", "fee"]

    crypto = rows(
        {
            "fee": 3_825_607,
            "A": 1_707_629,
            "gamma": 11_809_167_828_997,
            "mid_fee": 3_000_000,
            "out_fee": 30_000_000,
            "fee_gamma": 500_000_000_000_000,
            "price_scale": 64_996_211_703_193_777_726_748,
        }
    )
    assert [parameter.key for parameter, _ in crypto] == [
        "A", "gamma", "fee", "mid_fee", "out_fee", "fee_gamma", "price_scale",
    ]


def test_nothing_answered_is_no_rows_rather_than_a_row_of_dashes() -> None:
    assert rows({}) == []


def test_every_parameter_has_a_note() -> None:
    assert all(parameter.note for parameter in PARAMETERS)


# -- reading them ----------------------------------------------------------


def make_pool() -> Pool:
    pool = Pool(
        address="0x" + "11" * 20,
        name="Test",
        chain="ethereum",
        chain_id=1,
        registry="factory_tricrypto",
        lp_token="0x" + "11" * 20,
        coins=[Coin("0x" + f"{i:02x}" * 20, f"C{i}", 18, index=i) for i in range(2)],
    )
    pool.onchain_coins = 2
    return pool


class ScriptedProvider:
    """Answers the selectors it knows and nothing else."""

    def __init__(self, answers: dict[str, int]) -> None:
        from curve import abi

        self.abi = abi
        self.answers = answers
        self.asked: list[str] = []

    async def call(self, to: str, data: str) -> str:
        self.asked.append(data)
        for name, value in self.answers.items():
            if data.startswith(self.abi.encode_parameter(name)):
                return "0x" + f"{value:064x}"
            if data.startswith(self.abi.encode_indexed_parameter(name, 0)[:10]):
                return "0x" + f"{value:064x}"
        return "0x"


def contract_with(answers: dict[str, int]) -> PoolContract:
    return PoolContract(ScriptedProvider(answers), make_pool(), "0x" + "22" * 20)


async def test_a_stableswap_pool_answers_two_of_them() -> None:
    contract = contract_with({"A": 4_000, "fee": 1_500_000})
    assert (await contract.parameters()).values == {"A": 4_000, "fee": 1_500_000}


async def test_a_crypto_pool_answers_most_of_them() -> None:
    answers = {
        "A": 1_707_629,
        "gamma": 11_809_167_828_997,
        "fee": 3_825_607,
        "mid_fee": 3_000_000,
        "out_fee": 30_000_000,
        "fee_gamma": 500_000_000_000_000,
    }
    assert (await contract_with(answers).parameters()).values == answers


async def test_a_pool_that_answers_nothing_is_empty_not_an_error() -> None:
    assert not await contract_with({}).parameters()


async def test_an_indexed_price_is_found_after_the_plain_one_fails() -> None:
    from curve import abi

    class OnlyIndexed(ScriptedProvider):
        async def call(self, to: str, data: str) -> str:
            self.asked.append(data)
            if data.startswith(abi.encode_indexed_parameter("price_oracle", 0)[:10]):
                return "0x" + f"{65_003_125_444_859_976_272_179:064x}"
            return "0x"

    contract = PoolContract(OnlyIndexed({}), make_pool(), "")
    values = await contract.parameters()

    assert values.values == {"price_oracle": 65_003_125_444_859_976_272_179}


async def test_a_chain_without_multicall_asks_one_at_a_time() -> None:
    contract = contract_with({})
    await contract.parameters()

    asked = contract.provider.asked
    assert asked[0].startswith(abi.selector(AGGREGATE3), 2)
    assert len(asked) == 1 + len(PARAMETERS) + len(INDEXED_PARAMETERS) + len(ARRAY_PARAMETERS)


async def test_a_provider_that_cannot_read_at_all_says_so() -> None:

    class Dead:
        async def call(self, to: str, data: str) -> str:
            raise WalletError("No public node is known for this network.")

    with pytest.raises(WalletError, match="No public node is known"):
        await PoolContract(Dead(), make_pool(), "").parameters()


async def test_a_pool_that_implements_none_of_them_is_still_empty() -> None:
    assert not await contract_with({}).parameters()


async def test_a_reverting_read_does_not_stop_the_others() -> None:
    from wallet.base import RpcError

    class Reverts(ScriptedProvider):
        async def call(self, to: str, data: str) -> str:
            from curve import abi

            if data.startswith(abi.encode_parameter("gamma")):
                raise RpcError(-32000, "execution reverted")
            return await super().call(to, data)

    contract = PoolContract(Reverts({"A": 4_000, "fee": 1_500_000}), make_pool(), "")
    assert (await contract.parameters()).values == {"A": 4_000, "fee": 1_500_000}


def test_the_reader_and_the_table_agree_on_names() -> None:
    assert set(INDEXED_PARAMETERS) <= {parameter.key for parameter in PARAMETERS}


# -- explorers -------------------------------------------------------------


def test_a_known_chain_gets_its_own_explorer() -> None:
    assert explorers.address_url(1, "0xabc") == "https://etherscan.io/address/0xabc"
    assert explorers.address_url(100, "0xabc").startswith("https://gnosisscan.io")


def test_a_chain_that_publishes_one_wins_over_the_table() -> None:
    url = explorers.address_url(146, "0xabc", "https://custom.example/")
    assert url == "https://custom.example/address/0xabc"


def test_an_unknown_chain_still_gets_a_link() -> None:
    assert explorers.address_url(31337, "0xabc").startswith(explorers.FALLBACK)


def test_no_address_is_no_link() -> None:
    assert explorers.address_url(1, "") == ""


async def test_it_does_not_raise_on_a_pool_call_failure() -> None:
    assert issubclass(PoolCallFailed, WalletError)


# -- one round trip instead of twelve --------------------------------------


def word(value: int) -> str:
    return f"{value:064x}"


def aggregate3_response(answers: list[int | str | None]) -> str:
    """Encode `(bool success, bytes returnData)[]` as Multicall3 returns it."""
    elements = []
    for value in answers:
        if value is None:
            elements.append(word(0) + word(0x40) + word(0))
        elif isinstance(value, str):
            body = value.removeprefix("0x")
            elements.append(word(1) + word(0x40) + word(len(body) // 2) + body)
        else:
            elements.append(word(1) + word(0x40) + word(32) + word(value))
    heads, position = [], len(elements) * 32
    for element in elements:
        heads.append(word(position))
        position += len(element) // 2
    return "0x" + word(0x20) + word(len(elements)) + "".join(heads) + "".join(elements)


class BatchingProvider:
    """A chain with Multicall3 on it."""

    def __init__(self, answers: dict[str, int]) -> None:
        self.answers = answers
        self.asked: list[tuple[str, str]] = []

    async def call(self, to: str, data: str) -> str:
        self.asked.append((to, data))
        if to.lower() != MULTICALL3.lower():
            raise AssertionError("asked the pool directly despite the batch")
        plan = _parameter_plan()
        return aggregate3_response([self.answers.get(key) for key, _ in plan])


async def test_the_whole_batch_is_one_call() -> None:
    contract = PoolContract(
        BatchingProvider({"A": 1_707_629, "gamma": 11_809_167_828_997}),
        make_pool(),
        "",
    )

    values = await contract.parameters()

    assert values.values == {"A": 1_707_629, "gamma": 11_809_167_828_997}
    assert len(contract.provider.asked) == 1
    assert contract.provider.asked[0][0] == MULTICALL3


async def test_the_batch_is_sent_to_the_pool_with_failures_allowed() -> None:
    contract = PoolContract(BatchingProvider({"A": 4_000}), make_pool(), "")
    await contract.parameters()

    _to, data = contract.provider.asked[0]
    plan = _parameter_plan()
    assert data.startswith("0x" + abi.selector(AGGREGATE3))
    assert data.count(word(1)) >= len(plan)
    assert data.lower().count(make_pool().address[2:].lower()) == len(plan)


def test_the_encoding_round_trips() -> None:
    calls = [("0x" + "11" * 20, "0xf446c1d0"), ("0x" + "22" * 20, "0xb1373929")]
    data = encode_aggregate3(calls)

    assert data.startswith("0x" + abi.selector(AGGREGATE3))
    body = data[10:]
    assert int(body[0:64], 16) == 32
    assert int(body[64:128], 16) == 2


def test_failures_can_be_refused() -> None:
    calls = [("0x" + "11" * 20, "0xf446c1d0"), ("0x" + "22" * 20, "0xb1373929")]
    allowed = encode_aggregate3(calls)
    refused = encode_aggregate3(calls, allow_failure=False)

    assert len(allowed) == len(refused)
    assert allowed.count(word(1)) - refused.count(word(1)) == len(calls)
    assert decode_uints(aggregate3_response([1, None]), 2) == [1, None]


@pytest.mark.parametrize(
    "result",
    ["0x", "", "0x00", "0x" + "ff" * 64, None],
)
def test_nothing_readable_is_no_answers(result) -> None:
    assert decode_aggregate3(result) == []


def test_a_failed_call_reads_as_no_value() -> None:
    assert decode_aggregate3(aggregate3_response([None])) == [None]
    assert decode_uints(aggregate3_response([None, 7]), 2) == [None, 7]


def test_a_short_answer_is_not_mistaken_for_a_full_batch() -> None:
    assert decode_uints(aggregate3_response([1, 2]), 12) == [None] * 12


# -- stored_rates ----------------------------------------------------------
# The one read here that answers an array rather than a word, and the one
# that most pools do not answer at all.

STETH_NG_RATES = (
    "0x"
    "0000000000000000000000000000000000000000000000000de0b6b3a7640000"
    "0000000000000000000000000000000000000000000000000de0b6b3a7640000"
)

OSETH_RETH_RATES = (
    "0x"
    "0000000000000000000000000000000000000000000000000000000000000020"
    "0000000000000000000000000000000000000000000000000000000000000002"
    "0000000000000000000000000000000000000000000000000ef2cef8b2a2279a"
    "000000000000000000000000000000000000000000000000103b99ff5b536808"
)


def test_both_array_encodings_are_read() -> None:
    assert abi.decode_uint_array(STETH_NG_RATES) == [10**18, 10**18]
    assert abi.decode_uint_array(OSETH_RETH_RATES) == [
        1_077_150_828_439_152_538,
        1_169_697_850_260_678_664,
    ]


def test_the_offset_is_never_mistaken_for_a_rate() -> None:
    assert abi.decode_uint(OSETH_RETH_RATES) == 32
    assert 32 not in abi.decode_uint_array(OSETH_RETH_RATES)


@pytest.mark.parametrize("junk", ["", "0x", "0xabc", "0x" + "11" * 33])
def test_unreadable_data_is_no_rates_rather_than_a_guess(junk) -> None:
    assert abi.decode_uint_array(junk) == []


def test_each_coin_is_scaled_by_its_own_decimals() -> None:
    mixed = rate_rows([10**30, 10**18], [("USDC", 6), ("WETH", 18)])
    oracle = rate_rows([10**30, 1_101_580_158_261_000_000], [("USDC", 6), ("weETH", 18)])

    assert mixed == []  # both are exactly 1.0 against each other
    assert [value for _parameter, value in oracle] == ["1.101580158261"]


def test_an_oracle_rate_is_what_the_row_is_for() -> None:
    shown = rate_rows(
        [1_077_150_828_439_152_538, 1_169_697_850_260_678_664],
        [("osETH", 18), ("rETH", 18)],
    )

    assert [(parameter.label, value) for parameter, value in shown] == [
        ("External oracle rETH/osETH", "1.085918349945"),
    ]


def test_the_rate_is_divided_by_the_first_coins_own_rate() -> None:
    raw = [1_077_150_828_439_152_538, 1_169_697_850_260_678_664]
    coins = [("osETH", 18), ("rETH", 18)]

    assert format_value(Kind.PRECISE, raw[1]) == "1.169697850261"
    assert [value for _parameter, value in rate_rows(raw, coins)] == ["1.085918349945"]


def test_dividing_by_one_changes_nothing_for_the_other_71_percent() -> None:
    shown = rate_rows(
        [10**18, 1_243_624_562_186_000_000], [("DOLA", 18), ("sUSDe", 18)]
    )

    assert [(parameter.label, value) for parameter, value in shown] == [
        ("External oracle sUSDe/DOLA", "1.243624562186"),
    ]


def test_the_first_coin_gets_no_row_of_its_own() -> None:
    shown = rate_rows(
        [10**18, 1_243_624_562_186_000_000], [("DOLA", 18), ("sUSDe", 18)]
    )

    assert len(shown) == 1
    assert not any("DOLA/DOLA" in parameter.label for parameter, _value in shown)


def test_a_pool_with_no_oracle_between_its_coins_shows_nothing() -> None:
    assert rate_rows([10**30, 10**30], [("PYUSD", 6), ("USDC", 6)]) == []
    assert rate_rows([10**18, 10**18, 10**18], [("a", 18), ("b", 18), ("c", 18)]) == []
    assert rate_rows([12 * 10**17, 12 * 10**17], [("a", 18), ("b", 18)]) == []


def test_the_row_says_where_the_number_came_from() -> None:
    shown = rate_rows(
        [1_077_150_828_439_152_538, 1_169_697_850_260_678_664],
        [("osETH", 18), ("rETH", 18)],
    )
    internal = BY_KEY["price_oracle"].label

    assert shown[0][0].label == "External oracle rETH/osETH"
    assert internal == "Price oracle"
    assert internal not in shown[0][0].label


def test_the_label_fits_a_phone() -> None:
    shown = rate_rows(
        [1_243_624_562_186_000_000, 1_179_347_425_983_000_000, 1_160_351_238_578_000_000],
        [("sUSDe", 18), ("sDAI", 18), ("sFRAX", 18)],
    )

    assert max(len(parameter.label) for parameter, _value in shown) == 27


def test_a_first_rate_of_zero_is_not_divided_by() -> None:
    assert rate_rows([0, 10**18], [("a", 18), ("b", 18)]) == []


def test_a_coin_count_that_does_not_match_shows_nothing() -> None:
    assert rate_rows([10**18, 10**18], [("DAI", 18)]) == []
    assert rate_rows([10**18], [("DAI", 18), ("USDC", 6)]) == []
    assert rate_rows([], [("DAI", 18)]) == []


async def test_the_rates_ride_in_the_same_batch_as_the_parameters() -> None:
    plan = _parameter_plan()
    answers: list[Any] = [None] * len(plan)
    answers[[key for key, _ in plan].index("A")] = 5_000
    answers[[key for key, _ in plan].index("stored_rates")] = OSETH_RETH_RATES

    class Batching:
        def __init__(self) -> None:
            self.asked: list[tuple[str, str]] = []

        async def call(self, to: str, data: str) -> str:
            self.asked.append((to, data))
            return aggregate3_response(answers)

    contract = PoolContract(Batching(), make_pool(), "")
    readings = await contract.parameters()

    assert len(contract.provider.asked) == 1
    assert readings.values == {"A": 5_000}
    assert readings.rates == (
        1_077_150_828_439_152_538,
        1_169_697_850_260_678_664,
    )


async def test_a_pool_without_them_leaves_the_rates_empty() -> None:
    readings = await contract_with({"A": 4_000}).parameters()

    assert readings.rates == ()
    assert readings.values == {"A": 4_000}
    assert readings  # something answered, so the panel does not say "none"


def test_nothing_at_all_is_falsy() -> None:
    assert not Readings()
    assert Readings({"A": 4_000})
    assert Readings(rates=(10**18,))
