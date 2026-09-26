"""What the Swap tab says when a quoted route cannot be sent, and where it
puts the route once it has one.

A route that quotes is not always a route that can be *shipped*: the router
refuses to encode one whose legs are too small to carry a minimum rate, which
is it declining to send something it cannot protect rather than anything
having gone wrong.  The quote itself is still the chain's own number.
"""

from __future__ import annotations

from router import Stage
from ui.responsive import layout_for
from ui.swap import SwapView
from ui.swap_page import _why_unsendable


class EncodingError(RuntimeError):
    """Named as the router names it, since the mapping keys off that."""


def test_a_leg_too_small_to_protect_is_said_in_one_line():
    """The router's own message is written for a terminal.

    Verbatim from a real refusal -- it names both pools, the wei in and out of
    each, and the flag that would ship it unprotected.  Right for someone
    debugging a route, and far too much under a swap button.
    """
    exc = EncodingError(
        "leg(s) 3 on 0xf05Bc5C38a8F5E3D98c72f11bC59E713F8a32228 (9329968064 "
        "in, 0 out), 5 on 0x8273Cb2cF9AF3228fD14AF25B5B1De2A9676C372 "
        "(35540624523651 in, 35 out) produce too little for a minimum rate to "
        "bound -- one unit of the output is more than the tolerance.  A leg "
        "worth that little is not worth executing; re-solve without it, or "
        "pass allow_unbounded to ship it unprotected"
    )
    said = _why_unsendable(exc)
    assert said == "This route has a leg too small to protect, so it cannot be sent"
    assert "0x" not in said and "allow_unbounded" not in said


def test_another_encoding_refusal_still_says_something_useful():
    assert _why_unsendable(EncodingError("32 legs is the most")) == (
        "This route cannot be packed into one call"
    )


def test_anything_else_is_reported_rather_than_hidden():
    said = _why_unsendable(RuntimeError("the endpoint went away\nand the rest"))
    assert said.startswith("This route cannot be sent: the endpoint went away")
    assert "\n" not in said, "one line, whatever the exception did"


def build_view():
    """A `SwapView` with nothing behind it.

    It only ever reads `page` for theme colours at draw time, so a bare object
    is enough to exercise its layout arithmetic without a window.
    """
    class NoPage:
        pass

    return SwapView(NoPage(), "ethereum", on_amount=lambda *_: None,
                    on_pair=lambda *_: None, on_max=lambda *_: None,
                    on_approve=lambda *_: None, on_swap=lambda *_: None)


def test_the_first_route_does_not_disturb_what_is_being_typed():
    """The stacked route appears without rebuilding the widget above it.

    It used to be added to the column when the first quote arrived, and that
    is an update of the subtree the amount field lives in -- which sends the
    server's copy of the field back to the browser, over whatever has been
    typed since.  Someone typing "2000000" watched it become "2" at the
    moment their first answer appeared.
    """
    view = build_view()
    view.set_layout(layout_for(400))
    assert view._stacked
    view.amount.value = "2000000"
    before = view._body.controls[0]

    view.show_route(object())

    assert view._body.controls[0] is before, "the same column, untouched"
    assert view.amount.value == "2000000"
    assert view.diagram.visible


def test_a_route_that_goes_away_hides_the_frame_again():
    view = build_view()
    view.set_layout(layout_for(400))
    view.show_route(object())
    view.show_route(None)
    assert not view.diagram.visible


def test_a_wide_window_keeps_the_frame_beside_the_widget_throughout():
    """Route or no route: the frame appearing on the first quote used to
    shift the widget sideways just as someone finished typing into it."""
    view = build_view()
    view.set_layout(layout_for(1400))
    assert not view._stacked
    assert view.diagram in view._body.controls and view.diagram.visible
    view.show_route(object())
    assert view.diagram in view._body.controls and view.diagram.visible


