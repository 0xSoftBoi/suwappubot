"""Every transaction this app can send, run against a forked mainnet."""

from __future__ import annotations

import pytest

from curve import abi, earnings
from curve.models import Pool
from curve.multicall import MULTICALL3
from curve.pool import PoolContract
from curve.rewards import CRV_DECIMALS
from ui.actions import (
    ClaimTab,
    DepositTab,
    StakeTab,
    SwapTab,
    WithdrawTab,
    claimable,
)

pytestmark = pytest.mark.fork

# -- the pool ---------------------------------------------------------------

POOL = "0xD001aE433f254283FeCE51d4ACcE8c53263aa186"   # RLUSD/USDC, stable-ng
LP_TOKEN = POOL                                        # NG pools are their own LP
GAUGE = "0xfc3212bd9ad9a28da6b2bd50a2918969c126894f"
USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
RLUSD = "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD"

#: Found by scanning the gauge's transfer log for accounts with both kinds
#: of reward outstanding -- see the finder in the commit message.
STAKER = "0xd85f8f0ea94e27f94a0ab1e106c90724c31c1a03"

CRV = "0xD533a949740bb3306d119CC777fa900bA034cd52"
MINTER = "0xd061D61a4d941c39E5453435B6345Dc261C2fcE0"


def make_pool() -> Pool:
    """The pool as the API describes it, minus what these tests do not read."""
    return Pool.from_v2(
        {
            "address": POOL,
            "pool_type": "stableswapng",
            "lp_token_address": LP_TOKEN,
            "chain_id": 1,
            "chain": "ethereum",
            "gauges": [GAUGE],
            "coins": [
                {"symbol": "USDC", "address": USDC, "decimals": 6, "pool_index": 0},
                {"symbol": "RLUSD", "address": RLUSD, "decimals": 18, "pool_index": 1},
            ],
        }
    ).merge_detail(
        {
            "n_coins": 2,
            "coins": [
                {"symbol": "USDC", "address": USDC, "decimals": 6, "pool_index": 0},
                {"symbol": "RLUSD", "address": RLUSD, "decimals": 18, "pool_index": 1},
            ],
        }
    )


class StubPage:
    """The panels touch `page` only to redraw, which nothing here watches."""

    def update(self) -> None:
        pass

    def run_task(self, *_args, **_kwargs) -> None:
        pass


async def _noop() -> None:
    pass


def panel(kind, fork, account: str):
    """One action panel, bound to the fork and acting as `account`."""
    pool = make_pool()
    contract = PoolContract(fork.provider(), pool, account)
    tab = kind(StubPage(), pool, lambda: contract, _noop)
    tab.slippage.value = "1"
    return tab, contract


async def confirm(fork, tx: str) -> dict:
    """The receipt, once it exists, asserting the transaction succeeded."""
    return fork.wait(tx)


# -- claiming ---------------------------------------------------------------


async def test_claiming_moves_both_kinds_of_reward(fork) -> None:
    fork.give_eth(STAKER)
    fork.advance()
    fork.warm(GAUGE, abi.encode_claimable_tokens(STAKER))
    tab, contract = panel(ClaimTab, fork, STAKER)
    await tab.refresh()

    if not tab.available:
        pytest.skip(f"{STAKER} has nothing staked any more")
    owed_crv = tab.crv_claimable
    owed_extra = {token.lower(): amount for token, _s, _d, amount in tab.extras}
    assert owed_crv > 0, "fixture account should have CRV accruing"
    assert any(owed_extra.values()), "fixture account should have an incentive token"

    crv_before = fork.erc20_balance(CRV, STAKER)
    rlusd_before = fork.erc20_balance(RLUSD, STAKER)

    await confirm(fork, await tab.submit(contract))

    crv_gained = fork.erc20_balance(CRV, STAKER) - crv_before
    rlusd_gained = fork.erc20_balance(RLUSD, STAKER) - rlusd_before
    assert crv_gained >= owed_crv, f"CRV: got {crv_gained}, owed {owed_crv}"
    assert rlusd_gained >= owed_extra.get(RLUSD.lower(), 0) > 0


