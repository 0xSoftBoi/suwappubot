"""Handing a generated file to whoever asked for it.

The desktop half opens the platform's save dialog, which is the part worth
testing without one: a dismissed dialog is an answer, not a failure, and the
caller has to be able to tell the two apart.
"""

from __future__ import annotations

import pytest

from ui import download


class FakePage:
    """Just the `services` list a `FilePicker` gets hung on."""

    def __init__(self) -> None:
        self.services: list = []


class FakePicker:
    """Whatever the dialog was told, and whatever it was told to answer."""

    def __init__(self, answer: str | None) -> None:
        self.answer = answer
        self.asked: dict = {}

    async def save_file(self, **kwargs):
        self.asked = kwargs
        return self.answer


@pytest.fixture
def picker(monkeypatch):
    """Stand in for `ft.FilePicker`, whatever it is asked to answer.

    The dialog is declared available too: whether *this* machine has Zenity
    is a separate question with its own tests, and it must not decide whether
    these ones exercise the dialog.
    """
    monkeypatch.setattr(download, "has_dialog", lambda: True)
    made: list[FakePicker] = []

    def install(answer: str | None) -> list[FakePicker]:
        import flet as ft

        def build(*_a, **_kw) -> FakePicker:
            made.append(FakePicker(answer))
            return made[-1]

        monkeypatch.setattr(ft, "FilePicker", build)
        return made

    return install


async def test_the_dialog_is_given_the_bytes_and_the_name(picker):
    made = picker("/home/someone/Documents/route.svg")
    page = FakePage()

    where = await download.save_text(
        "curve-route-ETH-WETH.svg", "<svg/>", media="image/svg+xml",
        page=page, title="Save the route")

    assert where == "/home/someone/Documents/route.svg"
    asked = made[-1].asked
    assert asked["file_name"] == "curve-route-ETH-WETH.svg"
    assert asked["src_bytes"] == b"<svg/>", "written by the dialog, in one step"
    assert asked["dialog_title"] == "Save the route"
    assert asked["allowed_extensions"] == ["svg"]


async def test_a_dismissed_dialog_answers_none_rather_than_a_path(picker):
    """Closing it is a decision.  A caller that reported success would be
    telling them a file exists that does not."""
    picker(None)
    assert await download.save_text("route.svg", "<svg/>", page=FakePage()) is None


async def test_the_dialog_is_taken_down_afterwards(picker):
    picker("/tmp/route.svg")
    page = FakePage()
    await download.save_text("route.svg", "<svg/>", page=page)
    assert page.services == [], "not left on the page for the next one"


async def test_it_is_taken_down_even_when_the_dialog_raises(picker, monkeypatch):
    made = picker("/tmp/route.svg")
    page = FakePage()

    async def explode(**_kw):
        raise RuntimeError("no display")

    import flet as ft

    def build(*_a, **_kw):
        made.append(type("P", (), {"save_file": staticmethod(explode)})())
        return made[-1]

    monkeypatch.setattr(ft, "FilePicker", build)

    with pytest.raises(RuntimeError):
        await download.save_text("route.svg", "<svg/>", page=page)
    assert page.services == []


async def test_with_no_page_at_all_it_writes_the_file_itself(tmp_path, monkeypatch):
    """There is no dialog without a page to hang it on."""
    monkeypatch.setattr(download, "_folder", lambda: tmp_path)
    where = await download.save_text("route.svg", "<svg/>")
    assert where == str(tmp_path / "route.svg")
    assert (tmp_path / "route.svg").read_text() == "<svg/>"


def test_a_name_that_would_not_survive_a_filesystem_is_cleaned_up():
    """Pairs are written "A/B" everywhere else in this app, and that is a
    directory separator here."""
    assert download.safe_name("curve-route-USDC/USDT.svg") == (
        "curve-route-USDC-USDT.svg")
    assert download.safe_name("...") == "download"


async def test_without_zenity_the_file_is_written_and_the_path_named(
        tmp_path, monkeypatch):
    """Flet's picker shells out to Zenity on Linux.  Without it the dialog
    never opens and says nothing about why, which would make the button look
    broken -- so the file is written instead and the caller names the path."""
    monkeypatch.setattr(download, "has_dialog", lambda: False)
    monkeypatch.setattr(download, "_folder", lambda: tmp_path)

    where = await download.save_text("route.svg", "<svg/>", page=FakePage())

    assert where == str(tmp_path / "route.svg")
    assert (tmp_path / "route.svg").read_text() == "<svg/>"


def test_a_platform_with_its_own_dialog_needs_nothing_installed(monkeypatch):
    monkeypatch.setattr(download.sys, "platform", "darwin")
    assert download.has_dialog() is True

    monkeypatch.setattr(download.sys, "platform", "linux")
    monkeypatch.setattr(download.shutil, "which", lambda _name: None)
    assert download.has_dialog() is False
    monkeypatch.setattr(download.shutil, "which", lambda _name: "/usr/bin/zenity")
    assert download.has_dialog() is True
