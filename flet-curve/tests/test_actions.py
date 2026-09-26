"""The action panels' calldata, without a running page."""

from __future__ import annotations

import math

import flet as ft
import pytest

from curve import abi
from curve.models import Pool
from curve.pool import PoolContract
from ui.actions import WithdrawTab
from ui.typography import BODY
from wallet.base import RpcError, WalletProvider

ACCOUNT = "0x1111111111111111111111111111111111111111"
POOL_ADDRESS = "0x390f3595bCa2df7D23783DFd126427CCeb997BF4"
LP_TOKEN = "0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490"

#: Reserves, in human numbers, as the API reports them.
USDT_RESERVE = 1_000_000.0
CRVUSD_RESERVE = 2_000_000.0
#: LP tokens outstanding. Deliberately not the sum of the reserves.
LP_SUPPLY = 1_500_000 * 10**18


def word(value: int) -> str:
    return "0x" + f"{value:064x}"


class FakeProvider(WalletProvider):
    """Answers `eth_call` by selector and records what was sent."""

    def __init__(self, answers: dict[str, str] | None = None) -> None:
        self.answers = answers or {}
        self.sent: list[dict] = []
        self.estimated: list[dict] = []
        self.default = word(0)
        self.raise_on_call: Exception | None = None
        self.chain = 1

    async def request(self, method: str, params=None):
        params = params or []
        if method == "eth_chainId":
            return hex(self.chain)
        if method == "eth_call":
            if self.raise_on_call is not None:
                raise self.raise_on_call
            return self.answers.get(params[0]["data"][:10], self.default)
        if method == "eth_estimateGas":
            self.estimated.append(params[0])
            return "0x30d40"
        if method == "eth_sendTransaction":
            self.sent.append(params[0])
            return "0x" + "cd" * 32
        raise AssertionError(f"unexpected method {method}")


class StubPage:
    """Enough of `ft.Page` for a panel that never redraws."""

    def update(self) -> None:
        pass

    def run_task(self, *_args, **_kwargs) -> None:
        pass


def make_pool(registry: str = "crvusd") -> Pool:
    pool = Pool.from_v2(
        {
            "address": POOL_ADDRESS,
            "pool_type": registry,
            "lp_token_address": LP_TOKEN,
            "gauges": [],
            "coins": [
                {"symbol": "USDT", "address": "0x" + "aa" * 20, "decimals": 6},
                {"symbol": "crvUSD", "address": "0x" + "bb" * 20, "decimals": 18},
            ],
        }
    )
    return pool.merge_detail(
        {
            "n_coins": 2,
            "balances": [USDT_RESERVE, CRVUSD_RESERVE],
            "coins": [
                {"symbol": "USDT", "address": "0x" + "aa" * 20, "decimals": 6},
                {"symbol": "crvUSD", "address": "0x" + "bb" * 20, "decimals": 18},
            ],
        }
    )


def make_tab(provider: FakeProvider) -> WithdrawTab:
    pool = make_pool()
    contract = PoolContract(provider, pool, ACCOUNT)
    tab = WithdrawTab(StubPage(), pool, lambda: contract, None)
    tab.slippage.value = "1"
    return tab


def words_of(data: str) -> list[int]:
    """The 32-byte words of some calldata, selector stripped."""
    body = data[10:]
    return [int(body[i : i + 64], 16) for i in range(0, len(body), 64)]


class ReservedProvider(FakeProvider):
    """A pool that answers `balances(i)` in one of the two spellings."""

    def __init__(self, reserves: list[int], *, old: bool = False, **kw) -> None:
        # totalSupply, and an LP balance so the panel quotes rather
        # than reporting an empty wallet over the top of the
        # estimate.
        super().__init__(
            {"0x18160ddd": word(LP_SUPPLY), "0x70a08231": word(LP_SUPPLY), **kw}
        )
        self.reserves = reserves
        self.refuse_reserves = False
        self.refuse_quote_all = False
        mine, theirs = ("balances(int128)", "balances(uint256)")
        if not old:
            mine, theirs = theirs, mine
        self.selector = "0x" + abi.selector(mine)
        self.wrong = "0x" + abi.selector(theirs)

    async def request(self, method: str, params=None):
        if method == "eth_call":
            data = (params or [{}])[0].get("data", "")
            if data.startswith(self.selector):
                if self.refuse_reserves:
                    raise RpcError(-32000, "execution reverted")
                index = words_of(data)[0]
                if index < len(self.reserves):
                    return word(self.reserves[index])
            if self.refuse_quote_all and data.startswith(
                "0x" + abi.selector("calc_withdraw_one_coin(uint256,int128)")
            ):
                raise RpcError(-32000, "execution reverted")
            if data.startswith(self.wrong):
                raise RpcError(-32000, "execution reverted")
        return await super().request(method, params)


#: Integer multiplication, not `float * 10**18` -- the latter loses the low
#: digits and makes an exact share impossible to assert.
RESERVES = [int(USDT_RESERVE) * 10**6, int(CRVUSD_RESERVE) * 10**18]


@pytest.mark.parametrize("old", [False, True], ids=["uint256", "int128"])
async def test_balanced_withdrawal_floors_each_coin_at_its_share(old: bool) -> None:
    provider = ReservedProvider(RESERVES, old=old)
    tab = make_tab(provider)
    tab.amount.value = "150000"  # a tenth of the supply

    contract = tab.get_contract()
    await tab.submit(contract)

    amount, usdt_min, crvusd_min = words_of(provider.sent[-1]["data"])
    assert amount == 150_000 * 10**18
    assert usdt_min == pytest.approx(100_000 * 10**6 * 0.99, rel=1e-9)
    assert crvusd_min == pytest.approx(200_000 * 10**18 * 0.99, rel=1e-9)


async def test_a_balanced_withdrawal_previews_every_coin_it_pays() -> None:
    tab = make_tab(ReservedProvider(RESERVES))
    tab.mode.value = "balanced"
    tab.amount.value = "150000"          # a tenth of the supply

    await tab.refresh()

    assert tab.estimate.value == "-> 100,000.00 USDT  +  200,000.00 crvUSD"


async def test_the_preview_and_the_floor_are_the_same_numbers() -> None:
    provider = ReservedProvider(RESERVES)
    tab = make_tab(provider)
    tab.mode.value = "balanced"
    tab.amount.value = "150000"

    shares = await tab.balanced_shares(tab.get_contract(), 150_000 * 10**18)
    await tab.submit(tab.get_contract())

    _amount, usdt_min, crvusd_min = words_of(provider.sent[-1]["data"])
    assert shares == [100_000 * 10**6, 200_000 * 10**18]
    assert usdt_min == pytest.approx(shares[0] * 0.99, rel=1e-9)
    assert crvusd_min == pytest.approx(shares[1] * 0.99, rel=1e-9)


async def test_a_pool_that_will_not_say_its_reserves_previews_nothing() -> None:
    provider = ReservedProvider(RESERVES)
    provider.refuse_reserves = True
    tab = make_tab(provider)
    tab.mode.value = "balanced"
    tab.amount.value = "150000"

    await tab.refresh()

    assert tab.estimate.value == ""


# -- the mark beside the amount --------------------------------------------
# An amount and the token it is in are one fact.


def marks_on(tab) -> list:
    """The token marks drawn on the estimate line, in order."""
    from ui.actions import ESTIMATE_MARK

    found = []
    for control in tab.estimate_line.controls:
        for child in getattr(control, "controls", []):
            if getattr(child, "width", None) == ESTIMATE_MARK:
                found.append(child)
    return found


async def test_every_coin_of_a_balanced_withdrawal_is_marked() -> None:
    tab = make_tab(ReservedProvider(RESERVES))
    tab.mode.value = "balanced"
    tab.amount.value = "150000"

    await tab.refresh()

    assert len(marks_on(tab)) == 2, "one per coin paid out"
    assert tab.estimate.value == "-> 100,000.00 USDT  +  200,000.00 crvUSD"


async def test_a_one_coin_withdrawal_marks_the_coin_it_pays() -> None:
    provider = ReservedProvider(
        RESERVES,
        **{"0x" + abi.selector("calc_withdraw_one_coin(uint256,int128)"): word(99 * 10**6)},
    )
    tab = make_tab(provider)
    tab.mode.value = "one"
    tab.coin_picker.value = "0"
    tab.amount.value = "100"

    await tab.refresh()

    assert len(marks_on(tab)) == 1
    assert "USDT" in tab.estimate.value


async def test_a_swap_marks_the_coin_it_pays_out() -> None:
    tab = swap_tab(CurvedProvider())
    tab.amount.value = "1000"

    await tab.refresh()

    assert len(marks_on(tab)) == 1
    assert "crvUSD" in tab.estimate.value, "the coin on the receiving side"


async def test_a_deposit_is_marked_with_the_pool_it_buys_into() -> None:
    from ui.actions import ESTIMATE_MARK

    provider = FakeProvider({"0x" + abi.selector("calc_token_amount(uint256[2],bool)"):
                             word(5 * 10**18)})
    tab = deposit_tab(provider)
    tab.fields[0].value = "100"

    await tab.refresh()

    assert "LP" in tab.estimate.value
    stack = tab.estimate_line.controls[1].controls[0]
    assert stack.height == ESTIMATE_MARK
    assert stack.width > ESTIMATE_MARK