def test_a_failure_says_which_block_it_happened_at():
    """A router that will not price a pair it priced a minute ago is a thing
    to reproduce, and reproducing it means pinning the state."""
    from ui.swap_page import _with_block

    exc = RuntimeError("src not connected to dst through the active set")
    assert _with_block(exc, 25_812_795) == (
        "src not connected to dst through the active set (block 25,812,795)"
    )


def test_a_failure_with_no_block_to_name_says_the_rest_anyway():
    from ui.swap_page import _with_block

    assert _with_block(RuntimeError("the endpoint went away"), 0) == (
        "the endpoint went away"
    )
    assert _with_block(RuntimeError(""), 0) == "RuntimeError"


class Wallet:
    """A wallet that arrives after the tab is already open."""

    def __init__(self) -> None:
        self.address = ""
        self.balances: dict[str, int] = {}

    def connect(self, address: str, **balances: int) -> None:
        self.address = address
        self.balances = {token.lower(): held for token, held in balances.items()}


class Reader:
    """Answers `balanceOf` from the wallet, and nothing else."""

    def __init__(self, wallet: Wallet) -> None:
        self.wallet = wallet

    async def call(self, to: str, data: str) -> str:
        held = self.wallet.balances.get(to.lower(), 0)
        return "0x" + f"{held:064x}"

    async def get_balance(self, _address: str) -> int:
        return 0


def swap_page_with(wallet: Wallet, coins):
    """A `SwapPage` wired to that wallet and nothing else that needs a network."""
    from ui.swap_page import SwapPage

    class NoPage:
        def run_task(self, *_a, **_kw) -> None:
            pass

    page = SwapPage(
        NoPage(),
        api=None,
        chain_name=lambda: "ethereum",
        chain_id=lambda: 1,
        provider_for=lambda: Reader(wallet),
        account=lambda: wallet.address,
        on_loading=lambda *_a: None,
        on_loaded=lambda *_a: None,
    )
    page.chain_id_now = 1
    page.view.offer(coins, "ethereum")
    page.view.set_pair(coins[0], coins[1])
    return page


def two_coins():
    from router.universe import CoinEntry

    return [
        CoinEntry("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "USDC",
                  "USD Coin", 6, 0.0, 0),
        CoinEntry("0xdac17f958d2ee523a2206206994597c13d831ec7", "USDT",
                  "Tether", 6, 0.0, 0),
    ]


async def test_a_wallet_that_connects_after_the_tab_is_open_still_shows_a_balance():
    """Everything wallet-shaped here is read through a callable, so nothing
    was stale -- it was simply never asked again."""
    coins = two_coins()
    wallet = Wallet()
    page = swap_page_with(wallet, coins)

    await page._read_balances()
    assert page.view.amount.hint_text == "0.0", "nobody connected, nothing to show"

    wallet.connect("0x" + "11" * 20, **{coins[0].address: 8_598_432_131})
    await page.wallet_changed()

    assert page.view.amount.hint_text == "8,598.43"


async def test_max_works_once_the_wallet_is_there():
    coins = two_coins()
    wallet = Wallet()
    page = swap_page_with(wallet, coins)
    page._max_clicked()
    assert page.view.amount.value in ("", None), "no balance, nothing to fill"

    wallet.connect("0x" + "11" * 20, **{coins[0].address: 2_500_000})
    await page.wallet_changed()
    page._max_clicked()

    assert page.view.amount.value == "2.5"


async def test_a_wallet_going_away_takes_the_balance_with_it():
    """A figure left on screen after the wallet has gone is a figure for
    nobody."""
    coins = two_coins()
    wallet = Wallet()
    page = swap_page_with(wallet, coins)
    wallet.connect("0x" + "11" * 20, **{coins[0].address: 8_598_432_131})
    await page.wallet_changed()
    assert page.view.amount.hint_text == "8,598.43"

    wallet.address = ""
    await page.wallet_changed()

    assert page.view.amount.hint_text == "0.0"


