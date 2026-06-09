"""Tests for WhatsApp webhook signature verification (the security blocker).

Meta signs each inbound webhook with the App Secret (HMAC-SHA256 over the raw
body). Without verification, anyone can POST forged messages. These tests guard
verify_signature: accept genuine signatures, reject forged/missing/tampered, and
skip (fail-open) only when no secret is configured.
"""

import hashlib
import hmac

from bot.services.whatsapp_service import WhatsAppService


def _svc(secret):
    s = WhatsAppService()
    s.app_secret = secret
    return s


def _sign(secret: bytes, body: bytes) -> str:
    return "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()


def test_valid_signature_accepted():
    body = b'{"object":"whatsapp_business_account"}'
    svc = _svc("sekret")
    assert svc.verify_signature(body, _sign(b"sekret", body)) is True


def test_forged_signature_rejected():
    svc = _svc("sekret")
    assert svc.verify_signature(b'{"x":1}', "sha256=deadbeef") is False


def test_tampered_body_rejected():
    svc = _svc("sekret")
    sig = _sign(b"sekret", b'{"amount":1}')
    # Same signature, different body — must fail.
    assert svc.verify_signature(b'{"amount":1000000}', sig) is False


def test_missing_header_rejected_when_secret_set():
    svc = _svc("sekret")
    assert svc.verify_signature(b'{"x":1}', None) is False
    assert svc.verify_signature(b'{"x":1}', "garbage-no-prefix") is False


def test_unconfigured_skips_open():
    # No app secret -> can't verify; skip rather than brick an unconfigured env.
    svc = _svc(None)
    assert svc.verify_signature(b'{"x":1}', None) is True