async def test_a_line_with_nothing_to_mark_is_still_just_words() -> None:
    provider = ReservedProvider(RESERVES)
    provider.refuse_quote_all = True
    tab = make_tab(provider)
    tab.mode.value = "one"
    tab.amount.value = "100"

    await tab.refresh()

    assert marks_on(tab) == []
    assert tab.estimate_line.controls == [tab.estimate]
    assert "reverted" in tab.estimate.value


async def test_a_zero_floor_is_sent_when_the_supply_cannot_be_read() -> None:
    provider = FakeProvider()
    provider.raise_on_call = RpcError(-32000, "execution reverted")
    tab = make_tab(provider)
    tab.amount.value = "1"

    await tab.submit(tab.get_contract())
    _amount, *floors = words_of(provider.sent[-1]["data"])
    assert floors == [0, 0]


async def test_the_supply_read_targets_the_lp_token() -> None:
    provider = FakeProvider({"0x18160ddd": word(LP_SUPPLY)})
    seen: list[str] = []

    original = provider.request

    async def spy(method, params=None):
        if method == "eth_call":
            seen.append(params[0]["to"])
        return await original(method, params)

    provider.request = spy  # type: ignore[method-assign]
    tab = make_tab(provider)
    tab.amount.value = "1"
    await tab.submit(tab.get_contract())
    assert LP_TOKEN in seen


async def test_withdrawing_nothing_is_refused_before_any_call() -> None:
    provider = FakeProvider()
    tab = make_tab(provider)
    tab.amount.value = ""
    with pytest.raises(Exception, match="Enter an amount"):
        await tab.submit(tab.get_contract())
    assert provider.sent == []


async def test_a_one_coin_withdrawal_floors_at_the_pool_s_own_quote() -> None:
    quote = "0x" + abi.selector("calc_withdraw_one_coin(uint256,int128)")
    provider = FakeProvider({quote: word(99 * 10**6)})
    tab = make_tab(provider)
    tab.amount.value = "100"
    tab.mode.value = "one"
    tab.coin_picker.value = "0"

    await tab.submit(tab.get_contract())
    sent = provider.sent[-1]["data"]
    assert sent.startswith(
        "0x" + abi.selector("remove_liquidity_one_coin(uint256,int128,uint256)")
    )
    amount, index, minimum = words_of(sent)
    assert (amount, index) == (100 * 10**18, 0)
    assert minimum == pytest.approx(99 * 10**6 * 0.99, rel=1e-9)


# -- how the panel is laid out ---------------------------------------------
# The amounts are the subject of these panels, so they get the panel's full
# width.


def tabs():
    """The four panels, on a pool with a gauge."""
    from ui.actions import DepositTab, StakeTab, SwapTab, WithdrawTab

    pool = make_pool()
    pool.gauge = "0x" + "cc" * 20
    page = StubPage()
    return [
        cls(page, pool, lambda: None, None)
        for cls in (DepositTab, WithdrawTab, SwapTab, StakeTab)
    ]


def widths_are_stretched(column) -> bool:
    import flet as ft

    return column.horizontal_alignment == ft.CrossAxisAlignment.STRETCH


def fields_of(control) -> list:
    """Every text field in a control tree."""
    import flet as ft

    found = []
    if isinstance(control, ft.TextField):
        found.append(control)
    for child in getattr(control, "controls", None) or []:
        found += fields_of(child)
    inner = getattr(control, "content", None)
    if isinstance(inner, ft.Control):
        found += fields_of(inner)
    return found


@pytest.mark.parametrize("index", range(4))
def test_every_panel_stretches_its_fields(index: int) -> None:
    tab = tabs()[index]
    assert widths_are_stretched(tab.mount())


def test_a_field_and_its_balance_line_stretch_together() -> None:
    tab = tabs()[0]
    tab.mount()
    pairs = [c for c in tab.control.controls if isinstance(c, ft.Column)]
    assert pairs and all(widths_are_stretched(pair) for pair in pairs)


def test_no_amount_field_sets_its_own_width() -> None:
    for tab in tabs():
        for field in fields_of(tab.mount()):
            if field is tab.slippage:
                continue
            assert field.width is None, f"{tab.title}: {field.label} pins its width"


def test_slippage_is_small_and_out_of_the_way() -> None:
    tab = tabs()[0]
    tab.mount()
    assert tab.slippage.width and tab.slippage.width <= 100
    assert tab.slippage.text_size and tab.slippage.text_size < BODY
    row = next(
        r
        for r in tab.control.controls
        if isinstance(r, ft.Row) and tab.slippage in (r.controls or [])
    )
    assert row.alignment == ft.MainAxisAlignment.END


def test_the_buttons_follow_the_fields_with_room_to_spare() -> None:
    from ui.actions import BUTTON_GAP

    for tab in tabs():
        frame = tab.mount()
        assert frame.controls[0] is tab.control
        assert frame.controls[-1] is tab.status_panel
        assert tab.control.spacing < BUTTON_GAP


def test_nothing_inside_the_panel_scrolls() -> None:
    for tab in tabs():
        frame = tab.mount()
        assert tab.control.scroll is None
        assert frame.scroll is None


def test_slippage_sits_with_the_amounts_not_with_the_button() -> None:
    for tab in tabs():
        if not tab.uses_slippage:
            continue
        frame = tab.mount()
        fields = tab.control.controls
        slippage_at = next(
            i
            for i, c in enumerate(fields)
            if isinstance(c, ft.Row) and tab.slippage in (c.controls or [])
        )
        assert slippage_at < fields.index(tab.estimate_panel)
        assert tab.control is frame.controls[0]
        assert [getattr(c, "content", c) for c in frame.controls[1:3]] == [
            tab.approve_button,
            tab.submit_button,
        ]


# -- filling a field with everything you have ------------------------------


def max_button(field: ft.TextField) -> ft.TextButton | None:
    return field.suffix_icon if isinstance(field.suffix_icon, ft.TextButton) else None


def test_every_amount_field_carries_its_own_max() -> None:
    for tab in tabs():
        amounts = [f for f in fields_of(tab.mount()) if f is not tab.slippage]
        assert amounts, f"{tab.title}: no amount field"
        for field in amounts:
            assert max_button(field), f"{tab.title}: {field.label} has no MAX"


def test_no_max_button_is_left_loose_in_the_panel() -> None:
    def loose_buttons(control) -> list:
        found = []
        if isinstance(control, ft.TextButton) and control.content == "MAX":
            found.append(control)
        for child in getattr(control, "controls", None) or []:
            found += loose_buttons(child)
        return found

    for tab in tabs():
        assert not loose_buttons(tab.mount()), f"{tab.title}: MAX outside its field"


def test_deposit_max_fills_that_coin_with_the_whole_balance() -> None:
    tab = tabs()[0]
    tab.mount()
    tab.balances = [1_500_000, 2 * 10**18]  # 1.5 USDT (6dp), 2 crvUSD (18dp)

    max_button(tab.fields[0]).on_click(None)
    assert tab.fields[0].value == "1.5"
    assert tab.fields[1].value in (None, "")

    max_button(tab.fields[1]).on_click(None)
    assert tab.fields[1].value == "2"


def test_max_keeps_every_decimal_the_token_has() -> None:
    tab = tabs()[0]
    tab.mount()
    tab.balances = [1_234_567, 0]  # 1.234567 USDT, more places than shown
    max_button(tab.fields[0]).on_click(None)
    assert tab.fields[0].value == "1.234567"


def test_swap_max_follows_the_coin_being_sold() -> None:
    _deposit, _withdraw, swap, _stake = tabs()
    swap.mount()
    swap.balance = 3 * 10**6  # 3 USDT, the first coin
    max_button(swap.amount).on_click(None)
    assert swap.amount.value == "3"

    swap.from_coin.value = "1"  # crvUSD, 18 decimals
    swap.balance = 4 * 10**18
    max_button(swap.amount).on_click(None)
    assert swap.amount.value == "4"


def test_stake_max_follows_the_direction() -> None:
    stake = tabs()[3]
    stake.mount()
    stake.lp_balance, stake.staked = 5 * 10**18, 7 * 10**18

    max_button(stake.amount).on_click(None)
    assert stake.amount.value == "5"

    stake.direction.value = "unstake"
    max_button(stake.amount).on_click(None)
    assert stake.amount.value == "7"


def test_staking_offers_no_slippage() -> None:
    deposit, _withdraw, _swap, stake = tabs()
    assert deposit.slippage in fields_of(deposit.mount())
    assert stake.slippage not in fields_of(stake.mount())


# -- slippage from the pool's own fee --------------------------------------
# A fixed 0.5% is arbitrary: it is loose for a stable pool charging 0.01% and
# no better than a guess for a crypto pool charging 1.5%.


class FeeProvider(FakeProvider):
    """Answers `fee()` and, optionally, `dynamic_fee(i, j)`."""

    def __init__(self, flat: int, pair: int | None = None) -> None:
        super().__init__()
        self.flat, self.pair = flat, pair
        self.reads: list[str] = []

    async def request(self, method: str, params=None):
        if method != "eth_call":
            return await super().request(method, params)
        data = (params or [{}])[0].get("data", "")
        self.reads.append(data[:10])
        if data.startswith("0x" + abi.selector("fee()")):
            return word(self.flat)
        if data.startswith("0x" + abi.selector("dynamic_fee(int128,int128)")):
            return word(self.pair) if self.pair is not None else "0x"
        return word(0)


def tab_with_fee(cls, flat: int, pair: int | None = None, registry: str = "crvusd"):
    pool = make_pool(registry=registry)
    pool.gauge = "0x" + "cc" * 20
    provider = FeeProvider(flat, pair)
    contract = PoolContract(provider, pool, ACCOUNT)
    tab = cls(StubPage(), pool, lambda: contract, None)
    tab.mount()
    return tab, provider


