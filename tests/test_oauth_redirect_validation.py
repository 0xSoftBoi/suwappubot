"""
Regression tests for OAuth security hardening in api/routes/oauth.py.

Covers:
- Open-redirect / authorization-code interception via unvalidated
  ``redirect_url`` (validated by ``_is_allowed_redirect``).
"""

import os

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.config.settings import settings  # noqa: E402
from api.routes.oauth import _is_allowed_redirect  # noqa: E402


@pytest.fixture()
def allowlist(monkeypatch):
    monkeypatch.setattr(
        settings,
        "oauth_redirect_base",
        "https://app.suwappu.com,https://staging.suwappu.com",
        raising=False,
    )


def test_none_redirect_is_allowed(allowlist):
    # None falls back to the server-chosen default dashboard URL.
    assert _is_allowed_redirect(None) is True


def test_exact_base_allowed(allowlist):
    assert _is_allowed_redirect("https://app.suwappu.com") is True


def test_path_under_base_allowed(allowlist):
    assert _is_allowed_redirect("https://app.suwappu.com/dashboard") is True
    assert _is_allowed_redirect("https://staging.suwappu.com/auth/done") is True


def test_external_domain_rejected(allowlist):
    assert _is_allowed_redirect("https://attacker.com") is False
    assert _is_allowed_redirect("https://attacker.com/steal") is False


def test_suffix_confusion_rejected(allowlist):
    # Must not match a look-alike host that merely starts with the base string.
    assert _is_allowed_redirect("https://app.suwappu.com.attacker.com") is False
    assert _is_allowed_redirect("https://app.suwappu.com.attacker.com/cb") is False


def test_scheme_or_host_mismatch_rejected(allowlist):
    assert _is_allowed_redirect("http://app.suwappu.com/dashboard") is False
    assert _is_allowed_redirect("//attacker.com") is False


def test_empty_allowlist_rejects_nonnull(monkeypatch):
    monkeypatch.setattr(settings, "oauth_redirect_base", "", raising=False)
    assert _is_allowed_redirect("https://app.suwappu.com") is False
    # None still allowed (server picks default).
    assert _is_allowed_redirect(None) is True
