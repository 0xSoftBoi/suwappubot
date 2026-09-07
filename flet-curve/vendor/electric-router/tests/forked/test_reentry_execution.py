"""Does the reentry walk survive being executed?

Every other route in this system is adjudicated by the chain: the quoter walks it
and the answer that counts is the one that comes back.  A route that enters one
pool twice cannot be, because a view-only quoter cannot see its own earlier leg
-- the entire reason `_stateful_leg` exists.  So the walk is the *only* thing
standing between a reentry route and a transaction.

This checks it against real `exchange`, `add_liquidity` and
`remove_liquidity_one_coin` against 3pool on a fork, in the order the router
emitted them.  It is the test that would have caught the withdrawal burning
against a pre-deposit supply -- worth 107 bp on crvUSD -> sDOLA at 2M, and worth
free money to the solver, which duly went and found it.

The tolerance is one basis point rather than one wei: the walk prices in floats
by design (5.4e-4 bp on 263 mainnet stableswaps), so wei-exactness is not the
claim.  The claim is that the *state* is carried, and a dropped mint is 125 bp.
"""

from __future__ import annotations

import boa
import pytest

from erouter.chain.exact_probe import ExactQuoterClient
from erouter.chain.lp_params import build_exact_lp
from erouter.chain.stable_params import build_exact_pools
from erouter.core.types import ArcKind, Leg
from erouter.dev.universe import parse_universe, read_balances, resolve_dialects, resolve_lp_tokens

pytestmark = pytest.mark.forked

POOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"
CRV3 = "0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490"
DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F"
USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7"

DAI_INDEX, USDT_INDEX = 0, 2
SWAP_IN = 200_000 * 10**6        # USDT, 6 decimals
DEPOSIT_IN = 1_500_000 * 10**6
TOLERANCE_BP = 1.0

POOL_ABI = """[
 {"name":"exchange","outputs":[],"inputs":[
   {"type":"int128","name":"i"},{"type":"int128","name":"j"},
   {"type":"uint256","name":"dx"},{"type":"uint256","name":"min_dy"}],
  "stateMutability":"nonpayable","type":"function"},
 {"name":"add_liquidity","outputs":[],"inputs":[
   {"type":"uint256[3]","name":"amounts"},
   {"type":"uint256","name":"min_mint_amount"}],
  "stateMutability":"nonpayable","type":"function"},
 {"name":"remove_liquidity_one_coin","outputs":[],"inputs":[
   {"type":"uint256","name":"_token_amount"},{"type":"int128","name":"i"},
   {"type":"uint256","name":"min_amount"}],
  "stateMutability":"nonpayable","type":"function"}]"""

# `approve` is declared as returning nothing, which is USDT's spelling and the
# only one this file calls.  `totalSupply` is here because `boa.deal` writes it.
ERC20_ABI = """[
 {"name":"balanceOf","outputs":[{"type":"uint256","name":""}],
  "inputs":[{"type":"address","name":"o"}],
  "stateMutability":"view","type":"function"},
 {"name":"totalSupply","outputs":[{"type":"uint256","name":""}],
  "inputs":[],"stateMutability":"view","type":"function"},
 {"name":"decimals","outputs":[{"type":"uint8","name":""}],
  "inputs":[],"stateMutability":"view","type":"function"},
 {"name":"approve","outputs":[],
  "inputs":[{"type":"address","name":"s"},{"type":"uint256","name":"v"}],
  "stateMutability":"nonpayable","type":"function"}]"""


def leg(kind, i, j):
    return Leg(target=POOL, kind=kind, i=i, j=j, n=3,
               src_slot=0, dst_slot=1, bps=0)


SWAP = leg(ArcKind.SWAP_STABLE, USDT_INDEX, DAI_INDEX)
DEPOSIT = leg(ArcKind.DEPOSIT_FIXED, USDT_INDEX, 0)
WITHDRAW = leg(ArcKind.WITHDRAW_STABLE, 0, DAI_INDEX)


