"""The wallet panel, built rather than described."""

from __future__ import annotations

import flet as ft
import pytest

import main
from curve.rpc import ChainlistDirectory, FallbackProvider, PublicNode
from wallet import chains
from wallet.session import Wallet

ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F"


class StubPage:
    #: `flet run --web` sets this while Python stays on the host, which
    #: is the case the panel explains.
    web = False

    def __init__(self) -> None:
        self.tasks: list[object] = []
        self.popped = 0

    def update(self) -> None:
        pass

    def pop_dialog(self) -> None:
        self.popped += 1

    def run_task(self, coro, *args) -> None:
        self.tasks.append(coro)


class StubProvider:
    name = "Mock Wallet"

    def on(self, event, handler) -> None:
        pass


def make_app() -> main.CurveApp:
    app = main.CurveApp.__new__(main.CurveApp)
    app.page = StubPage()
    app.wallet = make_wallet()
    return app


def make_wallet(icon: str | None = None) -> Wallet:
    return Wallet(StubProvider(), ADDRESS, chains.get_chain(1), icon=icon)


def buttons(dialog: ft.AlertDialog) -> list[str]:
    return [str(getattr(a, "content", "") or getattr(a, "text", "")) for a in dialog.actions]


def texts(control) -> list[str]:
    """Every string in a control tree, flattened."""
    found: list[str] = []
    if isinstance(control, ft.Text) and control.value:
        found.append(control.value)
    for child in (getattr(control, "controls", None) or []):
        found += texts(child)
    inner = getattr(control, "content", None)
    if isinstance(inner, ft.Control):
        found += texts(inner)
    return found


def test_the_panel_builds_at_all() -> None:
    dialog = make_app()._wallet_dialog(make_wallet())
    assert isinstance(dialog, ft.AlertDialog)


def test_it_shows_the_whole_address() -> None:
    dialog = make_app()._wallet_dialog(make_wallet())
    assert ADDRESS in texts(dialog.content)


def test_it_names_the_wallet_and_the_network() -> None:
    dialog = make_app()._wallet_dialog(make_wallet())
    assert "Mock Wallet" in texts(dialog.title)
    assert any("Ethereum" in line for line in texts(dialog.content))


def test_the_browser_can_change_wallet(monkeypatch) -> None:
    monkeypatch.setattr(main, "is_browser", lambda: True)
    dialog = make_app()._wallet_dialog(make_wallet())
    assert buttons(dialog) == ["Copy", "Change wallet", "Disconnect", "Close"]


def test_the_desktop_is_told_where_to_change_it_instead(monkeypatch) -> None:
    monkeypatch.setattr(main, "is_browser", lambda: False)
    dialog = make_app()._wallet_dialog(make_wallet())
    assert buttons(dialog) == ["Copy", "Disconnect", "Close"]
    assert any("switch account in the wallet" in t for t in texts(dialog.content))


@pytest.mark.parametrize("icon", [None, "data:image/svg+xml;base64,PHN2Zy8+"])
def test_every_button_has_a_handler(icon: str | None, monkeypatch) -> None:
    monkeypatch.setattr(main, "is_browser", lambda: True)
    dialog = make_app()._wallet_dialog(make_wallet(icon))
    assert all(callable(button.on_click) for button in dialog.actions)


def test_disconnect_closes_the_panel_and_runs_the_disconnect() -> None:
    app = make_app()
    dialog = app._wallet_dialog(make_wallet())
    disconnect = next(b for b in dialog.actions if b.content == "Disconnect")
    disconnect.on_click(None)
    assert app.page.popped == 1
    assert app.page.tasks == [app._disconnect_wallet]


def test_close_pops_without_touching_the_wallet() -> None:
    app = make_app()
    dialog = app._wallet_dialog(make_wallet())
    close = next(b for b in dialog.actions if b.content == "Close")
    close.on_click(None)
    assert app.page.popped == 1
    assert app.page.tasks == []


def test_an_announced_icon_is_drawn_and_a_missing_one_is_not() -> None:
    with_icon = main.wallet_mark("data:image/png;base64,iVBORw0KGgo=", "Rabby")
    without = main.wallet_mark(None, "Frame / qeth (127.0.0.1:1248)")
    assert isinstance(with_icon, ft.Image)
    assert isinstance(without, ft.CircleAvatar)
    assert isinstance(without.content, ft.Icon)


def test_wallet_art_is_not_decoded_at_a_pixel_size() -> None:
    mark = main.wallet_mark("data:image/svg+xml;base64,PHN2Zy8+", "WalletConnect")
    assert mark.cache_width is None


# -- which transport is in play --------------------------------------------


