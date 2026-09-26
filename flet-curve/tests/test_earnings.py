"""Boost, the rate it implies, and how many transactions a claim takes."""

from __future__ import annotations

import pytest

from curve.abi import encode_claim_rewards_for, selector
from curve.earnings import (
    MAX_BOOST,
    ClaimPlan,
    Earning,
    Reward,
    claim_plan,
    read_earnings,
    seed_from_detail,
    send_claims,
)
from curve.models import Incentive
from curve.multicall import MULTICALL3, encode_aggregate3

from .test_parameters import aggregate3_response

CRV = Reward("", "CRV", 18, 5 * 10**18, 0.5, minted=True)
ARB = Reward("0x" + "ab" * 20, "ARB", 18, 2 * 10**18, 1.5)
USDC = Reward("0x" + "cd" * 20, "USDC", 6, 2_500_000, 1.0)


def staked(**kw) -> Earning:
    base = {"pool": "0xpool", "gauge": "0xgauge", "staked": 1000, "working": 400}
    return Earning(**{**base, **kw})


# -- boost ------------------------------------------------------------------


def test_no_ve_crv_is_the_floor_not_a_penalty() -> None:
    assert staked(working=400).boost == 1.0


def test_a_full_working_balance_is_the_ceiling() -> None:
    assert staked(working=1000).boost == MAX_BOOST == 2.5


def test_the_boost_is_clamped_to_what_the_protocol_allows() -> None:
    assert staked(working=99999).boost == 2.5


def test_an_unstaked_position_has_no_boost_rather_than_the_minimum() -> None:
    assert Earning(pool="p", gauge="g", staked=0, wallet=500).boost == 0.0


def test_a_gauge_that_did_not_answer_reads_as_no_boost() -> None:
    assert staked(working=0).boost == 0.0


# -- the rate that follows --------------------------------------------------


def test_the_rate_is_the_published_one_times_the_boost() -> None:
    assert staked(working=1000, crv_apr=10.0).user_crv_apr == 25.0


def test_rewards_are_paid_on_the_staked_part_only() -> None:
    position = Earning(
        pool="p", gauge="g", staked=100, wallet=900, working=100, crv_apr=10.0
    )
    assert position.staked_share == pytest.approx(0.1)
    assert position.user_crv_apr == pytest.approx(2.5)  # 10 * 2.5 boost * 0.1


def test_incentives_are_staked_only_but_never_boosted() -> None:
    position = Earning(
        pool="p", gauge="g", staked=500, wallet=500, working=500,
        incentives=(Incentive("ARB", "0x" + "ab" * 20, 4.0),),
    )
    assert position.boost == 2.5
    assert position.user_incentive_apr == pytest.approx(2.0)


def test_the_two_rates_add_up() -> None:
    position = Earning(
        pool="p", gauge="g", staked=1000, working=400, crv_apr=6.0,
        incentives=(Incentive("ARB", "0x" + "ab" * 20, 4.0),),
    )
    assert position.user_apr == pytest.approx(10.0)


# -- what is owed -----------------------------------------------------------


def test_a_reward_is_valued_in_its_own_decimals() -> None:
    assert USDC.whole == pytest.approx(2.5)
    assert USDC.value == pytest.approx(2.5)


def test_the_value_owed_is_every_token_together() -> None:
    position = staked(rewards=(CRV, ARB, USDC))
    assert position.claimable_value == pytest.approx(5 * 0.5 + 2 * 1.5 + 2.5)


def test_a_token_with_no_price_still_counts_as_owed() -> None:
    position = staked(rewards=(Reward("0xtok", "MYSTERY", 18, 10**18, 0.0),))
    assert position.claimable_value == 0.0
    assert position.has_extras is True


def test_crv_and_extras_are_told_apart() -> None:
    assert staked(rewards=(CRV,)).has_crv is True
    assert staked(rewards=(CRV,)).has_extras is False
    assert staked(rewards=(ARB,)).has_crv is False
    assert staked(rewards=(ARB,)).has_extras is True


def test_crv_streamed_as_an_incentive_is_claimed_from_the_gauge() -> None:
    streamed = Reward("0x" + "cc" * 20, "CRV", 18, 10**18, 0.5)
    position = staked(rewards=(streamed,))
    assert position.has_crv is False
    assert position.has_extras is True
    assert claim_plan(1, [position]).crv == ()
    assert claim_plan(1, [position]).extras == ("0xgauge",)


def test_a_reward_that_is_owed_nothing_is_not_a_reason_to_send_anything() -> None:
    nothing = staked(
        rewards=(
            Reward("", "CRV", 18, 0, 0.5, minted=True),
            Reward("0x" + "ab" * 20, "ARB", 18, 0, 1.5),
        )
    )
    assert nothing.has_crv is False
    assert nothing.has_extras is False
    assert claim_plan(1, [nothing]).transactions == 0


# -- the claim ---------------------------------------------------------------


