"""The address bar: what it says, and what the app does about it."""

from __future__ import annotations

import flet as ft
import pytest

from curve.http import ApiError
from curve.models import Coin, Pool
from ui import routing

WL = "0xC09e82f81Cb811DB0922dD48206fc2e212322caf"


# -- reading a route -------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("/", routing.Route()),
        ("", routing.Route()),
        (None, routing.Route()),
        ("/ethereum", routing.Route("ethereum")),
        ("/ethereum/", routing.Route("ethereum")),
        ("//ethereum//", routing.Route("ethereum")),
        ("/xdai", routing.Route("xdai")),
        ("/x-layer", routing.Route("x-layer")),
        (f"/ethereum/{WL}", routing.Route("ethereum", WL)),
        (f"/Ethereum/{WL}", routing.Route("ethereum", WL)),
    ],
)
def test_routes_are_read(raw, expected) -> None:
    assert routing.parse(raw) == expected


@pytest.mark.parametrize(
    "raw",
    ["/ethereum/deposit", "/ethereum/0x123", "/ethereum/" + "z" * 42, "/ethereum/0x"],
)
def test_a_second_segment_that_is_not_an_address_is_dropped(raw: str) -> None:
    assert routing.parse(raw) == routing.Route("ethereum")


def test_extra_segments_are_ignored() -> None:
    assert routing.parse(f"/ethereum/{WL}/anything/else") == routing.Route("ethereum", WL)


# -- writing one -----------------------------------------------------------


def test_routes_are_built() -> None:
    assert routing.build() == "/"
    assert routing.build("ethereum") == "/ethereum"
    assert routing.build("ethereum", WL) == f"/ethereum/{WL}"


def test_a_built_route_reads_back() -> None:
    for chain, pool in [("", ""), ("xdai", ""), ("xdai", WL)]:
        assert routing.parse(routing.build(chain, pool)) == routing.Route(chain, pool)


def test_a_pool_address_keeps_its_case_but_compares_without_it() -> None:
    assert routing.build("ethereum", WL).endswith(WL)
    assert routing.same_pool(WL, WL.lower())
    assert not routing.same_pool(WL, "0x" + "11" * 20)
    assert not routing.same_pool("", "")


# -- the handler -----------------------------------------------------------


def make_pool(address: str = WL, chain: str = "ethereum") -> Pool:
    pool = Pool(
        address=address,
        name="World Liberty USD1 Pool",
        chain=chain,
        chain_id=1,
        registry="stableswapng",
        lp_token=address,
        coins=[Coin("0x" + f"{i:02x}" * 20, f"C{i}", 18, index=i) for i in range(2)],
    )
    pool.onchain_coins = 2
    return pool


class StubPage:
    """Enough of `ft.Page` to record navigation."""

    def __init__(self, route: str = "/") -> None:
        self.route = route
        self.width = 1400
        self.pushed: list[str] = []
        self.tasks: list = []

    def push(self, route: str) -> None:
        """What a push amounts to here: a history entry and a new route."""
        self.pushed.append(route)
        self.route = route

    async def push_route(self, route: str) -> None:
        """Flet's own, which the app reaches through `run_task`."""
        self.push(route)

    def update(self) -> None:
        pass

    def run_task(self, handler, *args):
        # Navigation is applied rather than queued.
        if getattr(handler, "__name__", "") == "push_route":
            self.push(*args)
            return
        self.tasks.append((handler, args))
        return


class FakeApi:
    def __init__(self, pool: Pool | None = None) -> None:
        self.pool = pool
        self.asked: list[tuple[int, str]] = []

    async def get_pool(self, chain_id, address, chain=""):
        self.asked.append((chain_id, address))
        if self.pool is None:
            raise ApiError(f"No pool at {address} on this network.")
        return self.pool


#: "not given", so a test can ask for an API that finds *no* pool.
_DEFAULT = object()


class _Paged(ft.Container):
    """A page view, as far as anything routing does to one."""

    def set_layout(self, _layout) -> None:
        pass


async def _noop() -> None:
    pass