def test_a_desktop_window_says_nothing_about_transports(monkeypatch) -> None:
    monkeypatch.setattr(main, "is_browser", lambda: False)
    app = make_app()
    app.page.web = False
    dialog = app._wallet_dialog(make_wallet())
    assert not any("Python is running" in t for t in texts(dialog.content))


def test_a_published_browser_build_says_nothing_either(monkeypatch) -> None:
    monkeypatch.setattr(main, "is_browser", lambda: True)
    app = make_app()
    app.page.web = True
    dialog = app._wallet_dialog(make_wallet())
    assert not any("Python is running" in t for t in texts(dialog.content))


def test_flet_run_web_explains_why_there_are_no_browser_wallets(monkeypatch) -> None:
    monkeypatch.setattr(main, "is_browser", lambda: False)
    app = make_app()
    app.page.web = True
    dialog = app._wallet_dialog(make_wallet())
    note = [t for t in texts(dialog.content) if "Python is running" in t]
    assert note and "flet publish" in note[0]


# -- changing wallet, and changing your mind --------------------------------


class Recorder:
    """Stands in for a live `Wallet` so the app can be driven without one."""

    def __init__(self, address: str = ADDRESS) -> None:
        self.address = address
        self.short_address = f"{address[:6]}…{address[-4:]}"
        self.name = "qeth"
        self.icon = None
        self.chain = chains.get_chain(1)
        self.closed = False
        self.disconnected = False

    def on_change(self, handler) -> None:
        pass

    def on_disconnect(self, handler) -> None:
        pass

    async def close(self) -> None:
        self.closed = True

    async def disconnect(self) -> None:
        self.disconnected = True
        self.closed = True


def app_with(wallet) -> main.CurveApp:
    """An app already connected, with just enough header to redraw."""
    app = main.CurveApp.__new__(main.CurveApp)
    app.page = StubPage()
    app.wallet = wallet
    app._detail = None
    app.swap_page = None
    app._page_name = "pools"      # not the portfolio, so nothing reloads
    app._address_expanded = False
    app.chain = "ethereum"
    app.chains = {"ethereum": 1}
    app.account_label = ft.Text("")
    app.account_chip = ft.Container(app.account_label)
    app.connect_button = ft.Button("Connect wallet")
    app.error = ft.Text("", visible=False)
    return app


async def test_cancelling_a_change_keeps_the_wallet_you_had(monkeypatch) -> None:
    from wallet.session import ConnectionCancelled

    previous = Recorder()
    app = app_with(previous)

    async def refuse(**kwargs):
        raise ConnectionCancelled()

    monkeypatch.setattr(main.Wallet, "connect", refuse)
    await app._change_wallet()

    assert app.wallet is previous, "the old session was dropped"
    assert not previous.closed and not previous.disconnected
    assert not app.connect_button.visible, "still connected, so no Connect button"
    assert not app.error.visible, "and nothing to report: backing out is an answer"


async def test_backing_out_of_the_picker_says_nothing(monkeypatch) -> None:
    from wallet.session import ConnectionCancelled

    async def refuse(**kwargs):
        raise ConnectionCancelled()

    monkeypatch.setattr(main.Wallet, "connect", refuse)
    app = app_with(None)
    app.error.value = "something earlier"
    await app.connect(None)

    assert app.wallet is None
    assert not app.error.visible, "cancelling is not an error"
    assert app.connect_button.visible, "and the button has to come back"
    assert not app.connect_button.disabled
    assert app.connect_button.content == main.CONNECT_LABEL


async def test_a_successful_change_releases_the_old_one(monkeypatch) -> None:
    previous, chosen = Recorder(), Recorder("0x" + "22" * 20)

    async def accept(**kwargs):
        return chosen

    monkeypatch.setattr(main.Wallet, "connect", accept)
    app = app_with(previous)
    await app._change_wallet()

    assert app.wallet is chosen
    assert previous.closed and not previous.disconnected


async def test_a_failed_first_connection_still_offers_the_button(
    monkeypatch,
) -> None:
    from wallet.base import WalletUnavailable

    async def fail(**kwargs):
        raise WalletUnavailable("no wallet here")

    monkeypatch.setattr(main.Wallet, "connect", fail)
    app = app_with(None)
    await app.connect(None)

    assert app.wallet is None
    assert app.connect_button.visible
    assert "no wallet here" in app.error.value


# -- the chip's size --------------------------------------------------------


def test_the_address_chip_is_never_told_how_wide_to_be() -> None:
    app = app_with(Recorder())

    app._show_account(expanded=False)
    assert app.account_chip.width is None
    assert app.account_label.value == Recorder().short_address

    app._show_account(expanded=True)
    assert app.account_chip.width is None
    assert app.account_label.value == ADDRESS


