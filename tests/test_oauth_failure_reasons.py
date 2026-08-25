"""The OAuth login failure paths must name their own cause.

Four distinct rejections previously all surfaced as an HTTPException with a
JSON body, which meant:
  * the user saw a dead-end `{"detail": ...}` page, and
  * "it failed" was unactionable — state-not-found, state-expired,
    nonce-missing and nonce-mismatch are indistinguishable from outside, and
    the server log buffer is short enough to lose the attempt.

The distinction that matters most: nonce MISSING means /authorize ran on a
different origin than the callback (the cookie is host-only), while nonce
MISMATCH means a replay or crossed flows. Collapsing them hides the single
most likely misconfiguration.
"""

import re

import pytest

SRC = open("api/routes/oauth.py").read()


def test_helper_exists():
    assert "_oauth_failure_redirect" in SRC


@pytest.mark.parametrize(
    "reason",
    ["state_not_found", "state_expired", "nonce_missing", "nonce_mismatch", "provider_rejected"],
)
def test_each_failure_has_a_distinct_reason(reason):
    assert f'"{reason}"' in SRC, f"missing distinct auth_error reason: {reason}"


def test_login_failures_redirect_rather_than_raise():
    """The login path must not dead-end the browser on JSON."""
    body = SRC[SRC.index("async def oauth_callback") :]  # noqa: E203
    # Cut at the token-exchange block; everything above is state/nonce checks.
    head = body[: body.index("oauth_service = get_oauth_service()")]
    assert (
        "raise HTTPException(status_code=400" not in head
    ), "a login rejection still raises instead of redirecting with a reason"


def test_nonce_branch_distinguishes_missing_from_mismatch():
    assert re.search(
        r'"nonce_missing"\s+if\s+not\s+presented_nonce\s+else\s+"nonce_mismatch"', SRC
    ), "nonce failure must distinguish absent cookie (wrong origin) from mismatch"


def test_provider_error_is_logged_in_full():
    """The provider message is the only place redirect_uri_mismatch appears."""
    assert "OAuth token exchange failed" in SRC
    assert "exc_info=True" in SRC


def test_reason_slugs_do_not_leak_existence():
    """Slugs must be coarse — never echo the state or nonce value itself."""
    for bad in ("{state}", "{presented_nonce}", "{expected_nonce}"):
        assert f"auth_error={bad}" not in SRC
