"""ETH native on L2s keeps the Coinbase ETH-USD chart (same asset as mainnet)."""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from api.routes.terminal import _is_eth_usdc_chart  # noqa: E402

NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"


def test_eth_native_uses_coinbase_chart_on_eth_native_chains():
    for chain in ("ethereum", "base", "arbitrum", "optimism"):
        assert _is_eth_usdc_chart(NATIVE, chain), chain
        assert _is_eth_usdc_chart("0x0000000000000000000000000000000000000000", chain)


def test_non_eth_native_chains_fall_through_to_pool_charts():
    assert not _is_eth_usdc_chart(NATIVE, "polygon")
    assert not _is_eth_usdc_chart(NATIVE, "bsc")
    assert not _is_eth_usdc_chart("0x6982508145454Ce325dDbE47a25d4ec3d2311933", "ethereum")
