"""Regression guard for the runtime additive-migration path.

`database.db.init_db()` imports `bot.models.*` before calling
`Base.metadata.create_all()`. Importing a package submodule executes
`bot/models/__init__.py`, which must therefore register every new execution
model with the shared SQLAlchemy Base.
"""

import bot.models  # noqa: F401
from database.db import Base


EXPECTED_EXECUTION_TABLES = {
    "execution_intents",
    "execution_candidate_plans",
    "execution_parent_orders",
    "execution_child_placements",
    "execution_fills",
    "execution_settlements",
    "execution_events",
    "execution_outbox",
}


def test_execution_tables_are_registered_for_create_all():
    assert EXPECTED_EXECUTION_TABLES <= set(Base.metadata.tables)
