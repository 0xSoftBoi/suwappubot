"""The custom `index.html`, and the one thing that can silently ruin it."""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path

import pytest

INDEX = Path(__file__).resolve().parent.parent / "src" / "assets" / "index.html"

#: Elements whose text content belongs there and is not stray prose.
TEXT_IS_FINE_IN = {"script", "style", "title"}


class HeadReader(HTMLParser):
    """What lands in the head, and any bare text that should not."""

    def __init__(self) -> None:
        super().__init__()
        self.in_head = False
        self.current: str | None = None
        self.tags: list[tuple[str, dict[str, str]]] = []
        self.stray: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        self.current = tag
        if tag == "head":
            self.in_head = True
        elif tag == "body":
            self.in_head = False
        elif self.in_head:
            self.tags.append((tag, {k: v or "" for k, v in attrs}))

    def handle_endtag(self, tag: str) -> None:
        self.current = None
        if tag == "head":
            self.in_head = False

    def handle_data(self, data: str) -> None:
        if self.in_head and self.current not in TEXT_IS_FINE_IN and data.strip():
            self.stray.append(" ".join(data.split())[:70])


@pytest.fixture(scope="module")
def head() -> HeadReader:
    reader = HeadReader()
    reader.feed(INDEX.read_text(encoding="utf-8"))
    return reader


def test_no_bare_text_inside_head(head: HeadReader) -> None:
    assert not head.stray, f"text in <head> closes it early: {head.stray}"


def test_the_icon_links_are_in_the_head(head: HeadReader) -> None:
    rels = {attrs.get("rel"): attrs.get("href", "") for tag, attrs in head.tags
            if tag == "link"}
    assert "icon" in rels, f"no favicon link in <head>, only {sorted(rels)}"
    assert rels["icon"].startswith("favicon.png")
    assert "apple-touch-icon" in rels
    assert "manifest" in rels


def test_the_icon_url_is_versioned(head: HeadReader) -> None:
    for tag, attrs in head.tags:
        if tag == "link" and attrs.get("rel") in ("icon", "apple-touch-icon"):
            assert "?v=" in attrs.get("href", ""), attrs


def test_the_page_is_named_for_what_it_is() -> None:
    import re

    import main

    shown = re.search(r"<title>(.*?)</title>", INDEX.read_text(encoding="utf-8"))
    assert shown and shown.group(1) == main.APP_TITLE == "Curve Finance"


def test_the_title_and_base_are_in_the_head(head: HeadReader) -> None:
    tags = [tag for tag, _ in head.tags]
    assert "title" in tags
    assert "base" in tags


def test_the_flet_markers_survive(head: HeadReader) -> None:
    text = INDEX.read_text(encoding="utf-8")
    assert '<base href="/">' in text
    assert "var flet = {" in text


def test_the_mock_wallet_is_gated_on_a_local_host() -> None:
    """A fake wallet that fabricates mined receipts must not be one query
    string away on a published site. `publish_ipfs.py` deletes the file
    too; this is the half that holds when a build slips through."""
    source = INDEX.read_text()
    gate = source[source.index("mock_wallet.js") - 600 : source.index("mock_wallet.js")]

    assert "location.hostname" in gate, "it must ask where it is running"
    assert "127.0.0.1" in gate and "localhost" in gate


def test_asking_for_no_mock_does_not_load_one() -> None:
    """`.has("mock")` was the bug: `?mock=0` loaded it."""
    source = INDEX.read_text()

    assert '.get("mock")' in source
    assert '"0"' in source and '"false"' in source