def view_with(coins):
    """Just the `SwapView`, with no network behind it."""
    from ui.swap import SwapView

    class NoPage:
        def run_task(self, *_a, **_kw) -> None:
            pass

    view = SwapView(NoPage(), "ethereum", on_amount=lambda *_: None,
                    on_pair=lambda *_: None, on_max=lambda *_: None,
                    on_approve=lambda *_: None, on_swap=lambda *_: None)
    view.offer(coins, "ethereum")
    return view


def held_and_not():
    """Two coins in volume order, the second of which the wallet holds."""
    from router.universe import CoinEntry

    return [
        CoinEntry("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "USDC",
                  "USD Coin", 6, volume=9.0),
        CoinEntry("0xdac17f958d2ee523a2206206994597c13d831ec7", "USDT",
                  "Tether", 6, volume=1.0),
    ]


def test_only_the_selling_side_is_reordered_by_what_is_held():
    """What somebody already holds says nothing about what they want to buy."""
    from router import holdings

    coins = held_and_not()
    ranked = holdings.rank(
        coins, {coins[1].address: 5_000_000}, {coins[1].address: 1.0})
    view = view_with(coins)

    view.offer(coins, "ethereum", owned=ranked)

    assert [c.symbol for c in view.sell._entries] == ["USDT", "USDC"]
    assert [c.symbol for c in view.buy._entries] == ["USDC", "USDT"]


def test_the_buying_side_shows_no_balance_against_a_coin():
    """A balance beside a coin someone is buying answers a question they did
    not ask."""
    from router import holdings

    coins = held_and_not()
    ranked = holdings.rank(
        coins, {coins[1].address: 5_000_000}, {coins[1].address: 1.0})
    view = view_with(coins)

    view.offer(coins, "ethereum", owned=ranked)

    assert view.sell._entries[0].balance == 5_000_000
    assert all(entry.balance == 0 for entry in view.buy._entries)


def test_with_nothing_held_both_sides_are_the_same_list():
    coins = held_and_not()
    view = view_with(coins)

    view.offer(coins, "ethereum", owned=None)

    assert [c.symbol for c in view.sell._entries] == ["USDC", "USDT"]
    assert [c.symbol for c in view.buy._entries] == ["USDC", "USDT"]


class Session:
    """A session that records what `plan_call` was told."""

    solver = "rust"
    block = 100

    def __init__(self) -> None:
        self.planned: list[int] = []

    def diagram(self, _result):
        class Empty:
            buses = elements = order = ()
        return Empty()

    async def plan_call(self, _result, *, receiver, sender, not_before=0):
        self.planned.append(not_before)

        class Plan:
            to = "0x" + "22" * 20
            data = b""
            value = 0
            token_in = "0x" + "33" * 20
            amount_in = 1
            quoted_out = guaranteed_out = 1
            tolerance_bp = 0.0
            gas = 0
            block = 100
            unbounded = ()
            reverted = ""
            gas_estimated = False

        return Plan()


async def test_a_plan_is_told_the_block_an_approval_landed_in():
    """The router reads through a load balancer, which is many nodes at
    slightly different heights.  One still behind cannot see an approval that
    has already happened, and the dry run then reverts on an allowance that
    is there."""
    coins = two_coins()
    page = swap_page_with(Wallet(), coins)
    session = Session()
    # `RouterHost.session` reads through to the chain it is holding, so the
    # fake goes where the real one would be kept.
    held = page.host._held           # creates the entry for the current chain
    held.session = session
    held.stage = Stage.READY

    class Route:
        legs = ()

    class Result:
        route = Route()
        verified_out = 1
        amount_in = 1
        price_impact_bp = 0.0

    page._quote = type("Quote", (), {"result": Result()})()

    await page._plan_now()
    assert session.planned == [0], "nothing confirmed yet, so no floor"

    page._floor_block = 25_813_900
    await page._plan_now()
    assert session.planned[-1] == 25_813_900


async def test_the_floor_only_ever_moves_forward():
    """A later transaction in an earlier block would be a reorg, not a lag."""
    page = swap_page_with(Wallet(), two_coins())
    page._floor_block = 200

    page._floor_block = max(page._floor_block, 150)
    assert page._floor_block == 200


