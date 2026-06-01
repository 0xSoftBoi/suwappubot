"""Regression tests for chainlist.org RPC endpoint domain validation.

Guards against RPC Endpoint Injection via the untrusted chainlist.org feed:
only https URLs on trusted registrable domains may be accepted from discovery.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import pytest

from bot.services.rpc_manager import _is_trusted_rpc_url


@pytest.mark.parametrize("url", [
    # Attacker-controlled / internal targets from the threat model
    "https://evil.attacker.com/steal-txs",
    "https://internal-service:8545/",
    "http://192.168.0.1:8545",
    # Plaintext http on an otherwise-trusted domain (defeats TLS intent)
    "http://eth.llamarpc.com",
    # Non-https schemes
    "wss://eth.publicnode.com",
    "ftp://1rpc.io/eth",
    # Registrable-suffix bypass: trusted domain as a substring, not a real subdomain
    "https://evilpublicnode.com/rpc",
    "https://publicnode.com.attacker.net/rpc",
    # userinfo trick — real host is evil.com
    "https://eth.llamarpc.com@evil.com/rpc",
    # malformed / empty
    "",
    "not-a-url",
    "https://",
])
def test_untrusted_urls_rejected(url):
    assert _is_trusted_rpc_url(url) is False


@pytest.mark.parametrize("url", [
    "https://ethereum-rpc.publicnode.com",
    "https://1rpc.io/eth",
    "https://eth.drpc.org",
    "https://eth.llamarpc.com",
    "https://linea.blockpi.network/v1/rpc/public",
    "https://bsc-dataseed.binance.org",
    "https://arb1.arbitrum.io/rpc",
    # subdomain of a trusted domain, with a port
    "https://node.eth.drpc.org:443/v1",
    # case-insensitive host
    "https://ETH.LlamaRPC.com",
])
def test_trusted_urls_accepted(url):
    assert _is_trusted_rpc_url(url) is True
