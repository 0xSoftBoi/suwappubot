"""Regression tests for local signing in bot.services.wallet.

These verify behavior preservation of the key-hardening changes on the
two local signing paths (_sign_evm_local, _sign_typed_data_local):
the try/finally cleanup (key zeroization + dropping the Account reference)
must NOT corrupt the signed output. Signatures must still recover to the
correct signer address.

The decrypted key is modelled the way production supplies it: a freshly
generated, uniquely-owned string handed to the signer (which the signer
is then free to zeroize in place). No DB / encryption harness is needed —
get_private_key is stubbed.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from eth_account import Account
from eth_account.messages import encode_typed_data

from bot.services.wallet import WalletService


class _StubWallet:
    is_turnkey_wallet = False


def _service_returning_fresh_key(hex_key_no_prefix: str, prefix: bool) -> WalletService:
    """Build a WalletService whose get_private_key returns a brand-new,
    uniquely-owned string each call (as the decryption layer does in prod)."""
    svc = WalletService.__new__(WalletService)  # skip __init__/DB setup

    def _get(wallet, auto_migrate=True):
        # Construct a fresh str object the signer exclusively owns, so the
        # in-place zeroization in the finally block cannot corrupt anything
        # the test still references.
        return ("0x" if prefix else "") + "".join(hex_key_no_prefix)

    svc.get_private_key = _get  # type: ignore[assignment]
    return svc


def _roundtrip_evm(prefix: bool):
    acct = Account.create()
    key_no_prefix = acct.key.hex()[2:] if acct.key.hex().startswith("0x") else acct.key.hex()
    expected_addr = acct.address

    svc = _service_returning_fresh_key(key_no_prefix, prefix)
    tx = {
        "nonce": 0,
        "maxFeePerGas": 2_000_000_000,
        "maxPriorityFeePerGas": 1_000_000_000,
        "gas": 21000,
        "to": "0x000000000000000000000000000000000000dEaD",
        "value": 1,
        "chainId": 1,
    }
    raw_hex = svc._sign_evm_local(_StubWallet(), tx)
    assert raw_hex
    assert Account.recover_transaction(raw_hex) == expected_addr


def test_sign_evm_local_roundtrip_unprefixed_key():
    _roundtrip_evm(prefix=False)  # exercises the "0x" + key branch


def test_sign_evm_local_roundtrip_prefixed_key():
    _roundtrip_evm(prefix=True)  # prefixed -> prefixed is private_key alias


def _typed_data():
    return {
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


def _roundtrip_typed(prefix: bool):
    acct = Account.create()
    key_no_prefix = acct.key.hex()[2:] if acct.key.hex().startswith("0x") else acct.key.hex()
    expected_addr = acct.address

    svc = _service_returning_fresh_key(key_no_prefix, prefix)
    td = _typed_data()
    sig_hex = svc._sign_typed_data_local(_StubWallet(), td)
    assert sig_hex
    sig = sig_hex if sig_hex.startswith("0x") else "0x" + sig_hex
    encoded = encode_typed_data(full_message=td)
    assert Account.recover_message(encoded, signature=sig) == expected_addr


def test_sign_typed_data_local_roundtrip_unprefixed_key():
    _roundtrip_typed(prefix=False)


def test_sign_typed_data_local_roundtrip_prefixed_key():
    _roundtrip_typed(prefix=True)


if __name__ == "__main__":
    test_sign_evm_local_roundtrip_unprefixed_key()
    test_sign_evm_local_roundtrip_prefixed_key()
    test_sign_typed_data_local_roundtrip_unprefixed_key()
    test_sign_typed_data_local_roundtrip_prefixed_key()
    print("OK")
