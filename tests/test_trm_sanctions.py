"""TRM Labs free public Sanctions Screening API client + its wiring into
AddressComplianceService.screen_recipient_remote (recipient-only, async,
mode-aware, fail-open).
"""

import importlib
import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import pytest  # noqa: E402

from bot.config.settings import settings  # noqa: E402
from bot.services.compliance.compliance_service import AddressComplianceService  # noqa: E402

trm_module = importlib.import_module("bot.services.compliance.trm_sanctions")

ADDR = "0x722122df12d4e14e13ac3b6895a86e84145b6967"
CLEAN = "0x1111111111111111111111111111111111111111"


class _FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _fake_client_factory(response=None, raise_exc=None):
    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json=None):
            if raise_exc:
                raise raise_exc
            return response

    return _FakeAsyncClient


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(settings, "compliance_trm_enabled", True, raising=False)
    monkeypatch.setattr(settings, "compliance_trm_daily_budget", 90, raising=False)
    return trm_module.TrmSanctionsClient()


# --- TrmSanctionsClient ------------------------------------------------


async def test_sanctioned_true(client, monkeypatch):
    resp = _FakeResponse(201, [{"address": ADDR, "isSanctioned": True}])
    monkeypatch.setattr(trm_module.httpx, "AsyncClient", _fake_client_factory(response=resp))
    assert await client.is_sanctioned(ADDR) is True


async def test_clean_false(client, monkeypatch):
    resp = _FakeResponse(201, [{"address": ADDR, "isSanctioned": False}])
    monkeypatch.setattr(trm_module.httpx, "AsyncClient", _fake_client_factory(response=resp))
    assert await client.is_sanctioned(ADDR) is False


async def test_timeout_returns_none(client, monkeypatch):
    monkeypatch.setattr(
        trm_module.httpx, "AsyncClient", _fake_client_factory(raise_exc=TimeoutError("boom"))
    )
    assert await client.is_sanctioned(ADDR) is None


async def test_429_returns_none(client, monkeypatch):
    resp = _FakeResponse(429, None)
    monkeypatch.setattr(trm_module.httpx, "AsyncClient", _fake_client_factory(response=resp))
    assert await client.is_sanctioned(ADDR) is None


async def test_bad_response_shape_returns_none(client, monkeypatch):
    resp = _FakeResponse(201, {"not": "a list"})
    monkeypatch.setattr(trm_module.httpx, "AsyncClient", _fake_client_factory(response=resp))
    assert await client.is_sanctioned(ADDR) is None


async def test_cache_hit_avoids_second_call(client, monkeypatch):
    calls = {"n": 0}

    class _CountingClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json=None):
            calls["n"] += 1
            return _FakeResponse(201, [{"address": ADDR, "isSanctioned": True}])

    monkeypatch.setattr(trm_module.httpx, "AsyncClient", _CountingClient)
    r1 = await client.is_sanctioned(ADDR)
    r2 = await client.is_sanctioned(ADDR)
    assert r1 is True and r2 is True
    assert calls["n"] == 1


async def test_budget_exhaustion_returns_none(client, monkeypatch):
    monkeypatch.setattr(settings, "compliance_trm_daily_budget", 1, raising=False)
    resp = _FakeResponse(201, [{"address": ADDR, "isSanctioned": True}])
    monkeypatch.setattr(trm_module.httpx, "AsyncClient", _fake_client_factory(response=resp))
    assert await client.is_sanctioned(ADDR) is True
    # A distinct address with the budget already spent must return None
    # without ever attempting a request.
    assert await client.is_sanctioned(CLEAN) is None


async def test_disabled_never_called(client, monkeypatch):
    monkeypatch.setattr(settings, "compliance_trm_enabled", False, raising=False)
    calls = {"n": 0}

    class _ShouldNotBeCalled:
        def __init__(self, *a, **k):
            calls["n"] += 1

    monkeypatch.setattr(trm_module.httpx, "AsyncClient", _ShouldNotBeCalled)
    assert await client.is_sanctioned(ADDR) is None
    assert calls["n"] == 0


# --- AddressComplianceService.screen_recipient_remote wiring -------------


def _svc(monkeypatch, mode, trm_enabled):
    monkeypatch.setattr(settings, "compliance_mode", mode, raising=False)
    monkeypatch.setattr(settings, "compliance_trm_enabled", trm_enabled, raising=False)
    monkeypatch.setattr(settings, "compliance_blocklist", "", raising=False)
    monkeypatch.setattr(settings, "compliance_allowlist", "", raising=False)
    monkeypatch.setattr(settings, "compliance_ofac_list_path", "", raising=False)
    return AddressComplianceService()


async def test_screen_recipient_remote_blocks_in_enforce(monkeypatch):
    svc = _svc(monkeypatch, "enforce", True)

    async def fake_is_sanctioned(addr):
        return True

    monkeypatch.setattr(trm_module.trm_sanctions_client, "is_sanctioned", fake_is_sanctioned)
    result = await svc.screen_recipient_remote(CLEAN, chain="ethereum")
    assert result.allowed is False
    assert result.blocked[0].source == "trm_sanctions"
    assert result.blocked[0].role == "recipient"


async def test_screen_recipient_remote_monitor_logs_and_allows(monkeypatch):
    svc = _svc(monkeypatch, "monitor", True)

    async def fake_is_sanctioned(addr):
        return True

    monkeypatch.setattr(trm_module.trm_sanctions_client, "is_sanctioned", fake_is_sanctioned)
    result = await svc.screen_recipient_remote(CLEAN, chain="ethereum")
    assert result.allowed is True
    assert result.blocked and result.blocked[0].source == "trm_sanctions"


async def test_screen_recipient_remote_none_or_false_changes_nothing(monkeypatch):
    svc = _svc(monkeypatch, "enforce", True)

    async def fake_is_sanctioned(addr):
        return None

    monkeypatch.setattr(trm_module.trm_sanctions_client, "is_sanctioned", fake_is_sanctioned)
    result = await svc.screen_recipient_remote(CLEAN, chain="ethereum")
    assert result.allowed is True
    assert result.blocked == []


async def test_screen_recipient_remote_disabled_flag_skips_call(monkeypatch):
    svc = _svc(monkeypatch, "enforce", False)
    calls = {"n": 0}

    async def fake_is_sanctioned(addr):
        calls["n"] += 1
        return True

    monkeypatch.setattr(trm_module.trm_sanctions_client, "is_sanctioned", fake_is_sanctioned)
    result = await svc.screen_recipient_remote(CLEAN, chain="ethereum")
    assert result.allowed is True
    assert calls["n"] == 0
