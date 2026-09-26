"""Native to wrapped native, which is not a route and should not be one.

`deposit()` mints one wrapped token per wei and `withdraw(n)` burns them back,
exactly, for ever.  There is no curve, no fee and nothing to solve -- so the
tab does not ask the router, and these are the pieces it uses instead.
"""

from __future__ import annotations

from router import wrapping

WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
AMOUNT = 3 * 10 ** 18


def test_the_two_directions_are_recognised_either_way_round():
    assert wrapping.direction(wrapping.NATIVE, WETH, WETH) == wrapping.DEPOSIT
    assert wrapping.direction(WETH, wrapping.NATIVE, WETH) == wrapping.WITHDRAW


def test_the_case_of_an_address_does_not_decide_it():
    """The sentinel is famously mixed-case and the chain table is checksummed."""
    assert wrapping.direction(
        wrapping.NATIVE.upper(), WETH.lower(), WETH) == wrapping.DEPOSIT


def test_anything_that_is_not_a_wrapping_says_so():
    assert wrapping.direction(USDC, WETH, WETH) is None
    assert wrapping.direction(wrapping.NATIVE, USDC, WETH) is None
    assert wrapping.direction(WETH, WETH, WETH) is None, "not a swap at all"
    assert wrapping.direction("", WETH, WETH) is None
    assert wrapping.direction(wrapping.NATIVE, WETH, "") is None


def test_the_calldata_is_the_two_selectors_everyone_knows():
    """Canonical WETH: `deposit()` takes nothing, `withdraw` takes the amount."""
    assert wrapping.calldata(wrapping.DEPOSIT, AMOUNT) == "0xd0e30db0"
    assert wrapping.calldata(wrapping.WITHDRAW, AMOUNT) == (
        "0x2e1a7d4d" + f"{AMOUNT:064x}")


def test_a_deposit_sends_the_coin_and_a_withdraw_does_not():
    deposit = wrapping.plan(wrapping.DEPOSIT, WETH, AMOUNT)
    assert deposit.value == AMOUNT and deposit.token_in == wrapping.NATIVE

    withdraw = wrapping.plan(wrapping.WITHDRAW, WETH, AMOUNT)
    assert withdraw.value == 0 and withdraw.token_in == WETH

    for plan in (deposit, withdraw):
        assert plan.to == WETH, "the wrapper is the whole route"
        assert plan.wrap is True


def test_what_comes_back_is_the_amount_itself_not_an_estimate_of_it():
    """One for one.  There is no rate here to be bounded, so the guarantee is
    the amount -- not the amount less a tolerance."""
    plan = wrapping.plan(wrapping.DEPOSIT, WETH, AMOUNT)
    assert plan.quoted_out == AMOUNT
    assert plan.guaranteed_out == AMOUNT
    assert plan.tolerance_bp == 0.0


def test_a_measured_gas_figure_is_kept_and_a_guess_is_marked():
    assert wrapping.plan(wrapping.DEPOSIT, WETH, AMOUNT, gas=41_234).gas == 41_234
    assert not wrapping.plan(wrapping.DEPOSIT, WETH, AMOUNT, gas=41_234).gas_estimated

    guessed = wrapping.plan(wrapping.WITHDRAW, WETH, AMOUNT)
    assert guessed.gas == wrapping.FALLBACK_GAS[wrapping.WITHDRAW]
    assert guessed.gas_estimated, "said to be a guess, since it is one"


def test_the_picture_is_two_columns_and_one_ribbon():
    class Coin:
        def __init__(self, symbol, address):
            self.symbol, self.address = symbol, address

    eth = Coin("ETH", wrapping.NATIVE)
    weth = Coin("WETH", WETH)
    got = wrapping.diagram(wrapping.DEPOSIT, eth, weth, WETH, "3")

    assert [bus.symbol for bus in got.buses] == ["ETH", "WETH"]
    assert got.buses[0].is_source and got.buses[1].is_dest
    assert len(got.elements) == 1
    leg = got.elements[0]
    assert leg.share_pct == 100.0
    assert leg.kind.name == "WRAP_NATIVE"
    assert leg.detail == WETH, "the pool address the mark is looked up by"


def test_the_other_direction_is_drawn_as_an_unwrap():
    class Coin:
        def __init__(self, symbol, address):
            self.symbol, self.address = symbol, address

    got = wrapping.diagram(wrapping.WITHDRAW, Coin("WETH", WETH),
                           Coin("ETH", wrapping.NATIVE), WETH, "3")
    assert got.elements[0].kind.name == "UNWRAP_NATIVE"


def test_the_picture_lays_out_like_any_other_route():
    """It goes through the same geometry, so it has to satisfy the same
    invariants -- one leg carrying everything, left to right."""
    from ui.routegraph import layout

    class Coin:
        def __init__(self, symbol, address):
            self.symbol, self.address = symbol, address

    got = layout(wrapping.diagram(wrapping.DEPOSIT, Coin("ETH", wrapping.NATIVE),
                                  Coin("WETH", WETH), WETH, "3"), 400, 200)
    assert len(got.buses) == 2 and len(got.bands) == 1
    assert got.bands[0].x0 < got.bands[0].x1
    assert got.bands[0].label == wrapping.DEPOSIT
