"""Session provenance, address normalization, and identity precedence regressions."""

import os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from api.main import (
    _wallet_auth_origin,
    create_jwt_token,
    decode_jwt_token,
    get_current_user_from_token,
)
from api.authz import require_proof_of_possession


def test_jwt_preserves_case_sensitive_solana_address():
    address = "AbCdEfGhijkMNopQRstuVWxyz123456789ABCDEfghij"
    payload = decode_jwt_token(create_jwt_token(address, user_id=7, src="siwe"))
    assert payload is not None
    assert payload["address"] == address


def test_jwt_normalizes_evm_address():
    address = "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD"
    payload = decode_jwt_token(create_jwt_token(address, user_id=7, src="siwe"))
    assert payload is not None
    assert payload["address"] == address.lower()


async def test_explicit_bearer_wins_over_conflicting_cookie():
    bearer = create_jwt_token("0x1111111111111111111111111111111111111111", 101, "siwe")
    cookie = create_jwt_token("0x2222222222222222222222222222222222222222", 202, "weak")
    request = SimpleNamespace(headers={"Authorization": f"Bearer {bearer}"})

    payload = await get_current_user_from_token(request, auth_token=cookie)
    assert payload is not None
    assert payload["user_id"] == 101
    assert payload["src"] == "siwe"


def test_wallet_challenge_uses_terminal_origin_and_rejects_foreign_origin():
    request = SimpleNamespace(headers={"origin": "https://terminal.suwappu.bot"})
    assert _wallet_auth_origin(request) == (
        "terminal.suwappu.bot",
        "https://terminal.suwappu.bot",
    )

    foreign = SimpleNamespace(headers={"origin": "https://example.com"})
    with pytest.raises(HTTPException, match="Untrusted wallet sign-in origin"):
        _wallet_auth_origin(foreign)


def test_money_paths_require_a_real_possession_proof():
    assert require_proof_of_possession({"user_id": 7, "src": "siwe"}) == 7
    assert require_proof_of_possession({"user_id": 7, "src": "passkey"}) == 7
    assert require_proof_of_possession({"user_id": 7, "src": "telegram"}) == 7

    with pytest.raises(HTTPException) as exc_info:
        require_proof_of_possession({"user_id": 7, "src": "weak"})
    assert exc_info.value.status_code == 403
