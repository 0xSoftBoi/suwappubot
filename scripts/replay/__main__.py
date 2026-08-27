"""Money-path replay CLI (W1.2/W1.3).

Rebuilds per-user money state from the canonical event stream and validates it against
the aggregates production maintains incrementally, halting on the first divergence past
the stated epsilon.

    python3 -m scripts.replay --days 1
    python3 -m scripts.replay --start 2026-08-01 --end 2026-08-02 --epsilon 0.01
    python3 -m scripts.replay --days 7 --no-halt --json report.json

Exit codes: 0 clean, 1 divergence found, 2 could not run (no DB, missing tables).
The nonzero-on-divergence contract is what lets this run as a nightly job whose failure
means something, rather than a log line nobody reads.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.replay.canonical import build_canonical_stream, stream_digest  # noqa: E402
from scripts.replay.engine import (  # noqa: E402
    DEFAULT_CHECKPOINT_EVERY,
    DEFAULT_EPSILON,
    load_opening_balances,
    load_points_snapshot,
    replay,
)

EXIT_OK = 0
EXIT_DIVERGED = 1
EXIT_UNAVAILABLE = 2


def _parse_day(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="scripts.replay", description=__doc__)
    p.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    p.add_argument("--days", type=int, default=1, help="window size ending now (default 1)")
    p.add_argument("--start", type=_parse_day, help="explicit window start (UTC, ISO)")
    p.add_argument("--end", type=_parse_day, help="explicit window end (UTC, ISO)")
    p.add_argument("--epsilon", type=Decimal, default=DEFAULT_EPSILON)
    p.add_argument("--checkpoint-every", type=int, default=DEFAULT_CHECKPOINT_EVERY)
    p.add_argument(
        "--no-halt",
        action="store_true",
        help="collect every divergence instead of stopping at the first",
    )
    p.add_argument("--tables", nargs="*", help="restrict to these source tables")
    p.add_argument(
        "--metrics",
        nargs="*",
        default=["points_earned", "points_spent"],
        help="snapshot metrics to validate against",
    )
    p.add_argument("--json", dest="json_path", help="write the full report as JSON")
    p.add_argument("--quiet", action="store_true")
    return p


def resolve_window(args) -> tuple[datetime, datetime]:
    if args.start and args.end:
        return args.start, args.end
    end = args.end or datetime.now(timezone.utc)
    start = args.start or (end - timedelta(days=max(1, args.days)))
    return start, end


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)

    if not args.database_url:
        print("no DATABASE_URL; pass --database-url", file=sys.stderr)
        return EXIT_UNAVAILABLE

    try:
        from sqlalchemy import create_engine
    except ImportError:
        print("SQLAlchemy is required", file=sys.stderr)
        return EXIT_UNAVAILABLE

    start, end = resolve_window(args)
    if not args.quiet:
        print(f"window {start.isoformat()} -> {end.isoformat()}")

    engine = create_engine(args.database_url, future=True)
    try:
        with engine.connect() as conn:
            events, warnings = build_canonical_stream(conn, start, end, tables=args.tables)
            snapshot = load_points_snapshot(conn)
            opening = load_opening_balances(conn, start)
    except Exception as exc:
        print(f"could not read the database: {exc}", file=sys.stderr)
        return EXIT_UNAVAILABLE

    for warning in warnings:
        print(f"WARN {warning}", file=sys.stderr)

    if not args.quiet:
        print(f"canonical stream: {len(events)} events, digest {stream_digest(events)[:16]}")
        print(f"snapshot anchor:  {len(snapshot)} accounts")
        print(f"opening balances: {len(opening)} accounts at window start")

    _, report = replay(
        events,
        snapshot=snapshot,
        opening=opening,
        checkpoint_every=args.checkpoint_every,
        epsilon=args.epsilon,
        halt_on_divergence=not args.no_halt,
        metrics=tuple(args.metrics),
    )
    report.warnings.extend(warnings)

    print(report.summary())
    for div in report.divergences[:25]:
        print(f"  DIVERGENCE {div.describe()}")
    if len(report.divergences) > 25:
        print(f"  ... and {len(report.divergences) - 25} more")

    if args.json_path:
        payload = {
            "window": {"start": start.isoformat(), "end": end.isoformat()},
            "events": report.events_processed,
            "accounts": report.accounts_touched,
            "checkpoints": len(report.checkpoints),
            "max_delta": str(report.max_delta),
            "epsilon": str(args.epsilon),
            "events_per_second": round(report.events_per_second, 1),
            "final_state_hash": report.final_state_hash,
            "stream_digest": stream_digest(events),
            "halted_at": report.halted_at,
            "warnings": report.warnings,
            "divergences": [
                {
                    "checkpoint": dv.checkpoint,
                    "event_index": dv.event_index,
                    "user_id": dv.user_id,
                    "metric": dv.metric,
                    "reconstructed": str(dv.reconstructed),
                    "observed": str(dv.observed),
                    "delta": str(dv.delta),
                }
                for dv in report.divergences
            ],
        }
        with open(args.json_path, "w") as fh:
            json.dump(payload, fh, indent=2)
        if not args.quiet:
            print(f"report written to {args.json_path}")

    return EXIT_OK if report.ok else EXIT_DIVERGED


if __name__ == "__main__":
    raise SystemExit(main())
