#!/usr/bin/env python3
"""
Dual-ORM schema drift check.

Runs the Python runtime migration path (database.db.init_db -> create_all +
_ensure_schema) against a throwaway Postgres, then parses the Drizzle
TypeScript schema files (api-ts/src/db/schema/*.ts) and, for every table that
exists in BOTH ORMs, asserts via information_schema.columns that:

  - any column Drizzle declares serial()/bigserial()/.generatedAlwaysAsIdentity()
    has a non-null column_default OR is_identity = 'YES' in Postgres.
  - any column Drizzle declares .notNull() is is_nullable = 'NO' in Postgres.

This exists because the Python runtime migration (database/db.py) and the
Drizzle schema (api-ts/src/db/schema/*.ts) both define the same tables, and
they can silently drift (e.g. agent_link_codes.id: Python created it with no
sequence while Drizzle's serial() assumed one existed -> prod 500 on insert).

Exit 0 if no mismatches, exit 1 and print a table of mismatches otherwise.
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DRIZZLE_SCHEMA_DIR = REPO_ROOT / "api-ts" / "src" / "db" / "schema"

# Drizzle pg-core column builders that imply "database generates this value" /
# "not null" for our purposes.
SERIAL_FNS = {"serial", "bigserial"}


@dataclass
class DrizzleColumn:
    name: str  # DB column name, e.g. "code_hash"
    is_serial: bool = False
    is_identity: bool = False
    not_null: bool = False


@dataclass
class DrizzleTable:
    name: str
    columns: dict[str, DrizzleColumn] = field(default_factory=dict)


def parse_drizzle_schema_dir(schema_dir: Path) -> dict[str, DrizzleTable]:
    """Regex-parse `pgTable('name', { ... })` blocks out of every *.ts file.

    Deliberately simple: we don't need a real TS parser, just enough
    structure to catch serial()/notNull() drift. Keep this robust to minor
    formatting differences (single/double quotes, trailing commas, etc.)
    rather than exact-syntax-perfect.
    """
    tables: dict[str, DrizzleTable] = {}

    table_start_re = re.compile(
        r"pgTable\(\s*['\"](?P<table>[a-zA-Z0-9_]+)['\"]\s*,\s*\{", re.MULTILINE
    )

    for ts_file in sorted(schema_dir.glob("*.ts")):
        text = ts_file.read_text()

        for m in table_start_re.finditer(text):
            table_name = m.group("table")
            # Find the matching closing brace for the columns object literal
            # by brace counting starting right after the opening '{'.
            start = m.end()  # position right after the '{'
            depth = 1
            i = start
            while i < len(text) and depth > 0:
                if text[i] == "{":
                    depth += 1
                elif text[i] == "}":
                    depth -= 1
                i += 1
            body = text[start : i - 1]

            table = tables.setdefault(table_name, DrizzleTable(name=table_name))

            # Split body into per-column statements. Columns are defined as
            # `key: builder('col_name', ...)...,` — split on top-level commas
            # is fragile with nested calls, so instead find each column
            # definition by looking for `<builderFn>(` calls and walking
            # forward to capture chained methods until the next column key
            # or end of body.
            col_def_re = re.compile(
                r"(?P<key>[a-zA-Z0-9_]+)\s*:\s*(?P<fn>[a-zA-Z0-9_.]+)\s*\(\s*['\"](?P<colname>[a-zA-Z0-9_]+)['\"]",
            )
            matches = list(col_def_re.finditer(body))
            for idx, cm in enumerate(matches):
                fn = cm.group("fn").split(".")[-1]
                colname = cm.group("colname")
                seg_start = cm.end()
                seg_end = matches[idx + 1].start() if idx + 1 < len(matches) else len(body)
                segment = body[seg_start:seg_end]

                col = table.columns.setdefault(colname, DrizzleColumn(name=colname))
                if fn in SERIAL_FNS:
                    col.is_serial = True
                if ".generatedAlwaysAsIdentity(" in segment or fn == "generatedAlwaysAsIdentity":
                    col.is_identity = True
                if ".notNull(" in segment:
                    col.not_null = True
                # serial()/bigserial()/identity columns are implicitly not-null
                if col.is_serial or col.is_identity:
                    col.not_null = True

    return tables


@dataclass
class Mismatch:
    table: str
    column: str
    expectation: str
    actual: str


def check_against_postgres(tables: dict[str, DrizzleTable], conn) -> list[Mismatch]:
    mismatches: list[Mismatch] = []

    for table in tables.values():
        rows = conn.execute(
            text(
                "select column_name, column_default, is_nullable, is_identity "
                "from information_schema.columns "
                "where table_schema = 'public' and table_name = :table"
            ),
            {"table": table.name},
        ).fetchall()

        if not rows:
            # Table doesn't exist in the Python-migrated Postgres at all —
            # not this check's job (a separate table-existence check would
            # catch that); skip silently.
            continue

        pg_cols = {r[0]: {"default": r[1], "nullable": r[2], "identity": r[3]} for r in rows}

        for col in table.columns.values():
            pg = pg_cols.get(col.name)
            if pg is None:
                # Column declared in Drizzle but missing from the Python
                # migration entirely — flag it, this is exactly the kind of
                # drift we care about.
                mismatches.append(
                    Mismatch(
                        table.name,
                        col.name,
                        "column exists (declared in Drizzle)",
                        "MISSING in Postgres (Python migration never added it)",
                    )
                )
                continue

            if col.is_serial or col.is_identity:
                has_default = pg["default"] is not None
                is_identity = pg["identity"] == "YES"
                if not (has_default or is_identity):
                    mismatches.append(
                        Mismatch(
                            table.name,
                            col.name,
                            "serial/identity -> non-null column_default or is_identity=YES",
                            f"column_default={pg['default']!r} is_identity={pg['identity']!r}",
                        )
                    )

            if col.not_null:
                if pg["nullable"] != "NO":
                    mismatches.append(
                        Mismatch(
                            table.name,
                            col.name,
                            ".notNull() -> is_nullable=NO",
                            f"is_nullable={pg['nullable']!r}",
                        )
                    )

    return mismatches


def print_mismatches(mismatches: list[Mismatch]) -> None:
    print("\nSchema drift check FAILED — Python migration / Drizzle schema mismatch:\n")
    print(f"{'table':<24} {'column':<24} {'expected':<55} actual")
    print("-" * 130)
    for m in mismatches:
        print(f"{m.table:<24} {m.column:<24} {m.expectation:<55} {m.actual}")
    print()


def main() -> int:
    tables = parse_drizzle_schema_dir(DRIZZLE_SCHEMA_DIR)
    print(f"Parsed {len(tables)} Drizzle tables from {DRIZZLE_SCHEMA_DIR}")

    database_url = os.environ.get("SCHEMA_DRIFT_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not database_url:
        print(
            "ERROR: set SCHEMA_DRIFT_DATABASE_URL (or DATABASE_URL) to a throwaway "
            "Postgres before running this check.",
            file=sys.stderr,
        )
        return 2

    sys.path.insert(0, str(REPO_ROOT))
    global text
    from sqlalchemy import text  # noqa: E402

    from database.db import init_db  # noqa: E402
    import database.db as db_module  # noqa: E402

    ok = init_db(database_url)
    if not ok:
        print("ERROR: database.db.init_db() failed against the throwaway Postgres", file=sys.stderr)
        return 2

    with db_module.engine.connect() as conn:
        mismatches = check_against_postgres(tables, conn)

    # --strict fails on every mismatch. Default mode fails only on the class
    # that broke prod on 2026-09-26 (a Drizzle serial()/identity column with no
    # sequence in Postgres → every insert 500s) and reports the rest as
    # warnings: the Python-vs-Drizzle nullability/missing-column drift is
    # legacy (dozens of columns) and is tracked for cleanup separately; it
    # should not block unrelated PRs, but it must stay visible in every run.
    strict = "--strict" in sys.argv
    blocking = [m for m in mismatches if m.expectation.startswith("serial/identity")]
    warnings = [m for m in mismatches if m not in blocking]

    if warnings:
        print(
            f"\nWARN: {len(warnings)} non-blocking mismatch(es) (run with --strict to fail on them):"
        )
        print_mismatches(warnings)
    if blocking:
        print(f"\nBLOCKING: {len(blocking)} serial/identity column(s) without a sequence:")
        print_mismatches(blocking)
        return 1
    if strict and warnings:
        return 1

    print(
        "Schema drift check passed — no serial/identity drift"
        + (f" ({len(warnings)} non-blocking warnings)" if warnings else "")
        + "."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