async def test_the_portfolio_claims_incentives_through_multicall(fork) -> None:
    fork.give_eth(STAKER)
    fork.advance()
    fork.warm(GAUGE, abi.encode_claim_rewards_for(STAKER))

    before = fork.erc20_balance(RLUSD, STAKER)
    plan = earnings.ClaimPlan(extras=(GAUGE,))
    sent = await earnings.send_claims(fork.provider(), STAKER, plan, crv=False)

    assert len(sent) == 1, "every gauge goes in one transaction"
    receipt = await confirm(fork, sent[0])
    assert receipt["to"].lower() == MULTICALL3.lower()
    gained = fork.erc20_balance(RLUSD, STAKER) - before
    assert gained > 0, (
        "Multicall3 claimed and the staker got nothing -- either the gauge "
        "paid its caller, or the batch swallowed a failed call"
    )


async def test_a_claim_that_cannot_pay_takes_the_batch_down(fork) -> None:
    fork.give_eth(STAKER)
    plan = earnings.ClaimPlan(extras=(GAUGE, RLUSD))  # a token, not a gauge
    sent = await earnings.send_claims(fork.provider(), STAKER, plan, crv=False)

    receipt = fork.wait(sent[0], require_success=False)
    assert int(receipt["status"], 16) == 0, (
        "a call that cannot succeed was mined as a success -- allowFailure "
        "is back on, and a refused claim now looks like a claimed one"
    )


async def test_claiming_takes_all_but_the_next_block_s_worth(fork) -> None:
    fork.give_eth(STAKER)
    fork.advance()
    fork.warm(GAUGE, abi.encode_claimable_tokens(STAKER))
    tab, contract = panel(ClaimTab, fork, STAKER)
    await tab.refresh()
    if not tab.available:
        pytest.skip(f"{STAKER} has nothing staked any more")
    owed = tab.crv_claimable

    await confirm(fork, await tab.submit(contract))
    await tab.refresh()

    assert tab.crv_claimable < owed // 1000, (
        f"{tab.crv_claimable} still owed against {owed} claimed -- that is not "
        "one block's accrual, the mint did not take it"
    )
    assert not claimable(tab.crv_claimable, CRV_DECIMALS)


# -- staking ----------------------------------------------------------------


async def test_unstaking_returns_lp_to_the_wallet(fork) -> None:
    fork.give_eth(STAKER)
    tab, contract = panel(StakeTab, fork, STAKER)
    await tab.refresh()
    assert tab.staked > 0, "fixture account should hold a staked position"

    amount = tab.staked // 10
    lp_before = fork.erc20_balance(LP_TOKEN, STAKER)
    tab.direction.value = "unstake"
    tab.amount.value = str(amount / 10**18)

    await confirm(fork, await tab.submit(contract))

    gained = fork.erc20_balance(LP_TOKEN, STAKER) - lp_before
    assert gained > 0
    assert abs(gained - tab._amount_units()) < 10**12  # parsing rounds, not the chain


