"""Real-Postgres fixtures for the agent-control-plane integration suite.

WHY THIS FILE EXISTS: the unit tests in ``tests/test_agent_approvals.py``,
``tests/test_admin_killswitch.py``, ``tests/test_approval_webhook_dispatch.py``
and ``tests/test_claim_agent.py`` all build SQLite shadow tables. That hid two
real production bugs that only manifest on Postgres:

  (a) ``agents.uuid`` is a native Postgres ``uuid`` column while
      ``approval_requests.agent_id`` (and other refs) are ``varchar``/text.
      A bare ``uuid = text`` join throws on Postgres
      (``operator does not exist: uuid = text``) but silently "works" on
      SQLite, where both sides are stored as TEXT. The fix
      (``CAST(a.uuid AS TEXT) = ap.agent_id`` in
      ``bot/services/approval_webhook.py`` /
      ``bot/services/webhook_dispatcher.py``) is exactly what this module
      regression-tests against a real join.
  (b) Postgres-only SQL -- ``now()``, ``IS NOT DISTINCT FROM``, and
      ``(:delay || ' seconds')::interval`` -- either errors or is silently
      unsupported on the sqlite test driver, which made whole test bodies
      skip cleanly (see ``test_admin_killswitch.py``'s
      ``_sqlite_supports_syntax`` guard) rather than actually exercise the
      code path.

These fixtures stand up a REAL scratch Postgres database (against the local
``supabase_db_static`` docker container), transcribe the drizzle (api-ts)
schemas for the tables Python reads/writes with their REAL Postgres column
types, then call the REAL ``database/db.py`` ``init_db()`` (which internally
runs ``_ensure_schema()``) against that same database so all the
Python-owned additive tables/columns (``agent_webhook_deliveries``,
``agents.owner_user_id``, ``agent_link_codes``, etc.) are created via the
actual migration path -- never hand-duplicated here.

If Postgres is unreachable (e.g. CI without docker), the whole module is
skipped cleanly via ``pytest.skip(..., allow_module_level=True)`` in the test
module itself -- see ``test_control_plane_pg.py``.
"""

import os
import uuid

import pytest
from sqlalchemy import create_engine, text

# Bot modules need these env vars set before import (mirrors tests/conftest.py's
# top-level setdefault pattern, but this file may be imported by pytest's
# collection before the top-level tests/conftest.py fixtures run, so set them
# unconditionally here too).
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "x")
os.environ.setdefault("ENCRYPTION_KEY", "x")
os.environ.setdefault("KMS_PROVIDER", "dev")
os.environ.setdefault("PYTHONPATH", ".")

PG_ADMIN_URL = "postgresql://postgres:postgres@localhost:54322/postgres?sslmode=disable"
PG_HOST_URL_TEMPLATE = "postgresql://postgres:postgres@localhost:54322/{db}?sslmode=disable"


def pg_reachable() -> bool:
    try:
        engine = create_engine(PG_ADMIN_URL, connect_args={"connect_timeout": 3})
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        engine.dispose()
        return True
    except Exception:
        return False


