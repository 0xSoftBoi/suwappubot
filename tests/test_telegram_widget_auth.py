"""Tests for Telegram Login Widget signature verification.

This is an auth path, so the tests are adversarial rather than happy-path.

The single most dangerous mistake here is using the Mini App secret
derivation. The two schemes look almost identical but are not
interchangeable:

    Login Widget : secret = SHA256(bot_token)
    Mini App     : secret = HMAC_SHA256("WebAppData", bot_token)

A payload signed with the wrong one must be rejected, and there is a test
below that signs with the Mini App derivation specifically to prove it is.
"""

import hashlib
import hmac
import time

import pytest

BOT_TOKEN = "123456:TEST-TOKEN-abcdefghijklmnop"


def _sign_widget(payload: dict, bot_token: str = BOT_TOKEN) -> str:
    """Produce a valid Login Widget hash for `payload` (Telegram's algorithm)."""
    pairs = sorted(f"{k}={v}" for k, v in payload.items() if k != "hash" and v is not None)
    data_check_string = "\n".join(pairs)
    secret = hashlib.sha256(bot_token.encode()).digest()
    return hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()


@pytest.fixture()
def verify():
    """Import the verifier without importing the whole FastAPI app graph."""
    import ast

    src = open("api/main.py").read()
    tree = ast.parse(src)
    fn = next(
        n
        for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name == "_verify_telegram_widget"
    )
    ns: dict = {
        "hashlib": hashlib,
        "hmac": hmac,
        "Dict": dict,
        "Any": object,
        "datetime": __import__("datetime").datetime,
        "timezone": __import__("datetime").timezone,
    }
    exec(compile(ast.Module([fn], []), "<verify>", "exec"), ns)
    return ns["_verify_telegram_widget"]


def _fresh(**over) -> dict:
    p = {
        "id": 4242,
        "first_name": "Ada",
        "username": "ada",
        "auth_date": int(time.time()),
    }
    p.update(over)
    p["hash"] = _sign_widget(p)
    return p


def test_valid_signature_accepted(verify):
    assert verify(_fresh(), BOT_TOKEN) is True


def test_tampered_field_rejected(verify):
    p = _fresh()
    p["id"] = 9999  # signature no longer covers this
    assert verify(p, BOT_TOKEN) is False


def test_missing_hash_rejected(verify):
    p = _fresh()
    del p["hash"]
    assert verify(p, BOT_TOKEN) is False


def test_wrong_bot_token_rejected(verify):
    assert verify(_fresh(), "999999:SOME-OTHER-TOKEN") is False


def test_mini_app_secret_derivation_is_rejected(verify):
    """A payload signed with the Mini App scheme must NOT authenticate.

    Mixing the two derivations is the likeliest implementation error, and it
    would either lock every user out or, in the reverse direction, weaken the
    check. This pins the distinction.
    """
    p = {"id": 4242, "username": "ada", "auth_date": int(time.time())}
    pairs = sorted(f"{k}={v}" for k, v in p.items())
    wrong_secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    p["hash"] = hmac.new(wrong_secret, "\n".join(pairs).encode(), hashlib.sha256).hexdigest()
    assert verify(p, BOT_TOKEN) is False


def test_stale_payload_rejected(verify):
    """Replay protection: the signature alone is valid forever."""
    stale = _fresh(auth_date=int(time.time()) - 86400 - 60)
    assert verify(stale, BOT_TOKEN) is False


def test_future_dated_payload_rejected(verify):
    assert verify(_fresh(auth_date=int(time.time()) + 600), BOT_TOKEN) is False


def test_non_numeric_auth_date_rejected(verify):
    p = {"id": 1, "username": "x", "auth_date": "not-a-number"}
    p["hash"] = _sign_widget(p)
    assert verify(p, BOT_TOKEN) is False


def test_empty_bot_token_rejected(verify):
    assert verify(_fresh(), "") is False


def test_optional_fields_included_in_digest(verify):
    """photo_url/last_name are signed too — they cannot be swapped freely."""
    p = _fresh(last_name="Lovelace", photo_url="https://t.me/i/x.jpg")
    assert verify(p, BOT_TOKEN) is True
    p["photo_url"] = "https://evil.example/x.jpg"
    assert verify(p, BOT_TOKEN) is False