# -- picking the coin the other side already holds ---------------------------


def test_choosing_the_other_side_s_coin_swaps_the_pair():
    """Nobody asks to swap USDC for USDC.

    Picking the coin the other selector holds is the pair the other way
    round, which is what the flip button does -- so the other selector takes
    what this one was showing rather than both ending up the same.
    """
    coins = two_coins()
    usdc, usdt = coins
    page = swap_page_with(Wallet(), coins)
    assert page.view.pair == (usdc, usdt)

    page.view.sell.pick(usdt)           # sell := the coin buy already holds

    assert page.view.pair == (usdt, usdc), "it swapped rather than doubled"


def test_it_works_from_the_buying_side_too():
    coins = two_coins()
    usdc, usdt = coins
    page = swap_page_with(Wallet(), coins)

    page.view.buy.pick(usdc)            # buy := the coin sell already holds

    assert page.view.pair == (usdt, usdc)


def test_an_unrelated_coin_leaves_the_other_side_alone():
    coins = two_coins()
    usdc, usdt = coins
    third = type(usdc)("0x" + "33" * 20, "DAI", "Dai", 18, 0.0, 0)
    page = swap_page_with(Wallet(), coins)

    page.view.sell.pick(third)

    assert page.view.pair == (third, usdt), "the buying side moved for no reason"


# -- what a swap of ours changes about this wallet --------------------------


class Sending:
    """A router contract with no chain behind it."""

    can_send = True

    async def execute(self, _plan) -> str:
        return "0x" + "ef" * 32

    async def needs_approval(self, _plan) -> bool:
        return False

    async def balance_of(self, _token: str) -> int:
        return 5_000_000


class Planned:
    """Enough of an execution plan for the send path to read."""

    def __init__(self) -> None:
        self.reverted = ""
        self.to = "0x" + "22" * 20
        self.token_in = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
        self.amount_in = 1_000
        self.value = 0
        self.data = b""


async def test_a_swap_re_reads_both_balances_and_the_picker_order():
    """The swap moved this wallet, not just the pools.

    Both boxes print a balance as their hint, and the selling picker is
    ordered by those balances with the figures beside them -- so a swap that
    leaves either alone is showing what was true just before the transaction
    this tab sent.
    """
    import asyncio

    coins = two_coins()
    wallet = Wallet()
    wallet.connect("0x" + "11" * 20, **{coins[0].address: 5_000_000})
    page = swap_page_with(wallet, coins)

    scheduled = []
    page._page.run_task = lambda fn, *a: scheduled.append(fn)
    read = []
    original = page._read_balances

    async def watched():
        read.append(True)
        await original()

    page._read_balances = watched
    page._plan = Planned()
    contract = Sending()
    page._contract = lambda: contract
    page._confirm = lambda *a, **k: asyncio.sleep(0, result=0)

    class Host:
        async def after_swap(self):
            return 0

    page.host = Host()

    await page._swap()

    assert read, "the boxes still show the balance from before the swap"
    assert page._rank_by_holdings in scheduled, (
        "the selling picker kept its pre-swap order and figures"
    )


# -- the button between the two boxes ---------------------------------------


def test_flipping_carries_the_worked_out_amount_across():
    """Selling 1,000 USDT for 0.01 WBTC and flipping asks to sell the 0.01.

    Carrying the typed number across instead would ask to sell a thousand
    WBTC, which is a different question by four orders of magnitude and the
    one the widget used to put on screen.
    """
    coins = two_coins()
    usdc, usdt = coins
    page = swap_page_with(Wallet(), coins)
    page.view.amount.value = "1000"
    page.view.receive.value = "0.010000"

    page.view._flip_clicked(None)

    assert page.view.pair == (usdt, usdc), "the coins turned round"
    assert page.view.amount.value == "0.010000", "the amounts did not follow"
    assert page.view.receive.value == "", "the output was guessed rather than quoted"