async def test_deposit_slippage_is_the_fee_plus_a_little() -> None:
    from ui.actions import DepositTab

    tab, _ = tab_with_fee(DepositTab, 1_500_000, registry="main")
    await tab.refresh()
    assert float(tab.slippage.value) == pytest.approx(0.02)


async def test_the_same_line_holds_whatever_the_implementation() -> None:
    from ui.actions import ESTIMATE_FEE_SHARE, QUOTE_DRIFT, DepositTab, slippage_for

    for registry in ("main", "factory", "crvusd", "stableswapng", "twocryptong", "new-2027"):
        tab, _ = tab_with_fee(DepositTab, 1_000_000, registry=registry)
        await tab.refresh()
        expected = slippage_for(1_000_000, ESTIMATE_FEE_SHARE, QUOTE_DRIFT)
        assert float(tab.slippage.value) == pytest.approx(expected), registry


async def test_a_tiny_fee_still_gets_the_drift_allowance() -> None:
    from ui.actions import QUOTE_DRIFT, DepositTab

    tab, _ = tab_with_fee(DepositTab, 100_000, registry="stableswapng")
    await tab.refresh()
    assert float(tab.slippage.value) == pytest.approx(0.001 + QUOTE_DRIFT)


async def test_withdrawing_uses_the_flat_fee_too() -> None:
    from ui.actions import WithdrawTab

    tab, provider = tab_with_fee(WithdrawTab, 1_000_000, pair=9_999_999)
    await tab.refresh()
    assert float(tab.slippage.value) == pytest.approx(0.01 + 0.005)
    assert "0x" + abi.selector("dynamic_fee(int128,int128)") not in provider.reads


async def test_swapping_stays_tight_because_its_quote_is_exact() -> None:
    from ui.actions import SwapTab

    tab, _ = tab_with_fee(SwapTab, 1_000_000, pair=2_000_000)
    await tab.refresh()
    assert tab.slippage.value == "0.004"  # from the pair fee, not the flat one


async def test_a_swap_pool_without_dynamic_fee_falls_back() -> None:
    from ui.actions import SwapTab

    tab, _ = tab_with_fee(SwapTab, 4_577_514)  # no pair fee
    await tab.refresh()
    assert tab.slippage.value == "0.00916"


async def test_a_deposit_is_always_given_more_room_than_a_swap() -> None:
    from ui.actions import DepositTab, SwapTab

    for registry in ("main", "crvusd", "stableswapng", "factory_tricrypto"):
        deposit, _ = tab_with_fee(DepositTab, 1_000_000, registry=registry)
        swap, _ = tab_with_fee(SwapTab, 1_000_000, registry=registry)
        await deposit.refresh()
        await swap.refresh()
        assert float(deposit.slippage.value) > float(swap.slippage.value), registry


async def test_changing_the_pair_re_reads_the_fee() -> None:
    from ui.actions import SwapTab

    tab, provider = tab_with_fee(SwapTab, 1_000_000, pair=2_000_000)
    await tab.refresh()
    first = provider.reads.count("0x" + abi.selector("dynamic_fee(int128,int128)"))

    tab.to_coin.value = "0"
    await tab.refresh()
    assert provider.reads.count("0x" + abi.selector("dynamic_fee(int128,int128)")) > first


async def test_the_fee_is_read_once_per_pair_not_per_keystroke() -> None:
    from ui.actions import DepositTab

    tab, provider = tab_with_fee(DepositTab, 1_500_000)
    for _ in range(4):
        await tab.refresh()
    assert provider.reads.count("0x" + abi.selector("fee()")) == 1


async def test_what_the_user_typed_is_never_overwritten() -> None:
    from ui.actions import DepositTab

    tab, _ = tab_with_fee(DepositTab, 1_500_000)
    tab.slippage.value = "1.5"
    tab._slippage_edited(None)  # the field's own on_change

    await tab.refresh()
    assert tab.slippage.value == "1.5"


async def test_a_pool_that_will_not_answer_keeps_the_default() -> None:
    from ui.actions import DEFAULT_SLIPPAGE, DepositTab

    tab, _ = tab_with_fee(DepositTab, 0)  # fee() answers zero
    await tab.refresh()
    assert tab.slippage.value == str(DEFAULT_SLIPPAGE)


async def test_staking_reads_no_fee_at_all() -> None:
    from ui.actions import StakeTab

    tab, provider = tab_with_fee(StakeTab, 1_500_000)
    await tab.refresh()
    assert "0x" + abi.selector("fee()") not in provider.reads


async def test_the_line_covers_every_measured_pool() -> None:
    from ui.actions import ESTIMATE_FEE_SHARE, QUOTE_DRIFT, slippage_for

    measured = [                      # (fee in 1e10 units, needed %)
    (  15_000_000,  0.13696),   # cvxCrv/Crv             factory
    (   1_500_000,  0.00952),   # DAI/USDC/USDT          main
    (   4_000_000,  0.00537),   # alETHfrxETH            factory
    (   4_000_000,  0.00220),   # msETH/WETH             factory
    (     207_000,  0.00035),   # TricryptoUSDT          factory_tricrypto
    (  10_000_000,  0.00013),   # USDS/stUSDS            stableswapng
    (   1_000_000,  0.00012),   # DOLA/sUSDe             stableswapng
    (   1_000_000,  0.00012),   # AUSD/USDC              stableswapng
    (   4_000_000,  0.00012),   # BOLD/USDC Pool         stableswapng
    (   1_000_000,  0.00012),   # FRAX/frxUSD            stableswapng
    (   1_000_000,  0.00012),   # NUSD/USDC              stableswapng
    (   1_000_000,  0.00012),   # PayPool                stableswapng
    (   2_000_000,  0.00012),   # RLUSD/USDC             stableswapng
    (   3_000_000,  0.00012),   # TricryptoUSDC          factory_tricrypto
    (   4_000_000,  0.00012),   # USD0/USD0++            stableswapng
    (   1_000_000,  0.00012),   # USDC/USDat             stableswapng
    (   1_000_000,  0.00012),   # USDC/fxUSD             stableswapng
    (   1_000_000,  0.00012),   # USDG/USDC              stableswapng
    (   1_000_000,  0.00012),   # USDtb-USDC             stableswapng
    (  60_000_000,  0.00012),   # YB WETH                twocryptong
    ( 100_000_000,  0.00012),   # YB cbBTC               twocryptong
    ( 100_000_000,  0.00012),   # YB tBTC                twocryptong
    (  20_000_000,  0.00012),   # apxUSD-USDC v3         stableswapng
    (   1_000_000,  0.00012),   # crvUSD/frxUSD          stableswapng
    (   4_000_000,  0.00012),   # frxUSD/msUSD           stableswapng
    (   1_000_000,  0.00012),   # frxUSD/trUSD           stableswapng
    (   1_000_000,  0.00012),   # sfrxUSD/frxUSD         stableswapng
    (   1_000_000,  0.00012),   # strUSD/trUSD           stableswapng
    (   1_000_000,  0.00012),   # tBTC/WBTC              crvusd
    (   1_000_000,  0.00012),   # trUSD/USDC             stableswapng
    (   2_000_000,  0.00000),   # sDAI/sUSDe             stableswapng
    (   1_000_000,  0.00000),   # DOLA/sUSDS             stableswapng
    (   2_000_000,  0.00000),   # reUSD/scrvUSD          stableswapng
    (   2_000_000,  0.00000),   # ETH+/ETH               stableswapng
    (   1_000_000,  0.00000),   # FRAXUSDe               stableswapng
    (     100_000,  0.00000),   # Strategic USD Reserv   stableswapng
    (   1_000_000,  0.00000),   # TricryptoLLAMA         factory_tricrypto
    (           0,  0.00000),   # USAT/USDT              stableswapng
    (   3_000_000,  0.00000),   # USD-BTC-ETH            crypto
    ( 100_000_000,  0.00000),   # YB WBTC                twocryptong
    (  20_000_000,  0.00000),   # apyUSD-apxUSD          stableswapng
    (   1_000_000,  0.00000),   # crvUSD/USDC            crvusd
    (   1_000_000,  0.00000),   # crvUSD/USDT            crvusd
    (   2_000_000,  0.00000),   # osETH/rETH             stableswapng
    ]
    for fee, needed in measured:
        allowed = slippage_for(fee, ESTIMATE_FEE_SHARE, QUOTE_DRIFT)
        assert allowed >= needed, f"fee {fee}: allows {allowed}, needs {needed}"


def test_the_slope_is_one_whole_fee() -> None:
    from ui.actions import ESTIMATE_FEE_SHARE, QUOTE_DRIFT, slippage_for

    assert ESTIMATE_FEE_SHARE == 1.0
    binding_fee, binding_need = 15_000_000, 0.13696      # cvxCrv/Crv
    assert binding_need / (binding_fee / 10**10 * 100) < ESTIMATE_FEE_SHARE
    assert slippage_for(binding_fee, ESTIMATE_FEE_SHARE, QUOTE_DRIFT) >= binding_need


def test_a_low_constant_is_what_the_slope_buys() -> None:
    from ui.actions import ESTIMATE_FEE_SHARE, QUOTE_DRIFT, slippage_for

    pegged = slippage_for(100_000, ESTIMATE_FEE_SHARE, QUOTE_DRIFT)     # 0.001% fee
    volatile = slippage_for(60_000_000, ESTIMATE_FEE_SHARE, QUOTE_DRIFT)  # 0.6% fee
    assert pegged < 0.01, "a pegged pool should stay well under a hundredth"
    assert volatile > 0.5, "a 0.6% fee pool needs room the constant cannot give"


