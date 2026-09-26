"""What a wallet has to do around a route, and around a wrapping.

The interesting case is the one that looks like the other: a wrapping's
`withdraw` spends an ERC20, so asked the usual way it would report an
allowance that is missing -- with the wrapped token as its own spender -- and
the tab would offer an approval that does nothing.
"""

from __future__ import annotations

from curve.router_contract import RouterContract
from router import wrapping
from tests.test_pool import FakeProvider

WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
ME = "0x" + "11" * 20
AMOUNT = 10 ** 18


def contract(provider: FakeProvider | None = None) -> RouterContract:
    return RouterContract(provider or FakeProvider(), ME)


async def test_a_deposit_needs_no_approval_and_rides_on_the_value() -> None:
    plan = wrapping.plan(wrapping.DEPOSIT, WETH, AMOUNT)
    assert await contract().needs_approval(plan) is False
    assert plan.value == AMOUNT, "the native coin is sent, not approved"


async def test_a_withdraw_needs_no_approval_though_it_spends_an_erc20() -> None:
    provider = FakeProvider()
    plan = wrapping.plan(wrapping.WITHDRAW, WETH, AMOUNT)
    assert plan.token_in.lower() == WETH.lower()
    assert plan.value == 0

    assert await contract(provider).needs_approval(plan) is False
    assert provider.calls == [], "and it does not go asking the chain either"


async def test_a_route_is_still_asked_about_its_allowance() -> None:
    """The wrap flag is not a way round the check for everything else."""
    provider = FakeProvider()

    class Route:
        token_in = WETH
        to = "0x" + "22" * 20
        amount_in = AMOUNT

    assert await contract(provider).needs_approval(Route()) is True
    assert len(provider.calls) == 1, "asked, and answered zero by the fake"


async def test_a_wrapping_is_sent_to_the_wrapper_itself() -> None:
    provider = FakeProvider()
    plan = wrapping.plan(wrapping.DEPOSIT, WETH, AMOUNT)

    await contract(provider).execute(plan)

    sent = provider.sent[-1]
    assert sent["to"] == WETH
    assert int(sent["value"], 16) == AMOUNT
    assert sent["data"] == "0xd0e30db0", "deposit(), which takes no arguments"
