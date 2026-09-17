"""Regression coverage for the cross-stack managed-agent wallet identity."""

import asyncio
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager, closing, contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Query

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


def test_provision_and_execution_reject_the_evm_zero_address(client):
    zero_address = "0x" + "0" * 40

    provision = _post(
        client,
        "/internal/agent/provision-wallet",
        _provision_payload(address=zero_address),
    )
    assert provision.status_code == 422

    request = internal.AgentSwapRequest(
        agent_id=42,
        agent_uuid=AGENT_UUID,
        wallet_address=zero_address,
        internal_user_id=1,
        internal_wallet_id=2,
        chain_type="evm",
        quote_data={},
    )
    with pytest.raises(HTTPException) as exc_info:
        internal._require_agent_execution_wallet(request)
    assert exc_info.value.status_code == 422

    with get_session() as session:
        assert session.query(Wallet).count() == 0


@pytest.mark.parametrize("existing_user", [False, True])
def test_concurrent_provision_is_idempotent(client, existing_user):
    if existing_user:
        agent_int_id, agent_username = internal._managed_agent_user_identity(UUID(AGENT_UUID))
        with get_session() as session:
            session.add(User(telegram_id=agent_int_id, username=agent_username))

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


def test_sqlite_provision_reserves_writer_before_identity_reads(client, monkeypatch):
    with get_session() as session:
        engine = session.bind

    reads = []
    reservation_checked = []
    original_wallet_lock = internal._lock_managed_wallet_identity

    def record_reads(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            reads.append(statement)

    def check_writer_reservation(session, request, address):
        assert not reads, "Identity reads must follow the SQLite writer reservation"
        with closing(sqlite3.connect(engine.url.database, timeout=0)) as contender:
            with pytest.raises(sqlite3.OperationalError, match="database is locked") as exc_info:
                contender.execute("BEGIN IMMEDIATE")
            assert exc_info.value.sqlite_errorcode == sqlite3.SQLITE_BUSY
        reservation_checked.append(True)
        return original_wallet_lock(session, request, address)

    monkeypatch.setattr(internal, "_lock_managed_wallet_identity", check_writer_reservation)
    event.listen(engine, "before_cursor_execute", record_reads)
    try:
        response = _post(client, "/internal/agent/provision-wallet", _provision_payload())
    finally:
        event.remove(engine, "before_cursor_execute", record_reads)

    assert response.status_code == 200
    assert reservation_checked == [True]
    assert reads


def test_sqlite_provision_contention_is_bounded_and_recovers(client, tmp_db, monkeypatch):
    attempts = []
    retry_delays = []
    original_agent_lock = internal._lock_managed_agent_identity

    def fail_fast_on_contention(session, agent_int_id):
        session.connection().exec_driver_sql("PRAGMA busy_timeout=0")
        attempts.append(agent_int_id)
        return original_agent_lock(session, agent_int_id)

    async def record_retry(delay):
        retry_delays.append(delay)

    monkeypatch.setattr(internal, "_lock_managed_agent_identity", fail_fast_on_contention)
    monkeypatch.setattr(internal, "asyncio", SimpleNamespace(sleep=record_retry))

    with closing(sqlite3.connect(tmp_db.removeprefix("sqlite:///"), timeout=0)) as blocker:
        blocker.execute("BEGIN IMMEDIATE")
        response = _post(client, "/internal/agent/provision-wallet", _provision_payload())
        blocker.rollback()

    assert response.status_code == 503
    assert response.json()["detail"] == "Agent wallet provisioning busy"
    assert len(attempts) == 4
    assert retry_delays == pytest.approx([0.05, 0.10, 0.15])
    with get_session() as session:
        assert session.query(User).count() == 0
        assert session.query(Wallet).count() == 0

    retried = _post(client, "/internal/agent/provision-wallet", _provision_payload())

    assert retried.status_code == 200
    assert len(attempts) == 5
    with get_session() as session:
        assert session.query(User).count() == 1
        assert session.query(Wallet).count() == 1


def test_sqlite_provision_rolls_back_partial_write_before_retry(client, tmp_db, monkeypatch):
    attempts = []
    retry_delays = []
    original_wallet_lock = internal._lock_managed_wallet_identity

    def contend_after_partial_write(session, request, address):
        attempts.append(session)
        if len(attempts) == 1:
            session.add(User(telegram_id=12345, username="rolled-back-probe"))
            session.flush()
            raise OperationalError("write", {}, sqlite3.OperationalError("database is locked"))
        return original_wallet_lock(session, request, address)

    async def check_rollback_before_retry(delay):
        retry_delays.append(delay)
        with closing(sqlite3.connect(tmp_db.removeprefix("sqlite:///"), timeout=0)) as contender:
            contender.execute("BEGIN IMMEDIATE")
            contender.rollback()
        with get_session() as session:
            assert session.query(User).count() == 0

    monkeypatch.setattr(internal, "_lock_managed_wallet_identity", contend_after_partial_write)
    monkeypatch.setattr(internal, "asyncio", SimpleNamespace(sleep=check_rollback_before_retry))

    response = _post(client, "/internal/agent/provision-wallet", _provision_payload())

    assert response.status_code == 200
    assert len(attempts) == 2
    assert attempts[0] is not attempts[1]
    assert retry_delays == [0.05]
    with get_session() as session:
        assert session.query(User).count() == 1
        assert session.query(Wallet).count() == 1
        assert session.query(User).filter(User.username == "rolled-back-probe").first() is None


def test_concurrent_agents_cannot_bind_the_same_provider_wallet(client):
    payloads = [
        _provision_payload(),
        _provision_payload(agent_uuid=OTHER_AGENT_UUID),
    ]

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(
            executor.map(
                lambda payload: _post(
                    client,
                    "/internal/agent/provision-wallet",
                    payload,
                ),
                payloads,
            )
        )

    assert sorted(response.status_code for response in responses) == [200, 409]
    with get_session() as session:
        assert session.query(User).count() == 1
        assert session.query(Wallet).count() == 1


def test_provision_uses_nonblocking_database_locks(client, monkeypatch):
    lock_options = []
    original_with_for_update = Query.with_for_update

    def capture_lock_options(query, *args, **options):
        lock_options.append(options)
        return original_with_for_update(query, *args, **options)

    monkeypatch.setattr(Query, "with_for_update", capture_lock_options)

    response = _post(client, "/internal/agent/provision-wallet", _provision_payload())

    assert response.status_code == 200
    assert lock_options == [{"nowait": True}, {"nowait": True}]


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


def test_provision_reports_busy_when_provider_identity_lock_is_unavailable():
    class Result:
        @staticmethod
        def scalar():
            return False

    calls = []

    def execute(_statement, parameters):
        calls.append(parameters["identity_key"])
        return Result()

    session = SimpleNamespace(
        bind=SimpleNamespace(dialect=SimpleNamespace(name="postgresql")),
        execute=execute,
    )
    request = internal.AgentProvisionRequest(**_provision_payload())

    with pytest.raises(HTTPException) as exc_info:
        internal._lock_managed_wallet_identity(session, request, ADDRESS)

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Managed wallet provider identity is busy"
    assert calls == ["turnkey:account:turnkey-account-a"]


def test_provision_locks_every_provider_identity_in_stable_order():
    class Result:
        @staticmethod
        def scalar():
            return True

    calls = []

    def execute(_statement, parameters):
        calls.append(parameters["identity_key"])
        return Result()

    session = SimpleNamespace(
        bind=SimpleNamespace(dialect=SimpleNamespace(name="postgresql")),
        execute=execute,
    )
    request = internal.AgentProvisionRequest(**_provision_payload())

    internal._lock_managed_wallet_identity(session, request, ADDRESS)

    assert calls == sorted(
        [
            "turnkey:account:turnkey-account-a",
            f"turnkey:evm:address:{ADDRESS.lower()}",
            "turnkey:sub-org:turnkey-sub-org-a",
            "turnkey:wallet:turnkey-wallet-a",
        ]
    )


def test_provision_database_work_does_not_block_the_event_loop(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "internal-test-key")
    database_started = threading.Event()
    allow_database_to_finish = threading.Event()
    events = []

    @contextmanager
    def slow_session():
        events.append("database-started")
        database_started.set()
        allow_database_to_finish.wait(timeout=0.2)
        events.append("database-finished")
        raise HTTPException(status_code=418, detail="test complete")
        yield  # pragma: no cover

    request = internal.AgentProvisionRequest(**_provision_payload())

    async def heartbeat():
        while not database_started.is_set():
            await asyncio.sleep(0)
        events.append("event-loop-responsive")
        allow_database_to_finish.set()

    async def exercise():
        with patch.object(internal, "get_session", new=slow_session):
            results = await asyncio.gather(
                internal.provision_agent_wallet(request, "internal-test-key"),
                heartbeat(),
                return_exceptions=True,
            )
        return results

    results = asyncio.run(exercise())

    assert isinstance(results[0], HTTPException)
    assert events.index("event-loop-responsive") < events.index("database-finished")


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


def test_provision_enriches_missing_turnkey_account_after_provider_recovery(client):
    partial_payload = _provision_payload()
    partial_payload.pop("turnkey_account_id")

    partial = _post(client, "/internal/agent/provision-wallet", partial_payload)
    recovered = _post(client, "/internal/agent/provision-wallet", _provision_payload())

    assert partial.status_code == 200
    assert recovered.status_code == 200
    assert recovered.json() == partial.json()
    with get_session() as session:
        wallet = session.query(Wallet).one()
        assert wallet.turnkey_wallet_id == "turnkey-wallet-a"
        assert wallet.turnkey_account_id == "turnkey-account-a"


def test_provision_never_overwrites_an_existing_turnkey_account(client):
    first = _post(client, "/internal/agent/provision-wallet", _provision_payload())
    conflicting = _post(
        client,
        "/internal/agent/provision-wallet",
        _provision_payload(turnkey_account_id="turnkey-account-b"),
    )

    assert first.status_code == 200
    assert conflicting.status_code == 409
    with get_session() as session:
        assert session.query(Wallet).one().turnkey_account_id == "turnkey-account-a"


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
        internal._require_agent_execution_wallet(request)

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Managed wallet execution is already in progress"


def test_execute_identity_guard_uses_fk_compatible_row_locks():
    lock_options = []
    expected_telegram_id, expected_username = internal._managed_agent_user_identity(
        UUID(AGENT_UUID)
    )
    rows = {
        User: SimpleNamespace(
            id=1,
            telegram_id=expected_telegram_id,
            username=expected_username,
        ),
        Wallet: SimpleNamespace(
            id=2,
            user_id=1,
            address=ADDRESS,
            wallet_provider="turnkey",
            is_active=True,
            chain_type="evm",
        ),
    }

    class Query:
        def __init__(self, row):
            self.row = row

        def filter(self, *_args):
            return self

        def with_for_update(self, **options):
            lock_options.append(options)
            return self

        def first(self):
            return self.row

    class Session:
        def query(self, model):
            return Query(rows[model])

    @contextmanager
    def fake_session():
        yield Session()

    request = internal.AgentSwapRequest(
        agent_id=42,
        agent_uuid=AGENT_UUID,
        wallet_address=ADDRESS,
        internal_user_id=1,
        internal_wallet_id=2,
        chain_type="evm",
        quote_data={},
    )

    with patch.object(internal, "get_session", new=fake_session):
        internal._require_agent_execution_wallet(request)

    # FOR NO KEY UPDATE NOWAIT blocks identity changes while remaining compatible
    # with the foreign-key key-share lock taken by SwapTransaction inserts.
    assert lock_options == [
        {"nowait": True, "key_share": True},
        {"nowait": True, "key_share": True},
    ]


def test_engine_rejects_unproven_already_locked_bypass():
    from bot.services.swap_engine import SwapEngine

    wallet_id = 987654
    engine = object.__new__(SwapEngine)
    engine._wallet_locks = {}
    engine._wallet_lock_users = {}
    engine._wallet_lock_owners = {}
    engine._wallet_locks_max = 1000

    async def exercise():
        with pytest.raises(RuntimeError, match="was not acquired"):
            async with engine.wallet_execution_context(wallet_id, already_locked=True):
                pass

        async with engine.wallet_execution_context(wallet_id):
            async with engine.wallet_execution_context(wallet_id, already_locked=True):
                pass

    asyncio.run(exercise())


def test_swap_engine_instances_share_process_execution_lock_state():
    from bot.services.swap_engine import SwapEngine

    first = SwapEngine()
    second = SwapEngine()

    assert first._wallet_locks is second._wallet_locks
    assert first._wallet_lock_users is second._wallet_lock_users
    assert first._wallet_lock_owners is second._wallet_lock_owners


def test_engine_rejects_already_locked_bypass_from_another_task():
    from bot.services.swap_engine import SwapEngine

    engine = object.__new__(SwapEngine)
    engine._wallet_locks = {}
    engine._wallet_lock_users = {}
    engine._wallet_lock_owners = {}
    engine._wallet_locks_max = 1000

    async def exercise():
        acquired = asyncio.Event()
        release = asyncio.Event()

        async def owner():
            async with engine.wallet_execution_context(123):
                acquired.set()
                await release.wait()

        task = asyncio.create_task(owner())
        await acquired.wait()
        try:
            with pytest.raises(RuntimeError, match="was not acquired"):
                async with engine.wallet_execution_context(123, already_locked=True):
                    pass
        finally:
            release.set()
            await task

    asyncio.run(exercise())


def test_engine_does_not_evict_a_wallet_lock_with_queued_waiters():
    from bot.services.swap_engine import SwapEngine

    engine = object.__new__(SwapEngine)
    engine._wallet_locks = {}
    engine._wallet_lock_users = {}
    engine._wallet_lock_owners = {}
    engine._wallet_locks_max = 2

    async def exercise():
        owner_acquired = asyncio.Event()
        release_owner = asyncio.Event()
        waiter_acquired = asyncio.Event()
        release_waiter = asyncio.Event()

        async def owner():
            async with engine.wallet_execution_context(1):
                owner_acquired.set()
                await release_owner.wait()
            # Lock.release() wakes the queued waiter, but it has not resumed yet.
            # Filling the cache in this window must not replace its lock object.
            engine.wallet_execution_lock(3)

        async def waiter():
            async with engine.wallet_execution_context(1):
                waiter_acquired.set()
                await release_waiter.wait()

        owner_task = asyncio.create_task(owner())
        await owner_acquired.wait()
        original_lock = engine.wallet_execution_lock(1)
        engine.wallet_execution_lock(2)
        waiter_task = asyncio.create_task(waiter())
        await asyncio.sleep(0)

        release_owner.set()
        await owner_task
        assert engine.wallet_execution_lock(1) is original_lock

        await waiter_acquired.wait()
        release_waiter.set()
        await waiter_task

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

    import bot.services.swap_engine as swap_engine_module
    from bot.services.swap_engine import SwapEngine

    engine = object.__new__(SwapEngine)
    engine._wallet_locks = {}
    engine._wallet_lock_users = {}
    engine._wallet_lock_owners = {}
    engine._wallet_locks_max = 1000
    events = []
    event_loop_thread_id = threading.get_ident()

    def guarded(_request):
        assert threading.get_ident() != event_loop_thread_id
        assert engine.wallet_execution_lock(provisioned["internal_wallet_id"]).locked()
        events.append("db-validate")

    async def execute_swap(**kwargs):
        assert kwargs["_wallet_lock_held"] is True
        events.append("engine-start")
        await asyncio.sleep(0.02)
        events.append("engine-end")
        return SimpleNamespace(id=len(events), tx_hash="0xabc", status="pending")

    async def run_concurrently():
        with (
            patch.object(swap_engine_module, "swap_engine", new=engine),
            patch.object(internal, "_require_agent_execution_wallet", new=guarded),
            patch.object(engine, "execute_swap", new=execute_swap),
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
        "db-validate",
        "engine-start",
        "engine-end",
        "db-validate",
        "engine-start",
        "engine-end",
    ]