def test_flipping_with_nothing_quoted_keeps_what_was_typed():
    """With no output there is nothing better to offer than what was typed."""
    coins = two_coins()
    usdc, usdt = coins
    page = swap_page_with(Wallet(), coins)
    page.view.amount.value = "1000"
    page.view.receive.value = ""

    page.view._flip_clicked(None)

    assert page.view.pair == (usdt, usdc)
    assert page.view.amount.value == "1000"


# -- the coins a pool holds, which its ribbon is drawn with -----------------


def pool_rows():
    return [{
        "address": "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
        "name": "Curve.fi DAI/USDC/USDT",
        "coins": [
            {"address": "0x6b175474e89094c44da98b954eedeac495271d0f",
             "symbol": "DAI", "decimals": 18},
            {"address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
             "symbol": "USDC", "decimals": 6},
        ],
    }]


def test_re_ordering_the_coins_keeps_the_pool_logos():
    """The ribbons lost their logos as soon as a wallet turned up.

    `offer` carries two unrelated things: which coins exist, and which pools
    hold what.  The callers that re-offer for *ordering* -- a wallet
    connecting, a swap of ours landing -- have no pool rows to hand over, and
    passing none used to empty the table, so every pool on the picture went
    back to being a name on its own for the rest of the session.
    """
    coins = two_coins()
    page = swap_page_with(Wallet(), coins)
    page.view.offer(coins, "ethereum", pools=pool_rows())
    assert page.view.diagram._pool_coins, "the rows never arrived"

    page.view.offer(coins, "ethereum", owned=list(reversed(coins)))

    assert page.view.diagram._pool_coins, "re-ordering threw the logos away"
    held = page.view.diagram._pool_coins[
        "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7"]
    assert [coin.symbol for coin in held] == ["DAI", "USDC"]


def test_a_different_chain_does_empty_it():
    """An address that means one pool here means nothing on the next network,
    and the wrong coins on a ribbon are worse than none."""
    coins = two_coins()
    page = swap_page_with(Wallet(), coins)
    page.view.offer(coins, "ethereum", pools=pool_rows())

    page.view.diagram.set_chain("arbitrum")

    assert page.view.diagram._pool_coins == {}



# -- an amount is a count of one particular coin's units --------------------


def test_the_flip_writes_a_number_with_no_separators_in_it():
    """What goes in the box is read back as a number.

    A thousands separator is only ever in the way there, and in a locale
    where a comma *is* the decimal point it is worse than in the way.
    """
    coins = two_coins()
    page = swap_page_with(Wallet(), coins)
    page.view.amount.value = "0.01"
    page.view.receive.value = "1,998,432.10"

    page.view._flip_clicked(None)

    assert page.view.amount.value == "1998432.10"


async def test_a_new_selling_coin_is_quoted_in_its_own_units():
    """2,000,000 USDC and 2,000,000 sDOLA are the same figure and a million
    million apart in units.

    The host is handed a raw count, and `set_pair` ends by quoting whatever it
    still holds -- so a pair change used to re-ask at the old coin's scale.
    Two million USDC read as sDOLA is two millionths of one, which does not
    route, and the refusal then cleared the amount so nothing quoted again.
    """
    from router.universe import CoinEntry

    usdc = CoinEntry("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "USDC",
                     "USD Coin", 6, 0.0, 0)
    sdola = CoinEntry("0x" + "5d" * 20, "sDOLA", "Staked DOLA", 18, 0.0, 0)
    page = swap_page_with(Wallet(), [usdc, sdola])
    page.view.set_pair(sdola, usdc)
    page.view.amount.value = "1998432.10"

    asked = []

    class Host:
        stage = Stage.READY

        def request(self, amount):
            asked.append(amount)

        async def set_pair(self, _src, _dst):
            return True

    page.host = Host()
    page._on_loading = lambda *_a: None
    page._on_loaded = lambda *_a: None

    async def no_balances():
        return None

    page._read_balances = no_balances

    await page._prepare(sdola.address, usdc.address)

    assert asked[0] == 0, "the old coin's count was left for set_pair to quote"
    assert asked[-1] == 1998432 * 10 ** 18 + 10 ** 17, (
        f"quoted at the wrong scale: {asked[-1]}"
    )