def make_app(route: str = "/", *, pool=_DEFAULT, chain: str = "ethereum"):
    """`CurveApp` with its constructor skipped -- only the routing parts."""
    import main as app_module

    app = app_module.CurveApp.__new__(app_module.CurveApp)
    app.page = StubPage(route)
    app.api = FakeApi(make_pool() if pool is _DEFAULT else pool)
    app.chains = {"ethereum": 1, "xdai": 100}
    app.chain = chain
    app._detail = None
    app.swap_page = None
    app._page_name = "pools"
    app._route_applied = True
    app.body = ft.Container()
    app._page_box = ft.Container()
    app.list_view = ft.Container()
    app.progress = ft.ProgressBar(visible=False)
    app.error = ft.Text("", visible=False)
    app.chain_picker = ft.SearchBar(value=chain)
    app._chain_tvls = {}
    app._chain_order = [chain, "xdai", "ethereum"]
    app.nav = ft.Container()          # the header's page links
    app.menu = ft.PopupMenuButton()
    app._icons = False
    app._totals = []
    app._opened_from = "pools"
    app.portfolio_view = _Paged()
    app.load_portfolio = _noop
    app.opened: list[Pool] = []

    def open_pool(pool_to_open):
        app.opened.append(pool_to_open)
        app._detail = type("Detail", (), {"pool": pool_to_open})()
        app.page.push(routing.build(pool_to_open.chain or app.chain, pool_to_open.address))

    app.open_pool = open_pool  # type: ignore[method-assign]
    return app


async def test_a_pool_url_opens_that_pool() -> None:
    app = make_app(f"/ethereum/{WL}")
    await app.apply_route(app.page.route)
    assert [p.address for p in app.opened] == [WL]


async def test_a_chain_url_shows_that_chain() -> None:
    app = make_app("/xdai", chain="ethereum")
    app.load_pools = _noop_loader(app)
    await app.apply_route("/xdai")
    assert app.chain == "xdai"
    # The bar names the network; the slug belongs to the app, not the label.
    assert app.chain_picker.value == "Gnosis"


def _noop_loader(app):
    async def load():
        app.loaded = True
    return load


async def test_a_chain_the_api_does_not_know_is_ignored() -> None:
    app = make_app("/nosuchchain", chain="ethereum")
    await app.apply_route("/nosuchchain")
    assert app.chain == "ethereum"


async def test_the_same_pool_again_is_not_reopened() -> None:
    app = make_app(f"/ethereum/{WL}")
    await app.apply_route(app.page.route)
    await app.apply_route(app.page.route)
    assert len(app.opened) == 1


async def test_the_same_pool_in_another_case_is_still_the_same() -> None:
    app = make_app(f"/ethereum/{WL}")
    await app.apply_route(app.page.route)
    await app.apply_route(f"/ethereum/{WL.lower()}")
    assert len(app.opened) == 1


async def test_going_back_to_a_chain_route_closes_the_pool() -> None:
    app = make_app(f"/ethereum/{WL}")
    await app.apply_route(app.page.route)
    assert app._detail is not None

    await app.apply_route("/ethereum")

    assert app._detail is None


async def test_going_back_does_not_push_another_entry() -> None:
    app = make_app(f"/ethereum/{WL}")
    await app.apply_route(app.page.route)
    app.page.route = "/ethereum"      # as the browser leaves it after Back
    app.page.pushed.clear()

    await app.apply_route("/ethereum")

    assert app.page.pushed == []


async def test_a_pool_that_cannot_be_fetched_says_so_and_shows_the_list() -> None:
    app = make_app(f"/ethereum/{WL}", pool=None)
    await app.apply_route(app.page.route)
    assert app.opened == []
    assert app.error.visible is True
    assert WL in app.error.value


async def test_a_deep_link_asks_the_api_for_that_one_pool() -> None:
    app = make_app(f"/ethereum/{WL}")
    await app.apply_route(app.page.route)
    assert app.api.asked == [(1, WL)]


# -- the chain picker ------------------------------------------------------


def test_picking_the_chain_you_are_already_on_does_nothing() -> None:
    app = make_app(f"/ethereum/{WL}")
    app.open_pool(make_pool())
    app.page.pushed.clear()
    app.page.tasks.clear()
    detail = app._detail

    app._chain_picked("ethereum")                 # the one already selected

    assert app._detail is detail                  # still on the pool
    assert app.page.pushed == []                  # no history entry
    # Nothing refetched. Closing the view is a task of its own -- it waits
    # on the client -- so this asks what was *reloaded*.
    assert [t for t, _a in app.page.tasks if "load" in getattr(t, "__name__", "")] == []


def test_picking_a_different_chain_does_switch() -> None:
    app = make_app(f"/ethereum/{WL}")
    app.open_pool(make_pool())
    app.page.tasks.clear()

    app._chain_picked("xdai")

    assert app.chain == "xdai"
    assert app._detail is None                    # back to the list
    assert app.page.tasks                          # and it reloads it