def test_the_arithmetic_is_a_times_fee_plus_b() -> None:
    from ui.actions import ESTIMATE_FEE_SHARE, QUOTE_DRIFT, SLIPPAGE_OF_FEE, slippage_for

    assert (SLIPPAGE_OF_FEE, ESTIMATE_FEE_SHARE, QUOTE_DRIFT) == (0.2, 1.0, 0.005)
    assert slippage_for(10_000_000) == pytest.approx(0.02)
    assert slippage_for(0) == 0
    assert slippage_for(10_000_000, ESTIMATE_FEE_SHARE, QUOTE_DRIFT) == pytest.approx(0.105)
    assert slippage_for(0, ESTIMATE_FEE_SHARE, QUOTE_DRIFT) == pytest.approx(QUOTE_DRIFT)


def test_a_deposit_allows_more_than_a_swap_at_every_fee() -> None:
    from ui.actions import ESTIMATE_FEE_SHARE, QUOTE_DRIFT, SLIPPAGE_OF_FEE, slippage_for

    for fee in (0, 100_000, 1_000_000, 5_520_000, 155_010_000):
        deposit = slippage_for(fee, ESTIMATE_FEE_SHARE, QUOTE_DRIFT)
        swap = slippage_for(fee, SLIPPAGE_OF_FEE)
        assert deposit > swap


# -- waiting for the chain -------------------------------------------------
# The panels used to re-read straight after broadcasting, which reads the
# state *before* the transaction: an approval landed and left the submit
# button disabled.


@pytest.fixture(autouse=True)
def _no_polling_delay(monkeypatch):
    """Run the confirmation loops at full speed."""
    import ui.actions

    monkeypatch.setattr(ui.actions, "CONFIRM_INTERVAL", 0)


class MinedProvider(FakeProvider):
    """Sends, then mines at `block` after `pending` empty polls."""

    def __init__(self, block: int = 500, pending: int = 1, status: str = "0x1") -> None:
        super().__init__()
        self.block, self.pending, self.status = block, pending, status
        self.heads = [block - 2, block - 1, block]
        self.receipts_asked = 0
        self.allowance_after = 0

    async def request(self, method: str, params=None):
        if method == "eth_getTransactionReceipt":
            self.receipts_asked += 1
            if self.receipts_asked <= self.pending:
                return None
            return {"blockNumber": hex(self.block), "status": self.status}
        if method == "eth_blockNumber":
            return hex(self.heads.pop(0) if self.heads else self.block)
        if method == "eth_call":
            data = (params or [{}])[0].get("data", "")
            if data.startswith("0x" + abi.selector("allowance(address,address)")):
                mined = self.receipts_asked > self.pending
                return word(10**30 if mined else 0)
            if data.startswith("0x" + abi.selector("fee()")):
                return word(1_000_000)
            return "0x"
        return await super().request(method, params)


def deposit_tab(provider):
    pool = make_pool()
    contract = PoolContract(provider, pool, ACCOUNT)
    from ui.actions import DepositTab

    tab = DepositTab(StubPage(), pool, lambda: contract, None)
    tab.mount()
    return tab


def retired_gauge_pool():
    """A pool whose only gauge has been killed, with LP still in it."""
    pool = make_pool()
    pool.gauge = ""
    pool.dead_gauge = "0x" + "cc" * 20
    return pool


async def test_a_retired_gauge_can_still_be_unstaked_from() -> None:
    """Killed means no more CRV and no new stakes, not that the money is
    gone. 161 Ethereum pools are in this state and the sampled ones still
    hold LP -- which was unreachable through this UI."""
    from ui.actions import StakeTab

    pool = retired_gauge_pool()
    contract = PoolContract(FakeProvider(), pool, ACCOUNT)
    tab = StakeTab(StubPage(), pool, lambda: contract, None)
    tab.mount()
    tab.staked = 5 * 10**18

    controls = tab.build()

    assert tab.direction.value == "unstake"
    assert tab.available is True
    assert any("retired" in getattr(c, "value", "") for c in controls)
    assert contract.build_unstake(10**18)[0] == pool.dead_gauge


async def test_a_retired_gauge_takes_no_new_stake() -> None:
    from ui.actions import StakeTab
    from wallet.base import WalletError as _WalletError

    pool = retired_gauge_pool()
    contract = PoolContract(FakeProvider(), pool, ACCOUNT)
    tab = StakeTab(StubPage(), pool, lambda: contract, None)
    tab.mount()
    tab.amount.value = "1"
    tab.direction.value = "stake"

    with pytest.raises(_WalletError, match="retired"):
        await tab.submit(contract)

    assert contract.provider.sent == []


async def test_a_retired_gauge_is_still_read_for_balances_and_rewards() -> None:
    pool = retired_gauge_pool()
    contract = PoolContract(FakeProvider(), pool, ACCOUNT)

    assert contract.build_claim_rewards()[0] == pool.dead_gauge
    assert await contract.staked_balance() == 0  # asked, rather than skipped


async def test_a_refresh_during_a_send_leaves_submit_held_down() -> None:
    """A refresh runs on its own task, and `_sync_approval` sets Submit
    from the allowance alone -- so a MAX click or an edited amount while
    the wallet prompt was open re-enabled the button under a transaction
    that had already been built, and a second press builds a second one."""
    tab = deposit_tab(FakeProvider())
    tab.fields[0].value = "1"
    tab._busy(True)

    await tab.refresh()

    assert tab._sending is True
    assert tab.submit_button.disabled is True
    assert tab.approve_button.disabled is True


async def test_the_buttons_come_back_when_the_action_is_over() -> None:
    tab = deposit_tab(FakeProvider())
    tab.fields[0].value = "1"
    tab._busy(True)
    tab._busy(False)

    await tab.refresh()

    assert tab._sending is False
    # Back under the allowance's control, which is what disables it here:
    # this pool has no approval yet, so Submit is step 2.
    assert tab.submit_button.disabled is (tab._pending_approval is not None)


async def test_an_approval_waits_to_be_mined_before_reading_back() -> None:
    provider = MinedProvider(pending=2)
    tab = deposit_tab(provider)
    tab.fields[0].value = "1"

    await tab._approve_clicked(None)

    assert provider.receipts_asked > 2, "did not wait for the receipt"
    assert "confirm" in tab.status.value.lower() or "Approved" in tab.status.value


async def test_the_block_the_transaction_landed_in_is_waited_for() -> None:
    provider = MinedProvider(block=500, pending=0)
    tab = deposit_tab(provider)
    tab.fields[0].value = "1"

    await tab._approve_clicked(None)
    assert provider.heads == [], "the head was not polled until it caught up"


async def test_a_mined_revert_is_reported_not_celebrated() -> None:
    provider = MinedProvider(status="0x0")
    tab = deposit_tab(provider)
    tab.fields[0].value = "1"

    await tab._approve_clicked(None)
    assert "reverted" in tab.status.value.lower()


async def test_a_confirmed_deposit_clears_the_amounts() -> None:
    provider = MinedProvider(pending=0)
    tab = deposit_tab(provider)
    tab.fields[0].value = "1"
    tab.balances = [10**18, 0]

    async def submit(contract):
        return "0x" + "cd" * 32

    tab.submit = submit  # type: ignore[assignment]
    tab.on_done = _noop
    await tab._submit_clicked(None)
    assert tab.fields[0].value == ""


async def _noop() -> None:
    return None


# -- what the confirmation says --------------------------------------------
# The block number the receipt named still governs the reads that follow it
# -- see `curve.confirm` -- but it is not what someone who just deposited --
# wants read back to them.


async def test_a_confirmed_deposit_names_the_amount_not_the_block() -> None:
    provider = MinedProvider(block=21_000_000, pending=0)
    tab = deposit_tab(provider)
    tab.fields[0].value = "1000"  # USDT, 6 decimals

    async def submit(contract):
        return "0x" + "cd" * 32

    tab.submit = submit  # type: ignore[assignment]
    tab.on_done = _noop
    await tab._submit_clicked(None)

    assert tab.status.value == "Deposited 1,000.00 USDT."
    assert "block" not in tab.status.value


async def test_a_deposit_of_several_coins_names_them_all() -> None:
    provider = MinedProvider(pending=0)
    tab = deposit_tab(provider)
    tab.fields[0].value = "1000"
    tab.fields[1].value = "2.5"

    async def submit(contract):
        return "0x" + "cd" * 32

    tab.submit = submit  # type: ignore[assignment]
    tab.on_done = _noop
    await tab._submit_clicked(None)

    assert tab.status.value == "Deposited 1,000.00 USDT + 2.5 crvUSD."


async def test_an_approval_names_what_it_approved() -> None:
    provider = MinedProvider(pending=0)
    tab = deposit_tab(provider)
    tab.fields[0].value = "1000"

    await tab._approve_clicked(None)

    assert tab.status.value == "Approved 1,000.00 USDT."


async def test_the_summary_is_taken_before_the_fields_are_cleared() -> None:
    provider = MinedProvider(pending=0)
    tab = deposit_tab(provider)
    tab.fields[0].value = "7"

    async def submit(contract):
        return "0x" + "cd" * 32

    tab.submit = submit  # type: ignore[assignment]
    tab.on_done = _noop
    await tab._submit_clicked(None)

    assert tab.fields[0].value == ""
    assert "7 USDT" in tab.status.value