# -- what waits in the frame before there is a route ------------------------


def test_the_frame_waits_with_a_sticker_and_no_caption():
    """From the first frame, not from the first quote.

    Nothing called `show` until a quote or a pair change, so a freshly opened
    tab sat through the whole warm -- twenty seconds, the longest anyone looks
    at this panel -- showing a line of grey text and nothing else.
    """
    page = swap_page_with(Wallet(), two_coins())

    assert page.view.diagram._meme.visible, "the frame opened empty"
    assert page.view.diagram._empty.value == "", (
        "a caption saying the route appears here, under a picture that is "
        "plainly not a route"
    )


def test_a_reason_is_said_without_a_joke_beside_it():
    """A picture next to a failure reads as being pleased about it."""
    page = swap_page_with(Wallet(), two_coins())

    page.view.diagram.say("This route could not be drawn.")

    assert page.view.diagram._meme.visible is False
    assert page.view.diagram._empty.value == "This route could not be drawn."


def test_going_back_to_waiting_asks_for_another(monkeypatch):
    from ui import swap as swap_module

    asked = []

    def counted() -> str:
        asked.append(1)
        return "memes/001.webp"

    monkeypatch.setattr(swap_module.assets, "meme", counted)
    page = swap_page_with(Wallet(), two_coins())
    diagram = page.view.diagram
    before = len(asked)

    diagram.say("nothing to draw")
    diagram._show_meme(True)

    assert len(asked) == before + 1, "it put the same one back up"
    assert diagram._meme.visible


def test_staying_empty_keeps_the_same_one(monkeypatch):
    """Picking again on every redraw turns a thing to look at into a
    thing that flickers -- and `show(None)` runs on every keystroke."""
    from ui import swap as swap_module

    asked = []

    def counted() -> str:
        asked.append(1)
        return "memes/001.webp"

    monkeypatch.setattr(swap_module.assets, "meme", counted)
    page = swap_page_with(Wallet(), two_coins())
    diagram = page.view.diagram
    before = len(asked)

    diagram._show_meme(True)
    diagram._show_meme(True)

    assert len(asked) == before, "it re-picked while nothing had changed"


# -- and not flashing in the gap between two routes -------------------------


class Looping:
    """A page whose `run_task` actually runs the coroutine."""

    def __init__(self) -> None:
        self.tasks: list = []

    def run_task(self, handler, *args):
        import asyncio

        task = asyncio.ensure_future(handler(*args))
        self.tasks.append(task)
        return task


async def test_a_route_going_away_does_not_flash_a_sticker():
    """The flip empties the frame and fills it again as soon as the new quote
    lands.  A picture in the few hundred milliseconds between the two is a
    flash, not something to look at."""
    import asyncio

    from ui import swap as swap_module

    page = swap_page_with(Wallet(), two_coins())
    diagram = page.view.diagram
    diagram._page = Looping()
    diagram._meme.visible = False
    diagram._diagram = object()             # a route is showing

    monkeyish = swap_module.MEME_AFTER
    try:
        swap_module.MEME_AFTER = 0.05
        diagram.show(None)                  # the flip empties it
        assert diagram._meme.visible is False, "it went up straight away"
        assert diagram._empty.value == "", "the caption flashed instead"

        diagram._diagram = object()         # the new quote lands first
        await asyncio.sleep(0.12)
        assert diagram._meme.visible is False, "it went up behind the route"
    finally:
        swap_module.MEME_AFTER = monkeyish


