"""Connecting is asked for; disconnecting is remembered."""

from __future__ import annotations

from typing import Any

import pytest

from wallet import consent
from wallet.base import WalletProvider
from wallet.session import Wallet, autoconnect

ACCOUNT = "0x6B175474E89094C44Da98b954EedeAC495271d0F"


@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
    yield tmp_path


class FakeProvider(WalletProvider):
    """One wallet, always available, never prompting."""

    def __init__(self, wallets: list[dict[str, Any]] | None = None) -> None:
        self.wallets = wallets if wallets is not None else []
        self.selected = ""
        self.closed = False

    def on(self, event, handler) -> None:
        pass

    async def select_wallet(self, uuid: str, *, silent: bool = False):
        self.selected = uuid
        return {}

    async def request(self, method: str, params=None):
        if method in ("eth_requestAccounts", "eth_accounts"):
            return [ACCOUNT]
        if method == "eth_chainId":
            return "0x1"
        raise AssertionError(f"unexpected {method}")

    async def close(self) -> None:
        self.closed = True


def use(monkeypatch, provider: FakeProvider) -> None:
    from wallet import session

    async def fake_connect_provider():
        return provider

    monkeypatch.setattr(session, "connect_provider", fake_connect_provider)


def as_desktop(monkeypatch) -> None:
    """`autoconnect` is about the transports with no page storage."""
    from wallet import session

    monkeypatch.setattr(session, "is_browser", lambda: False)


# -- the marker itself -----------------------------------------------------


def test_a_fresh_machine_may_connect_by_itself() -> None:
    assert consent.autoconnect_allowed()


def test_disconnecting_withdraws_that() -> None:
    consent.record_disconnect()
    assert not consent.autoconnect_allowed()


def test_connecting_restores_it() -> None:
    consent.record_disconnect()
    consent.record_connect()
    assert consent.autoconnect_allowed()


def test_the_decision_outlives_the_process(isolated_state) -> None:
    consent.record_disconnect()
    assert (isolated_state / "flet-curve" / "disconnected").exists()
    assert not consent.autoconnect_allowed()


def test_disconnecting_twice_is_not_an_error() -> None:
    consent.record_disconnect()
    consent.record_disconnect()
    assert not consent.autoconnect_allowed()


def test_connecting_without_a_marker_is_not_an_error() -> None:
    consent.record_connect()
    assert consent.autoconnect_allowed()


# -- what the app asks -----------------------------------------------------


def test_the_desktop_connects_at_startup(monkeypatch) -> None:
    as_desktop(monkeypatch)
    assert autoconnect()


def test_but_not_after_the_user_disconnected(monkeypatch) -> None:
    as_desktop(monkeypatch)
    consent.record_disconnect()
    assert not autoconnect()


def test_a_browser_never_connects_at_startup(monkeypatch) -> None:
    from wallet import session

    monkeypatch.setattr(session, "is_browser", lambda: True)
    assert not autoconnect()


async def test_disconnecting_a_live_wallet_records_it(monkeypatch) -> None:
    provider = FakeProvider()
    use(monkeypatch, provider)
    wallet = await Wallet.connect()
    await wallet.disconnect()
    assert not consent.autoconnect_allowed()
    assert provider.closed


async def test_connecting_again_clears_it(monkeypatch) -> None:
    provider = FakeProvider()
    use(monkeypatch, provider)
    consent.record_disconnect()
    await Wallet.connect()
    assert consent.autoconnect_allowed()


async def test_restoring_a_session_counts_as_connecting(monkeypatch) -> None:
    provider = FakeProvider(
        [{"uuid": "u", "name": "Rabby", "rdns": "io.rabby", "connector": "injected"}]
    )
    provider.remembered = {"rdns": "io.rabby", "connector": "injected"}
    use(monkeypatch, provider)
    consent.record_disconnect()
    assert await Wallet.restore() is not None
    assert consent.autoconnect_allowed()


# -- being asked which wallet ----------------------------------------------