async def test_staking_puts_lp_into_the_gauge(fork) -> None:
    fork.give_eth(STAKER)
    tab, contract = panel(StakeTab, fork, STAKER)
    await tab.refresh()
    tab.direction.value = "unstake"
    tab.amount.value = str((tab.staked // 10) / 10**18)
    await confirm(fork, await tab.submit(contract))

    await tab.refresh()
    assert tab.lp_balance > 0
    staked_before = tab.staked
    tab.direction.value = "stake"
    tab.amount.value = str((tab.lp_balance // 2) / 10**18)

    pending = await tab.approval_needed(contract)
    if pending is not None:
        token, spender, amount = pending
        await confirm(fork, await contract.approve(token, spender, amount))
    await confirm(fork, await tab.submit(contract))

    await tab.refresh()
    assert tab.staked > staked_before


# -- withdrawing ------------------------------------------------------------


async def test_withdrawing_staked_lp_unstakes_first(fork) -> None:
    fork.give_eth(STAKER)
    tab, contract = panel(WithdrawTab, fork, STAKER)
    await tab.refresh()
    assert tab.staked > 0

    assert tab.use_staked.visible is True
    tab.use_staked.value = True
    tab.mode.value = "one"
    tab.coin_picker.value = "0"  # USDC
    amount = tab.staked // 100
    tab.amount.value = str(amount / 10**18)

    usdc_before = fork.erc20_balance(USDC, STAKER)
    staked_before = tab.staked

    await confirm(fork, await tab.submit(contract))

    assert fork.erc20_balance(USDC, STAKER) > usdc_before, "no USDC arrived"
    await tab.refresh()
    assert tab.staked < staked_before, "nothing left the gauge"


async def test_a_balanced_withdrawal_returns_both_coins(fork) -> None:
    fork.give_eth(STAKER)
    tab, contract = panel(WithdrawTab, fork, STAKER)
    await tab.refresh()
    tab.use_staked.value = True
    tab.mode.value = "balanced"
    tab.amount.value = str((tab.staked // 100) / 10**18)

    before = (fork.erc20_balance(USDC, STAKER), fork.erc20_balance(RLUSD, STAKER))
    await confirm(fork, await tab.submit(contract))
    after = (fork.erc20_balance(USDC, STAKER), fork.erc20_balance(RLUSD, STAKER))

    assert after[0] > before[0] and after[1] > before[1]


# -- depositing -------------------------------------------------------------


async def test_depositing_mints_lp(fork) -> None:
    fork.give_eth(STAKER)
    fund = 10_000 * 10**6
    fork.fund_erc20(USDC, POOL, STAKER, fund)

    tab, contract = panel(DepositTab, fork, STAKER)
    await tab.refresh()
    tab.fields[0].value = "1000"

    lp_before = fork.erc20_balance(LP_TOKEN, STAKER)
    pending = await tab.approval_needed(contract)
    if pending is not None:
        await confirm(fork, await contract.approve(*pending))
    await confirm(fork, await tab.submit(contract))

    assert fork.erc20_balance(LP_TOKEN, STAKER) > lp_before


async def test_deposit_and_stake_is_one_transaction_and_skips_the_wallet(fork) -> None:
    fork.give_eth(STAKER)
    fork.fund_erc20(USDC, POOL, STAKER, 10_000 * 10**6)

    tab, contract = panel(DepositTab, fork, STAKER)
    tab.stake_box.value = True
    assert tab.combined is True, "Ethereum has a deposit-and-stake zap"
    await tab.refresh()
    tab.fields[0].value = "1000"

    lp_before = fork.erc20_balance(LP_TOKEN, STAKER)
    staked_before = fork.erc20_balance(GAUGE, STAKER)

    pending = await tab.approval_needed(contract)
    if pending is not None:
        token, spender, amount = pending
        assert spender.lower() == tab.stake_zap.address.lower(), (
            "the stake zap is what moves the coins, so it is what gets approved"
        )
        await confirm(fork, await contract.approve(token, spender, amount))
    await confirm(fork, await tab.submit(contract))

    assert fork.erc20_balance(GAUGE, STAKER) > staked_before, "nothing was staked"
    assert fork.erc20_balance(LP_TOKEN, STAKER) == lp_before, (
        "LP passed through the wallet -- that is the two-transaction path"
    )


# -- swapping ---------------------------------------------------------------


async def test_swapping_one_coin_for_the_other(fork) -> None:
    fork.give_eth(STAKER)
    fork.fund_erc20(USDC, POOL, STAKER, 10_000 * 10**6)

    tab, contract = panel(SwapTab, fork, STAKER)
    await tab.refresh()
    tab.amount.value = "1000"

    rlusd_before = fork.erc20_balance(RLUSD, STAKER)
    pending = await tab.approval_needed(contract)
    if pending is not None:
        await confirm(fork, await contract.approve(*pending))
    await confirm(fork, await tab.submit(contract))

    assert fork.erc20_balance(RLUSD, STAKER) > rlusd_before
