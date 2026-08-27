"""Schema conformance gate for the replay and analytics SQL.

`scripts/replay/` and `scripts/analytics/` read production tables through hand-written
SQL rather than the ORM, deliberately: the replayer has to run anywhere a
``DATABASE_URL`` does, without importing the bot package or its native crypto stack.
The cost of that choice is that a column rename in `bot/models/` cannot break them at
import time or in CI — it breaks them at 03:00 in the nightly reconciler, as a log line.

This closes that gap. It materialises the **real** schema from
``Base.metadata`` (every module under `bot/models/`), seeds one row into each table the
extractors read, then runs every extractor and every analytics view against it. A
renamed or dropped column fails here, in CI, on the commit that renames it.

Seeding matters and is not decoration: an extractor over an empty table proves the SQL
names real columns, but never executes the Python that reads the returned row. Half the
mapping lives in ``row["realized_to_amount_usd"]``, not in the SELECT.

    python3 scripts/audit/schema_conformance.py
    python3 scripts/audit/schema_conformance.py --verbose

Exit 0 when everything conforms, 1 on any failure. This is a gate.
"""

from __future__ import annotations

import argparse
import importlib
import os
import pkgutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from typing import Any

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

# Tables the replay/analytics SQL touches. Seeding is scoped to these rather than all
# 126: the point is to exercise our readers, not to fixture the whole product.
SEEDED_TABLES = (
    "swap_transactions",
    "fee_transactions",
    "point_transactions",
    "referral_earnings",
    "spend_events",
    "user_points",
    "x402_payments",
)

# Values that make a row survive our own extraction filters, so the Python row-access
# path actually runs. A swap with status "pending" is skipped by atomic state validation
# and would prove nothing.
FORCED: dict[str, dict[str, Any]] = {
    "swap_transactions": {"status": "completed"},
    "x402_payments": {"status": "completed"},
    "point_transactions": {"amount": 10},
    "referral_earnings": {"amount_usd": 1.5},
    "fee_transactions": {"fee_amount_usd": 0.5, "collected": False},
    "spend_events": {"amount_usd": 2.0},
}


def load_models() -> tuple[Any, list[str]]:
    """Import every model module so Base.metadata is complete."""
    from database.db import Base

    import bot.models as models_pkg

    skipped: list[str] = []
    for _, name, _ in pkgutil.iter_modules(models_pkg.__path__):
        try:
            importlib.import_module(f"bot.models.{name}")
        except Exception as exc:  # noqa: BLE001 - report, never abort the sweep
            skipped.append(f"bot.models.{name}: {type(exc).__name__}")
    return Base, skipped


def _sample_value(column, when: datetime) -> Any:
    """A plausible value for a column, by type. Enough to satisfy NOT NULL."""
    from sqlalchemy import Boolean, Date, DateTime, Enum, Float, Integer, Numeric

    type_ = column.type
    if isinstance(type_, Enum):
        enums = list(getattr(type_, "enums", []) or [])
        return enums[0] if enums else "completed"
    if isinstance(type_, Boolean):
        return False
    if isinstance(type_, (DateTime, Date)):
        return when
    if isinstance(type_, (Integer,)):
        return 1
    if isinstance(type_, (Float, Numeric)):
        return 1.0
    return "1"


def seed(conn, metadata, when: datetime, verbose: bool = False) -> list[str]:
    """Insert one row into each seeded table. Returns notes about anything skipped."""
    notes: list[str] = []
    for name in SEEDED_TABLES:
        table = metadata.tables.get(name)
        if table is None:
            notes.append(f"{name}: not present in Base.metadata (no model defines it)")
            continue

        row: dict[str, Any] = {}
        for column in table.columns:
            if column.primary_key and column.autoincrement:
                continue
            forced = FORCED.get(name, {})
            if column.name in forced:
                row[column.name] = forced[column.name]
            elif column.nullable or column.default is not None or column.server_default is not None:
                # Let the schema supply it; a NULL here is representative of real rows.
                continue
            else:
                row[column.name] = _sample_value(column, when)
        row.update(FORCED.get(name, {}))

        try:
            conn.execute(table.insert().values(**row))
        except Exception as exc:  # noqa: BLE001
            notes.append(f"{name}: could not seed ({str(exc).splitlines()[0][:100]})")
        else:
            if verbose:
                notes.append(f"{name}: seeded {len(row)} columns")
    return notes


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--verbose", action="store_true")
    args = p.parse_args(argv)

    from sqlalchemy import create_engine, text

    Base, skipped = load_models()
    for note in skipped:
        print(f"WARN could not import {note}", file=sys.stderr)

    when = datetime.now(timezone.utc).replace(microsecond=0)
    start, end = when - timedelta(days=1), when + timedelta(days=1)

    with tempfile.TemporaryDirectory() as tmp:
        engine = create_engine(f"sqlite:///{os.path.join(tmp, 'conformance.db')}")
        Base.metadata.create_all(engine)
        print(f"materialised {len(Base.metadata.tables)} tables from bot/models/")

        failures: list[str] = []
        with engine.begin() as conn:
            for note in seed(conn, Base.metadata, when, verbose=args.verbose):
                print(f"  note: {note}")

        from scripts.analytics.views import VIEWS, build_query
        from scripts.replay.canonical import EXTRACTORS
        from scripts.replay.engine import load_opening_balances, load_points_snapshot

        with engine.connect() as conn:
            print("\ncanonical extractors")
            for name, extractor in EXTRACTORS.items():
                try:
                    rows = list(extractor(conn, start, end))
                except Exception as exc:  # noqa: BLE001
                    failures.append(f"extractor {name}: {str(exc).splitlines()[0]}")
                    print(f"  FAIL {name}: {str(exc).splitlines()[0][:110]}")
                else:
                    # A seeded table that yields nothing means the row-access path never
                    # ran, so this check proved less than it looks like it did.
                    marker = "OK  " if rows else "OK? "
                    suffix = "" if rows else "  (no rows produced - row access unexercised)"
                    print(f"  {marker} {name}: {len(rows)} event(s){suffix}")

            print("\nsnapshot loaders")
            for label, loader in (
                ("load_points_snapshot", lambda c: load_points_snapshot(c)),
                ("load_opening_balances", lambda c: load_opening_balances(c, start)),
            ):
                try:
                    loader(conn)
                    print(f"  OK   {label}")
                except Exception as exc:  # noqa: BLE001
                    failures.append(f"{label}: {str(exc).splitlines()[0]}")
                    print(f"  FAIL {label}: {str(exc).splitlines()[0][:110]}")

            print("\nanalytics views")
            for name, view in VIEWS.items():
                try:
                    conn.execute(
                        text(build_query(view, dialect="sqlite")),
                        {"start": start, "end": end, "limit": 5},
                    ).fetchall()
                    print(f"  OK   {name}")
                except Exception as exc:  # noqa: BLE001
                    failures.append(f"view {name}: {str(exc).splitlines()[0]}")
                    print(f"  FAIL {name}: {str(exc).splitlines()[0][:110]}")

    if failures:
        print(f"\n{len(failures)} conformance failure(s):")
        for f in failures:
            print(f"  - {f}")
        print(
            "\nThe replay and analytics SQL has drifted from bot/models/. Fix the SQL in "
            "scripts/replay/canonical.py or scripts/analytics/views.py to match, or the "
            "nightly reconciler fails silently in production."
        )
        return 1

    print("\nall extractors, loaders and views conform to the current schema")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
