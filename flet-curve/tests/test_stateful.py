"""Driving the app through random sequences of what a user can do."""

from __future__ import annotations

import asyncio
import inspect
import os
from typing import Any

import flet as ft
import pytest
from hypothesis import HealthCheck, settings
from hypothesis import strategies as st
from hypothesis.stateful import RuleBasedStateMachine, invariant, precondition, rule

from curve.models import Coin, Pool
from tests.fake_session import Event, Session
from ui import routing, theme
from ui.pool_list import PoolListView, PoolRow

CHAINS = {"ethereum": 1, "xdai": 100, "sonic": 146}
LITE = {146}


def make_pool(index: int, chain: str = "ethereum") -> Pool:
    """A pool with a stable, distinguishable identity."""
    address = "0x" + f"{index:040x}"
    pool = Pool(
        address=address,
        name=f"Pool {index}",
        chain=chain,
        chain_id=CHAINS.get(chain, 1),
        registry="stableswapng",
        lp_token=address,
        coins=[
            Coin("0x" + f"{index:02x}{i:038x}", f"C{i}", 18, index=i, usd_price=1.0)
            for i in range(2)
        ],
        tvl=1_000_000.0 - index,
        volume_24h=500_000.0 - index,
    )
    pool.onchain_coins = 2
    return pool


class FakeApi:
    """The Curve API, answering from memory and never from the network."""

    def __init__(self, pools_per_chain: int = 6) -> None:
        self.count = pools_per_chain
        self.calls: list[str] = []

    async def chains(self) -> dict[str, int]:
        self.calls.append("chains")
        return dict(CHAINS)

    async def lite_chains(self) -> dict[str, Any]:
        return {}

    async def is_lite(self, chain_id: int) -> bool:
        return chain_id in LITE

    async def list_pools(
        self, chain_id: int, *, chain: str = "", page: int = 1, page_size: int = 50,
        sort_by: str = "volume", direction: str = "desc", search: str = "",
        min_tvl: float | None = None,
    ) -> tuple[list[Pool], int]:
        self.calls.append(f"list_pools:{chain}:{page}:{sort_by}:{search}")
        pools = [make_pool(i, chain or "ethereum") for i in range(self.count)]
        if search:
            pools = [p for p in pools if search.lower() in p.name.lower()]
        start = (page - 1) * 2
        return pools[start : start + 2], len(pools)

    async def chain_totals(self, chain_id: int) -> dict[str, float | None]:
        return {"tvl": 1.0e9, "volume": None if chain_id in LITE else 1.0e8}

    async def get_pool(self, chain_id: int, address: str, chain: str = "") -> Pool:
        self.calls.append(f"get_pool:{address}")
        return make_pool(int(address, 16), chain or "ethereum")

    async def pool_detail(self, chain_id: int, address: str) -> dict[str, Any]:
        return {}

    async def attach_campaigns(
        self, chain_id: int, chain: str, pools: Any
    ) -> None:
        """Merkl and the point campaigns, with neither host reachable."""

    async def lp_candles(self, *a: Any, **kw: Any) -> list[Any]:
        return []

    async def pair_candles(self, *a: Any, **kw: Any) -> list[Any]:
        return []

    async def trades(self, *a: Any, **kw: Any) -> list[Any]:
        return []

    async def liquidity(self, *a: Any, **kw: Any) -> list[Any]:
        return []


class _NoPublicNodes:
    """The chainlist directory, with nothing in it."""

    async def endpoints(self, _chain_id: int) -> list[str]:
        return []


def build_app(session: Session):
    """The real `CurveApp`, on a fake session and a fake API."""
    import main as app_module

    app_module.autoconnect = lambda: False  # never open a wallet
    app = app_module.CurveApp.__new__(app_module.CurveApp)
    app.api = FakeApi()
    app.page = session
    app.wallet = None
    app._route_applied = False
    app._public_nodes = {}
    app._chainlist = _NoPublicNodes()
    app.chain = "ethereum"
    app.chains = {}
    app.feed = None
    app._detail = None
    app.swap_page = None
    app._page_name = "pools"
    app._address_expanded = False
    app.storage = session.shared_preferences
    app._build()
    return app