# -- the portfolio page ----------------------------------------------------


def test_portfolio_is_a_page_not_a_pool() -> None:
    route = routing.parse("/ethereum/portfolio")
    assert route == routing.Route("ethereum", page="portfolio")
    assert route.is_portfolio and not route.is_pool


def test_the_portfolio_route_reads_back() -> None:
    built = routing.build("xdai", page="portfolio")
    assert built == "/xdai/portfolio"
    assert routing.parse(built).is_portfolio


def test_a_pool_route_is_not_a_portfolio() -> None:
    assert not routing.parse(f"/ethereum/{WL}").is_portfolio
    assert not routing.parse("/ethereum").is_portfolio


def open_from_portfolio(app) -> None:
    """Stand on the portfolio, then open one of its rows."""
    app.show_portfolio()
    app.open_pool(make_pool())


async def test_back_out_of_a_pool_opened_from_the_portfolio() -> None:
    """The browser's Back button, which is a route change and nothing else.

    `_page_name` still says "portfolio" while a pool from it is open --
    a pool is not a page and does not claim the nav -- so "am I already
    there?" cannot be answered by the name alone. It was, and Back left
    the pool on screen; the next Back then found a detail view open on a
    chain route and went to the list, which is how the portfolio turned
    into Pools.
    """
    app = make_app("/ethereum/portfolio")
    open_from_portfolio(app)

    await app.apply_route("/ethereum/portfolio")

    assert app._detail is None, "the pool page is gone"
    assert app._page_name == "portfolio"


async def test_backing_out_does_not_refetch_the_portfolio() -> None:
    """Its rows are still there. Reading a wallet's positions again costs
    a round of chain calls for a page nobody has left.
    """
    app = make_app("/ethereum/portfolio")
    open_from_portfolio(app)
    app.page.tasks.clear()

    await app.apply_route("/ethereum/portfolio")

    assert app.load_portfolio not in [task for task, _a in app.page.tasks]


async def test_reaching_the_portfolio_from_a_pool_does_fill_it_in() -> None:
    """The same route arrived at from a pool opened off the *list*, where
    the portfolio has never been drawn and has nothing to show.
    """
    app = make_app(f"/ethereum/{WL}")
    app.open_pool(make_pool())          # opened from the list
    app.page.tasks.clear()

    await app.apply_route("/ethereum/portfolio")

    assert app._detail is None and app._page_name == "portfolio"
    assert app.load_portfolio in [task for task, _a in app.page.tasks]


async def test_the_portfolio_route_while_already_there_is_a_no_op() -> None:
    app = make_app("/ethereum/portfolio")
    app.show_portfolio()
    app.page.tasks.clear()
    app.page.pushed.clear()

    await app.apply_route("/ethereum/portfolio")

    assert app.page.tasks == [] and app.page.pushed == []


# -- opening somewhere else --------------------------------------------


def test_a_route_can_be_asked_for_on_the_command_line(monkeypatch) -> None:
    import main as app_module

    monkeypatch.setenv(app_module.ROUTE_ENV, "/ethereum/portfolio")
    assert app_module.startup_route() == "/ethereum/portfolio"


@pytest.mark.parametrize("junk", ["", "portfolio", "  ", "ethereum/portfolio"])
def test_a_route_that_is_not_one_is_ignored(monkeypatch, junk) -> None:
    import main as app_module

    monkeypatch.setenv(app_module.ROUTE_ENV, junk)
    assert app_module.startup_route() == ""


def test_a_theme_can_be_asked_for_too(monkeypatch) -> None:
    import main as app_module

    monkeypatch.setenv(app_module.THEME_ENV, "CHAD")
    assert app_module.startup_theme() == "chad"


@pytest.mark.parametrize("junk", ["", "solarized", "dark mode"])
def test_a_theme_that_is_not_one_is_ignored(monkeypatch, junk) -> None:
    import main as app_module

    monkeypatch.setenv(app_module.THEME_ENV, junk)
    assert app_module.startup_theme() == ""


def test_nothing_asked_for_is_nothing_forced(monkeypatch) -> None:
    import main as app_module

    monkeypatch.delenv(app_module.ROUTE_ENV, raising=False)
    monkeypatch.delenv(app_module.THEME_ENV, raising=False)
    assert app_module.startup_route() == ""
    assert app_module.startup_theme() == ""