async def test_but_it_does_go_up_if_no_route_arrives():
    import asyncio

    from ui import swap as swap_module

    page = swap_page_with(Wallet(), two_coins())
    diagram = page.view.diagram
    diagram._page = Looping()
    diagram._meme.visible = False
    diagram._diagram = object()

    monkeyish = swap_module.MEME_AFTER
    try:
        swap_module.MEME_AFTER = 0.05
        diagram.show(None)
        await asyncio.sleep(0.12)
        assert diagram._meme.visible, "the frame was left blank"
        assert diagram._empty.value == ""
    finally:
        swap_module.MEME_AFTER = monkeyish


# -- switching network ------------------------------------------------------


async def test_a_new_network_takes_the_old_one_off_the_screen():
    """The amount counts a coin that is not in the new list, the figures were
    quoted against pools that are not on it, and the route drawn belongs to
    the network being left -- and the warm ahead is twenty seconds, which is
    a long time to show somebody the wrong network's answer."""
    coins = two_coins()
    page = swap_page_with(Wallet(), coins)
    page.chain_id_now = 1
    page.view.amount.value = "2000"
    page.view.receive.value = "1999.5"
    page.view.diagram._diagram = object()
    page._quote = object()
    page._plan = Planned()
    page._balances = {coins[0].address: 5}

    page._chain_id = lambda: _answer(100)
    page._chain_name = lambda: "gnosis"
    page._offer_coins = lambda _id: _answer(None)
    page._read_balances = lambda: _answer(None)
    page._backend_error = "no backend here"

    await page.open()

    assert page.view.amount.value == "", "the old network's amount stayed"
    assert page.view.receive.value == "", "the old network's figure stayed"
    assert page.view.diagram._diagram is None, "the old network's route stayed"
    assert page._quote is None and page._plan is None
    assert page._balances == {}


async def test_the_frame_waits_with_a_picture_not_the_old_route():
    coins = two_coins()
    page = swap_page_with(Wallet(), coins)
    page.view.diagram._diagram = object()
    page.view.diagram._meme.visible = False

    page.view.forget_chain()

    assert page.view.diagram._meme.visible, "it left the frame blank"
    assert page.view.diagram._empty.value == ""


def _answer(value):
    import asyncio

    return asyncio.sleep(0, result=value)


# -- what a chain opens on --------------------------------------------------


async def test_a_chain_does_not_open_on_a_wrapping():
    """The gas token is listed beside its own wrapper, and the default pair
    is the two busiest coins -- so gnosis would have opened on XDAI to WXDAI,
    which is one for one, for ever, with no rate to show."""
    from router.universe import NATIVE, CoinEntry

    wxdai = "0xe91d153e0b41518a2ce8dd3d7944fa863463a97d"
    coins = [
        CoinEntry(NATIVE, "XDAI", "xDAI", 18, 900.0, 3),
        CoinEntry(wxdai, "WXDAI", "Wrapped xDAI", 18, 900.0, 3),
        CoinEntry("0x" + "11" * 20, "USDC.e", "USD Coin", 6, 500.0, 2),
    ]
    page = swap_page_with(Wallet(), coins)
    page._remembered_pair = lambda _id: _answer(None)

    await page._open_pair(100, coins)

    sell, buy = page.view.pair
    assert sell.symbol == "XDAI"
    assert buy.symbol == "USDC.e", f"opened on a wrapping: XDAI -> {buy.symbol}"


async def test_a_remembered_wrapping_is_still_honoured():
    """Choosing one is fine; it is only a poor thing to *open* on."""
    from router.universe import NATIVE, CoinEntry

    wxdai = "0xe91d153e0b41518a2ce8dd3d7944fa863463a97d"
    coins = [
        CoinEntry(NATIVE, "XDAI", "xDAI", 18, 900.0, 3),
        CoinEntry(wxdai, "WXDAI", "Wrapped xDAI", 18, 900.0, 3),
        CoinEntry("0x" + "11" * 20, "USDC.e", "USD Coin", 6, 500.0, 2),
    ]
    page = swap_page_with(Wallet(), coins)
    page._remembered_pair = lambda _id: _answer((NATIVE, wxdai))

    await page._open_pair(100, coins)

    assert [c.symbol for c in page.view.pair] == ["XDAI", "WXDAI"]


