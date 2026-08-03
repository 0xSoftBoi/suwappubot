"""Tests for the generic-rail CCTP completion relayer (fully mocked RPC/attestation)."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bot.services.cctp_generic_relayer import (
    CctpGenericRelayer,
    CctpGenericRelayerError,
    InsufficientRelayerGasError,
    MAX_ATTEMPTS,
    STALL_TERMINAL_HOURS,
)

DEP = {
    "id": 1,
    "user_id": 42,
    "recipient": "0x1111111111111111111111111111111111111111",
    "from_chain": "arbitrum",
    "to_chain": "base",
    "burn_tx_hash": "0xburn",
    "amount_raw": 100_000_000,
    "version": 2,
    "status": "burned",
}

# A well-formed 44-byte-minimum CCTP V2 message so message_nonce_bytes32
# can slice out bytes[12:44]. Content beyond the nonce doesn't matter here.
MESSAGE_HEX = "0x" + ("00" * 12) + ("11" * 32) + ("22" * 4)
NONCE_BYTES = bytes.fromhex("11" * 32)


def _relayer():
    r = CctpGenericRelayer()
    r._set_status = MagicMock()
    r._notify = AsyncMock(return_value=None)
    r._alert_admins = AsyncMock(return_value=None)
    return r


def _attested_status(message=MESSAGE_HEX, attestation="0xatt"):
    return SimpleNamespace(
        status="ATTESTED",
        attestation=attestation,
        raw_response={"message": message},
    )


def _pending_status():
    return SimpleNamespace(status="PENDING", attestation=None, raw_response={})


def _message_bytes():
    from web3 import Web3

    return Web3.to_bytes(hexstr=MESSAGE_HEX)


# --------------------------------------------------------------------------
# is_enabled
# --------------------------------------------------------------------------


def test_is_enabled_requires_flag_and_key():
    r = CctpGenericRelayer()
    with patch("bot.services.cctp_generic_relayer.settings") as s:
        s.cctp_generic_relayer_enabled = True
        s.cctp_relayer_private_key = "0xkey"
        assert r.is_enabled() is True
        s.cctp_relayer_private_key = None
        assert r.is_enabled() is False
        s.cctp_generic_relayer_enabled = False
        s.cctp_relayer_private_key = "0xkey"
        assert r.is_enabled() is False


# --------------------------------------------------------------------------
# record_burn: called BEFORE broadcast (pending_broadcast), idempotent on burn_tx_hash
# --------------------------------------------------------------------------


def test_record_burn_persists_and_is_idempotent():
    r = CctpGenericRelayer()

    class FakeRow:
        def __init__(self, **kw):
            self.id = 7
            for k, v in kw.items():
                setattr(self, k, v)

    added = []

    class FakeQuery:
        def __init__(self, existing):
            self._existing = existing

        def filter_by(self, **kw):
            return self

        def first(self):
            return self._existing

    class FakeSession:
        def __init__(self, existing=None):
            self._existing = existing

        def query(self, model):
            return FakeQuery(self._existing)

        def add(self, obj):
            added.append(obj)
            obj.id = 7

        def flush(self):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    # First call: no existing row -> inserts.
    with patch(
        "bot.services.cctp_generic_relayer.get_session", MagicMock(return_value=FakeSession())
    ):
        dep_id = r.record_burn(
            user_id=42,
            recipient_address="0xabc",
            from_chain="arbitrum",
            to_chain="base",
            burn_tx_hash="0xburn",
            amount_raw=100_000_000,
        )
    assert dep_id == 7
    assert len(added) == 1
    assert added[0].status == "pending_broadcast"  # default status is pre-broadcast

    # Second call with the same burn_tx_hash: existing row found -> no new insert.
    existing = FakeRow(id=7)
    with patch(
        "bot.services.cctp_generic_relayer.get_session",
        MagicMock(return_value=FakeSession(existing=existing)),
    ):
        dep_id2 = r.record_burn(
            user_id=42,
            recipient_address="0xabc",
            from_chain="arbitrum",
            to_chain="base",
            burn_tx_hash="0xburn",
            amount_raw=100_000_000,
        )
    assert dep_id2 == 7
    assert len(added) == 1  # still just the one insert


def test_mark_broadcast_promotes_pending_to_burned():
    r = CctpGenericRelayer()

    class FakeRow:
        status = "pending_broadcast"

    row = FakeRow()

    class FakeQuery:
        def filter_by(self, **kw):
            return self

        def first(self):
            return row

    class FakeSession:
        def query(self, model):
            return FakeQuery()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    with patch(
        "bot.services.cctp_generic_relayer.get_session", MagicMock(return_value=FakeSession())
    ):
        r.mark_broadcast("0xburn")
    assert row.status == "burned"


# --------------------------------------------------------------------------
# _advance: attestation pending -> no-op
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_advance_waits_when_attestation_incomplete():
    r = _relayer()
    with (
        patch(
            "bot.services.cctp_generic_relayer.cctp_api.get_attestation_v2",
            AsyncMock(return_value=_pending_status()),
        ),
        patch("bot.services.cctp_generic_relayer.rpc_manager.get_web3", MagicMock()),
    ):
        await r._advance(dict(DEP))
    r._set_status.assert_not_called()
    r._notify.assert_not_awaited()


# --------------------------------------------------------------------------
# _advance: attestation complete -> mints on the CORRECT destination chain
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_advance_mints_on_correct_destination_chain():
    r = _relayer()
    r._submit_receive = AsyncMock(return_value="0xmint")
    get_web3_mock = MagicMock()

    with (
        patch(
            "bot.services.cctp_generic_relayer.cctp_api.get_attestation_v2",
            AsyncMock(return_value=_attested_status()),
        ),
        patch(
            "bot.services.cctp_generic_relayer.cctp_api.build_receive_transaction",
            MagicMock(
                return_value={
                    "to": "0x2222222222222222222222222222222222222222",
                    "data": "0x",
                    "value": 0,
                }
            ),
        ) as build_receive,
        patch("bot.services.cctp_generic_relayer.rpc_manager.get_web3", get_web3_mock),
    ):
        await r._advance(dict(DEP))

    # Destination chain (DEP["to_chain"] == "base") used for both the web3
    # client and the receiveMessage tx build -- never the source chain.
    get_web3_mock.assert_called_once_with("base")
    assert build_receive.call_args.args[0] == "base"
    r._submit_receive.assert_awaited_once()
    r._set_status.assert_called_once_with(DEP["id"], "minted", mint_tx_hash="0xmint")
    r._notify.assert_awaited_once_with(DEP, "0xmint")


# --------------------------------------------------------------------------
# Insufficient relayer gas: surfaced, retryable (stall, not permanent), NOT dropped
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_submit_receive_raises_insufficient_gas_and_stays_retryable():
    r = CctpGenericRelayer()
    web3 = MagicMock()
    web3.eth.call.return_value = (0).to_bytes(32, "big")  # usedNonces -> unused
    web3.eth.estimate_gas.return_value = 100_000
    web3.eth.gas_price = 1_000_000_000
    web3.eth.get_balance.return_value = 0  # broke relayer wallet
    web3.eth.account.from_key.return_value = SimpleNamespace(address="0xrelayer")
    web3.from_wei = lambda wei, unit: wei / 1e18

    with patch(
        "bot.services.cctp_generic_relayer.get_chain_by_name",
        MagicMock(return_value=SimpleNamespace(chain_id=8453, native_token="ETH")),
    ):
        with pytest.raises(InsufficientRelayerGasError):
            await r._submit_receive(
                web3,
                dict(DEP),
                {"to": "0x2222222222222222222222222222222222222222", "data": "0x", "value": 0},
                _message_bytes(),
            )

    # Now drive it through process_once -> the deposit must be bumped via the
    # STALL path (not the permanent-error path), not marked failed outright,
    # and admins must be alerted. This is the exact test the money-path
    # reviewer flagged: it previously mocked _bump_error out and asserted
    # nothing about the real bump path -- now it exercises the real
    # _bump_stall and checks the DB effect.
    r2 = _relayer()
    r2._submit_receive = AsyncMock(
        side_effect=InsufficientRelayerGasError("relayer has 0 ETH on base, needs 0.001")
    )
    r2._alert_low_balance = AsyncMock(return_value=None)

    class FakeRow:
        id = 1
        attempts = 0
        stall_count = 0
        last_error = None
        status = "burned"
        created_at = datetime.now(timezone.utc)

    row = FakeRow()

    class FakeQuery:
        def filter_by(self, **kw):
            return self

        def first(self):
            return row

    class FakeSession:
        def query(self, model):
            return FakeQuery()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    # _advance polls the attestation before it ever reaches _submit_receive, so
    # that has to be satisfied for the gas-shortfall path to be exercised at
    # all; without these the deposit just returns early as "still pending" and
    # the test silently asserts nothing.
    attested = SimpleNamespace(
        status="ATTESTED",
        attestation="0x" + "cd" * 32,
        raw_response={"message": MESSAGE_HEX},
    )

    with (
        patch(
            "bot.services.cctp_generic_relayer.CctpGenericRelayer._pending",
            MagicMock(return_value=[dict(DEP)]),
        ),
        patch(
            "bot.services.cctp_generic_relayer.CctpGenericRelayer._pending_broadcast_rows",
            MagicMock(return_value=[]),
        ),
        patch(
            "bot.services.cctp_generic_relayer.get_session",
            MagicMock(return_value=FakeSession()),
        ),
        patch(
            "bot.services.cctp_generic_relayer.cctp_api.get_attestation_v2",
            AsyncMock(return_value=attested),
        ),
        patch(
            "bot.services.cctp_generic_relayer.cctp_api.build_receive_transaction",
            MagicMock(
                return_value={
                    "to": "0x2222222222222222222222222222222222222222",
                    "data": "0x",
                    "value": 0,
                }
            ),
        ),
        patch(
            "bot.services.cctp_generic_relayer.rpc_manager.get_web3",
            MagicMock(return_value=web3),
        ),
    ):
        await r2.process_once()

    r2._alert_low_balance.assert_awaited_once()
    # Deposit was NOT marked minted/failed by the gas-shortfall path itself --
    # it went through stall_count, not attempts, and stayed "burned".
    r2._set_status.assert_not_called()
    assert row.stall_count == 1
    assert row.attempts == 0
    assert row.status == "burned"
    assert "insufficient relayer gas" in row.last_error


def test_insufficient_gas_never_reaches_terminal_via_attempt_count():
    """H1: InsufficientRelayerGasError must not exhaust the permanent MAX_ATTEMPTS
    budget in a handful of loop iterations -- it only becomes terminal after
    STALL_TERMINAL_HOURS of wall-clock time, regardless of stall count."""
    r = CctpGenericRelayer()
    r._alert_admins = AsyncMock(return_value=None)

    class FakeRow:
        id = 1
        attempts = 0
        stall_count = 0
        last_error = None
        status = "burned"
        created_at = datetime.now(timezone.utc)  # created just now

    row = FakeRow()

    class FakeQuery:
        def filter_by(self, **kw):
            return self

        def first(self):
            return row

    class FakeSession:
        def query(self, model):
            return FakeQuery()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    with patch(
        "bot.services.cctp_generic_relayer.get_session", MagicMock(return_value=FakeSession())
    ):
        for _ in range(MAX_ATTEMPTS * 3):  # far more than the permanent-error budget
            r._bump_stall(1, "insufficient relayer gas")

    assert row.status == "burned"  # never became terminal from count alone
    assert row.stall_count == MAX_ATTEMPTS * 3


def test_stall_becomes_terminal_after_wall_clock_hours():
    r = CctpGenericRelayer()
    r._alert_admins = AsyncMock(return_value=None)
    r._schedule_alert = MagicMock()

    class FakeRow:
        id = 1
        attempts = 0
        stall_count = 0
        last_error = None
        status = "burned"
        created_at = datetime.now(timezone.utc) - timedelta(hours=STALL_TERMINAL_HOURS + 1)

    row = FakeRow()

    class FakeQuery:
        def filter_by(self, **kw):
            return self

        def first(self):
            return row

    class FakeSession:
        def query(self, model):
            return FakeQuery()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    with patch(
        "bot.services.cctp_generic_relayer.get_session", MagicMock(return_value=FakeSession())
    ):
        r._bump_stall(1, "insufficient relayer gas")

    assert row.status == "failed"
    r._schedule_alert.assert_called_once()


# --------------------------------------------------------------------------
# usedNonces-based idempotency: the ONLY authoritative source of truth
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unused_nonce_proceeds_to_broadcast():
    r = CctpGenericRelayer()
    web3 = MagicMock()
    web3.eth.call.return_value = (0).to_bytes(32, "big")  # usedNonces -> 0 == unused
    web3.eth.estimate_gas.return_value = 100_000
    web3.eth.gas_price = 1_000_000_000
    web3.eth.get_balance.return_value = 10**18  # plenty
    web3.eth.get_transaction_count.return_value = 5
    web3.eth.account.from_key.return_value = SimpleNamespace(
        address="0xrelayer",
        sign_transaction=MagicMock(return_value=SimpleNamespace(raw_transaction=b"\x01\x02")),
    )
    fake_hash = SimpleNamespace(hex=lambda: "0xminted")
    web3.eth.send_raw_transaction.return_value = fake_hash
    web3.eth.wait_for_transaction_receipt.return_value = {"status": 1}
    web3.from_wei = lambda wei, unit: wei / 1e18

    with patch(
        "bot.services.cctp_generic_relayer.get_chain_by_name",
        MagicMock(return_value=SimpleNamespace(chain_id=8453, native_token="ETH")),
    ):
        result = await r._submit_receive(
            web3,
            dict(DEP),
            {"to": "0x2222222222222222222222222222222222222222", "data": "0x", "value": 0},
            _message_bytes(),
        )
    assert result == "0xminted"
    web3.eth.send_raw_transaction.assert_called_once()


@pytest.mark.asyncio
async def test_consumed_nonce_marks_minted_without_broadcasting():
    """The authoritative usedNonces check, not a revert string, is what may
    turn this into a no-broadcast success."""
    r = CctpGenericRelayer()
    web3 = MagicMock()
    web3.eth.call.return_value = (1).to_bytes(32, "big")  # usedNonces -> non-zero == consumed
    web3.eth.account.from_key.return_value = SimpleNamespace(address="0xrelayer")

    with patch(
        "bot.services.cctp_generic_relayer.get_chain_by_name",
        MagicMock(return_value=SimpleNamespace(chain_id=8453, native_token="ETH")),
    ):
        result = await r._submit_receive(
            web3,
            dict(DEP),
            {"to": "0x2222222222222222222222222222222222222222", "data": "0x", "value": 0},
            _message_bytes(),
        )
    assert result == "already-relayed-verified-onchain"
    web3.eth.send_raw_transaction.assert_not_called()
    web3.eth.estimate_gas.assert_not_called()  # never reached -- usedNonces short-circuits first


@pytest.mark.asyncio
async def test_eoa_nonce_style_broadcast_error_does_not_mark_minted():
    """C1 regression guard: an ordinary EOA transaction-nonce collision on
    broadcast (phrased by some RPC providers as literally "nonce already
    used") must NOT be misread as an already-relayed CCTP message. The only
    thing that may confirm success is usedNonces returning non-zero -- and
    here it stays 0 (unused), so this must raise, not return success."""
    r = CctpGenericRelayer()
    web3 = MagicMock()
    # usedNonces always returns 0 (unused) -- the CCTP message genuinely has
    # NOT been relayed, even though the broadcast raises a nonce-flavoured error.
    web3.eth.call.return_value = (0).to_bytes(32, "big")
    web3.eth.estimate_gas.return_value = 100_000
    web3.eth.gas_price = 1_000_000_000
    web3.eth.get_balance.return_value = 10**18
    web3.eth.get_transaction_count.return_value = 5
    web3.eth.account.from_key.return_value = SimpleNamespace(
        address="0xrelayer",
        sign_transaction=MagicMock(return_value=SimpleNamespace(raw_transaction=b"\x01\x02")),
    )
    web3.eth.send_raw_transaction.side_effect = Exception(
        "replacement transaction underpriced: nonce already used"
    )
    web3.from_wei = lambda wei, unit: wei / 1e18

    with patch(
        "bot.services.cctp_generic_relayer.get_chain_by_name",
        MagicMock(return_value=SimpleNamespace(chain_id=8453, native_token="ETH")),
    ):
        with pytest.raises(CctpGenericRelayerError):
            await r._submit_receive(
                web3,
                dict(DEP),
                {"to": "0x2222222222222222222222222222222222222222", "data": "0x", "value": 0},
                _message_bytes(),
            )


@pytest.mark.asyncio
async def test_broadcast_error_but_nonce_actually_consumed_is_verified_success():
    """A client-side broadcast exception (timeout, connection drop) where the
    message DID land -- usedNonces must be the tiebreaker, and here it
    confirms success."""
    r = CctpGenericRelayer()
    web3 = MagicMock()
    calls = [
        (0).to_bytes(32, "big"),  # pre-broadcast check: unused
        (1).to_bytes(32, "big"),  # post-exception recheck: consumed
    ]
    web3.eth.call.side_effect = lambda *a, **kw: calls.pop(0)
    web3.eth.estimate_gas.return_value = 100_000
    web3.eth.gas_price = 1_000_000_000
    web3.eth.get_balance.return_value = 10**18
    web3.eth.get_transaction_count.return_value = 5
    web3.eth.account.from_key.return_value = SimpleNamespace(
        address="0xrelayer",
        sign_transaction=MagicMock(return_value=SimpleNamespace(raw_transaction=b"\x01\x02")),
    )
    web3.eth.send_raw_transaction.side_effect = Exception("read timeout")
    web3.from_wei = lambda wei, unit: wei / 1e18

    with patch(
        "bot.services.cctp_generic_relayer.get_chain_by_name",
        MagicMock(return_value=SimpleNamespace(chain_id=8453, native_token="ETH")),
    ):
        result = await r._submit_receive(
            web3,
            dict(DEP),
            {"to": "0x2222222222222222222222222222222222222222", "data": "0x", "value": 0},
            _message_bytes(),
        )
    assert result == "already-relayed-verified-onchain"


@pytest.mark.asyncio
async def test_genuine_estimate_gas_revert_is_not_swallowed():
    r = CctpGenericRelayer()
    web3 = MagicMock()
    web3.eth.call.return_value = (0).to_bytes(32, "big")  # unused
    web3.eth.estimate_gas.side_effect = Exception("execution reverted: invalid attestation")
    web3.eth.account.from_key.return_value = SimpleNamespace(address="0xrelayer")

    with patch(
        "bot.services.cctp_generic_relayer.get_chain_by_name",
        MagicMock(return_value=SimpleNamespace(chain_id=8453, native_token="ETH")),
    ):
        with pytest.raises(CctpGenericRelayerError):
            await r._submit_receive(
                web3,
                dict(DEP),
                {"to": "0x2222222222222222222222222222222222222222", "data": "0x", "value": 0},
                _message_bytes(),
            )


# --------------------------------------------------------------------------
# Restart does not double-mint: a "minted" deposit is no longer in _pending(),
# and re-running _advance on an already-terminal dict is a strict no-op.
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_advance_is_noop_for_already_minted_deposit():
    r = _relayer()
    dep = dict(DEP, status="minted")
    with patch(
        "bot.services.cctp_generic_relayer.cctp_api.get_attestation_v2", AsyncMock()
    ) as get_att:
        await r._advance(dep)
    get_att.assert_not_awaited()
    r._set_status.assert_not_called()


# --------------------------------------------------------------------------
# Terminal failure (permanent errors): bounded retries, then "failed" + admin alert
# --------------------------------------------------------------------------


def test_bump_error_marks_failed_and_alerts_after_max_attempts():
    r = CctpGenericRelayer()
    r._schedule_alert = MagicMock()

    class FakeRow:
        attempts = 7  # one below MAX_ATTEMPTS (8)
        last_error = None
        status = "burned"

    row = FakeRow()

    class FakeQuery:
        def filter_by(self, **kw):
            return self

        def first(self):
            return row

    class FakeSession:
        def query(self, model):
            return FakeQuery()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    with patch(
        "bot.services.cctp_generic_relayer.get_session", MagicMock(return_value=FakeSession())
    ):
        r._bump_error(1, "receiveMessage reverted")

    assert row.status == "failed"
    assert row.attempts == 8
    r._schedule_alert.assert_called_once()
    assert "FAILED" in r._schedule_alert.call_args.args[0]


def test_bump_error_does_not_alert_before_max_attempts():
    r = CctpGenericRelayer()
    r._schedule_alert = MagicMock()

    class FakeRow:
        attempts = 1
        last_error = None
        status = "burned"

    row = FakeRow()

    class FakeQuery:
        def filter_by(self, **kw):
            return self

        def first(self):
            return row

    class FakeSession:
        def query(self, model):
            return FakeQuery()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    with patch(
        "bot.services.cctp_generic_relayer.get_session", MagicMock(return_value=FakeSession())
    ):
        r._bump_error(1, "transient rpc error")

    assert row.status == "burned"  # not failed yet
    r._schedule_alert.assert_not_called()


# --------------------------------------------------------------------------
# Telegram-id resolution (H3): dep["user_id"] is the DB users.id, never a
# Telegram chat id directly.
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_notify_resolves_telegram_id_not_db_user_id():
    r = CctpGenericRelayer()
    r._bot = AsyncMock()

    with patch(
        "bot.services.cctp_generic_relayer.CctpGenericRelayer._resolve_telegram_id",
        MagicMock(return_value=999888777),
    ):
        await r._notify(dict(DEP), "0xmint")

    r._bot.send_message.assert_awaited_once()
    kwargs = r._bot.send_message.call_args.kwargs
    assert kwargs["chat_id"] == 999888777
    assert kwargs["chat_id"] != DEP["user_id"]  # must NOT be the raw DB id
    assert "0xmint" in kwargs["text"]


@pytest.mark.asyncio
async def test_notify_noop_when_telegram_id_unresolvable():
    r = CctpGenericRelayer()
    r._bot = AsyncMock()

    with patch(
        "bot.services.cctp_generic_relayer.CctpGenericRelayer._resolve_telegram_id",
        MagicMock(return_value=None),
    ):
        await r._notify(dict(DEP), "0xmint")

    r._bot.send_message.assert_not_awaited()


# --------------------------------------------------------------------------
# Claim/lease (H2): a second worker must not see an already-claimed row.
# --------------------------------------------------------------------------


def test_pending_claims_rows_and_second_worker_sees_none_within_lease():
    r = CctpGenericRelayer()

    class FakeRow:
        id = 1
        user_id = 42
        recipient_address = "0xabc"
        from_chain = "arbitrum"
        to_chain = "base"
        burn_tx_hash = "0xburn"
        amount_raw = 100_000_000
        version = 2
        status = "burned"
        attempts = 0
        stall_count = 0
        claimed_at = None
        claimed_by = None
        updated_at = None

    row = FakeRow()

    class FakeQuery:
        def filter(self, *a, **kw):
            return self

        def with_for_update(self, **kw):
            return self

        def all(self):
            # First call returns the unclaimed row; once claimed_at is set,
            # a real DB's SKIP LOCKED / claimed_at filter would exclude it --
            # emulate that here by checking the row's own state.
            return [] if row.claimed_at is not None else [row]

    class FakeSession:
        def query(self, model):
            return FakeQuery()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    with patch(
        "bot.services.cctp_generic_relayer.get_session", MagicMock(return_value=FakeSession())
    ):
        first_pass = r._pending()
        assert len(first_pass) == 1
        assert row.claimed_at is not None
        assert row.claimed_by == r._worker_id()

        second_pass = r._pending()  # a second worker (or the same one, next tick)
        assert second_pass == []
