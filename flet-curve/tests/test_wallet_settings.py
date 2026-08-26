"""What the browser bridge is told, and who gets the last word.

A WalletConnect session is proposed once, at connect time, with every chain it
may ever use.  A chain left out cannot be switched to afterwards -- the wallet
answers "the chain is not approved", and a Safe says the dApp does not support
its network -- so which chains go in the proposal is worth being sure about.
"""

from __future__ import annotations

import pytest

from wallet import settings


@pytest.fixture(autouse=True)
def clean():
    """Offers are process-wide; no test may leave one behind."""
    settings._offered.clear()
    yield
    settings._offered.clear()


def test_what_the_app_offers_reaches_the_bridge(monkeypatch):
    monkeypatch.setattr(settings, "_file_values", dict)
    settings.offer_default("walletConnectChains", [1, 239, 8453])

    assert settings.bridge_config()["walletConnectChains"] == [1, 239, 8453]


def test_a_configured_value_beats_the_offer(monkeypatch):
    """The offer is a default for anyone who has not said otherwise."""
    monkeypatch.setattr(
        settings, "_file_values", lambda: {"walletconnect": {"chains": [1]}})
    settings.offer_default("walletConnectChains", [1, 239, 8453])

    assert settings.bridge_config()["walletConnectChains"] == [1]


def test_an_empty_offer_is_not_an_offer(monkeypatch):
    """An app that does not know its chains yet must not propose none of
    them -- the bridge's own fallback is better than an empty list."""
    monkeypatch.setattr(settings, "_file_values", dict)
    settings.offer_default("walletConnectChains", [1, 239])
    settings.offer_default("walletConnectChains", [])

    assert "walletConnectChains" not in settings.bridge_config()


def test_offering_twice_keeps_the_later_answer(monkeypatch):
    monkeypatch.setattr(settings, "_file_values", dict)
    settings.offer_default("walletConnectChains", [1])
    settings.offer_default("walletConnectChains", [1, 239])

    assert settings.bridge_config()["walletConnectChains"] == [1, 239]
