"""Provider plumbing lessons from production logs (CoW 403 page, Solana RPC 403/429)."""

import os

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")


async def test_shared_session_sends_a_browser_user_agent():
    from bot.utils import http_client

    session = await http_client.get_session()
    try:
        ua = session.headers.get("User-Agent", "")
        assert ua.startswith("Mozilla/5.0"), ua
        assert "aiohttp" not in ua.lower()
    finally:
        await http_client.close_session()


def test_solana_rpc_prefers_helius_when_key_is_set(monkeypatch):
    from bot.config.settings import Settings

    settings = Settings(helius_api_key="hel-123", alchemy_api_key="", infura_api_key="")
    urls = {settings.get_rpc_url("solana") for _ in range(40)}
    assert any(u.startswith("https://mainnet.helius-rpc.com/?api-key=hel-123") for u in urls)
    # Weighted preference: the keyed endpoint must be the common case.
    hits = sum(
        settings.get_rpc_url("solana").startswith("https://mainnet.helius-rpc.com")
        for _ in range(200)
    )
    assert hits > 100


def test_solana_rpc_without_helius_still_returns_public_endpoint():
    from bot.config.settings import Settings

    settings = Settings(helius_api_key="", alchemy_api_key="", infura_api_key="")
    assert settings.get_rpc_url("solana").startswith("https://")
    assert "helius" not in settings.get_rpc_url("solana")


def test_webapp_swap_engine_is_shared():
    from api import webapp

    a = webapp._swap_engine()
    b = webapp._swap_engine()
    assert a is b
