"""SLIP-0010 ed25519 derivation against the spec's test vector 1 and Turnkey's Solana path."""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from bot.utils import slip10  # noqa: E402

SEED = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
ABANDON = (
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
)


def test_spec_vector_1():
    key, _ = slip10.master_key(SEED)
    assert key.hex() == "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7"
    assert (
        slip10.derive_ed25519_seed(SEED, "m/0'").hex()
        == "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3"
    )
    assert (
        slip10.derive_ed25519_seed(SEED, "m/0'/1'/2'/2'/1000000000'").hex()
        == "8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793"
    )


def test_turnkey_solana_path_matches_reference_wallets():
    from eth_account.hdaccount.mnemonic import Mnemonic
    from solders.keypair import Keypair

    seed = Mnemonic.to_seed(ABANDON)
    keypair = Keypair.from_seed(slip10.derive_ed25519_seed(seed, "m/44'/501'/0'/0'"))
    # Phantom / Solana CLI address for this mnemonic at account 0.
    assert str(keypair.pubkey()) == "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk"


def test_derive_backup_key_is_chain_aware():
    import base58
    from eth_account import Account
    from solders.keypair import Keypair

    from bot.services.turnkey_client import TurnkeyActivityError, TurnkeyClient

    sol = TurnkeyClient.derive_backup_key(
        ABANDON, "solana", "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk"
    )
    kp = Keypair.from_bytes(base58.b58decode(sol))
    assert str(kp.pubkey()) == "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk"

    Account.enable_unaudited_hdwallet_features()
    evm_addr = Account.from_mnemonic(ABANDON).address
    evm = TurnkeyClient.derive_backup_key(ABANDON, "evm", evm_addr)
    assert Account.from_key("0x" + evm).address == evm_addr

    import pytest

    with pytest.raises(TurnkeyActivityError):
        TurnkeyClient.derive_backup_key(ABANDON, "solana", "11111111111111111111111111111111")
    with pytest.raises(TurnkeyActivityError):
        TurnkeyClient.derive_backup_key(
            ABANDON, "evm", "0x0000000000000000000000000000000000000001"
        )
