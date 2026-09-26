"""The custodial deposit credit path.

MONEY-PATH. The properties under test are the ones whose absence loses or
duplicates user funds:

* a deposit to a user's own address credits that user, once;
* re-scanning the same log never credits twice (crash, restart, rewound
  cursor — all replay the same range);
* a token we do not book is ignored, so an airdropped spam token cannot enter
  the ledger;
* dust below the sweep floor is not booked;
* a failed range read never advances the cursor past unread blocks.
"""

from decimal import Decimal

import pytest

from bot.services.deposit_watcher import (
    TRANSFER_TOPIC0,
    DepositWatcher,
    _address_from_topic,
    _topic_for_address,
)

USER_ADDRESS = "0x1111111111111111111111111111111111111111"
SENDER = "0x2222222222222222222222222222222222222222"
USDC_ETHEREUM = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
SPAM_TOKEN = "0x000000000000000000000000000000000000dead"


def _log(*, token: str, to: str, value: int, tx_hash: str = "0xabc", log_index: int = 0):
    """A Transfer log shaped the way web3.py hands one back."""
    return {
        "address": token,
        "topics": [
            TRANSFER_TOPIC0,
            _topic_for_address(SENDER),
            _topic_for_address(to),
        ],
        "data": hex(value),
        "transactionHash": tx_hash,
        "logIndex": log_index,
        "blockNumber": 1000,
    }


@pytest.fixture()
def watcher(tmp_db):
    return DepositWatcher()


def _balance(user_id: int, chain: str, token: str) -> Decimal:
    from bot.services.hot_wallet import hot_wallet_service

    return hot_wallet_service.get_custodial_balance(user_id, chain, token)


def test_topic_roundtrip():
    assert _address_from_topic(_topic_for_address(USER_ADDRESS)).lower() == USER_ADDRESS.lower()


def test_deposit_credits_the_owning_user(watcher):
    tokens = {USDC_ETHEREUM.lower(): "USDC"}
    by_address = {USER_ADDRESS.lower(): 42}

    credited = watcher._handle_log(
        _log(token=USDC_ETHEREUM, to=USER_ADDRESS, value=25_000_000),  # 25 USDC, 6dp
        "ethereum",
        tokens,
        by_address,
    )

    assert credited is True
    assert _balance(42, "ethereum", "USDC") == Decimal("25")


def test_rescanning_the_same_log_does_not_credit_twice(watcher):
    """The whole point of the idempotency key. A re-scan must be a no-op."""
    tokens = {USDC_ETHEREUM.lower(): "USDC"}
    by_address = {USER_ADDRESS.lower(): 7}
    log = _log(token=USDC_ETHEREUM, to=USER_ADDRESS, value=10_000_000, tx_hash="0xdup")

    assert watcher._handle_log(log, "ethereum", tokens, by_address) is True
    assert _balance(7, "ethereum", "USDC") == Decimal("10")

    # Same log again — a restart replaying the range, or a rewound cursor.
    assert watcher._handle_log(log, "ethereum", tokens, by_address) is False
    assert _balance(7, "ethereum", "USDC") == Decimal("10")


def test_two_transfers_in_one_tx_are_both_credited(watcher):
    """Distinct log indexes are distinct deposits — batched sends are real."""
    tokens = {USDC_ETHEREUM.lower(): "USDC"}
    by_address = {USER_ADDRESS.lower(): 9}

    assert watcher._handle_log(
        _log(token=USDC_ETHEREUM, to=USER_ADDRESS, value=1_000_000, tx_hash="0xbatch", log_index=0),
        "ethereum",
        tokens,
        by_address,
    )
    assert watcher._handle_log(
        _log(token=USDC_ETHEREUM, to=USER_ADDRESS, value=2_000_000, tx_hash="0xbatch", log_index=1),
        "ethereum",
        tokens,
        by_address,
    )
    assert _balance(9, "ethereum", "USDC") == Decimal("3")


def test_unlisted_token_is_ignored(watcher):
    """An airdropped spam token must never enter the ledger."""
    tokens = {USDC_ETHEREUM.lower(): "USDC"}
    by_address = {USER_ADDRESS.lower(): 11}

    assert (
        watcher._handle_log(
            _log(token=SPAM_TOKEN, to=USER_ADDRESS, value=10**24),
            "ethereum",
            tokens,
            by_address,
        )
        is False
    )
    assert _balance(11, "ethereum", "USDC") == Decimal("0")


def test_transfer_to_an_unknown_address_is_ignored(watcher):
    tokens = {USDC_ETHEREUM.lower(): "USDC"}
    assert (
        watcher._handle_log(
            _log(token=USDC_ETHEREUM, to=SENDER, value=5_000_000), "ethereum", tokens, {}
        )
        is False
    )


def test_dust_below_the_floor_is_not_credited(watcher):
    """Crediting less than the sweep costs hands the user an immovable balance."""
    tokens = {USDC_ETHEREUM.lower(): "USDC"}
    by_address = {USER_ADDRESS.lower(): 13}

    assert (
        watcher._handle_log(
            _log(token=USDC_ETHEREUM, to=USER_ADDRESS, value=1),  # 0.000001 USDC
            "ethereum",
            tokens,
            by_address,
        )
        is False
    )
    assert _balance(13, "ethereum", "USDC") == Decimal("0")


def test_cursor_round_trips(watcher):
    assert watcher._get_cursor("ethereum") is None
    watcher._set_cursor("ethereum", 500)
    assert watcher._get_cursor("ethereum") == 500
    watcher._set_cursor("ethereum", 900)
    assert watcher._get_cursor("ethereum") == 900


@pytest.mark.asyncio
async def test_failed_range_read_does_not_advance_the_cursor(watcher, monkeypatch):
    """A skipped range is a permanently missing deposit. Never advance past one."""
    from bot.services import hot_wallet as hw_module

    monkeypatch.setattr(
        hw_module.hot_wallet_service,
        "list_user_deposit_wallets",
        lambda chain_type="evm": [(1, USER_ADDRESS)],
    )

    class BoomWeb3:
        class eth:
            block_number = 10_000

            @staticmethod
            def get_logs(_params):
                raise RuntimeError("provider rejected the range")

    from bot.services import rpc_manager as rpc_module

    monkeypatch.setattr(rpc_module.rpc_manager, "get_web3", lambda chain: BoomWeb3)

    watcher._set_cursor("ethereum", 100)
    await watcher.scan_chain("ethereum")

    assert watcher._get_cursor("ethereum") == 100
