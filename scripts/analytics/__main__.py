"""Revenue analytics CLI (W2.4/W2.5).

Runs the five institutional-grade views over a bounded window and prints every figure
next to the SQL that produced it.

    python3 -m scripts.analytics --days 7
    python3 -m scripts.analytics --view summary --days 1 --show-sql
    python3 -m scripts.analytics --days 30 --json revenue.json

There is deliberately no "all time" option. Tektonic's partition discipline is that an
unpartitioned scan should be architecturally impossible rather than discouraged, so the
window is required and :data:`scripts.analytics.views.MAX_WINDOW_DAYS` caps it.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.analytics.views import (  # noqa: E402
    VIEWS,
    UnboundedQuery,
    build_query,
    run,
    validate_window,
)

EXIT_OK = 0
EXIT_BAD_WINDOW = 1
EXIT_UNAVAILABLE = 2


def _parse_day(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="scripts.analytics", description=__doc__)
    p.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    p.add_argument("--view", choices=sorted(VIEWS), action="append", dest="views")
    p.add_argument("--days", type=int, default=7)
    p.add_argument("--start", type=_parse_day)
    p.add_argument("--end", type=_parse_day)
    p.add_argument("--limit", type=int, default=25)
    p.add_argument("--show-sql", action="store_true", help="print the query behind each table")
    p.add_argument("--json", dest="json_path")
    return p


def _format_table(columns, rows, limit: int = 25) -> str:
    if not rows:
        return "    (no rows)"
    cols = [c for c in columns if c in rows[0]] or list(rows[0])
    widths = {c: max(len(c), *(len(_fmt(r.get(c))) for r in rows[:limit])) for c in cols}
    head = "  ".join(c.ljust(widths[c]) for c in cols)
    rule = "  ".join("-" * widths[c] for c in cols)
    body = ["  ".join(_fmt(r.get(c)).ljust(widths[c]) for c in cols) for r in rows[:limit]]
    out = [f"    {head}", f"    {rule}", *(f"    {b}" for b in body)]
    if len(rows) > limit:
        out.append(f"    ... {len(rows) - limit} more rows")
    return "\n".join(out)


def _fmt(value) -> str:
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:,.6f}".rstrip("0").rstrip(".") or "0"
    return str(value)


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)

    end = args.end or datetime.now(timezone.utc)
    start = args.start or (end - timedelta(days=max(1, args.days)))

    try:
        start, end = validate_window(start, end)
    except UnboundedQuery as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return EXIT_BAD_WINDOW

    if not args.database_url:
        # Still useful without a database: print the SQL so it can be run elsewhere.
        print("no DATABASE_URL - printing the queries only\n", file=sys.stderr)
        for name in args.views or sorted(VIEWS):
            view = VIEWS[name]
            print(f"-- {view.title}: {view.description}")
            print(f"-- :start = {start.isoformat()}\n-- :end = {end.isoformat()}")
            print(build_query(view), "\n")
        return EXIT_UNAVAILABLE

    try:
        from sqlalchemy import create_engine
    except ImportError:
        print("SQLAlchemy is required", file=sys.stderr)
        return EXIT_UNAVAILABLE

    engine = create_engine(args.database_url, future=True)
    print(f"window {start.isoformat()} -> {end.isoformat()}\n")

    payload: dict[str, object] = {
        "window": {"start": start.isoformat(), "end": end.isoformat()},
        "views": {},
    }

    with engine.connect() as conn:
        for name in args.views or sorted(VIEWS):
            view = VIEWS[name]
            try:
                result = run(conn, view, start=start, end=end, limit=args.limit)
            except Exception as exc:
                print(f"== {view.title}\n    unavailable: {str(exc).splitlines()[0]}\n")
                continue

            print(f"== {view.title}")
            print(f"   {view.description}")
            print(_format_table(view.columns, result.rows, limit=args.limit))
            if args.show_sql:
                print("\n    -- reproduce:")
                for line in result.reproduce().splitlines():
                    print(f"    {line}")
            print()

            payload["views"][name] = {
                "title": view.title,
                "rows": result.rows,
                "sql": result.sql,
                "params": {k: str(v) for k, v in result.params.items()},
            }

    if args.json_path:
        with open(args.json_path, "w") as fh:
            json.dump(payload, fh, indent=2, default=str)
        print(f"written to {args.json_path}")

    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
