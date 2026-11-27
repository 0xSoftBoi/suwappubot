"""Suwappu Bank DDL — auto-discovered per-module files.

Each ``database/bank_ddl/<module>.py`` exports ``statements(is_sqlite) -> list[str]``
(idempotent ``IF NOT EXISTS`` DDL). ``ensure_bank_tables`` runs them all, sorted by
module name, on every boot. Mirrors api-ts ``db/schema/bank*.ts`` (ADR 0003).
"""

import importlib
import logging
import pkgutil

from sqlalchemy import text

logger = logging.getLogger(__name__)


def ensure_bank_tables(db_engine, is_sqlite: bool) -> None:
    for info in sorted(pkgutil.iter_modules(__path__), key=lambda m: m.name):
        mod = importlib.import_module(f"{__name__}.{info.name}")
        stmts = getattr(mod, "statements", None)
        if stmts is None:
            continue
        try:
            with db_engine.begin() as conn:
                for stmt in stmts(is_sqlite):
                    conn.execute(text(stmt))
        except Exception as exc:  # never block boot on a bank DDL failure
            logger.error("bank_ddl.%s failed: %s", info.name, exc)