@pytest.fixture(scope="module")
def walk(chain, quoter_client, pools):
    """The model's stateful quoter for the three legs, in this order."""
    specs = [p for p in parse_universe(pools)
             if p.address.lower() == POOL.lower()]
    if not specs:
        pytest.skip("3pool not in the universe at this TVL floor")
    resolve_dialects(specs, quoter_client, chain)
    read_balances(specs, quoter_client)
    resolve_lp_tokens(specs, quoter_client, chain.chain_id)

    swaps = build_exact_pools(specs, quoter_client)
    if swaps.get(POOL) is None:
        pytest.skip("3pool's swap model did not reproduce at this block")
    lp = build_exact_lp(specs, swaps, quoter_client)
    if lp.get(POOL) is None:
        pytest.skip("3pool's LP model did not reproduce at this block")

    exact = ExactQuoterClient(quoter_client, swaps, lp=lp)
    assert POOL.lower() in exact.reentrant_pools, (
        "3pool is not reentrant, so this test would prove nothing")
    return exact._stateful_leg([SWAP, DEPOSIT, WITHDRAW])


@pytest.fixture(scope="module")
def forked_env(rpc):
    boa.fork(rpc.pin.url, block_identifier=rpc.block, allow_dirty=True)
    return boa.env


def _bp(got: int, want: int) -> float:
    return abs(got - want) / want * 10_000 if want else 0.0


def test_the_walk_matches_a_real_stateful_execution(forked_env, walk):
    """Swap, deposit, withdraw -- all three through 3pool, in one route."""
    pool = boa.loads_abi(POOL_ABI).at(POOL)
    dai = boa.loads_abi(ERC20_ABI).at(DAI)
    usdt = boa.loads_abi(ERC20_ABI).at(USDT)
    crv3 = boa.loads_abi(ERC20_ABI).at(CRV3)

    modelled = [walk(SWAP, SWAP_IN), walk(DEPOSIT, DEPOSIT_IN)]
    modelled.append(walk(WITHDRAW, modelled[1]))

    with boa.env.anchor():
        who = boa.env.generate_address()
        boa.env.set_balance(who, 10**20)
        boa.deal(usdt, who, SWAP_IN + DEPOSIT_IN)
        with boa.env.prank(who):
            usdt.approve(POOL, 2**256 - 1)

            before = dai.balanceOf(who)
            pool.exchange(USDT_INDEX, DAI_INDEX, SWAP_IN, 0)
            swapped = dai.balanceOf(who) - before

            before = crv3.balanceOf(who)
            pool.add_liquidity([0, 0, DEPOSIT_IN], 0)
            minted = crv3.balanceOf(who) - before

            before = dai.balanceOf(who)
            pool.remove_liquidity_one_coin(minted, DAI_INDEX, 0)
            withdrawn = dai.balanceOf(who) - before

    executed = [swapped, minted, withdrawn]
    names = ("swap USDT->DAI", "deposit USDT->3Crv", "withdraw 3Crv->DAI")
    worst = max(_bp(m, e) for m, e in zip(modelled, executed, strict=True))
    detail = "\n".join(
        f"    {name:22} modelled {m:>28,}  executed {e:>28,}  {_bp(m, e):+.4f} bp"
        for name, m, e in zip(names, modelled, executed, strict=True))
    assert worst < TOLERANCE_BP, (
        f"the reentry walk disagrees with execution by {worst:.4f} bp:\n{detail}")


def test_the_route_beats_neither_nothing_nor_itself(forked_env):
    """Deposit-and-withdraw through one pool must not manufacture value.

    The failure that motivated all of this: 2M USDT in, more than 2M DAI out,
    because the burn was priced against a supply that did not include the mint.
    Two imbalance fees are cheaper than a swap's flat fee on 3pool -- `fee * n /
    (4(n-1))` is 3/8 of it, twice -- so the round trip genuinely can win, and the
    test is that it wins by *fees*, not by conjuring principal.
    """
    pool = boa.loads_abi(POOL_ABI).at(POOL)
    dai = boa.loads_abi(ERC20_ABI).at(DAI)
    usdt = boa.loads_abi(ERC20_ABI).at(USDT)
    crv3 = boa.loads_abi(ERC20_ABI).at(CRV3)

    with boa.env.anchor():
        who = boa.env.generate_address()
        boa.env.set_balance(who, 10**20)
        boa.deal(usdt, who, DEPOSIT_IN)
        with boa.env.prank(who):
            usdt.approve(POOL, 2**256 - 1)
            pool.add_liquidity([0, 0, DEPOSIT_IN], 0)
            minted = crv3.balanceOf(who)
            before = dai.balanceOf(who)
            pool.remove_liquidity_one_coin(minted, DAI_INDEX, 0)
            out = dai.balanceOf(who) - before

    paid = DEPOSIT_IN * 10**12          # USDT -> DAI decimals
    assert out < paid, (
        f"deposit-and-withdraw returned {out} for {paid}: a round trip "
        "through one pool cannot pay more than it took")
