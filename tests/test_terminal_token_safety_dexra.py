"""Solana token safety: Dexra's verdict is merged into the RugCheck report only when
DEXRA_API_KEY is set, and a Dexra failure leaves the RugCheck report unchanged."""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import asyncio  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402

from api.routes import terminal  # noqa: E402
from bot.config.settings import settings  # noqa: E402

MINT = "So11111111111111111111111111111111111111112"
RUGCHECK = {"score": 0, "risks": []}


@pytest.fixture
def rugcheck(monkeypatch):
    async def fake_get_json(client, url, params=None):
        return RUGCHECK

    monkeypatch.setattr(terminal, "_get_json", fake_get_json)


def run(monkeypatch, api_key, dexra):
    calls = []

    async def fake_dexra(client, address, key):
        calls.append((address, key))
        if isinstance(dexra, Exception):
            raise dexra
        return dexra

    monkeypatch.setattr(settings, "dexra_api_key", api_key)
    monkeypatch.setattr(terminal, "_dexra_token_check", fake_dexra)
    return asyncio.run(terminal._solana_safety("solana", MINT)), calls


def test_dexra_not_called_without_key(monkeypatch, rugcheck):
    report, calls = run(monkeypatch, None, {"verdict": "avoid", "reasons": ["x"]})
    assert calls == []
    assert report["sources"] == ["rugcheck"]
    assert report["riskLevel"] == "safe"


def test_avoid_verdict_adds_danger_flags(monkeypatch, rugcheck):
    report, calls = run(
        monkeypatch,
        "dxr_test",
        {"verdict": "avoid", "reasons": ["creator's past launches collapsed"]},
    )
    assert calls == [(MINT, "dxr_test")]
    assert report["sources"] == ["dexra", "rugcheck"]
    assert {"label": "Dexra: creator's past launches collapsed", "level": "danger"} in report[
        "flags"
    ]
    assert report["riskLevel"] == "danger"


def test_ok_verdict_adds_source_without_flags(monkeypatch, rugcheck):
    report, _ = run(monkeypatch, "dxr_test", {"verdict": "ok", "reasons": []})
    assert "dexra" in report["sources"]
    assert report["flags"] == []
    assert report["riskLevel"] == "safe"


def test_dexra_failure_fails_open(monkeypatch, rugcheck):
    report, _ = run(monkeypatch, "dxr_test", httpx.ConnectError("down"))
    assert report["sources"] == ["rugcheck"]
    assert report["riskLevel"] == "safe"
