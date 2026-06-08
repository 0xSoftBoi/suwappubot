import os
import asyncio

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import pytest

from bot.services.turnkey_client import TurnkeyClient


# A typed-data message we can sign deterministically.
TYPED_DATA = {
    "types": {
        "EIP712Domain": [
            {"name": "name", "type": "string"},
            {"name": "version", "type": "string"},
            {"name": "chainId", "type": "uint256"},
        ],
        "Mail": [
            {"name": "contents", "type": "string"},
        ],
    },
    "primaryType": "Mail",
    "domain": {"name": "Test", "version": "1", "chainId": 1},
    "message": {"contents": "hello"},
}

# Deterministic test key.
PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"


def _client_without_init() -> TurnkeyClient:
    # Bypass __init__ (which needs real P-256 keys); we only exercise
    # sign_typed_data, which calls the patched sign_raw_payload.
    return TurnkeyClient.__new__(TurnkeyClient)


def _ground_truth():
    """Sign TYPED_DATA with eth_account and return the canonical signature
    plus the r/s/v components the way Turnkey would surface them."""
    from eth_account import Account
    from eth_account.messages import encode_typed_data

    account = Account.from_key(PRIVATE_KEY)
    signed = account.sign_message(encode_typed_data(full_message=TYPED_DATA))
    expected_sig = signed.signature.hex()
    if not expected_sig.startswith("0x"):
        expected_sig = "0x" + expected_sig
    return expected_sig, signed.r, signed.s, signed.v


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _patch_raw(client, monkeypatch, r_hex, s_hex, v_hex):
    async def fake_sign_raw_payload(**_kwargs):
        return {"r": r_hex, "s": s_hex, "v": v_hex}

    monkeypatch.setattr(client, "sign_raw_payload", fake_sign_raw_payload)


def test_matches_eth_account_signature_with_recovery_id(monkeypatch):
    expected_sig, r, s, v = _ground_truth()
    client = _client_without_init()

    # Turnkey reports v as a bare recovery id 00/01 (hex), no 0x prefix.
    rec_id = v - 27  # 0 or 1
    _patch_raw(
        client,
        monkeypatch,
        format(r, "064x"),
        format(s, "064x"),
        format(rec_id, "02x"),
    )

    sig = _run(client.sign_typed_data(TYPED_DATA, sign_with="0xdead"))

    assert sig == expected_sig
    assert sig.startswith("0x")
    assert len(sig) == 132  # 0x + 130 hex chars
    body = sig[2:]
    assert body[0:64] == format(r, "064x")
    assert body[64:128] == format(s, "064x")
    assert body[128:130] == format(v, "02x")


def test_matches_with_v_already_27_28(monkeypatch):
    expected_sig, r, s, v = _ground_truth()
    client = _client_without_init()

    # Turnkey reports v as full 27/28 (hex 1b/1c).
    _patch_raw(
        client,
        monkeypatch,
        format(r, "064x"),
        format(s, "064x"),
        format(v, "02x"),
    )

    sig = _run(client.sign_typed_data(TYPED_DATA, sign_with="0xdead"))
    assert sig == expected_sig


def test_strips_0x_prefix_on_components(monkeypatch):
    expected_sig, r, s, v = _ground_truth()
    client = _client_without_init()

    _patch_raw(
        client,
        monkeypatch,
        "0x" + format(r, "064x"),
        "0x" + format(s, "064x"),
        "0x" + format(v, "02x"),
    )

    sig = _run(client.sign_typed_data(TYPED_DATA, sign_with="0xdead"))
    assert sig == expected_sig


def test_preserves_leading_zero_nibble(monkeypatch):
    # r/s with a leading "0" nibble must NOT be truncated (lstrip bug).
    client = _client_without_init()
    r_hex = "0" + "a" * 63  # 64 chars, leading zero nibble
    s_hex = "0" + "b" * 63
    _patch_raw(client, monkeypatch, r_hex, s_hex, "00")

    sig = _run(client.sign_typed_data(TYPED_DATA, sign_with="0xdead"))
    assert sig == "0x" + r_hex + s_hex + "1b"
    assert len(sig) == 132


def test_rejects_malformed_components(monkeypatch):
    client = _client_without_init()
    _patch_raw(client, monkeypatch, "abc", "def", "00")
    with pytest.raises(ValueError):
        _run(client.sign_typed_data(TYPED_DATA, sign_with="0xdead"))


def test_rejects_out_of_range_v(monkeypatch):
    # A bad upstream v (0x63 = 99) must NOT pass through as an unrecoverable
    # signature; it has to raise rather than silently emit "...63".
    _expected_sig, r, s, _v = _ground_truth()
    client = _client_without_init()
    _patch_raw(client, monkeypatch, format(r, "064x"), format(s, "064x"), "63")
    with pytest.raises(ValueError):
        _run(client.sign_typed_data(TYPED_DATA, sign_with="0xdead"))


def test_rejects_non_hex_v(monkeypatch):
    _expected_sig, r, s, _v = _ground_truth()
    client = _client_without_init()
    _patch_raw(client, monkeypatch, format(r, "064x"), format(s, "064x"), "zz")
    with pytest.raises(ValueError):
        _run(client.sign_typed_data(TYPED_DATA, sign_with="0xdead"))