async def test_unstaking_says_unstaked() -> None:
    from ui.actions import StakeTab

    provider = MinedProvider(pending=0)
    pool = make_pool()
    pool.gauge = "0x" + "ee" * 20
    contract = PoolContract(provider, pool, ACCOUNT)
    tab = StakeTab(StubPage(), pool, lambda: contract, None)
    tab.mount()
    tab.amount.value = "5"

    tab.direction.value = "unstake"
    assert tab.done_message() == "Unstaked 5 LP."
    tab.direction.value = "stake"
    assert tab.done_message() == "Staked 5 LP."


async def test_a_swap_names_both_sides() -> None:
    from ui.actions import SwapTab

    provider = MinedProvider(pending=0)
    pool = make_pool()
    contract = PoolContract(provider, pool, ACCOUNT)
    tab = SwapTab(StubPage(), pool, lambda: contract, None)
    tab.mount()
    tab.amount.value = "250"

    assert tab.done_message() == "Swapped 250 USDT for crvUSD."


async def test_nothing_typed_leaves_a_bare_confirmation() -> None:
    provider = MinedProvider(pending=0)
    tab = deposit_tab(provider)
    assert tab.done_message() == "Deposited."


def test_the_shown_tolerance_is_never_tighter_than_the_computed_one() -> None:
    from ui.actions import ESTIMATE_FEE_SHARE, QUOTE_DRIFT, format_slippage, slippage_for

    for fee in range(0, 200_000_000, 137_017):
        exact = slippage_for(fee, ESTIMATE_FEE_SHARE, QUOTE_DRIFT)
        assert float(format_slippage(exact)) >= exact, fee


# -- what the buttons say --------------------------------------------------
# `ft.Button` carries its label in `content`; it has no `text` property, so
# assigning one silently sets an attribute nobody reads.


async def test_unstaking_says_unstake() -> None:
    from ui.actions import StakeTab

    tab, _ = tab_with_fee(StakeTab, 1_000_000)
    tab.pool.gauge = "0x" + "cc" * 20
    await tab.refresh()
    assert tab.submit_button.content == "Stake"

    tab.direction.value = "unstake"
    await tab.refresh()
    assert tab.submit_button.content == "Unstake"

    tab.direction.value = "stake"
    await tab.refresh()
    assert tab.submit_button.content == "Stake"


async def test_the_submit_button_is_numbered_while_an_approval_is_pending() -> None:
    from ui.actions import DepositTab

    provider = FeeProvider(1_000_000)
    pool = make_pool()
    contract = PoolContract(provider, pool, ACCOUNT)
    tab = DepositTab(StubPage(), pool, lambda: contract, None)
    tab.mount()
    tab.fields[0].value = "1"

    await tab._sync_approval(contract)      # allowance is zero in the fake
    assert tab.approve_button.content == "1. Approve USDT"
    assert tab.submit_button.content == "2. Deposit"


async def test_and_loses_the_number_once_it_is_approved() -> None:
    from ui.actions import DepositTab

    class Approved(FeeProvider):
        async def request(self, method, params=None):
            data = (params or [{}])[0].get("data", "") if method == "eth_call" else ""
            if data.startswith("0x" + abi.selector("allowance(address,address)")):
                return word(10**30)
            return await super().request(method, params)

    provider = Approved(1_000_000)
    pool = make_pool()
    contract = PoolContract(provider, pool, ACCOUNT)
    tab = DepositTab(StubPage(), pool, lambda: contract, None)
    tab.mount()
    tab.fields[0].value = "1"

    await tab._sync_approval(contract)
    assert tab.submit_button.content == "Deposit"
    assert not tab.approve_button.visible


# -- the status line -------------------------------------------------------
# A wallet takes seconds to answer and a block takes twelve.


def status_of(tab):
    return tab.status.value, tab.status_spinner.visible, tab.status_panel.bgcolor


async def test_waiting_states_spin() -> None:

    provider = MinedProvider(pending=2)
    tab = deposit_tab(provider)
    tab.fields[0].value = "1"

    seen = []
    say = tab._say

    def record(message, colour=None, *, pending=False):
        seen.append((message, pending))
        say(message, colour, pending=pending)

    tab._say = record
    await tab._approve_clicked(None)

    assert any(pending for _m, pending in seen), "nothing ever showed as pending"
    waiting = [m for m, pending in seen if pending]
    assert any("wallet" in m for m in waiting)
    assert any("confirm" in m for m in waiting)


async def test_the_panel_hides_when_there_is_nothing_to_say() -> None:
    from ui.actions import DepositTab

    tab, _ = tab_with_fee(DepositTab, 1_000_000)
    assert not tab.status_panel.visible

    tab._say("something")
    assert tab.status_panel.visible
    tab._say("")
    assert not tab.status_panel.visible


def test_each_kind_of_status_gets_its_own_tint() -> None:
    from ui.actions import DepositTab

    tab, _ = tab_with_fee(DepositTab, 1_000_000)
    tints = {}
    for label, colour, pending in [
        ("pending", None, True),
        ("failed", ft.Colors.ERROR, False),
        ("done", ft.Colors.GREEN_600, False),
        ("plain", None, False),
    ]:
        tab._say(label, colour, pending=pending)
        tints[label] = tab.status_panel.bgcolor
    assert len(set(tints.values())) == 4, tints
    tab._say("pending", None, pending=True)
    assert tab.status_spinner.visible
    tab._say("done", ft.Colors.GREEN_600)
    assert not tab.status_spinner.visible


# -- the swap pickers ------------------------------------------------------
# Two coins, and the panel should never sit in a state it can complain about
# but not fix.


def swap_tab(provider=None):
    from ui.actions import SwapTab

    pool = make_pool()
    contract = PoolContract(provider or FakeProvider(), pool, ACCOUNT)
    tab = SwapTab(StubPage(), pool, lambda: contract, None)
    tab.mount()
    return tab


def test_choosing_the_coin_the_other_side_holds_moves_that_side() -> None:
    tab = swap_tab()
    assert (tab.from_coin.value, tab.to_coin.value) == ("0", "1")

    tab.from_coin.value = "1"  # the coin "To" already holds
    tab._from_selected(None)

    assert tab.to_coin.value != "1"
    assert tab._indices()[0] != tab._indices()[1]


def test_the_other_side_gives_way_whichever_was_touched() -> None:
    tab = swap_tab()
    tab.to_coin.value = "0"  # the coin "From" already holds
    tab._to_selected(None)
    assert tab.from_coin.value != "0"


def test_flipping_swaps_the_two_over() -> None:
    tab = swap_tab()
    tab.amount.value = "100"

    tab._flip(None)

    assert (tab.from_coin.value, tab.to_coin.value) == ("1", "0")
    assert tab.amount.value == "100"


def test_flipping_twice_is_where_it_started() -> None:
    tab = swap_tab()
    tab._flip(None)
    tab._flip(None)
    assert (tab.from_coin.value, tab.to_coin.value) == ("0", "1")


def test_a_one_coin_pool_cannot_be_made_to_pick_a_second() -> None:
    from ui.actions import SwapTab

    pool = make_pool()
    pool.coins = pool.coins[:1]
    pool.onchain_coins = 1
    tab = SwapTab(StubPage(), pool, lambda: None, None)
    tab.mount()
    tab._from_selected(None)
    assert tab.from_coin.value == "0"


# -- the wrong network -----------------------------------------------------
# Every read goes through the wallet's provider, so it lands on the network
# the *wallet* is on.


async def test_a_wallet_on_another_network_is_said_plainly() -> None:
    provider = FakeProvider()
    provider.chain = 1
    pool = make_pool()
    pool.chain_id = 100  # Gnosis
    pool.chain = "xdai"
    contract = PoolContract(provider, pool, ACCOUNT)
    from ui.actions import DepositTab

    tab = DepositTab(StubPage(), pool, lambda: contract, None)
    tab.mount()

    await tab.refresh()

    assert tab.network_panel.visible is True
    assert "Gnosis" in tab.network_note.value
    assert tab.submit_button.disabled is True
    assert tab.approve_button.visible is False


async def test_the_right_network_says_nothing() -> None:
    provider = FakeProvider()
    provider.chain = 1
    pool = make_pool()
    pool.chain_id = 1
    contract = PoolContract(provider, pool, ACCOUNT)
    from ui.actions import DepositTab

    tab = DepositTab(StubPage(), pool, lambda: contract, None)
    tab.mount()

    await tab.refresh()

    assert tab.network_panel.visible is False


async def test_a_pool_with_no_known_chain_is_not_complained_about() -> None:
    provider = FakeProvider()
    pool = make_pool()
    pool.chain_id = 0
    contract = PoolContract(provider, pool, ACCOUNT)
    from ui.actions import DepositTab

    tab = DepositTab(StubPage(), pool, lambda: contract, None)
    tab.mount()
    assert await tab.network_ok(contract) is True
    assert tab.network_panel.visible is False


async def test_the_switch_button_asks_the_wallet_to_move() -> None:
    class Switching(FakeProvider):
        def __init__(self):
            super().__init__()
            self.switched: list = []

        async def request(self, method, params=None):
            if method == "wallet_switchEthereumChain":
                self.switched.append(params[0]["chainId"])
                self.chain = int(params[0]["chainId"], 16)
                return None
            return await super().request(method, params)

    provider = Switching()
    pool = make_pool()
    pool.chain_id = 100
    pool.chain = "xdai"
    contract = PoolContract(provider, pool, ACCOUNT)
    from ui.actions import DepositTab

    tab = DepositTab(StubPage(), pool, lambda: contract, None)
    tab.mount()
    await tab.refresh()
    assert tab.network_panel.visible is True

    await tab._switch_network(None)

    assert provider.switched == [hex(100)]
    assert tab.network_panel.visible is False