def test_crv_batches_eight_at_a_time_on_ethereum() -> None:
    many = [
        Earning(pool=f"p{i}", gauge=f"0x{i:040x}", staked=1, rewards=(CRV,))
        for i in range(10)
    ]
    plan = claim_plan(1, many)
    assert [len(gauges) for _minter, gauges in plan.crv] == [8, 2]
    assert plan.crv[0][0] == "0xd061D61a4d941c39E5453435B6345Dc261C2fcE0"


def test_crv_batches_thirty_two_at_a_time_elsewhere() -> None:
    many = [
        Earning(pool=f"p{i}", gauge=f"0x{i:040x}", staked=1, rewards=(CRV,))
        for i in range(10)
    ]
    assert [len(g) for _m, g in claim_plan(42161, many).crv] == [10]


def test_incentives_batch_however_many_gauges_there_are() -> None:
    many = [
        Earning(pool=f"p{i}", gauge=f"0x{i:040x}", staked=1, rewards=(ARB,))
        for i in range(30)
    ]
    plan = claim_plan(1, many)
    assert plan.crv == ()
    assert len(plan.extras) == 30
    assert plan.transactions == 1


def test_a_gauge_owing_nothing_is_left_out_of_the_plan() -> None:
    positions = [
        Earning(pool="a", gauge="0x" + "11" * 20, staked=1, rewards=(CRV,)),
        Earning(pool="b", gauge="0x" + "22" * 20, staked=1),
    ]
    plan = claim_plan(1, positions)
    assert plan.crv[0][1] == ("0x" + "11" * 20,)
    assert plan.extras == ()


def test_a_chain_with_no_crv_offers_no_crv_claim() -> None:
    positions = [Earning(pool="a", gauge="0xg", staked=1, rewards=(CRV, ARB))]
    plan = claim_plan(196, positions)
    assert plan.crv == ()
    assert plan.extras == ("0xg",)


def test_an_empty_plan_is_no_transactions() -> None:
    assert ClaimPlan().transactions == 0
    assert claim_plan(1, []).transactions == 0


# -- what gets sent ----------------------------------------------------------


class Recorder:
    """A provider that keeps the transactions rather than sending them."""

    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_transaction(self, tx: dict) -> str:
        self.sent.append(tx)
        return f"0x{len(self.sent):064x}"


async def test_incentives_go_out_as_one_multicall_naming_the_owner() -> None:
    account = "0x" + "11" * 20
    plan = claim_plan(
        1,
        [
            Earning(pool=f"p{i}", gauge=f"0x{i:040x}", staked=1, rewards=(ARB,))
            for i in range(3)
        ],
    )
    provider = Recorder()
    hashes = await send_claims(provider, account, plan, crv=False)

    assert len(hashes) == 1
    (tx,) = provider.sent
    assert tx["to"] == MULTICALL3
    assert tx["from"] == account
    assert tx["data"] == encode_aggregate3(
        [(f"0x{i:040x}", encode_claim_rewards_for(account)) for i in range(3)],
        allow_failure=False,
    )
    assert tx["data"].count(selector("claim_rewards(address)")) == 3


class Chain:
    """A Multicall3 that answers each round in the order it was asked."""

    def __init__(self, rounds: list[list[int | None]]) -> None:
        self.rounds = list(rounds)
        self.asked: list[str] = []

    async def call(self, _to: str, data: str) -> str:
        self.asked.append(data)
        return aggregate3_response(self.rounds.pop(0))


class SlowChain:
    """A Multicall3 that takes its time, and records how many callers are
    inside it at once.
    """

    def __init__(self, answer: int = 1) -> None:
        self.answer = answer
        self.calls = 0
        self.running = 0
        self.at_once = 0

    async def call(self, _to: str, data: str) -> str:
        import asyncio

        from .test_parameters import aggregate3_response

        self.calls += 1
        self.running += 1
        self.at_once = max(self.at_once, self.running)
        await asyncio.sleep(0.01)
        self.running -= 1
        count = int(data[2 + 8 + 64 : 2 + 8 + 128], 16)
        return aggregate3_response([self.answer] * count)


async def test_the_chunks_of_a_round_go_out_together() -> None:
    from curve.earnings import CHUNK, CONCURRENCY, _batch

    chain = SlowChain()
    calls = [("0x" + f"{i:040x}", "0x11223344") for i in range(CHUNK * 4)]

    answers = await _batch(chain, calls)

    assert chain.calls == 4
    assert chain.at_once == 4, "four chunks, none of them waiting on another"
    assert len(answers) == CHUNK * 4
    assert CONCURRENCY >= 4


async def test_a_round_wider_than_the_gate_still_waits_its_turn() -> None:
    from curve.earnings import CHUNK, CONCURRENCY, _batch

    chain = SlowChain()
    calls = [("0x" + f"{i:040x}", "0x11223344") for i in range(CHUNK * (CONCURRENCY + 3))]

    await _batch(chain, calls)

    assert chain.calls == CONCURRENCY + 3
    assert chain.at_once == CONCURRENCY