# -- who the chain gets read through ---------------------------------------


def app_that_reads() -> main.CurveApp:
    app = app_with(Recorder())
    app._chainlist = ChainlistDirectory()
    app._public_nodes = {}
    return app


def test_a_connected_wallet_gets_the_public_endpoints_behind_it() -> None:
    app, provider = app_that_reads(), StubProvider()
    reader = app.reader(1, provider)

    assert isinstance(reader, FallbackProvider)
    assert reader.primary is provider, "the wallet is still asked first"
    assert isinstance(reader.sources[1], PublicNode)
    assert reader.sources[1].network_id == 1


def test_the_public_node_behind_a_wallet_is_the_cached_one() -> None:
    app, provider = app_that_reads(), StubProvider()
    first = app.reader(1, provider).sources[1]

    assert app.reader(1, provider).sources[1] is first
    assert app.public_node(1) is first


def test_a_chain_we_cannot_name_is_read_through_the_wallet_alone() -> None:
    app, provider = app_that_reads(), StubProvider()
    assert app.reader(0, provider) is provider


def test_walletconnect_is_read_past_rather_than_through() -> None:
    app, provider = app_that_reads(), StubProvider()
    provider.connector = "walletconnect"
    reader = app.reader(1, provider)

    assert isinstance(reader.sources[0], PublicNode), "public node reads first"
    assert reader.sources[-1] is provider, "the wallet is still the last resort"
    assert reader.primary is provider, "and still the only thing that signs"


def test_an_injected_wallet_keeps_being_read_first() -> None:
    app, provider = app_that_reads(), StubProvider()
    provider.connector = "injected"
    reader = app.reader(1, provider)

    assert reader.sources[0] is provider
    assert isinstance(reader.sources[1], PublicNode)


def test_a_wallet_on_another_chain_is_not_in_the_read_order() -> None:
    app, provider = app_that_reads(), StubProvider()
    app.wallet.chain = chains.get_chain(252)
    reader = app.reader(1, provider)

    assert provider not in reader.sources, "not read through"
    assert [isinstance(s, PublicNode) for s in reader.sources] == [True]
    assert reader.primary is provider, "still the only thing that signs"


def test_a_wallet_on_the_chain_being_browsed_is_read_first_as_before() -> None:
    app, provider = app_that_reads(), StubProvider()
    app.wallet.chain = chains.get_chain(1)

    assert app.reader(1, provider).sources[0] is provider


def test_with_no_wallet_there_is_nothing_to_disagree_with() -> None:
    app, provider = app_that_reads(), StubProvider()
    app.wallet = None

    assert app.reader(1, provider).sources[0] is provider


async def test_restoring_a_session_asks_the_wallet_for_the_chain_on_screen(
    monkeypatch,
) -> None:
    wallet = Recorder()
    wallet.chain = chains.get_chain(252)
    switched: list[int] = []

    class Provider(StubProvider):
        async def switch_chain(self, chain_id: int) -> None:
            switched.append(chain_id)
            wallet.chain = chains.get_chain(chain_id)

    wallet.provider = Provider()

    async def remembered() -> Recorder:
        return wallet

    monkeypatch.setattr(main.Wallet, "restore", remembered)
    app = app_with(wallet)
    app.wallet = None
    await app.restore()

    assert switched == [1], "asked to come across to the network being browsed"
    assert app.wallet is wallet


async def test_a_wallet_that_will_not_come_across_still_reads_correctly(
    monkeypatch,
) -> None:
    from wallet.base import RpcError

    wallet = Recorder()
    wallet.chain = chains.get_chain(252)

    class Refuses(StubProvider):
        async def switch_chain(self, chain_id: int) -> None:
            raise RpcError(4001, "User rejected the request")

    wallet.provider = Refuses()

    async def remembered() -> Recorder:
        return wallet

    monkeypatch.setattr(main.Wallet, "restore", remembered)
    app = app_with(wallet)
    app.wallet = None
    app._chainlist = ChainlistDirectory()
    app._public_nodes = {}
    await app.restore()

    assert wallet.chain.chain_id == 252, "the wallet stayed where it was"
    reader = app.reader(1, wallet.provider)
    assert wallet.provider not in reader.sources
    assert isinstance(reader.sources[0], PublicNode)


def test_a_longer_address_does_not_change_how_the_chip_is_built() -> None:
    wide = Recorder("0x" + "D" * 40)
    app = app_with(wide)

    app._show_account(expanded=True)
    assert app.account_chip.width is None
    assert app.account_label.value == wide.address