async def test_a_switch_that_failed_is_reported_not_swallowed() -> None:

    class Broken(FakeProvider):
        async def request(self, method, params=None):
            if method == "wallet_switchEthereumChain":
                raise RpcError(-32603, "Internal JSON-RPC error")
            return await super().request(method, params)

    tab = await _refusing_tab(Broken)

    assert "internal" in tab.status.value.lower()
    assert tab.network_panel.visible is True


async def test_a_switch_the_user_declined_says_nothing() -> None:

    class Refusing(FakeProvider):
        async def request(self, method, params=None):
            if method == "wallet_switchEthereumChain":
                raise RpcError(4001, "User rejected the request")
            return await super().request(method, params)

    tab = await _refusing_tab(Refusing)

    assert tab.status.value == ""
    assert tab.status_panel.visible is False
    assert tab.network_panel.visible is True


async def _refusing_tab(transport):
    pool = make_pool()
    pool.chain_id = 100
    contract = PoolContract(transport(), pool, ACCOUNT)
    from ui.actions import DepositTab

    tab = DepositTab(StubPage(), pool, lambda: contract, None)
    tab.mount()
    await tab.refresh()
    await tab._switch_network(None)
    return tab


# -- reading without a wallet ----------------------------------------------
# A quote needs no account, so the panels show rates before anything is
# connected -- through a public node (see `curve.rpc`).


def read_only_contract(provider=None):
    """What `contract_for` builds with no wallet: a node, and no account."""
    return PoolContract(provider or FakeProvider(), make_pool(), "")


async def test_a_quote_needs_no_account() -> None:
    provider = FakeProvider({"0x3883e119": word(0), "0x5e0d443f": word(99 * 10**18)})
    contract = read_only_contract(provider)
    assert contract.can_send is False
    assert await contract.get_dy(0, 1, 10**6) == 99 * 10**18


async def test_the_swap_panel_quotes_with_no_wallet() -> None:
    from ui.actions import SwapTab

    provider = FakeProvider({"0x5e0d443f": word(99 * 10**18)})
    contract = read_only_contract(provider)
    tab = SwapTab(StubPage(), contract.pool, lambda: contract, None)
    tab.mount()
    tab.amount.value = "100"

    await tab.refresh()

    assert "99" in tab.estimate.value
    assert tab.submit_button.disabled is True
    assert tab.approve_button.visible is False


async def test_the_slippage_suggestion_works_with_no_wallet() -> None:
    from ui.actions import SLIPPAGE_OF_FEE, SwapTab, slippage_for

    provider = FakeProvider(
        {"0xddca3f43": word(4_000_000), "0x76a9cd3e": word(4_000_000)}
    )
    contract = read_only_contract(provider)
    tab = SwapTab(StubPage(), contract.pool, lambda: contract, None)
    tab.mount()

    await tab.suggest_slippage(contract)

    assert float(tab.slippage.value) == pytest.approx(
        slippage_for(4_000_000, SLIPPAGE_OF_FEE), rel=1e-3
    )


async def test_balances_are_not_read_without_an_account() -> None:
    from ui.actions import DepositTab

    provider = FakeProvider()
    contract = read_only_contract(provider)
    tab = DepositTab(StubPage(), contract.pool, lambda: contract, None)
    tab.mount()
    tab.fields[0].value = "1"

    await tab.refresh()   # must not raise

    assert tab.balance_labels[0].value in ("", None)
    assert tab.submit_button.disabled is True


async def test_pressing_deposit_without_a_wallet_says_so() -> None:
    from ui.actions import DepositTab

    contract = read_only_contract()
    tab = DepositTab(StubPage(), contract.pool, lambda: contract, None)
    tab.mount()
    tab.fields[0].value = "1"

    await tab._submit_clicked(None)
    assert "connect a wallet" in tab.status.value.lower()

    await tab._approve_clicked(None)
    assert "connect a wallet" in tab.status.value.lower()


# -- what the size of a trade costs it -------------------------------------
# The panels measure this by quoting a twentieth of what was typed and
# comparing the two rates, so a test double whose quote is a straight line
# proves nothing.

#: A constant-product pool: `get_dy` is `Y * dx / (X + dx)`.
CP_X = 1_000_000 * 10**6       # USDT, the coin being sold
CP_Y = 1_000_000 * 10**18      # crvUSD, the coin being bought
CP_SUPPLY = 1_000_000 * 10**18  # LP outstanding, for the deposit side


def swap_impact(dx: int) -> float:
    """`(X + dx) / (X + dx/20) - 1`, in percent."""
    from ui.actions import IMPACT_PROBE_DIVISOR

    return ((CP_X + dx) / (CP_X + dx / IMPACT_PROBE_DIVISOR) - 1) * 100


def deposit_impact(amount: int) -> float:
    """The same comparison for `S * (sqrt(1 + a/X) - 1)`, in percent."""
    from ui.actions import IMPACT_PROBE_DIVISOR

    u = amount / CP_X
    probe = IMPACT_PROBE_DIVISOR * (math.sqrt(1 + u / IMPACT_PROBE_DIVISOR) - 1)
    return (probe / (math.sqrt(1 + u) - 1) - 1) * 100


def curved_mint(amounts: list[int]) -> int:
    """Uniswap's single-sided deposit, which is concave in the amount."""
    return int(CP_SUPPLY * (math.sqrt(1 + amounts[0] / CP_X) - 1))


def straight_mint(amounts: list[int]) -> int:
    """A pool with no curve at all: LP strictly proportional to the coin."""
    return CP_SUPPLY * amounts[0] // CP_X


