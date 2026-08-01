"""POST /webapp/bridge/build, /record and GET /bridge/transfers/{id}.

The ordering guarantee is the point of these tests: the transfer row must exist
*before* the build response comes back, so a broadcast always has something to
be recorded against. A signed bridge transaction with no row is invisible
forever — funds leave the source chain and nothing knows to chase the far side.
The inverse (a row whose transaction is never signed) is harmless.
"""

import asyncio
import os

import pytest
from fastapi import HTTPException

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from api.webapp import (  # noqa: E402
    WebAppBridgeBuildRequest,
    WebAppBridgeRecordRequest,
    build_terminal_bridge_transfer,
    get_terminal_bridge_transfer,
    record_terminal_bridge_transfer,
)
from bot.services.bridge.base import BridgeQuote  # noqa: E402

AUTH = {"user_id": 7}
SENDER = "0x1111111111111111111111111111111111111111"


@pytest.fixture()
def session(tmp_db):
    from database.db import SessionLocal

    db = SessionLocal()
    yield db
    db.close()


def _quote(provider="cctp", settlement="tx", deposit_address=None, with_approval=False):
    tx = {"to": "0x2222222222222222222222222222222222222222", "data": "0xabcd", "value": 0}
    if with_approval:
        tx["approval_tx"] = {
            "to": "0x3333333333333333333333333333333333333333",
            "data": "0x095ea7b3",
            "value": 0,
        }
    return BridgeQuote(
        provider=provider,
        from_chain="arbitrum",
        to_chain="base",
        from_token="USDC",
        to_token="USDC",
        from_amount="1000000",
        to_amount="1000000",
        to_amount_min="1000000",
        gas_cost_usd=0.4,
        fee_cost_usd=0.1,
        estimated_time=20,
        transaction_request={} if settlement == "deposit_address" else tx,
        settlement=settlement,
        trust_model="liquidity",
        deposit_address=deposit_address,
    )


def _patch_quotes(monkeypatch, quotes):
    async def _fake(**kwargs):
        return quotes

    monkeypatch.setattr("bot.services.bridge.registry.get_bridge_quotes", _fake)


def _build(session, monkeypatch, quotes, **overrides):
    _patch_quotes(monkeypatch, quotes)
    body = WebAppBridgeBuildRequest(
        provider=overrides.pop("provider", "cctp"),
        fromChain=overrides.pop("fromChain", "arbitrum"),
        toChain=overrides.pop("toChain", "base"),
        token="USDC",
        amount="1000000",
        fromAddress=overrides.pop("fromAddress", SENDER),
        **overrides,
    )
    auth = overrides.pop("auth", AUTH)
    return asyncio.run(build_terminal_bridge_transfer(body, auth_payload=auth, db=session))


# --- schema ---------------------------------------------------------------


def test_init_db_creates_the_bridge_transfers_table(tmp_db):
    """The build call writes before the user signs, so a missing table must not
    be discovered mid-flow."""
    from sqlalchemy import inspect

    from database.db import engine

    assert inspect(engine).has_table("bridge_transfers")


# --- build ----------------------------------------------------------------


def test_build_requires_auth(session, monkeypatch):
    _patch_quotes(monkeypatch, [_quote()])
    body = WebAppBridgeBuildRequest(
        provider="cctp",
        fromChain="arbitrum",
        toChain="base",
        token="USDC",
        amount="1000000",
        fromAddress=SENDER,
    )
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(build_terminal_bridge_transfer(body, auth_payload=None, db=session))
    assert excinfo.value.status_code == 401


def test_build_rejects_same_chain(session, monkeypatch):
    with pytest.raises(HTTPException) as excinfo:
        _build(session, monkeypatch, [_quote()], fromChain="base", toChain="base")
    assert excinfo.value.status_code == 400


def test_build_records_the_transfer_before_returning(session, monkeypatch):
    """The whole ordering guarantee, asserted against the DB."""
    from bot.models.bridge import BridgeTransfer

    result = _build(session, monkeypatch, [_quote()])

    row = session.query(BridgeTransfer).filter(BridgeTransfer.id == result.transferId).first()
    assert row is not None, "no row existed when the client received signable calldata"
    assert row.state == "pending_broadcast"
    assert row.source_tx_hash is None
    assert row.user_id == AUTH["user_id"]
    # Trust/settlement are persisted so a reload describes the transfer the same
    # way without re-quoting.
    assert row.settlement == "tx"
    assert row.trust_model == "liquidity"


def test_build_returns_approval_when_the_rail_needs_one(session, monkeypatch):
    result = _build(session, monkeypatch, [_quote(with_approval=True)])
    assert result.approval is not None
    assert result.tx is not None
    assert result.chainId == 42161


def test_build_omits_approval_when_the_rail_does_not(session, monkeypatch):
    result = _build(session, monkeypatch, [_quote(with_approval=False)])
    assert result.approval is None


def test_deposit_address_rail_needs_no_signature(session, monkeypatch):
    from bot.models.bridge import BridgeTransfer

    result = _build(
        session,
        monkeypatch,
        [
            _quote(
                provider="near_intents",
                settlement="deposit_address",
                deposit_address="0x4444444444444444444444444444444444444444",
            )
        ],
        provider="near_intents",
    )

    assert result.tx is None
    assert result.chainId is None
    assert result.depositAddress
    row = session.query(BridgeTransfer).filter(BridgeTransfer.id == result.transferId).first()
    assert row.state == "awaiting_deposit"


def test_build_refuses_a_deposit_rail_with_no_address(session, monkeypatch):
    """Telling the user to send funds nowhere would lose them."""
    with pytest.raises(HTTPException) as excinfo:
        _build(
            session,
            monkeypatch,
            [_quote(provider="near_intents", settlement="deposit_address")],
            provider="near_intents",
        )
    assert excinfo.value.status_code == 502


