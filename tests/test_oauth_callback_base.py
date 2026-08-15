"""Regression tests for the OAuth redirect_uri built from a list-valued base.

Google login broke in production with an unusable error, because
``oauth_redirect_base`` was widened to a comma-separated ALLOWLIST (so the
dashboard origin could be a valid post-login destination) while two call sites
still interpolated it raw as a SINGLE base URL. Google received:

    redirect_uri=https://terminal.suwappu.bot,https://suwappu.bot,https://www.suwappu.bot/auth/callback/google

and rejected it with redirect_uri_mismatch. The allowlist check itself was
fine — only the single-URL construction was wrong.
"""

import pytest


class _Settings:
    """Minimal stand-in exposing the property under test."""

    def __init__(self, base: str):
        self.oauth_redirect_base = base

    @property
    def oauth_callback_base(self) -> str:
        first = (self.oauth_redirect_base or "").split(",")[0].strip()
        return first.rstrip("/")


def _redirect_uri(settings, provider="google") -> str:
    return f"{settings.oauth_callback_base}/auth/callback/{provider}"


def test_single_base_unchanged():
    s = _Settings("https://terminal.suwappu.bot")
    assert _redirect_uri(s) == "https://terminal.suwappu.bot/auth/callback/google"


def test_list_uses_only_the_first_entry():
    # The exact production value that broke Google login.
    s = _Settings("https://terminal.suwappu.bot,https://suwappu.bot,https://www.suwappu.bot")
    uri = _redirect_uri(s)
    assert uri == "https://terminal.suwappu.bot/auth/callback/google"
    # The failure signature: a comma can never appear in a redirect_uri.
    assert "," not in uri


def test_whitespace_and_trailing_slash_tolerated():
    s = _Settings(" https://terminal.suwappu.bot/ , https://suwappu.bot ")
    assert _redirect_uri(s) == "https://terminal.suwappu.bot/auth/callback/google"


def test_empty_base_does_not_crash():
    assert _redirect_uri(_Settings("")) == "/auth/callback/google"


@pytest.mark.parametrize(
    "base",
    [
        "https://a.example",
        "https://a.example,https://b.example",
        "https://a.example/,https://b.example/,https://c.example/",
    ],
)
def test_redirect_uri_is_always_a_single_url(base):
    uri = _redirect_uri(_Settings(base))
    assert uri.count("://") == 1, f"multiple origins leaked into redirect_uri: {uri}"
    assert "," not in uri
