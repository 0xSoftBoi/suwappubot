"""Tests for build_alert_deep_link — pure deep-link builder for alert notifications."""

from urllib.parse import parse_qs, urlparse

from bot.config.settings import settings
from bot.utils.deep_links import build_alert_deep_link


def test_full_action_alert_includes_all_params():
    alert = {
        "alert_id": 42,
        "token": "SOL",
        "action_chain": "solana",
        "action_side": "buy",
        "action_amount": "1.5",
    }

    url = build_alert_deep_link(alert)
    qs = parse_qs(urlparse(url).query)

    assert qs["alertId"] == ["42"]
    assert qs["token"] == ["SOL"]
    assert qs["chain"] == ["solana"]
    assert qs["side"] == ["buy"]
    assert qs["amount"] == ["1.5"]
    assert qs["ref"] == ["alert"]


def test_notify_only_alert_omits_side_and_amount():
    alert = {"alert_id": 7, "token": "ETH", "chain": "ethereum"}

    url = build_alert_deep_link(alert)
    qs = parse_qs(urlparse(url).query)

    assert qs["alertId"] == ["7"]
    assert qs["token"] == ["ETH"]
    assert qs["chain"] == ["ethereum"]
    assert qs["ref"] == ["alert"]
    assert "side" not in qs
    assert "amount" not in qs
    # non-custodial guarantee: no identity/credential material in the link
    for leaky in ("user", "user_id", "wallet", "address", "key", "token_bearer", "jwt"):
        assert leaky not in qs


def test_special_chars_are_url_encoded():
    alert = {"alert_id": 1, "token": "A B&C", "chain": "base"}

    url = build_alert_deep_link(alert)
    # raw special chars must not appear unencoded in the query string
    assert " " not in urlparse(url).query
    assert "&C=" not in url
    qs = parse_qs(urlparse(url).query)
    assert qs["token"] == ["A B&C"]


def test_base_url_prefix_matches_configured_terminal_url():
    alert = {"alert_id": 5, "token": "BTC", "chain": "bitcoin"}

    url = build_alert_deep_link(alert)
    expected_base = settings.terminal_url.rstrip("/")

    assert url.startswith(f"{expected_base}/terminal/alert-swap?")