def test_build_rejects_a_malformed_sender(session, monkeypatch):
    with pytest.raises(HTTPException) as excinfo:
        _build(session, monkeypatch, [_quote()], fromAddress="not-an-address")
    assert excinfo.value.status_code == 400


def test_build_rejects_a_recipient_in_the_wrong_chain_format(session, monkeypatch):
    """The recipient is sealed into the transfer, so a wrong-format address
    would send funds somewhere nobody controls. Bridging to a non-EVM chain with
    an EVM address must fail loudly, not quietly succeed."""
    _patch_quotes(monkeypatch, [_quote()])
    body = WebAppBridgeBuildRequest(
        provider="cctp",
        fromChain="arbitrum",
        toChain="solana",
        token="USDC",
        amount="1000000",
        fromAddress=SENDER,
        toAddress=SENDER,  # an EVM address on a Solana destination
    )
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(build_terminal_bridge_transfer(body, auth_payload=AUTH, db=session))
    assert excinfo.value.status_code == 400


def test_build_409s_when_the_chosen_route_vanished(session, monkeypatch):
    """Never silently substitute another provider: the route was chosen for its
    trust model, not only its price."""
    with pytest.raises(HTTPException) as excinfo:
        _build(session, monkeypatch, [_quote(provider="usdt0")], provider="cctp")
    assert excinfo.value.status_code == 409


# --- record ---------------------------------------------------------------


def test_record_attaches_the_hash_and_advances(session, monkeypatch):
    built = _build(session, monkeypatch, [_quote()])
    body = WebAppBridgeRecordRequest(transferId=built.transferId, txHash="0xdead")

    result = asyncio.run(record_terminal_bridge_transfer(body, auth_payload=AUTH, db=session))

    assert result.sourceTxHash == "0xdead"
    assert result.state == "source_pending"


def test_record_is_idempotent(session, monkeypatch):
    """A retry must not reset progress the relayer already made."""
    built = _build(session, monkeypatch, [_quote()])
    body = WebAppBridgeRecordRequest(transferId=built.transferId, txHash="0xdead")
    asyncio.run(record_terminal_bridge_transfer(body, auth_payload=AUTH, db=session))

    again = WebAppBridgeRecordRequest(transferId=built.transferId, txHash="0xbeef")
    result = asyncio.run(record_terminal_bridge_transfer(again, auth_payload=AUTH, db=session))

    assert result.sourceTxHash == "0xdead", "a second record call overwrote the first hash"


def test_record_will_not_touch_another_users_transfer(session, monkeypatch):
    built = _build(session, monkeypatch, [_quote()])
    body = WebAppBridgeRecordRequest(transferId=built.transferId, txHash="0xdead")

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            record_terminal_bridge_transfer(body, auth_payload={"user_id": 999}, db=session)
        )
    assert excinfo.value.status_code == 404


# --- status ---------------------------------------------------------------


def test_status_reports_the_transfer(session, monkeypatch):
    built = _build(session, monkeypatch, [_quote()])
    result = asyncio.run(
        get_terminal_bridge_transfer(built.transferId, auth_payload=AUTH, db=session)
    )

    assert result.id == str(built.transferId)
    assert result.state == "pending_broadcast"
    # USDC is 6dp: 1_000_000 base units is 1.0.
    assert result.amountHuman == pytest.approx(1.0)
    assert result.estimatedTime == 20


def test_status_404s_for_an_unknown_transfer(session):
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(get_terminal_bridge_transfer(424242, auth_payload=AUTH, db=session))
    assert excinfo.value.status_code == 404


def test_cctp_state_is_derived_from_the_relayer_row(session, monkeypatch):
    """The relayer owns relay progress; this endpoint reads through to it rather
    than keeping a second copy that can disagree about whether funds landed."""
    from bot.models.cctp import CctpGenericDeposit

    built = _build(session, monkeypatch, [_quote()])
    asyncio.run(
        record_terminal_bridge_transfer(
            WebAppBridgeRecordRequest(transferId=built.transferId, txHash="0xburn"),
            auth_payload=AUTH,
            db=session,
        )
    )

    session.add(
        CctpGenericDeposit(
            user_id=AUTH["user_id"],
            recipient_address=SENDER,
            from_chain="arbitrum",
            to_chain="base",
            burn_tx_hash="0xburn",
            amount_raw=1_000_000,
            status="minted",
        )
    )
    session.commit()

    result = asyncio.run(
        get_terminal_bridge_transfer(built.transferId, auth_payload=AUTH, db=session)
    )
    assert result.state == "complete", "relayer said minted but the UI would still say pending"


def test_cctp_stall_is_distinct_from_failure(session, monkeypatch):
    """ "Not moving but safe" and "needs a human" must not read the same."""
    from bot.models.cctp import CctpGenericDeposit

    built = _build(session, monkeypatch, [_quote()])
    asyncio.run(
        record_terminal_bridge_transfer(
            WebAppBridgeRecordRequest(transferId=built.transferId, txHash="0xstall"),
            auth_payload=AUTH,
            db=session,
        )
    )

    session.add(
        CctpGenericDeposit(
            user_id=AUTH["user_id"],
            recipient_address=SENDER,
            from_chain="arbitrum",
            to_chain="base",
            burn_tx_hash="0xstall",
            amount_raw=1_000_000,
            status="burned",
            stall_count=3,
        )
    )
    session.commit()

    result = asyncio.run(
        get_terminal_bridge_transfer(built.transferId, auth_payload=AUTH, db=session)
    )
    assert result.state == "stalled"
    assert result.statusDetail and "safe" in result.statusDetail.lower()
