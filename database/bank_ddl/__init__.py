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


# Modules that CREATE the base tables, in dependency order. Everything else (additive
# ALTER / index modules) runs afterwards, sorted by name. Plain alphabetical order ran
# e.g. ``idempotency2`` (ALTER bank_payroll_runs) before ``payments_payroll`` (CREATE),
# leaving columns missing until the second boot.
_BASE_ORDER = (
    "core",
    "earn_credit",
    "remit_ramps",
    "cards",
    "payments_payroll",
    "business",
    "agents_platform",
    "integration",
)


def _ordered_modules() -> list:
    names = [m.name for m in pkgutil.iter_modules(__path__)]
    base = [n for n in _BASE_ORDER if n in names]
    rest = sorted(n for n in names if n not in _BASE_ORDER)
    return base + rest


def _run_module(db_engine, is_sqlite: bool, name: str) -> bool:
    mod = importlib.import_module(f"{__name__}.{name}")
    stmts = getattr(mod, "statements", None)
    if stmts is None:
        return True
    try:
        with db_engine.begin() as conn:
            for stmt in stmts(is_sqlite):
                conn.execute(text(stmt))
        return True
    except Exception as exc:  # never block boot on a bank DDL failure
        logger.error("bank_ddl.%s failed: %s", name, exc)
        return False


def ensure_bank_tables(db_engine, is_sqlite: bool) -> None:
    failed = [n for n in _ordered_modules() if not _run_module(db_engine, is_sqlite, n)]
    # One retry pass: every statement is idempotent, so a module that failed only because
    # of ordering succeeds once the others have run.
    for name in failed:
        if _run_module(db_engine, is_sqlite, name):
            logger.info("bank_ddl.%s succeeded on retry", name)
