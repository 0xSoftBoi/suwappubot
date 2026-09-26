"""What a wallet holds, out of everything it could pick.

The picker's order is right for someone looking for a market and wrong for
someone looking for their own coins -- which are the ones they came to swap.
"""

from __future__ import annotations

from curve.multicall import MULTICALL3
from router import holdings
from router.universe import CoinEntry

USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
DUST = "0x000000000000000000000000000000000dead000"


def coins() -> list[CoinEntry]:
    """Busiest first, which is the order the picker starts in."""
    return [
        CoinEntry(USDC, "USDC", "USD Coin", 6, volume=9.0),
        CoinEntry(WETH, "WETH", "Wrapped Ether", 18, volume=5.0),
        CoinEntry(DUST, "DUST", "Dusty", 18, volume=1.0),
    ]


PRICES = {USDC: 1.0, WETH: 2400.0, DUST: 0.5}


class Provider:
    """Answers a Multicall3 batch of `balanceOf` calls from a script.

    Decoded the way `curve.multicall` encodes it, so a wrong shape here
    fails rather than passing quietly -- the same fake `test_portfolio`
    uses, for the same reason.
    """

    def __init__(self, answers: dict[str, int] | None = None,
                 explode: bool = False) -> None:
        self.answers = {a.lower(): held for a, held in (answers or {}).items()}
        self.explode = explode
        self.batches: list[int] = []
        self.native_asked = 0

    async def get_balance(self, _owner: str) -> int:
        self.native_asked += 1
        if self.explode:
            raise OSError("the endpoint went away")
        return self.answers.get(holdings.NATIVE, 0)

    async def call(self, to: str, data: str) -> str:
        from tests.test_parameters import aggregate3_response

        if self.explode:
            raise OSError("the endpoint went away")
        assert to == MULTICALL3
        body = data[10:]
        count = int(body[64:128], 16)
        self.batches.append(count)
        targets = []
        for index in range(count):
            at = 128 + int(body[128 + index * 64:192 + index * 64], 16) * 2
            targets.append("0x" + body[at + 24:at + 64])
        return aggregate3_response(
            [self.answers.get(target.lower()) for target in targets])


async def test_every_coin_is_asked_about_in_one_batch():
    """Three hundred coins is three hundred requests if this is done per coin."""
    provider = Provider({USDC: 25_000_000})
    held = await holdings.read_balances(provider, "0x" + "11" * 20, coins())

    assert provider.batches == [3], "one call per coin, in one round trip"
    assert held == {USDC: 25_000_000}, "and only what is actually held"


async def test_an_address_the_encoder_will_not_take_loses_only_itself():
    """One bad row in a pool list must not cost the other three hundred
    balances, which is what raising for the whole chunk would do."""
    bad = CoinEntry("0xnot-an-address", "BAD", "", 18)
    provider = Provider({USDC: 25_000_000})

    held = await holdings.read_balances(
        provider, "0x" + "11" * 20, [*coins(), bad])

    assert provider.batches == [3], "the three good ones, still in one batch"
    assert held == {USDC: 25_000_000}


async def test_a_long_list_is_split_into_batches_rather_than_one_huge_call():
    many = [CoinEntry(f"0x{n:040x}", f"C{n}", "", 18) for n in range(1, 651)]
    provider = Provider()
    await holdings.read_balances(provider, "0x" + "11" * 20, many)
    assert provider.batches == [holdings.CHUNK, holdings.CHUNK, 50]


async def test_the_native_coin_is_asked_for_differently():
    """It has no `balanceOf` to call."""
    native = CoinEntry(holdings.NATIVE, "ETH", "Ether", 18)
    provider = Provider({holdings.NATIVE: 5 * 10 ** 17})

    held = await holdings.read_balances(provider, "0x" + "11" * 20, [native])

    assert provider.native_asked == 1
    assert provider.batches == [], "and never put in a Multicall3 batch"
    assert held == {holdings.NATIVE: 5 * 10 ** 17}


async def test_an_endpoint_that_will_not_answer_costs_the_order_not_the_list():
    provider = Provider(explode=True)
    assert await holdings.read_balances(provider, "0x" + "11" * 20, coins()) == {}


async def test_nothing_is_asked_without_an_account():
    provider = Provider()
    assert await holdings.read_balances(provider, "", coins()) == {}
    assert provider.batches == [] and provider.native_asked == 0


def test_what_is_held_comes_first_and_the_rest_keep_their_order():
    held = {USDC: 25_000_000, WETH: 3 * 10 ** 17}
    ranked = holdings.rank(coins(), held, PRICES)

    assert [c.symbol for c in ranked] == ["WETH", "USDC", "DUST"]
    assert ranked[0].worth == 720.0, "by what it is worth, not by volume"
    assert ranked[1].worth == 25.0
    assert ranked[2].balance == 0


def test_dust_stays_where_the_markets_put_it():
    """A holding worth less than a dollar is not what anyone came to swap,
    and putting it above the busiest market would be the list lying."""
    held = {DUST: 10 ** 18}          # one whole token, worth 50 cents
    ranked = holdings.rank(coins(), held, PRICES)

    assert [c.symbol for c in ranked] == ["USDC", "WETH", "DUST"]
    assert ranked[2].balance == 10 ** 18, "still carried, just not promoted"
    assert ranked[2].worth == 0.5


def test_a_coin_with_no_price_is_not_promoted_on_a_guess():
    """Worth nothing that can be measured is not the same as worth a lot."""
    held = {DUST: 10 ** 24}
    ranked = holdings.rank(coins(), held, {})

    assert [c.symbol for c in ranked] == ["USDC", "WETH", "DUST"]
    assert ranked[2].worth == 0.0


def test_the_floor_is_a_dollar_and_can_be_moved():
    held = {WETH: 10 ** 15}          # $2.40 of it
    assert holdings.rank(coins(), held, PRICES)[0].symbol == "WETH"

    ranked = holdings.rank(coins(), held, PRICES, floor=5.0)
    assert [c.symbol for c in ranked] == ["USDC", "WETH", "DUST"], "under the floor"


def test_ranking_leaves_the_coins_it_was_given_alone():
    """The picker holds the list it was handed; a sort in place would move
    entries under it."""
    original = coins()
    holdings.rank(original, {USDC: 25_000_000}, PRICES)
    assert [c.symbol for c in original] == ["USDC", "WETH", "DUST"]
    assert original[0].balance == 0
