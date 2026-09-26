"""Withdrawals must be sanctions-screened.

Before this, `compliance_service.screen` had exactly ONE call site —
`SwapEngine.execute_swap` — so withdrawals, the most obvious
funds-leave-the-platform path, were screened by nothing on any chain.

The guard lives inside send_native_token/send_token (beside the withdrawal
kill-switch) so every surface inherits it: the terminal API route, the Telegram
handler, and anything added later.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest  # noqa: E402

from bot.services.hot_wallet import (  # noqa: E402
    ComplianceBlockedError,
    _assert_recipient_compliant,
)  # noqa: E402

EVM_BAD = "0x" + "ba" * 20
EVM_OK = "0x" + "0c" * 20


class _Result:
    def __init__(self, allowed, reason=""):
        self.allowed = allowed
        self.reason = reason


class _Svc:
    """Minimal stand-in for the compliance singleton."""

    def __init__(self, enabled=True, allow=True, reason=""):
        self.enabled = enabled
        self._allow = allow
        self._reason = reason
        self.calls = []

    def screen(self, **kwargs):
        self.calls.append(kwargs)
        return _Result(self._allow, self._reason)


def _install(monkeypatch, svc):
    # _assert_recipient_compliant imports the singleton lazily from the package.
    import bot.services.compliance as pkg

    monkeypatch.setattr(pkg, "compliance_service", svc, raising=False)


def test_blocked_recipient_raises(monkeypatch):
    svc = _Svc(allow=False, reason="OFAC-sanctioned address")
    _install(monkeypatch, svc)
    with pytest.raises(ComplianceBlockedError, match="OFAC"):
        _assert_recipient_compliant(EVM_BAD, "ethereum")


def test_clean_recipient_passes(monkeypatch):
    svc = _Svc(allow=True)
    _install(monkeypatch, svc)
    _assert_recipient_compliant(EVM_OK, "ethereum")  # must not raise
    assert svc.calls, "the screener should have been consulted"
    assert svc.calls[0]["recipient"] == EVM_OK


def test_only_recipient_is_screened_not_token_address(monkeypatch):
    """Finding 6: a token *contract* address is not where funds end up, so
    it must not be forwarded to compliance_service.screen — only the actual
    recipient is screened."""
    svc = _Svc(allow=True)
    _install(monkeypatch, svc)
    _assert_recipient_compliant(EVM_OK, "tron", token_address="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")
    assert svc.calls[0]["recipient"] == EVM_OK
    assert svc.calls[0]["chain"] == "tron"
    assert "tokens" not in svc.calls[0] or not svc.calls[0]["tokens"]


def test_disabled_service_short_circuits(monkeypatch):
    """COMPLIANCE_MODE=disabled (today's prod default) must not screen."""
    svc = _Svc(enabled=False, allow=False)
    _install(monkeypatch, svc)
    _assert_recipient_compliant(EVM_BAD, "ethereum")  # must not raise
    assert svc.calls == []


def test_screener_errors_do_not_break_withdrawals(monkeypatch):
    """Fail OPEN on screener ERRORS in MONITOR/other modes — an outage in
    screening must not become an outage in withdrawals when we're not even
    enforcing yet. A real blocklist hit still raises (see above)."""

    class _Boom:
        enabled = True

        def screen(self, **kwargs):
            raise RuntimeError("screener exploded")

    _install(monkeypatch, _Boom())
    _assert_recipient_compliant(EVM_OK, "ethereum")  # must not raise


def test_screener_errors_fail_closed_in_enforce_mode(monkeypatch):
    """Finding 3: in ENFORCE mode a screener error must raise
    ComplianceBlockedError (fail closed) — we cannot prove the recipient is
    clean, so the withdrawal must not go through."""
    from bot.services.compliance import ComplianceMode

    class _BoomEnforce:
        enabled = True
        mode = ComplianceMode.ENFORCE

        def screen(self, **kwargs):
            raise RuntimeError("screener exploded")

    _install(monkeypatch, _BoomEnforce())
    with pytest.raises(ComplianceBlockedError):
        _assert_recipient_compliant(EVM_OK, "ethereum")


def test_block_is_not_swallowed_by_the_error_handler(monkeypatch):
    """ComplianceBlockedError must escape the broad except that guards errors."""
    svc = _Svc(allow=False, reason="operator-blocked address")
    _install(monkeypatch, svc)
    with pytest.raises(ComplianceBlockedError):
        _assert_recipient_compliant(EVM_BAD, "base")