class CurvedProvider(FakeProvider):
    """Answers the two quotes from the amounts it was actually sent."""

    def __init__(self, mint=curved_mint, out_reserve: int = CP_Y) -> None:
        super().__init__()
        self.mint = mint
        self.out_reserve = out_reserve
        self.quotes = 0
        self.fail_quote_number = 0
        self.revert_quotes = False

    async def request(self, method: str, params=None):
        params = params or []
        if method == "eth_call":
            data = params[0]["data"]
            quote = data[:10] in ("0x5e0d443f", "0xed8e84f3")
            if quote:
                self.quotes += 1
                if self.revert_quotes:
                    raise RpcError(-32000, "execution reverted")
                if self.quotes == self.fail_quote_number:
                    return "0x"          # what an unsupported method returns
            if data.startswith("0x5e0d443f"):     # get_dy(int128,int128,uint256)
                dx = words_of(data)[2]
                return word(self.out_reserve * dx // (CP_X + dx))
            if data.startswith("0xed8e84f3"):     # calc_token_amount(uint256[2],bool)
                return word(self.mint(words_of(data)[:2]))
        return await super().request(method, params)


def calm(band) -> bool:
    """Is this band at rest -- its own colour rather than the alarm's?"""
    from ui import theme

    return not band.alarming and band.bgcolor in (
        None,
        theme.note_tint(band._page, band.kind),
    )


def impact_percent(tab) -> float:
    """The number the panel printed, back out of its line."""
    text = (tab.impact.value or "").removeprefix("Price impact ")
    return float(text.rstrip("%"))


async def test_a_swap_is_priced_against_a_twentieth_of_itself() -> None:
    tab = swap_tab(CurvedProvider())
    tab.amount.value = "100000"      # a tenth of the pool

    await tab.refresh()

    assert tab.impact_panel.visible is True
    assert impact_percent(tab) == pytest.approx(
        swap_impact(100_000 * 10**6), rel=1e-3
    )


async def test_the_probe_asks_about_the_same_trade_at_a_twentieth() -> None:
    from ui.actions import IMPACT_PROBE_DIVISOR

    provider = CurvedProvider()
    tab = swap_tab(provider)
    tab.amount.value = "100000"
    sent: list[list[int]] = []
    calls = provider.request

    async def record(method: str, params=None):
        if method == "eth_call" and params[0]["data"].startswith("0x5e0d443f"):
            sent.append(words_of(params[0]["data"]))
        return await calls(method, params)

    provider.request = record          # type: ignore[method-assign]
    await tab.refresh()

    dx = 100_000 * 10**6
    assert [words[:2] for words in sent] == [[0, 1], [0, 1]]
    assert [words[2] for words in sent] == [dx, dx // IMPACT_PROBE_DIVISOR]


async def test_a_swap_big_enough_to_hurt_is_coloured() -> None:
    from ui.actions import IMPACT_HIGH

    small = swap_tab(CurvedProvider())
    small.amount.value = "1000"
    await small.refresh()
    assert impact_percent(small) < IMPACT_HIGH
    assert small.impact.color == ft.Colors.ON_SURFACE_VARIANT

    large = swap_tab(CurvedProvider())
    large.amount.value = "100000"
    await large.refresh()
    assert impact_percent(large) >= IMPACT_HIGH
    assert large.impact.color == ft.Colors.ERROR


async def test_a_trade_too_small_to_measure_says_nothing() -> None:
    tab = swap_tab(CurvedProvider())
    tab.amount.value = "0.1"

    await tab.refresh()

    assert tab.impact_panel.visible is False
    assert tab.impact.value == ""
    assert "crvUSD" in tab.estimate.value


async def test_a_deposit_is_priced_the_same_way() -> None:
    tab = deposit_tab(CurvedProvider())
    tab.fields[0].value = "200000"      # a fifth of the pool, one-sided

    await tab.refresh()

    assert tab.impact_panel.visible is True
    assert impact_percent(tab) == pytest.approx(
        deposit_impact(200_000 * 10**6), rel=1e-3
    )
    assert "LP" in tab.estimate.value


async def test_a_deposit_that_mints_in_proportion_reports_no_impact() -> None:
    tab = deposit_tab(CurvedProvider(mint=straight_mint))
    tab.fields[0].value = "200000"

    await tab.refresh()

    assert tab.impact.value == "Price impact under 0.01%"


async def test_a_probe_that_fails_leaves_the_estimate_standing() -> None:
    provider = CurvedProvider()
    provider.fail_quote_number = 2      # the probe, not the quote
    tab = swap_tab(provider)
    tab.amount.value = "100000"

    await tab.refresh()

    assert tab.impact_panel.visible is False
    assert "crvUSD" in tab.estimate.value
    assert tab.status.value in ("", None)


async def test_only_the_panels_with_a_price_carry_the_line() -> None:
    for tab in tabs():
        tab.mount()
        drawn = any(control is tab.impact_panel for control in tab.control.controls)
        assert drawn == tab.shows_impact
        assert tab.shows_impact == (tab.title in ("Deposit", "Swap", "Withdraw"))


def test_a_deposit_of_the_scarce_coin_is_a_bonus_not_an_error() -> None:
    from ui.actions import (
        IMPACT_MIN_PROBE,
        IMPACT_PROBE_DIVISOR,
        format_impact,
        price_impact,
    )

    probe_out = IMPACT_MIN_PROBE
    out = probe_out * IMPACT_PROBE_DIVISOR * 110 // 100
    impact = price_impact(probe_out, out)
    assert impact == pytest.approx(-100 / 11, rel=1e-9)
    assert format_impact(impact) == "-9.09%"


def test_the_probe_keeps_the_shape_of_the_deposit() -> None:
    from ui.actions import IMPACT_MIN_PROBE, IMPACT_PROBE_DIVISOR, impact_probe

    amount = IMPACT_MIN_PROBE * IMPACT_PROBE_DIVISOR
    assert impact_probe([amount, 0]) == [IMPACT_MIN_PROBE, 0]
    assert impact_probe([amount - IMPACT_PROBE_DIVISOR, 0]) is None
    assert impact_probe([amount, 1]) is None
    assert impact_probe([0, 0]) is None


class WithdrawingProvider(FakeProvider):
    """A pool whose one-coin withdrawal pays worse the more is asked of it."""

    DEPTH = 10**24                      # LP wei at which the pool is drained
    RATE = 10**6 / 10**18               # LP wei -> 6-decimal coin units

    def __init__(self, depth: int | None = None) -> None:
        # A million LP in the wallet, so the panel quotes rather than
        # reporting an empty balance -- `balanceOf`, which is what
        # both `lp_balance` and `staked_balance` ask.
        super().__init__({"0x70a08231": word(10**24)})
        self.depth = depth or self.DEPTH
        self.refuse_quote = False

    async def request(self, method: str, params=None):
        if method == "eth_call":
            data = (params or [{}])[0].get("data", "")
            if data.startswith(
                "0x" + abi.selector("calc_withdraw_one_coin(uint256,int128)")
            ):
                if self.refuse_quote:
                    raise RpcError(-32000, "execution reverted")
                lp = words_of(data)[0]
                out = lp * self.RATE * (1 - lp / self.depth)
                return word(int(out))
        return await super().request(method, params)


def withdraw_impact(lp: int, depth: int = WithdrawingProvider.DEPTH) -> float:
    """What `WithdrawingProvider` should make the panel print."""
    from ui.actions import IMPACT_PROBE_DIVISOR

    probe = lp / IMPACT_PROBE_DIVISOR
    full = 1 - lp / depth
    return ((1 - probe / depth) / full - 1) * 100


async def test_taking_one_coin_out_is_priced_like_a_trade() -> None:
    provider = WithdrawingProvider()
    tab = make_tab(provider)
    tab.mode.value = "one"
    tab.coin_picker.value = "0"
    tab.amount.value = "50000"          # 5% of the depth above

    await tab.refresh()

    assert tab.impact_panel.visible is True
    assert impact_percent(tab) == pytest.approx(
        withdraw_impact(50_000 * 10**18), rel=1e-3
    )


async def test_the_withdrawal_probe_asks_about_the_same_coin() -> None:
    from ui.actions import IMPACT_PROBE_DIVISOR

    provider = WithdrawingProvider()
    tab = make_tab(provider)
    tab.mode.value = "one"
    tab.coin_picker.value = "1"
    tab.amount.value = "50000"
    asked: list[list[int]] = []
    original = provider.request

    async def record(method: str, params=None):
        if method == "eth_call" and params[0]["data"].startswith(
            "0x" + abi.selector("calc_withdraw_one_coin(uint256,int128)")
        ):
            asked.append(words_of(params[0]["data"]))
        return await original(method, params)

    provider.request = record          # type: ignore[method-assign]
    await tab.refresh()

    lp = 50_000 * 10**18
    assert [words[0] for words in asked] == [lp, lp // IMPACT_PROBE_DIVISOR]
    assert [words[1] for words in asked] == [1, 1], "the selected coin, both times"


async def test_a_balanced_withdrawal_is_measured_against_nothing() -> None:
    tab = make_tab(WithdrawingProvider())
    tab.mode.value = "balanced"
    tab.amount.value = "50000"

    await tab.refresh()

    assert tab.impact_panel.visible is False


async def test_a_withdrawal_the_pool_refuses_reports_that_and_not_an_impact() -> None:
    provider = WithdrawingProvider()
    provider.refuse_quote = True
    tab = make_tab(provider)
    tab.mode.value = "one"
    tab.amount.value = "50000"

    await tab.refresh()

    assert tab.impact_panel.visible is False
    assert "reverted" in tab.estimate.value


async def test_a_swap_whose_output_is_too_coarse_to_divide_says_nothing() -> None:
    thin = CurvedProvider(out_reserve=10 * 10**8)      # ten WBTC, 8 decimals

    tab = swap_tab(thin)
    tab.amount.value = "1"
    await tab.refresh()
    assert tab.impact_panel.visible is False

    tab.amount.value = "10000"
    await tab.refresh()
    assert tab.impact_panel.visible is True
    assert impact_percent(tab) == pytest.approx(swap_impact(10_000 * 10**6), rel=1e-2)


# -- the band behind a number worth stopping at ----------------------------


class RecordingPage(StubPage):
    """A page that runs what it is handed, and remembers every repaint."""

    def __init__(self, panel=None) -> None:
        self.tints: list[str | None] = []
        self.panel = panel
        self.tasks: list[tuple] = []

    def update(self) -> None:
        if self.panel is not None:
            self.tints.append(self.panel.bgcolor)

    def run_task(self, handler, *args, **kwargs) -> None:
        self.tasks.append((handler, args))


def high_impact_tab():
    """A swap whose impact is well past the red line, on a live page."""
    provider = CurvedProvider()
    pool = make_pool()
    contract = PoolContract(provider, pool, ACCOUNT)
    from ui.actions import SwapTab

    page = RecordingPage()
    tab = SwapTab(page, pool, lambda: contract, None)
    page.panel = tab.impact_panel
    tab.mount()
    tab.amount.value = "100000"
    return tab, page


async def test_a_big_impact_arms_the_alarm() -> None:
    tab, page = high_impact_tab()

    await tab.refresh()

    assert tab.flashing is tab.impact_panel
    assert [handler for handler, _args in page.tasks] == [tab._alarms._pulse]


async def test_a_small_impact_leaves_the_band_alone() -> None:
    tab, page = high_impact_tab()
    tab.amount.value = "1000"

    await tab.refresh()

    assert tab.flashing is None
    assert calm(tab.impact_panel)
    assert page.tasks == []


async def test_the_alarm_is_armed_on_the_crossing_not_on_every_keystroke() -> None:
    tab, page = high_impact_tab()
    await tab.refresh()
    tab.amount.value = "200000"      # still red, still the same alarm
    await tab.refresh()
    assert len(page.tasks) == 1

    tab.amount.value = "1000"        # back under the line
    await tab.refresh()
    assert tab.flashing is None
    assert calm(tab.impact_panel)

    tab.amount.value = "100000"      # and over it again
    await tab.refresh()
    assert len(page.tasks) == 2


async def test_the_pulse_flashes_and_then_settles(monkeypatch) -> None:
    """The mechanics live in `ui.alarm` now; this is that they are wired up."""
    from ui import alarm

    monkeypatch.setattr(alarm, "ALARM_INTERVAL", 0)
    monkeypatch.setattr(alarm, "ALARM_PULSES", 3)
    tab, page = high_impact_tab()
    await tab.refresh()

    await tab._alarms._pulse(tab._alarms._run)

    lit = ft.Colors.with_opacity(alarm.ALARM_LIT, ft.Colors.ERROR)
    dim = ft.Colors.with_opacity(alarm.ALARM_DIM, ft.Colors.ERROR)
    assert page.tints.count(lit) == 3
    assert page.tints.count(dim) == 4
    assert tab.impact_panel.bgcolor == dim


async def test_a_retired_pulse_stops_painting(monkeypatch) -> None:
    from ui import alarm

    monkeypatch.setattr(alarm, "ALARM_INTERVAL", 0)
    tab, page = high_impact_tab()
    await tab.refresh()
    stale = tab._alarms._run

    tab.amount.value = "1000"
    await tab.refresh()                 # disarms, and retires the run
    page.tints.clear()

    await tab._alarms._pulse(stale)

    assert page.tints == []
    assert calm(tab.impact_panel)


def test_the_output_amount_is_sized_like_the_fields_it_answers() -> None:
    from ui.typography import BODY

    for tab in tabs():
        assert tab.estimate.size == BODY


async def test_the_estimate_points_at_what_you_get() -> None:
    tab = swap_tab(CurvedProvider())
    tab.amount.value = "1000"
    await tab.refresh()
    assert tab.estimate.value.startswith("-> ")
    assert "~" not in tab.estimate.value


# -- the same band for a message that means stop ---------------------------


async def test_a_reverted_quote_gets_the_band_too() -> None:
    provider = CurvedProvider()
    provider.revert_quotes = True
    tab, page = high_impact_tab()
    tab.get_contract().provider = provider

    await tab.refresh()

    assert "execution reverted" in tab.estimate.value
    assert tab.estimate.color == ft.Colors.ERROR
    assert tab.flashing is tab.estimate_panel
    assert [handler for handler, _args in page.tasks] == [tab._alarms._pulse]
    assert tab.impact_panel.visible is False


async def test_the_band_follows_the_message_that_is_actually_showing() -> None:
    provider = CurvedProvider()
    provider.revert_quotes = True
    tab, _page = high_impact_tab()
    tab.get_contract().provider = provider
    await tab.refresh()
    assert tab.flashing is tab.estimate_panel

    provider.revert_quotes = False
    await tab.refresh()

    assert tab.flashing is tab.impact_panel
    assert calm(tab.estimate_panel)
    assert tab.estimate.color == ft.Colors.ON_SURFACE


async def test_withdrawing_more_than_you_have_is_a_problem_not_a_caption() -> None:
    provider = FakeProvider()
    tab = make_tab(provider)
    tab.mount()
    tab.lp_balance = 5 * 10**18
    tab.amount.value = "1000"

    await tab.refresh()

    assert "available" in tab.estimate.value
    assert tab.estimate.color == ft.Colors.ERROR
    assert tab.flashing is tab.estimate_panel


async def test_an_empty_line_is_not_a_problem() -> None:
    tab, page = high_impact_tab()
    tab.show_estimate("", problem=True)
    assert tab.flashing is None
    assert page.tasks == []


async def test_leaving_the_network_takes_both_lines_with_it() -> None:
    tab, _page = high_impact_tab()
    await tab.refresh()
    assert tab.flashing is tab.impact_panel

    tab.pool.chain_id = 100          # the wallet is on Ethereum
    await tab.refresh()

    assert tab.estimate.value == ""
    assert tab.impact_panel.visible is False
    assert tab.flashing is None
    assert calm(tab.impact_panel)


# -- what it costs to send --------------------------------------------------


class PricedProvider(CurvedProvider):
    """A pool that quotes, on a chain that reports a base fee."""

    BASE = 30 * 10**9
    GAS = 150_000

    async def request(self, method: str, params=None):
        if method == "eth_getBlockByNumber":
            return {"baseFeePerGas": hex(self.BASE)}
        if method == "eth_gasPrice":
            return hex(self.BASE)
        if method == "eth_maxPriorityFeePerGas":
            return hex(0)
        if method == "eth_estimateGas":
            self.estimated.append((params or [{}])[0])
            return hex(self.GAS)
        return await super().request(method, params)


async def test_a_swap_says_what_sending_it_will_cost(monkeypatch) -> None:
    from ui import actions as actions_module

    async def priced(_chain, _chain_id):
        return 2_000.0

    monkeypatch.setattr(actions_module, "_native_usd", priced)
    tab = swap_tab(PricedProvider())
    tab.amount.value = "1000"

    await tab.refresh()

    assert tab.fee_panel.visible is True
    assert tab.fee.value == "Network fee 0.004725 ETH  ($9.45)"


async def test_the_fee_is_for_the_transaction_that_would_be_sent() -> None:
    provider = PricedProvider()
    tab = swap_tab(provider)
    tab.amount.value = "1000"

    await tab.refresh()

    asked = provider.estimated[-1]
    built = tab.preview(tab.get_contract())
    assert (asked["to"], asked["data"]) == built


async def test_a_panel_with_nothing_typed_prices_nothing() -> None:
    tab = swap_tab(PricedProvider())
    await tab.refresh()
    assert tab.fee_panel.visible is False


async def test_a_chain_that_reports_no_fees_shows_no_line() -> None:
    tab = swap_tab(FakeProvider())
    tab.amount.value = "1000"

    await tab.refresh()

    assert tab.fee_panel.visible is False


async def test_an_action_that_cannot_be_simulated_prices_its_approval(
    monkeypatch,
) -> None:
    from ui import actions as actions_module

    async def priced(_chain, _chain_id):
        return 2_000.0

    monkeypatch.setattr(actions_module, "_native_usd", priced)

    class Unapproved(PricedProvider):
        """The pool quotes; the deposit itself reverts for want of an
        allowance, and `allowance` reads zero.
        """

        async def request(self, method: str, params=None):
            if method == "eth_estimateGas":
                data = (params or [{}])[0].get("data", "")
                if not data.startswith("0x" + abi.selector("approve(address,uint256)")):
                    raise RpcError(-32000, "execution reverted")
            return await super().request(method, params)

    tab = deposit_tab(Unapproved())
    tab.fields[0].value = "1000"

    await tab.refresh()

    assert tab.fee_panel.visible is True
    assert tab.fee.value.endswith("to approve first")
    assert "ETH" in tab.fee.value


async def test_the_main_action_wins_where_both_can_be_priced() -> None:
    tab = swap_tab(PricedProvider())
    tab.amount.value = "1000"

    await tab.refresh()

    assert tab.fee_panel.visible is True
    assert "first" not in tab.fee.value


async def test_a_withdrawal_from_the_gauge_prices_the_unstake(monkeypatch) -> None:
    from ui import actions as actions_module

    async def priced(_chain, _chain_id):
        return 2_000.0

    monkeypatch.setattr(actions_module, "_native_usd", priced)

    class Staked(ReservedProvider):
        """Nothing in the wallet, a million in the gauge, and a withdrawal
        that reverts until some of it comes out.
        """

        GAUGE = "0x" + "cc" * 20

        async def request(self, method: str, params=None):
            if method == "eth_getBlockByNumber":
                return {"baseFeePerGas": hex(30 * 10**9)}
            if method in ("eth_gasPrice", "eth_maxPriorityFeePerGas"):
                return hex(30 * 10**9 if method == "eth_gasPrice" else 0)
            if method == "eth_estimateGas":
                data = (params or [{}])[0].get("data", "")
                unstake = "0x" + abi.selector("withdraw(uint256)")
                if not data.startswith(unstake):
                    raise RpcError(-32000, "execution reverted")
                return hex(90_000)
            if method == "eth_call":
                call = (params or [{}])[0]
                if call.get("data", "").startswith("0x70a08231"):
                    staked = call.get("to", "").lower() == self.GAUGE.lower()
                    return word(10**24 if staked else 0)
            return await super().request(method, params)

    provider = Staked(RESERVES)
    tab = make_tab(provider)
    tab.pool.gauge = Staked.GAUGE
    tab.use_staked.value = True
    tab.mode.value = "one"
    tab.amount.value = "100"

    await tab.refresh()

    assert tab.fee.value.endswith("to unstake first"), tab.fee.value


# -- the colour of an annotation --------------------------------------------


class ThemedPage(StubPage):
    """A page wearing one of the three themes, for the colour questions."""

    def __init__(self, name: str = "light") -> None:
        super().__init__()
        from ui import theme

        self.theme, self.theme_mode = theme.theme_for(name)


def test_the_two_annotations_are_told_apart_by_colour() -> None:
    from ui import theme

    page = ThemedPage("chad")
    assert theme.note_tint(page, "impact") != theme.note_tint(page, "fee")


def test_every_theme_colours_them_and_none_reuses_the_error() -> None:
    from ui import theme

    for name in ("chad", "light", "dark"):
        page = ThemedPage(name)
        for kind in ("impact", "fee"):
            tint = theme.note_tint(page, kind)
            assert tint, f"{name}/{kind} has no colour"
            assert "ERROR" not in str(tint).upper()


def test_a_band_with_nothing_to_say_takes_no_colour() -> None:
    from ui import theme

    assert theme.note_tint(ThemedPage("chad"), "") is None


def test_chad_fills_where_material_tints() -> None:
    from ui import theme

    chad = theme.note_tint(ThemedPage("chad"), "fee")
    material = theme.note_tint(ThemedPage("light"), "fee")

    assert chad is not None and "," not in chad
    assert material is not None and "," in material


async def test_a_theme_change_repaints_the_bands() -> None:
    from ui import theme

    page = ThemedPage("light")
    tab = swap_tab(PricedProvider())
    tab.page = page
    tab.impact_panel._page = page
    tab.impact_panel.before_update()
    light = tab.impact_panel.bgcolor

    page.theme, page.theme_mode = theme.theme_for("chad")
    tab.impact_panel.before_update()

    assert tab.impact_panel.bgcolor != light
    assert tab.impact_panel.bgcolor == theme.NOTE_IMPACT_CHAD