# Real Postgres DDL transcribed from the api-ts drizzle schemas (READ ONLY
# sources: api-ts/src/db/schema/{agents,users,organizations,approvals,
# policies,agentLinkCodes}.ts). Column types intentionally match exactly --
# in particular agents.uuid / approval_requests.id are native `uuid`, while
# approval_requests.agent_id / policies.agent_id / policy_kill_switches.scope_id
# are `varchar` -- this mismatch is bug class (a) above.
_SCHEMA_DDL = """
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE,
    whatsapp_id VARCHAR(255) UNIQUE,
    username VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    default_slippage INTEGER DEFAULT 50,
    notifications_enabled BOOLEAN DEFAULT true,
    gas_mode VARCHAR(10) DEFAULT 'auto',
    language_preference TEXT DEFAULT 'en',
    tos_accepted BOOLEAN DEFAULT false,
    tos_accepted_at TIMESTAMPTZ,
    referred_by_user_id INTEGER,
    total_referral_rewards REAL DEFAULT 0.0,
    referral_count INTEGER DEFAULT 0,
    two_fa_enabled BOOLEAN DEFAULT false,
    totp_secret VARCHAR(64),
    two_fa_threshold INTEGER DEFAULT 1000,
    organization_id UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    last_active_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    tier VARCHAR(20) NOT NULL DEFAULT 'enterprise',
    owner_id INTEGER NOT NULL REFERENCES users(id),
    seat_limit INTEGER NOT NULL DEFAULT 10,
    api_rate_limit_per_min INTEGER NOT NULL DEFAULT 1000,
    stripe_customer_id VARCHAR(100),
    stripe_subscription_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agents (
    id SERIAL PRIMARY KEY,
    uuid UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    api_key_hash VARCHAR(128) NOT NULL,
    callback_url TEXT,
    metadata JSONB,
    is_active BOOLEAN NOT NULL DEFAULT true,
    rate_limit_tier VARCHAR(20) NOT NULL DEFAULT 'free',
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    owner_user_id INTEGER REFERENCES users(id),
    subscription_tier VARCHAR(20),
    subscription_expires_at TIMESTAMPTZ,
    total_requests INTEGER DEFAULT 0,
    total_swaps INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at TIMESTAMPTZ
);

CREATE TABLE approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id VARCHAR(64) NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    action_type VARCHAR(40) NOT NULL,
    payload JSONB NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    policy_decision_id BIGINT,
    reason VARCHAR(300),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    decided_by INTEGER REFERENCES users(id),
    decided_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE policy_kill_switches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope VARCHAR(10) NOT NULL,
    scope_id VARCHAR(64),
    active BOOLEAN NOT NULL DEFAULT true,
    reason VARCHAR(300),
    activated_by INTEGER REFERENCES users(id),
    activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deactivated_at TIMESTAMPTZ
);

CREATE TABLE agent_link_codes (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    code_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ix_agent_link_codes_code_hash ON agent_link_codes (code_hash);
"""


@pytest.fixture(scope="session")
def pg_database_url():
    """Session-scoped: create a uniquely-named scratch Postgres DB, lay down
    the api-ts-owned tables with real types, then run the REAL
    database/db.py init_db()/_ensure_schema() against it so Python-owned
    additive tables are created via the actual migration path. Yields the
    scratch DB's URL; drops the DB on teardown."""
    if not pg_reachable():
        pytest.skip(
            "Local Postgres (supabase_db_static, localhost:54322) is unreachable -- "
            "skipping tests/integration.",
            allow_module_level=True,
        )

    db_name = f"cp_test_{uuid.uuid4().hex[:12]}"

    admin_engine = create_engine(PG_ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{db_name}"'))
    admin_engine.dispose()

    scratch_url = PG_HOST_URL_TEMPLATE.format(db=db_name)

    schema_engine = create_engine(scratch_url)
    with schema_engine.begin() as conn:
        conn.execute(text(_SCHEMA_DDL))
    schema_engine.dispose()

    # Run the REAL migration path so Python-owned tables (agent_webhook_deliveries,
    # etc.) are created exactly as production creates them -- never hand-rolled here.
    from database import db as database_db

    ok = database_db.init_db(scratch_url)
    assert ok, "database.db.init_db() failed against the Postgres scratch DB"

    yield scratch_url

    # Teardown: drop the scratch DB. Must dispose the app engine first so no
    # lingering connection blocks DROP DATABASE.
    if database_db.engine is not None:
        database_db.engine.dispose()
    admin_engine = create_engine(PG_ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        conn.execute(
            text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = :db AND pid <> pg_backend_pid()"
            ),
            {"db": db_name},
        )
        conn.execute(text(f'DROP DATABASE IF EXISTS "{db_name}"'))
    admin_engine.dispose()


# Tables truncated between tests, in FK-safe order (children before parents).
_TRUNCATE_ORDER = [
    "agent_webhook_deliveries",
    "agent_link_codes",
    "approval_requests",
    "policy_kill_switches",
    "agents",
    "organizations",
    "users",
]


@pytest.fixture()
def pg_db(pg_database_url):
    """Function-scoped: truncate all control-plane tables before each test so
    tests are independent, then hand back the real database.db module (with
    its engine/SessionLocal already pointed at the scratch Postgres DB by the
    session fixture) plus a plain psycopg2-less SQLAlchemy session for direct
    setup/assertions."""
    from database import db as database_db

    for tbl in _TRUNCATE_ORDER:
        # agent_webhook_deliveries only exists once _ensure_schema created it
        # -- tolerate a partial/older schema gracefully rather than failing
        # every test if that migration didn't run for some reason. Each
        # table gets its own transaction so one missing table can't abort
        # (and thus skip) the truncation of the rest.
        try:
            with database_db.engine.begin() as conn:
                conn.execute(text(f'TRUNCATE TABLE "{tbl}" RESTART IDENTITY CASCADE'))
        except Exception:
            pass

    yield database_db
