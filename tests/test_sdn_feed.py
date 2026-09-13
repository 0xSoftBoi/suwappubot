"""Live OFAC SDN digital-currency feed: fetch, merge into the compliance
blocklist, fail-open on a single list's failure, comment/blank-line parsing,
and disabled-flag no-op for the background loop.
"""

import importlib
import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import pytest  # noqa: E402

from bot.config.settings import settings  # noqa: E402
from bot.services.compliance.compliance_service import AddressComplianceService  # noqa: E402

# NB: the package __init__ re-exports a singleton named `sdn_feed`, which
# SHADOWS the submodule of the same name (same gotcha documented in
# test_compliance_tron.py for `compliance_service`) — go through importlib to
# get the actual module so we can monkeypatch its module-level fetch helper.
sdn_feed_module = importlib.import_module("bot.services.compliance.sdn_feed")
compliance_service_module = importlib.import_module("bot.services.compliance.compliance_service")

CLEAN_ETH = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
CLEAN_TRX_HEX = "0x4444444444444444444444444444444444444444"


@pytest.fixture()
def feed(monkeypatch):
    """A fresh SdnFeed wired to a fresh (enforce-mode) compliance service."""
    monkeypatch.setattr(settings, "compliance_mode", "enforce", raising=False)
    monkeypatch.setattr(settings, "compliance_blocklist", "", raising=False)
    monkeypatch.setattr(settings, "compliance_allowlist", "", raising=False)
    monkeypatch.setattr(settings, "compliance_ofac_list_path", "", raising=False)
    service = AddressComplianceService()
    # SdnFeed.refresh() does a lazy `from ...compliance_service import
    # compliance_service` inside the method body — patching the module
    # attribute makes that lazy import resolve to our test instance.
    monkeypatch.setattr(compliance_service_module, "compliance_service", service, raising=False)
    return sdn_feed_module.SdnFeed(), service


# --- parsing -----------------------------------------------------------


def test_parse_lines_handles_comments_and_blanks():
    text = "# header\n\n" + CLEAN_ETH + "\n   \n# trailing comment\nnot-an-address\n"
    parsed = sdn_feed_module._parse_lines(text)
    assert parsed == {CLEAN_ETH.lower()}


def test_parse_lines_empty_text_is_empty_set():
    assert sdn_feed_module._parse_lines("") == set()
    assert sdn_feed_module._parse_lines("# only comments\n\n") == set()


# --- refresh / merge -----------------------------------------------------


async def test_refresh_merges_into_blocklist_and_blocks_in_enforce(feed, monkeypatch):
    f, service = feed

    async def fake_fetch(base_url, ticker):
        if ticker == "TRX":
            return f"{CLEAN_TRX_HEX}\n"
        return ""  # other tickers: valid, empty list

    monkeypatch.setattr(sdn_feed_module, "_fetch_ticker_text", fake_fetch)
    count = await f.refresh()

    assert count == 1
    assert f.last_error is None
    result = service.screen(recipient=CLEAN_TRX_HEX)
    assert result.allowed is False
    assert result.blocked[0].source == "ofac"


async def test_fail_open_keeps_previous_set_on_next_fetch_failure(feed, monkeypatch):
    f, service = feed

    async def fetch_ok(base_url, ticker):
        if ticker == "ETH":
            return CLEAN_ETH + "\n"
        return ""

    monkeypatch.setattr(sdn_feed_module, "_fetch_ticker_text", fetch_ok)
    count1 = await f.refresh()
    assert count1 == 1
    assert f.last_error is None

    async def fetch_eth_fails(base_url, ticker):
        if ticker == "ETH":
            return None  # simulates HTTP error / timeout
        return ""

    monkeypatch.setattr(sdn_feed_module, "_fetch_ticker_text", fetch_eth_fails)
    count2 = await f.refresh()

    # ETH's previously-fetched set is retained (fail-open), not dropped.
    assert count2 == 1
    assert f.last_error is not None and "ETH" in f.last_error
    result = service.screen(recipient=CLEAN_ETH)
    assert result.allowed is False


async def test_all_fetches_fail_leaves_blocklist_unchanged(feed, monkeypatch):
    f, service = feed
    before = service.stats()["blocklist"]

    async def fetch_all_fail(base_url, ticker):
        return None

    monkeypatch.setattr(sdn_feed_module, "_fetch_ticker_text", fetch_all_fail)
    count = await f.refresh()

    assert count == 0
    assert f.last_error is not None
    assert service.stats()["blocklist"] == before


# --- disabled flag = no-op for the background loop ------------------------


async def test_run_loop_noop_when_disabled(monkeypatch):
    monkeypatch.setattr(settings, "compliance_sdn_feed_enabled", False, raising=False)
    called = False

    async def fake_refresh(self):
        nonlocal called
        called = True
        return 0

    monkeypatch.setattr(sdn_feed_module.SdnFeed, "refresh", fake_refresh)
    await sdn_feed_module.run_sdn_feed_loop()

    assert called is False
