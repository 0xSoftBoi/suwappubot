"""Social-recovery state machine: request -> DKIM-approve -> time-lock -> finalize,
plus cancellation and the anti-theft guards."""

import base64
import hashlib
import os

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from database.db import get_session, init_db
from bot.models.user import User
from bot.models.recovery import RecoveryRequest, RecoveryStatus
from bot.services.dkim_verifier import canonicalize_body_relaxed, canonicalize_header_relaxed
from bot.services.social_recovery import social_recovery_service as svc

GUARDIAN = "alice@example.com"


@pytest.fixture()
def sqlite_db(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'recovery.db'}")
    with get_session() as session:
        session.add(User(id=1, telegram_id=111, username="alice", recovery_email=GUARDIAN))
    yield


def _b64(d: bytes) -> str:
    return base64.b64encode(d).decode()


def _signed_approval(subject: str, from_addr: str = GUARDIAN, domain: str = "example.com"):
    """Build a relaxed/relaxed rsa-sha256 DKIM-signed approval email + resolver."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pub_b64 = _b64(
        key.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
        )
    )
    body = b"approve\r\n"
    headers = [(b"From", b" " + from_addr.encode()), (b"Subject", b" " + subject.encode())]
    bh = _b64(hashlib.sha256(canonicalize_body_relaxed(body)).digest())
    tags = f"v=1; a=rsa-sha256; c=relaxed/relaxed; d={domain}; s=sel; h=from:subject; bh={bh}; b="
    signing_input = b""
    for n, v in headers:
        signing_input += canonicalize_header_relaxed(n, v)
    signing_input += canonicalize_header_relaxed(b"DKIM-Signature", b" " + tags.encode())
    signing_input = signing_input.rstrip(b"\r\n")
    sig = key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    raw = (
        b"DKIM-Signature: "
        + (tags + _b64(sig)).encode()
        + b"\r\n"
        + b"From: "
        + from_addr.encode()
        + b"\r\n"
        + b"Subject: "
        + subject.encode()
        + b"\r\n\r\n"
        + body
    )
    return raw, (lambda s, d: pub_b64)


# ── request ──────────────────────────────────────────────────────────────────


def test_request_recovery_creates_request(sqlite_db):
    req, msg = svc.request_recovery(GUARDIAN, new_telegram_id=999)
    assert req is not None
    assert req["status"] == RecoveryStatus.PENDING
    assert req["new_telegram_id"] == 999
    assert len(req["challenge"]) >= 8


def test_request_recovery_unknown_email(sqlite_db):
    req, msg = svc.request_recovery("nobody@nowhere.com", new_telegram_id=999)
    assert req is None


def test_request_recovery_is_idempotent(sqlite_db):
    r1, _ = svc.request_recovery(GUARDIAN, new_telegram_id=999)
    r2, msg = svc.request_recovery(GUARDIAN, new_telegram_id=888)
    assert r2["id"] == r1["id"]  # reuses the live request
    assert "already in progress" in msg


# ── approval ─────────────────────────────────────────────────────────────────


def test_valid_email_approves_request(sqlite_db):
    req, _ = svc.request_recovery(GUARDIAN, new_telegram_id=999, delay_seconds=0)
    raw, resolver = _signed_approval(subject=f"RECOVER {req['challenge']}")
    ok, msg = svc.submit_approval_email(raw, resolver)
    assert ok is True, msg
    with get_session() as session:
        r = session.query(RecoveryRequest).filter(RecoveryRequest.id == req["id"]).first()
        assert r.status == RecoveryStatus.APPROVED
        assert r.approved_domain == "example.com"


def test_email_from_wrong_address_rejected(sqlite_db):
    req, _ = svc.request_recovery(GUARDIAN, new_telegram_id=999)
    raw, resolver = _signed_approval(
        subject=f"RECOVER {req['challenge']}", from_addr="attacker@example.com"
    )
    ok, msg = svc.submit_approval_email(raw, resolver)
    assert ok is False
    assert "registered recovery email" in msg


def test_email_wrong_challenge_no_match(sqlite_db):
    svc.request_recovery(GUARDIAN, new_telegram_id=999)
    raw, resolver = _signed_approval(subject="RECOVER deadbeefdeadbeef")
    ok, msg = svc.submit_approval_email(raw, resolver)
    assert ok is False
    assert "No pending recovery" in msg


def test_tampered_email_rejected(sqlite_db):
    req, _ = svc.request_recovery(GUARDIAN, new_telegram_id=999)
    raw, resolver = _signed_approval(subject=f"RECOVER {req['challenge']}")
    tampered = raw.replace(b"approve", b"HACKED!")  # breaks the body hash
    ok, msg = svc.submit_approval_email(tampered, resolver)
    assert ok is False
    assert "not verified" in msg


# ── finalize / time-lock ─────────────────────────────────────────────────────


def test_finalize_blocked_before_timelock(sqlite_db):
    req, _ = svc.request_recovery(GUARDIAN, new_telegram_id=999, delay_seconds=86400)
    raw, resolver = _signed_approval(subject=f"RECOVER {req['challenge']}")
    assert svc.submit_approval_email(raw, resolver)[0] is True
    ok, msg = svc.finalize_recovery(req["id"])
    assert ok is False
    assert "Time-lock" in msg


def test_finalize_after_timelock_transfers_account(sqlite_db):
    req, _ = svc.request_recovery(GUARDIAN, new_telegram_id=999, delay_seconds=0)
    raw, resolver = _signed_approval(subject=f"RECOVER {req['challenge']}")
    assert svc.submit_approval_email(raw, resolver)[0] is True
    ok, msg = svc.finalize_recovery(req["id"])
    assert ok is True, msg
    with get_session() as session:
        user = session.query(User).filter(User.id == 1).first()
        assert user.telegram_id == 999  # control transferred to the new account


def test_finalize_requires_approval(sqlite_db):
    req, _ = svc.request_recovery(GUARDIAN, new_telegram_id=999, delay_seconds=0)
    ok, msg = svc.finalize_recovery(req["id"])  # never approved
    assert ok is False
    assert "not approved" in msg


def test_finalize_blocked_when_target_id_taken(sqlite_db):
    with get_session() as session:
        session.add(User(id=2, telegram_id=999, username="bob"))  # target already exists
    req, _ = svc.request_recovery(GUARDIAN, new_telegram_id=999, delay_seconds=0)
    raw, resolver = _signed_approval(subject=f"RECOVER {req['challenge']}")
    assert svc.submit_approval_email(raw, resolver)[0] is True
    ok, msg = svc.finalize_recovery(req["id"])
    assert ok is False
    assert "already registered" in msg


# ── cancel ───────────────────────────────────────────────────────────────────


def test_cancel_blocks_finalize(sqlite_db):
    req, _ = svc.request_recovery(GUARDIAN, new_telegram_id=999, delay_seconds=0)
    raw, resolver = _signed_approval(subject=f"RECOVER {req['challenge']}")
    svc.submit_approval_email(raw, resolver)
    ok, _ = svc.cancel_recovery(req["id"])
    assert ok is True
    ok2, msg = svc.finalize_recovery(req["id"])
    assert ok2 is False
    assert "not approved" in msg
    # The original owner kept the account.
    with get_session() as session:
        assert session.query(User).filter(User.id == 1).first().telegram_id == 111
