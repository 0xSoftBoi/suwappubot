"""DKIM verifier correctness.

Two layers of assurance:
  1. Canonicalization is checked against RFC 6376's own known-answer vectors
     (§3.4.5), independent of any signer — this validates spec conformance.
  2. A full RSA-SHA256 round-trip (sign with a generated key, then verify)
     confirms the end-to-end signature path and that tampering is rejected.
"""

import base64

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from bot.services.dkim_verifier import (
    canonicalize_body_relaxed,
    canonicalize_header_relaxed,
    canonicalize_body_simple,
    verify_email,
)

# ── RFC 6376 §3.4.5 known-answer vectors ─────────────────────────────────────


def test_rfc_relaxed_header_vector():
    # RFC 6376 §3.4.5: "A: X" -> "a:X"; folded "B : Y<CRLF><TAB>Z" -> "b:Y Z".
    assert canonicalize_header_relaxed(b"A", b" X") == b"a:X\r\n"
    assert canonicalize_header_relaxed(b"B ", b" Y\t\r\n\tZ  ") == b"b:Y Z\r\n"


def test_rfc_relaxed_body_vector():
    # RFC 6376 §3.4.5 example body canonicalizes to "C\r\nD E\r\n".
    body = b"C \r\nD \t E\r\n\r\n\r\n"
    assert canonicalize_body_relaxed(body) == b"C\r\nD E\r\n"


def test_relaxed_empty_body_is_empty():
    assert canonicalize_body_relaxed(b"") == b""
    assert canonicalize_body_relaxed(b"\r\n\r\n") == b""


def test_simple_empty_body_is_single_crlf():
    assert canonicalize_body_simple(b"") == b"\r\n"
    assert canonicalize_body_simple(b"hi\r\n\r\n\r\n") == b"hi\r\n"


# ── Full RSA round-trip with a generated key ─────────────────────────────────


def _b64(d: bytes) -> str:
    return base64.b64encode(d).decode()


def _make_signed_email(
    from_addr="alice@example.com",
    subject="RECOVER abc123",
    body=b"approve recovery\r\n",
    selector="sel",
    domain="example.com",
    tamper_body=False,
    tamper_subject=False,
):
    """Produce a relaxed/relaxed rsa-sha256 DKIM-signed email and its public key
    (base64 DER), using the same canonicalization the verifier expects."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pub_der = key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    pub_b64 = _b64(pub_der)

    headers = [
        (b"From", b" " + from_addr.encode()),
        (b"To", b" bot@suwappu.bot"),
        (b"Subject", b" " + subject.encode()),
    ]
    signed_names = ["from", "to", "subject"]

    bh = _b64(__import__("hashlib").sha256(canonicalize_body_relaxed(body)).digest())

    dkim_tags = (
        f"v=1; a=rsa-sha256; c=relaxed/relaxed; d={domain}; s={selector}; "
        f"h={':'.join(signed_names)}; bh={bh}; b="
    )
    # Build signing input: signed headers (relaxed) + DKIM-Signature (b= empty).
    signing_input = b""
    hmap = {n.lower(): (n, v) for n, v in headers}
    for hn in signed_names:
        n, v = hmap[hn.encode()]
        signing_input += canonicalize_header_relaxed(n, v)
    signing_input += canonicalize_header_relaxed(b"DKIM-Signature", b" " + dkim_tags.encode())
    signing_input = signing_input.rstrip(b"\r\n")

    sig = key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    dkim_full = dkim_tags + _b64(sig)

    if tamper_subject:
        headers = [(n, b" HACKED") if n == b"Subject" else (n, v) for n, v in headers]
    out_body = b"tampered\r\n" if tamper_body else body

    lines = [b"DKIM-Signature: " + dkim_full.encode()]
    for n, v in headers:
        lines.append(n + b":" + v)
    raw = b"\r\n".join(lines) + b"\r\n\r\n" + out_body
    return raw, pub_b64


def _resolver_for(pub_b64):
    return lambda selector, domain: pub_b64


def test_valid_signature_verifies():
    raw, pub = _make_signed_email()
    res = verify_email(raw, _resolver_for(pub))
    assert res.verified is True, res.reason
    assert res.domain == "example.com"
    assert res.from_address == "alice@example.com"
    assert "RECOVER abc123" in (res.subject or "")


def test_tampered_body_rejected():
    raw, pub = _make_signed_email(tamper_body=True)
    res = verify_email(raw, _resolver_for(pub))
    assert res.verified is False
    assert "body hash" in res.reason


def test_tampered_signed_header_rejected():
    raw, pub = _make_signed_email(tamper_subject=True)
    res = verify_email(raw, _resolver_for(pub))
    assert res.verified is False
    assert "signature verification failed" in res.reason


def test_wrong_public_key_rejected():
    raw, _pub = _make_signed_email()
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_b64 = _b64(
        other.public_key().public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )
    res = verify_email(raw, _resolver_for(other_b64))
    assert res.verified is False


def test_missing_key_fails_closed():
    raw, _pub = _make_signed_email()
    res = verify_email(raw, lambda s, d: None)
    assert res.verified is False
    assert "public key not found" in res.reason


def test_no_dkim_header():
    res = verify_email(b"From: a@b.com\r\nSubject: hi\r\n\r\nbody\r\n", lambda s, d: "x")
    assert res.verified is False
    assert "no DKIM-Signature" in res.reason