#: Handlers a fuzzer must not fire: they would open a wallet, or reach a
#: network this test has no fake for.
OFF_LIMITS = ("connect", "_wallet_clicked", "_change_wallet", "_disconnect_wallet")

#: Tasks the app queues that the machine will run.
RUNNABLE = (
    "load_pools", "load_more", "apply_route", "restore_theme", "load",
    "load_chart", "load_selection",
)


def handlers(control: Any, found: list[tuple[Any, str]], seen: set[int]) -> None:
    """Every `on_*` handler in the tree, with the control it belongs to."""
    if id(control) in seen or not isinstance(control, ft.Control):
        return
    seen.add(id(control))
    for name in control.__dataclass_fields__:
        value = getattr(control, name, None)
        if name.startswith("on_") and callable(value):
            handler_name = getattr(value, "__name__", "")
            if not any(bad in handler_name for bad in OFF_LIMITS):
                found.append((control, name))
        elif isinstance(value, ft.Control):
            handlers(value, found, seen)
        elif isinstance(value, list):
            for item in value:
                handlers(item, found, seen)


class AppMachine(RuleBasedStateMachine):
    def __init__(self) -> None:
        super().__init__()
        self.session = Session()
        self.app = build_app(self.session)
        self.loop = asyncio.new_event_loop()
        self.session.baseline()
        self.pump()

    # -- plumbing ----------------------------------------------------------

    def run(self, coro: Any) -> None:
        self.loop.run_until_complete(coro)

    def pump(self, rounds: int = 4) -> None:
        """Run the follow-up tasks the app queued, as a loop would."""
        for _ in range(rounds):
            queued, self.session.tasks = self.session.tasks, []
            if not queued:
                return
            for handler, args in queued:
                if getattr(handler, "__name__", "") in RUNNABLE:
                    self.run(handler(*args))

    @property
    def rows(self) -> list[PoolRow]:
        view = self.app.list_view
        if not isinstance(view, PoolListView):
            return []
        return [r for r in view.rows.controls if isinstance(r, PoolRow)]

    # -- what a user can do ------------------------------------------------

    @rule()
    def flush(self) -> None:
        """The client caught up. This is what freezes keyed controls."""
        self.session.flush()

    @rule()
    def toggle_theme(self) -> None:
        self.app._toggle_theme(Event())
        self.pump()

    @rule(column=st.sampled_from(["base", "incentives", "volume", "tvl"]))
    def sort(self, column: str) -> None:
        self.app.list_view._sort_by(column)
        self.pump()

    @rule(text=st.text(alphabet="Pool 123", max_size=5))
    def search(self, text: str) -> None:
        search = self.app.list_view.search
        search.value = text
        self.app.list_view._search_changed(Event(control=search, data=text))
        self.pump()

    @rule(width=st.sampled_from([390.0, 820.0, 1280.0, 1900.0]))
    def resize(self, width: float) -> None:
        self.session.width = width
        self.app._resized(Event())
        self.pump()

    @rule()
    def scroll_to_end(self) -> None:
        view = self.app.list_view
        view.page_scrolled(Event(pixels=99_000.0, max_scroll_extent=99_100.0))
        self.pump()

    @rule(chain=st.sampled_from(sorted(CHAINS)))
    def switch_chain(self, chain: str) -> None:
        self.app._chain_picked(chain)
        self.pump()

    @rule()
    def reselect_the_current_chain(self) -> None:
        """Open the picker on the network you are already on, and pick it."""
        before = self.app._detail
        route = self.session.route
        self.app._chain_picked(self.app.chain)
        self.pump()
        assert self.app._detail is before
        assert self.session.route == route

    @rule(index=st.integers(min_value=0, max_value=5))
    @precondition(lambda self: bool(self.rows))
    def open_pool(self, index: int) -> None:
        rows = self.rows
        self.app.open_pool(rows[index % len(rows)].pool)
        self.pump()

    @precondition(lambda self: self.app._detail is not None)
    @rule()
    def back(self) -> None:
        self.app.show_list()
        self.pump()

    @rule(route=st.sampled_from(["/", "/ethereum", "/xdai", "/nosuch", "/ethereum/0x" + "0" * 40]))
    def navigate(self, route: str) -> None:
        """The Back button, or a pasted link."""
        self.session.route = route
        self.run(self.app.apply_route(route))
        self.pump()

    @rule(which=st.integers(min_value=0, max_value=200), data=st.sampled_from([True, False, None]))
    def fire_handler(self, which: int, data: Any) -> None:
        """Poke a handler somewhere in the live tree."""
        found: list[tuple[Any, str]] = []
        handlers(self.session.root, found, set())
        if not found:
            return
        control, name = found[which % len(found)]
        handler = getattr(control, name, None)
        if handler is None:
            return
        result = handler(Event(control=control, data=data))
        if inspect.iscoroutine(result):
            self.run(result)
        self.pump()

    # -- what must always be true ------------------------------------------

    @invariant()
    def theme_is_one_of_the_three(self) -> None:
        name = self.app._theme_name()
        assert name in theme.NAMES
        assert theme.is_chad(self.session) == (name == "chad")

    @invariant()
    def decorations_agree_with_the_theme(self) -> None:
        """Everything decided at build time and reassigned on a change."""
        chad = theme.is_chad(self.session)
        view = self.app.list_view
        assert (self.app.header.shadow is not None) == chad
        assert (view._table.shadow is not None) == chad
        assert (view._table.border is not None) == chad
        assert (view._rows_box.theme is not None) == chad
        assert (view._header.bgcolor is not None) == chad
        assert (self.app.account_chip.border is not None) == chad

    @invariant()
    def nothing_the_app_will_write_to_is_frozen(self) -> None:
        """The bug that shipped, as a property."""
        view = self.app.list_view
        for control in (
            self.app.header,
            self.app.account_chip,
            self.app.connect_button,
            self.app.theme_button,
            view._table,
            view._rows_box,
            view._header,
            view.rows,
            view.footer,
            view.count_label,
        ):
            assert not hasattr(control, "_frozen"), f"{control.__class__.__name__} is frozen"

    @invariant()
    def the_route_matches_what_is_on_screen(self) -> None:
        parsed = routing.parse(self.session.route)
        if self.app._detail is not None and parsed.is_pool:
            assert routing.same_pool(parsed.pool, self.app._detail.pool.address)

    @invariant()
    def the_list_never_shows_a_column_the_chain_cannot_fill(self) -> None:
        """A Lite chain measures no volume, and a blank column is a lie
        that looks like a zero.
        """
        view = self.app.list_view
        if view._lite:
            assert not view._sort_cells["volume"].visible
            assert not view._sort_cells["base"].visible

    def teardown(self) -> None:
        self.loop.close()