# -- a pool's name on a narrow picture --------------------------------------


def a_band(label: str, detail: str, x0: float, x1: float):
    """One ribbon running straight between two columns."""
    from ui.routegraph import Band

    return Band(index=0, label=label, kind="SWAP_STABLE", share=1.0,
                points=((x0, 100.0), (x1, 100.0)), height=40.0, detail=detail)


def test_the_marks_go_before_the_name_does():
    """The stack is the ornament and the name is what is being read.

    A fifteen-leg route in a 720-point panel had eleven names dropped for
    width -- and six of those fit once the coin stack came off, which is the
    difference between a picture that says where the money went and one that
    does not.
    """
    from curve.models import Coin

    coins = two_coins()
    page = swap_page_with(Wallet(), coins)
    diagram = page.view.diagram
    pool = "0x" + "ab" * 20
    diagram._pool_coins = {pool: [
        Coin(address="0x" + "11" * 20, symbol="DOLA", decimals=18),
        Coin(address="0x" + "22" * 20, symbol="sUSDe", decimals=18),
    ]}
    # Room for the name and not for the name plus two marks.
    band = a_band("DOLA/sUSDe", pool, 300.0, 400.0)

    drawn = diagram._leg_row([band], 720.0, [])

    assert len(drawn) == 1, "the name was dropped rather than the marks"


def test_a_name_that_will_not_fit_at_all_is_still_dropped():
    """There are eighteen-leg routes, and a name wider than its ribbon put
    over the top of everything is not a picture of anything."""
    coins = two_coins()
    page = swap_page_with(Wallet(), coins)
    diagram = page.view.diagram
    pool = "0x" + "cd" * 20
    diagram._pool_coins = {}
    band = a_band("Curve Strategic Ethena Reserves", pool, 300.0, 330.0)

    assert diagram._leg_row([band], 720.0, []) == []


def test_the_marks_stay_where_there_is_room_for_them():
    from curve.models import Coin

    coins = two_coins()
    page = swap_page_with(Wallet(), coins)
    diagram = page.view.diagram
    pool = "0x" + "ef" * 20
    diagram._pool_coins = {pool: [
        Coin(address="0x" + "11" * 20, symbol="DOLA", decimals=18),
        Coin(address="0x" + "22" * 20, symbol="sUSDe", decimals=18),
    ]}
    band = a_band("DOLA/sUSDe", pool, 100.0, 600.0)

    drawn = diagram._leg_row([band], 720.0, [])

    assert len(drawn) == 1
    import flet as ft
    assert isinstance(drawn[0].content.content, ft.Row), "the marks were dropped"


# -- and the marks shrink to what is left ------------------------------------


def test_marks_take_the_room_left_beside_the_name():
    from ui.swap import POOL_MARK, _marks_that_fit, _stack_width

    plenty = _marks_that_fit(2, _stack_width(2) + 20.0)

    assert plenty == POOL_MARK, "it drew them smaller than it had to"


def test_marks_shrink_rather_than_go():
    """Taking them off to make a name fit left the room they wanted empty --
    fifteen to twenty-five points of it, which is a smaller stack."""
    from ui.swap import POOL_MARK, POOL_MARK_MIN, _marks_that_fit, _stack_width

    tight = _stack_width(2) - 4.0
    mark = _marks_that_fit(2, tight)

    assert POOL_MARK_MIN <= mark < POOL_MARK
    assert _stack_width(2, mark) <= tight, "the smaller stack still did not fit"


def test_marks_go_when_they_would_be_dots():
    """Below the floor a token mark says a pool has coins and nothing about
    which, which is not worth the room."""
    from ui.swap import _marks_that_fit

    assert _marks_that_fit(2, 8.0) == 0.0


def test_a_pool_with_no_coins_asks_for_nothing():
    from ui.swap import _marks_that_fit

    assert _marks_that_fit(0, 100.0) == 0.0
