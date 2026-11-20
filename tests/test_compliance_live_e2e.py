"""Live end-to-end verification of the sanctions screening gate.

Opt-in: these tests hit the **real** OFAC SDN feed and the **real**
Chainalysis oracle over the network, so they are marked ``livenet`` and
deselected by default. Run them with::

    pytest tests/test_compliance_live_e2e.py -m livenet

Why this file exists: the mocked suite passed 2957 tests while the gate
was loaded with addresses OFAC had delisted in 2025. Unit tests cannot
catch "the data is wrong" — only a run against the live list can. Per
the repo's standing rule, an integration is not "live" until it has been
exercised for real.

What it proves, in the same order a reviewer would ask:

1. An empty bundled seed fails CLOSED in ENFORCE rather than reading as
   "screened clean".
2. The live OFAC SDN feed loads a plausible number of addresses.
3. A currently-designated address is BLOCKED, a clean one is ALLOWED, and
   a 2025-delisted Tornado Cash address is ALLOWED (the bug this branch
   fixed, pinned so it cannot regress).
4. The on-chain Chainalysis oracle answers over real RPC and blocks a
   real sanctioned recipient, including on a chain with no deployment.
5. MONITOR records without blocking (the prescribed first rollout step).
6. A failing/hostile feed keeps the previous list and degrades, instead of
   silently blanking the blocklist.
"""

from __future__ import annotations

import os
import urllib.request

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from bot.config.settings import settings  # noqa: E402
from bot.services.compliance import (  # noqa: E402
    chainalysis_oracle,
    compliance_service,
    sdn_feed,
)

pytestmark = pytest.mark.livenet

SDN_ETH_URL = (
    "https://raw.githubusercontent.com/0xB10C/"
    "ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt"
)

CLEAN = "0xd8dA6BF26964aF9D7eEd9e03E43415D37aA96045"  # vitalik.eth
# Tornado Cash "Donation" — OFAC DELISTED it on 2025-03-21. Must NOT block.
DELISTED = "0x8589427373D6D84E98730D7795D8f6f8731FDA16"


def _live_sdn_eth_addresses() -> list[str]:
    req = urllib.request.Request(SDN_ETH_URL, headers={"User-Agent": "suwappu-tests"})
    try:
        body = urllib.request.urlopen(req, timeout=30).read().decode()
    except Exception as exc:  # network-gated test: skip, never fail
        pytest.skip(f"live SDN feed unreachable: {exc}")
    return [ln.strip() for ln in body.splitlines() if ln.strip() and not ln.startswith("#")]


@pytest.fixture(scope="module")
def sanctioned() -> str:
    addrs = _live_sdn_eth_addresses()
    if not addrs:
        pytest.skip("live SDN ETH list is empty")
    return addrs[0]


@pytest.fixture
def enforce(monkeypatch):
    """Production wiring, ENFORCE mode, feed enabled."""
    monkeypatch.setattr(settings, "compliance_mode", "enforce", raising=False)
    monkeypatch.setattr(settings, "compliance_policy", "blocklist_only", raising=False)
    monkeypatch.setattr(settings, "compliance_blocklist", "", raising=False)
    monkeypatch.setattr(settings, "compliance_allowlist", "", raising=False)
    monkeypatch.setattr(settings, "compliance_ofac_list_path", "", raising=False)
    monkeypatch.setattr(settings, "compliance_sdn_feed_enabled", True, raising=False)
    compliance_service.reload()
    return compliance_service


async def _loaded(svc):
    count = await sdn_feed.refresh()
    assert count > 50, f"implausibly small live SDN list: {count}"
    assert sdn_feed.degraded is False
    return svc


# --- 1. boot state ---------------------------------------------------------


def test_empty_seed_fails_closed_before_first_refresh(enforce):
    """The bundled seed is empty; "not yet loaded" must never read as clean."""
    assert enforce.screen(recipient=CLEAN).allowed is False


# --- 2/3. live list + real verdicts ---------------------------------------


async def test_blocks_currently_designated_address(enforce, sanctioned):
    svc = await _loaded(enforce)
    assert svc.screen(recipient=sanctioned, chain="ethereum").allowed is False


async def test_allows_clean_address(enforce):
    svc = await _loaded(enforce)
    assert svc.screen(recipient=CLEAN, chain="ethereum").allowed is True


async def test_allows_delisted_tornado_cash_address(enforce):
    """Regression pin for the bug this branch fixed.

    OFAC delisted this address on 2025-03-21. Blocking it means blocking a
    user who has done nothing wrong.
    """
    svc = await _loaded(enforce)
    assert svc.screen(recipient=DELISTED, chain="ethereum").allowed is True


# --- 4. live oracle --------------------------------------------------------


async def test_oracle_answers_over_real_rpc(sanctioned):
    assert await chainalysis_oracle.is_sanctioned(sanctioned, "ethereum") is True
    assert await chainalysis_oracle.is_sanctioned(CLEAN, "ethereum") is False


async def test_oracle_declines_chain_without_deployment(sanctioned):
    """base has no oracle deployment; it must read unknown, never clean."""
    assert await chainalysis_oracle.is_sanctioned(sanctioned, "base") is None


async def test_remote_path_blocks_sanctioned_recipient(enforce, sanctioned):
    result = await enforce.screen_recipient_remote(sanctioned, chain="ethereum")
    assert result.allowed is False
    assert result.blocked


async def test_remote_path_screens_chain_without_deployment(enforce, sanctioned):
    """A Base-only swap is still screened, via another oracle deployment."""
    result = await enforce.screen_recipient_remote(sanctioned, chain="base", to_chain="base")
    assert result.allowed is False


# --- 5. monitor mode -------------------------------------------------------


async def test_monitor_records_without_blocking(enforce, monkeypatch, sanctioned):
    svc = await _loaded(enforce)
    monkeypatch.setattr(settings, "compliance_mode", "monitor", raising=False)
    local = svc.screen(recipient=sanctioned, chain="ethereum")
    assert local.allowed is True and local.blocked
    remote = await svc.screen_recipient_remote(sanctioned, chain="ethereum")
    assert remote.allowed is True and remote.blocked


# --- 6. resilience ---------------------------------------------------------


async def test_failing_feed_retains_list_and_degrades(enforce, monkeypatch):
    """A 404 / hostile feed must not blank the blocklist."""
    svc = await _loaded(enforce)
    before = svc.stats()["blocklist"]

    monkeypatch.setattr(
        settings,
        "compliance_sdn_feed_base_url",
        "https://raw.githubusercontent.com/0xB10C/"
        "ofac-sanctioned-digital-currency-addresses/lists/NO_SUCH_LIST_{ticker}.txt",
        raising=False,
    )
    await sdn_feed.refresh()

    assert svc.stats()["blocklist"] >= before, "a failed refresh emptied the blocklist"
    assert sdn_feed.degraded is True
    # And while degraded, ENFORCE must not claim anything is clean.
    assert svc.screen(recipient=CLEAN, chain="ethereum").allowed is False