# Two profiles. The default keeps this a few seconds inside `check.py`, which
# is what makes it a test people actually run; `deep` is for when something
# smells and the machine should be let off the leash: HYPOTHESIS_PROFILE=deep
# .venv/bin/python -m pytest tests/test_stateful.py No deadline either way: a
# single step can rebuild a view and diff the whole tree, and a per-step time
# limit would flag that as a failure.
_COMMON = {
    "deadline": None,
    "suppress_health_check": [HealthCheck.too_slow, HealthCheck.filter_too_much],
}
settings.register_profile("dev", max_examples=25, stateful_step_count=25, **_COMMON)
settings.register_profile("deep", max_examples=500, stateful_step_count=80, **_COMMON)
settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", "dev"))

AppMachine.TestCase.settings = settings.default
TestApp = AppMachine.TestCase


@pytest.mark.parametrize("theme_name", ["light", "dark", "chad"])
def test_re_making_a_keyed_control_freezes_it(theme_name: str) -> None:
    session = Session()
    app = build_app(session)
    app._set_theme(theme_name, remember=False)
    session.baseline()

    view = app.list_view
    view.rows.controls = [ft.Container(key=f"row-{n}") for n in range(3)]
    session.flush()
    assert not any(hasattr(row, "_frozen") for row in view.rows.controls)

    view.rows.controls = [ft.Container(key=f"row-{n}") for n in range(3)]
    session.flush()

    assert all(hasattr(row, "_frozen") for row in view.rows.controls)
    with pytest.raises(RuntimeError, match="Frozen"):
        view.rows.controls[0].bgcolor = "#AD7FA8"


