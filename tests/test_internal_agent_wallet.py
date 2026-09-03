"""Regression coverage for the cross-stack managed-agent wallet identity."""

import inspect
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager, contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from api.routes import internal
from bot.models.user import User, Wallet
from database.db import get_session

AGENT_UUID = "11111111-1111-4111-8111-111111111111"
OTHER_AGENT_UUID = "22222222-2222-4222-8222-222222222222"
ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"


@pytest.fixture()
def client(tmp_db, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "internal-test-key")
    app = FastAPI()
    app.include_router(internal.router)
    return TestClient(app)


def _provision_payload(**overrides):
    payload = {
        "agent_uuid": AGENT_UUID,
        "chain_type": "evm",
        "turnkey_wallet_id": "turnkey-wallet-a",
        "turnkey_sub_org_id": "turnkey-sub-org-a",
        "turnkey_account_id": "turnkey-account-a",
        "address": ADDRESS,
    }
    payload.update(overrides)
    return payload


def _post(client, path, payload):
    return client.post(
        path,
        headers={"X-Internal-Key": "internal-test-key"},
        json=payload,
    )


def _stub_swap_engine(execute_swap):
    @asynccontextmanager
    async def wallet_execution_context(_wallet_id):
        yield

    return SimpleNamespace(
        execute_swap=execute_swap,
        wallet_execution_context=wallet_execution_context,
    )


def test_managed_agent_identity_is_stable_and_namespaced():
    identity = internal._managed_agent_user_identity(UUID(AGENT_UUID))

    assert identity == (
        -7198632561950795079,
        f"managed_agent:{AGENT_UUID}",
    )
    assert internal._managed_agent_user_identity(UUID(AGENT_UUID)) == identity
    assert identity[0] < 0  # never aliases a real positive Telegram ID


def test_provision_registers_turnkey_wallet_idempotently(client):
    first = _post(client, "/internal/agent/provision-wallet", _provision_payload())
    second = _post(client, "/internal/agent/provision-wallet", _provision_payload())

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json() == first.json()
    assert first.json()["address"] == ADDRESS

    with get_session() as session:
        users = session.query(User).all()
        wallets = session.query(Wallet).all()

    assert len(users) == 1
    assert len(wallets) == 1
    wallet = wallets[0]
    assert first.json()["internal_wallet_id"] == wallet.id
    assert first.json()["internal_user_id"] == wallet.user_id
    assert wallet.address == ADDRESS
    assert wallet.wallet_provider == "turnkey"
    assert wallet.encrypted_private_key is None
    assert wallet.turnkey_sub_org_id == "turnkey-sub-org-a"
    assert wallet.turnkey_wallet_id == "turnkey-wallet-a"
    assert wallet.turnkey_account_id == "turnkey-account-a"


def test_concurrent_provision_is_idempotent(client):
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(
            executor.map(
                lambda _: _post(client, "/internal/agent/provision-wallet", _provision_payload()),
                range(2),
            )
        )

    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    with get_session() as session:
        assert session.query(User).count() == 1
        assert session.query(Wallet).count() == 1


def test_provision_uses_nonblocking_database_locks_in_async_route():
    lock_source = inspect.getsource(internal._lock_managed_agent_identity)
    route_source = inspect.getsource(internal.provision_agent_wallet)

    assert "pg_try_advisory_xact_lock" in lock_source
    assert "SELECT pg_advisory_xact_lock" not in lock_source
    assert route_source.count(".with_for_update(nowait=True)") == 2


def test_provision_reports_busy_when_advisory_lock_is_unavailable():
    class Result:
        @staticmethod
        def scalar():
            return False

    session = SimpleNamespace(
        bind=SimpleNamespace(dialect=SimpleNamespace(name="postgresql")),
        execute=lambda *_args, **_kwargs: Result(),
    )

    with pytest.raises(HTTPException) as exc_info:
        internal._lock_managed_agent_identity(session, 42)

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Managed wallet provisioning is busy"


def test_provision_adopts_legacy_turnkey_identity_without_wallet_or_account_ids(client):
    payload = _provision_payload()
    payload.pop("turnkey_wallet_id")
    payload.pop("turnkey_account_id")

    response = _post(client, "/internal/agent/provision-wallet", payload)

    assert response.status_code == 200
    assert response.json()["address"] == ADDRESS
    with get_session() as session:
        wallet = session.query(Wallet).one()
        assert wallet.wallet_provider == "turnkey"
        assert wallet.turnkey_sub_org_id == "turnkey-sub-org-a"
        assert wallet.turnkey_wallet_id is None
        assert wallet.turnkey_account_id is None


