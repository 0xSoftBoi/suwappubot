"""Tests for non-custodial wallet provider tagging used by /auth/turnkey/verify.

Pure logic only: the normalizer decides whether a connecting wallet is labelled a
Ledger hardware wallet or a plain external wallet, and — critically — guarantees a
client can never select a custodial ("turnkey"/"local") signing path by passing a
bogus provider string.
"""

from bot.utils.wallet_provider import EXTERNAL_PROVIDERS, normalize_wallet_provider


def test_ledger_tag_preserved():
    assert normalize_wallet_provider("ledger") == "ledger"


def test_external_default_when_absent():
    assert normalize_wallet_provider(None) == "external"
    assert normalize_wallet_provider("") == "external"


def test_case_and_whitespace_normalized():
    assert normalize_wallet_provider("  Ledger ") == "ledger"
    assert normalize_wallet_provider("EXTERNAL") == "external"


def test_bogus_or_custodial_values_collapse_to_external():
    # Security-critical: a client must never be able to tag a wallet custodial.
    assert normalize_wallet_provider("turnkey") == "external"
    assert normalize_wallet_provider("local") == "external"
    assert normalize_wallet_provider("garbage") == "external"
    assert normalize_wallet_provider("ledger; drop table") == "external"


def test_external_providers_set_is_the_allowlist():
    assert set(EXTERNAL_PROVIDERS) == {"external", "ledger"}