async def test_answers_keep_their_order_however_they_arrive() -> None:
    import asyncio

    from curve.earnings import CHUNK, _batch

    from .test_parameters import aggregate3_response

    order: list[int] = []

    class Uneven:
        async def call(self, _to: str, data: str) -> str:
            count = int(data[2 + 8 + 64 : 2 + 8 + 128], 16)
            index = len(order)
            order.append(index)
            await asyncio.sleep(0.02 - 0.005 * index)
            return aggregate3_response([index] * count)

    answers = await _batch(Uneven(), [("0x" + f"{i:040x}", "0x11223344")
                                      for i in range(CHUNK * 3)])

    assert answers[:1] == [0]
    assert answers[CHUNK : CHUNK + 1] == [1]
    assert answers[CHUNK * 2 : CHUNK * 2 + 1] == [2]


async def test_a_chunk_that_fails_costs_only_its_own_calls() -> None:
    from curve.earnings import CHUNK, _batch

    from .test_parameters import aggregate3_response

    class Flaky:
        async def call(self, _to: str, data: str) -> str:
            count = int(data[2 + 8 + 64 : 2 + 8 + 128], 16)
            if not hasattr(self, "seen"):
                self.seen = True
                raise RuntimeError("endpoint said no")
            return aggregate3_response([7] * count)

    answers = await _batch(Flaky(), [("0x" + f"{i:040x}", "0x11223344")
                                     for i in range(CHUNK * 2)])

    assert answers.count(None) == CHUNK
    assert answers.count(7) == CHUNK


async def test_a_reward_token_owing_nothing_never_becomes_a_reward() -> None:
    paid = "0x" + "ab" * 20
    dry = "0x" + "cd" * 20
    me = "0x" + "11" * 20
    position = Earning(pool="0xpool", gauge="0x" + "22" * 20, staked=1000)
    chain = Chain(
        [
            [400, 0, 2],                      # working, CRV owed (none), token count
            [int(paid, 16), int(dry, 16)],    # which tokens
            [7 * 10**18, 0],                  # what is owed in each
        ]
    )

    (filled,) = await read_earnings(
        chain, me, [position],
        token_meta={paid: ("ARB", 18, 1.5), dry: ("OP", 18, 2.0)},
    )

    assert [r.symbol for r in filled.rewards] == ["ARB"]
    assert filled.has_crv is False
    plan = claim_plan(1, [filled])
    assert plan.crv == ()
    assert plan.extras == ("0x" + "22" * 20,)


async def test_nothing_owed_sends_nothing() -> None:
    provider = Recorder()
    assert await send_claims(provider, "0xme", ClaimPlan(), crv=False) == []
    assert await send_claims(provider, "0xme", ClaimPlan(), crv=True) == []
    assert provider.sent == []


# -- seeding from the pool payload -------------------------------------------


def test_the_published_rates_are_taken_off_the_payload() -> None:
    seeded, meta = seed_from_detail(
        staked(),
        {
            "crv_apr": 3.5,
            "crv_apr_boosted": 8.75,
            "extra_rewards_apr": [
                {"address": "0xAA", "symbol": "ARB", "decimals": 18,
                 "price": 1.5, "apr": 4.0},
                {"address": "0xBB", "symbol": "USDC", "decimals": 6,
                 "price": 1.0, "apr": 1.0},
            ],
        },
    )
    assert seeded.crv_apr == 3.5
    assert seeded.crv_apr_max == 8.75
    assert seeded.incentive_apr == pytest.approx(5.0)
    assert meta["0xaa"] == ("ARB", 18, 1.5)
    assert meta["0xbb"] == ("USDC", 6, 1.0)


def test_crv_in_the_reward_list_is_not_counted_twice() -> None:
    seeded, meta = seed_from_detail(
        staked(),
        {
            "crv_apr": 3.0,
            "extra_rewards_apr": [
                {"address": "0xCRV", "symbol": "CRV", "price": 0.5, "apr": 9.0},
                {"address": "0xAA", "symbol": "ARB", "price": 1.5, "apr": 4.0},
            ],
        },
    )
    assert seeded.incentive_apr == pytest.approx(4.0)
    assert "0xcrv" not in meta


def test_a_payload_with_no_rewards_seeds_cleanly() -> None:
    seeded, meta = seed_from_detail(staked(), {})
    assert (seeded.crv_apr, seeded.incentive_apr, meta) == (0.0, 0.0, {})


async def test_a_read_that_failed_everywhere_is_not_a_page_of_zeros() -> None:
    """`_batch` answers `None` per call that failed, and `or 0` made that
    indistinguishable from a gauge that owes nothing -- so a transport
    that was down showed "Unclaimed rewards: $0.00" and nothing to claim."""
    from curve.earnings import Earning, read_earnings
    from wallet.base import WalletError

    class Down:
        async def call(self, _to, _data):
            raise WalletError("no node answered")

    positions = [Earning(pool="0x" + "11" * 20, gauge="0x" + "22" * 20, staked=10**18)]

    with pytest.raises(WalletError, match="Could not read"):
        await read_earnings(Down(), "0x" + "aa" * 20, positions)