async def test_connecting_asks_when_there_is_a_choice(monkeypatch) -> None:
    provider = FakeProvider(
        [
            {"uuid": "a", "name": "qeth", "rdns": "org.qeth", "connector": "injected"},
            {"uuid": "b", "name": "WalletConnect", "rdns": "", "connector": "walletconnect"},
        ]
    )
    use(monkeypatch, provider)
    asked: list[list[str]] = []

    async def choose(options):
        asked.append([o.name for o in options])
        return options[1].uuid

    wallet = await Wallet.connect(choose=choose)
    assert asked == [["qeth", "WalletConnect"]]
    assert provider.selected == "b"
    assert wallet.icon  # the bundled WalletConnect mark


async def test_change_wallet_asks_even_with_one(monkeypatch) -> None:
    provider = FakeProvider(
        [{"uuid": "only", "name": "qeth", "rdns": "org.qeth", "connector": "injected"}]
    )
    use(monkeypatch, provider)
    asked = []

    async def choose(options):
        asked.append([o.name for o in options])
        return options[0].uuid

    await Wallet.connect(choose=choose, always_choose=True)
    assert asked == [["qeth"]]


async def test_a_first_connection_does_not_ask_about_a_single_wallet(
    monkeypatch,
) -> None:
    provider = FakeProvider(
        [{"uuid": "only", "name": "qeth", "rdns": "org.qeth", "connector": "injected"}]
    )
    use(monkeypatch, provider)

    async def choose(options):
        raise AssertionError("should not have been asked")

    assert await Wallet.connect(choose=choose) is not None


async def test_cancelling_the_picker_connects_nothing(monkeypatch) -> None:
    from wallet.session import ConnectionCancelled

    provider = FakeProvider(
        [
            {"uuid": "a", "name": "qeth", "rdns": "org.qeth", "connector": "injected"},
            {"uuid": "b", "name": "WalletConnect", "rdns": "", "connector": "walletconnect"},
        ]
    )
    use(monkeypatch, provider)

    async def choose(options):
        return None

    with pytest.raises(ConnectionCancelled):
        await Wallet.connect(choose=choose)
    assert provider.closed


# -- swapping is not disconnecting -----------------------------------------


async def test_closing_a_session_says_nothing_about_intent(monkeypatch) -> None:
    provider = FakeProvider()
    forgotten = []
    provider.forget = lambda: forgotten.append(True)  # type: ignore[assignment]
    use(monkeypatch, provider)
    wallet = await Wallet.connect()

    await wallet.close()
    assert provider.closed
    assert consent.autoconnect_allowed(), "closing must not look like disconnecting"
    assert not forgotten, "closing must not forget the remembered wallet"


async def test_disconnecting_does_both(monkeypatch) -> None:
    provider = FakeProvider()
    forgotten = []

    async def forget() -> None:
        forgotten.append(True)

    provider.forget = forget  # type: ignore[assignment]
    use(monkeypatch, provider)
    wallet = await Wallet.connect()

    await wallet.disconnect()
    assert provider.closed
    assert not consent.autoconnect_allowed()
    assert forgotten == [True]


# -- what a page load is allowed to load ------------------------------------


def _preselect(wallets: list[dict[str, Any]]) -> str:
    """The rule `wallet.browser.discover` applies to a single wallet."""
    if len(wallets) == 1 and not wallets[0].get("deliberate"):
        return wallets[0]["uuid"]
    return ""


def test_a_lone_injected_wallet_is_still_settled_up_front() -> None:
    assert _preselect([{"uuid": "metamask", "connector": "injected"}]) == "metamask"


def test_a_lone_walletconnect_is_not_chosen_for_you() -> None:
    assert (
        _preselect(
            [
                {
                    "uuid": "walletconnect",
                    "connector": "walletconnect",
                    "deliberate": True,
                }
            ]
        )
        == ""
    )


def test_a_choice_of_wallets_is_never_settled_up_front() -> None:
    assert (
        _preselect(
            [
                {"uuid": "metamask", "connector": "injected"},
                {
                    "uuid": "walletconnect",
                    "connector": "walletconnect",
                    "deliberate": True,
                },
            ]
        )
        == ""
    )


def test_the_bridge_and_python_agree_on_the_flag() -> None:
    from pathlib import Path

    src = Path(__file__).resolve().parent.parent / "src"
    assert "deliberate: true" in (src / "assets/wallet_bridge.js").read_text()
    assert 'get("deliberate")' in (src / "wallet/browser.py").read_text()