def test_provision_never_reactivates_or_blesses_an_inactive_wallet(client):
    first = _post(client, "/internal/agent/provision-wallet", _provision_payload())
    assert first.status_code == 200

    with get_session() as session:
        wallet = session.query(Wallet).one()
        wallet.is_active = False

    retried = _post(client, "/internal/agent/provision-wallet", _provision_payload())

    assert retried.status_code == 409
    assert retried.json()["detail"] == "Managed wallet identity conflict"


def test_provision_rejects_distinct_active_turnkey_wallet_for_same_agent_chain(client):
    first = _post(client, "/internal/agent/provision-wallet", _provision_payload())
    assert first.status_code == 200

    response = _post(
        client,
        "/internal/agent/provision-wallet",
        _provision_payload(
            address="0x0000000000000000000000000000000000000001",
            turnkey_sub_org_id="turnkey-sub-org-b",
            turnkey_wallet_id="turnkey-wallet-b",
            turnkey_account_id="turnkey-account-b",
        ),
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Managed wallet identity conflict"
    with get_session() as session:
        assert session.query(Wallet).count() == 1


def test_provision_rejects_a_stable_identity_collision(client):
    target_id, _ = internal._managed_agent_user_identity(UUID(AGENT_UUID))
    with get_session() as session:
        session.add(
            User(
                telegram_id=target_id,
                username=f"managed_agent:{OTHER_AGENT_UUID}",
                first_name="Different Agent",
            )
        )

    response = _post(client, "/internal/agent/provision-wallet", _provision_payload())

    assert response.status_code == 409
    assert response.json()["detail"] == "Managed agent identity collision"
    with get_session() as session:
        assert session.query(Wallet).count() == 0


def test_execute_resolves_the_same_wallet_that_was_provisioned(client):
    provisioned = _post(client, "/internal/agent/provision-wallet", _provision_payload()).json()
    execute_swap = AsyncMock(return_value=SimpleNamespace(id=7, tx_hash="0xabc", status="pending"))

    with patch(
        "bot.services.swap_engine.swap_engine",
        new=_stub_swap_engine(execute_swap),
    ):
        response = _post(
            client,
            "/internal/agent/execute-swap",
            {
                "agent_id": 42,
                "agent_uuid": AGENT_UUID,
                # Deliberately lower-cased: EVM identity comparison is case-insensitive.
                "wallet_address": ADDRESS.lower(),
                "internal_user_id": provisioned["internal_user_id"],
                "internal_wallet_id": provisioned["internal_wallet_id"],
                "chain_type": "evm",
                "idempotency_key": "same-wallet-test",
                "quote_data": {
                    "provider": "lifi",
                    "from_chain": "base",
                    "to_chain": "base",
                    "from_token": "ETH",
                    "to_token": "USDC",
                    "from_amount": "1",
                },
            },
        )

    assert response.status_code == 200
    assert response.json()["swap_id"] == 7
    execute_swap.assert_awaited_once()
    call = execute_swap.await_args.kwargs
    assert call["wallet_id"] == provisioned["internal_wallet_id"]
    assert call["user_id"] == provisioned["internal_user_id"]
    assert call["_wallet_lock_held"] is True


def test_execute_rejects_legacy_split_wallet_before_swap(client):
    provisioned = _post(client, "/internal/agent/provision-wallet", _provision_payload()).json()
    with get_session() as session:
        split_wallet = Wallet(
            user_id=provisioned["internal_user_id"],
            name="legacy-split-wallet-b",
            address="0x0000000000000000000000000000000000000001",
            encrypted_private_key="encrypted-local-key",
            wallet_provider="local",
            chain_type="evm",
            is_active=True,
        )
        session.add(split_wallet)
        session.flush()
        split_wallet_id = split_wallet.id

    execute_swap = AsyncMock()
    with patch(
        "bot.services.swap_engine.swap_engine",
        new=_stub_swap_engine(execute_swap),
    ):
        response = _post(
            client,
            "/internal/agent/execute-swap",
            {
                "agent_id": 42,
                "agent_uuid": AGENT_UUID,
                "wallet_address": ADDRESS,
                "internal_user_id": provisioned["internal_user_id"],
                "internal_wallet_id": split_wallet_id,
                "chain_type": "evm",
                "quote_data": {},
            },
        )

    assert response.status_code == 403
    assert response.json()["detail"] == "Managed wallet identity mismatch"
    execute_swap.assert_not_awaited()


def test_execute_rejects_inactive_managed_wallet(client):
    provisioned = _post(client, "/internal/agent/provision-wallet", _provision_payload()).json()
    with get_session() as session:
        session.query(Wallet).filter(
            Wallet.id == provisioned["internal_wallet_id"]
        ).one().is_active = False

    execute_swap = AsyncMock()
    with patch(
        "bot.services.swap_engine.swap_engine",
        new=_stub_swap_engine(execute_swap),
    ):
        response = _post(
            client,
            "/internal/agent/execute-swap",
            {
                "agent_id": 42,
                "agent_uuid": AGENT_UUID,
                "wallet_address": ADDRESS,
                "internal_user_id": provisioned["internal_user_id"],
                "internal_wallet_id": provisioned["internal_wallet_id"],
                "chain_type": "evm",
                "quote_data": {},
            },
        )

    assert response.status_code == 403
    execute_swap.assert_not_awaited()


def test_execute_uses_nowait_identity_locks_inside_async_wallet_lock():
    guard_source = inspect.getsource(internal._require_agent_execution_wallet)
    route_source = inspect.getsource(internal.execute_agent_swap)

    assert guard_source.count(".with_for_update(nowait=True)") == 2
    assert "yield" in guard_source
    assert "async with swap_engine.wallet_execution_context" in route_source
    assert "with _require_agent_execution_wallet(request):" in route_source
    assert route_source.index(
        "async with swap_engine.wallet_execution_context"
    ) < route_source.index("with _require_agent_execution_wallet(request):")
    assert "_wallet_lock_held=True" in route_source


def test_execute_maps_nowait_row_contention_cleanly():
    class LockUnavailable(Exception):
        sqlstate = "55P03"

    @contextmanager
    def locked_session():
        raise OperationalError("SELECT FOR UPDATE NOWAIT", {}, LockUnavailable())
        yield  # pragma: no cover

    request = internal.AgentSwapRequest(
        agent_id=42,
        agent_uuid=AGENT_UUID,
        wallet_address=ADDRESS,
        internal_user_id=1,
        internal_wallet_id=2,
        quote_data={},
    )
    with (
        patch.object(internal, "get_session", new=locked_session),
        pytest.raises(HTTPException) as exc_info,
    ):
        with internal._require_agent_execution_wallet(request):
            pass

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Managed wallet execution is already in progress"


def test_engine_rejects_unproven_already_locked_bypass():
    from bot.services.swap_engine import swap_engine

    wallet_id = 987654
    swap_engine._wallet_locks.pop(wallet_id, None)

    async def exercise():
        with pytest.raises(RuntimeError, match="was not acquired"):
            async with swap_engine.wallet_execution_context(wallet_id, already_locked=True):
                pass

        async with swap_engine.wallet_execution_context(wallet_id):
            async with swap_engine.wallet_execution_context(wallet_id, already_locked=True):
                pass

    asyncio.run(exercise())


def test_concurrent_execute_orders_async_wallet_lock_before_db_guard(client):
    provisioned = _post(client, "/internal/agent/provision-wallet", _provision_payload()).json()
    request = internal.AgentSwapRequest(
        agent_id=42,
        agent_uuid=AGENT_UUID,
        wallet_address=ADDRESS,
        internal_user_id=provisioned["internal_user_id"],
        internal_wallet_id=provisioned["internal_wallet_id"],
        chain_type="evm",
        quote_data={
            "provider": "lifi",
            "from_chain": "base",
            "to_chain": "base",
            "from_token": "ETH",
            "to_token": "USDC",
            "from_amount": "1",
        },
    )

    from bot.services.swap_engine import swap_engine

    swap_engine._wallet_locks.pop(provisioned["internal_wallet_id"], None)
    events = []
    active_guards = 0

    @contextmanager
    def guarded(_request):
        nonlocal active_guards
        assert swap_engine.wallet_execution_lock(provisioned["internal_wallet_id"]).locked()
        active_guards += 1
        assert active_guards == 1
        events.append("db-enter")
        try:
            yield
        finally:
            events.append("db-exit")
            active_guards -= 1

    async def execute_swap(**kwargs):
        assert kwargs["_wallet_lock_held"] is True
        events.append("engine-start")
        await asyncio.sleep(0.02)
        events.append("engine-end")
        return SimpleNamespace(id=len(events), tx_hash="0xabc", status="pending")

    async def run_concurrently():
        with (
            patch.object(internal, "_require_agent_execution_wallet", new=guarded),
            patch.object(swap_engine, "execute_swap", new=execute_swap),
        ):
            return await asyncio.wait_for(
                asyncio.gather(
                    internal.execute_agent_swap(request, "internal-test-key"),
                    internal.execute_agent_swap(request, "internal-test-key"),
                ),
                timeout=1,
            )

    results = asyncio.run(run_concurrently())

    assert len(results) == 2
    assert events == [
        "db-enter",
        "engine-start",
        "engine-end",
        "db-exit",
        "db-enter",
        "engine-start",
        "engine-end",
        "db-exit",
    ]
