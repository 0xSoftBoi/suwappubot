#!/usr/bin/env python3
"""Run read-only historical Execution Synchronization replay.

Examples:
    python scripts/replay_execution_sync.py
    python scripts/replay_execution_sync.py --walk-forward
    python scripts/replay_execution_sync.py --days 60 --min-evidence 30
    python scripts/replay_execution_sync.py --walk-forward --json --limit-results 25

Requires the normal application DATABASE_URL/configuration. This command never
writes to the DB and never changes live route selection.
"""

from __future__ import annotations

import argparse
import json
from typing import Any


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Replay historical Suwappu route races")
    parser.add_argument("--days", type=int, default=30, help="history window (1-180 days)")
    parser.add_argument(
        "--min-evidence",
        type=int,
        default=20,
        help="minimum terminal executions required per provider",
    )
    parser.add_argument(
        "--limit-results",
        type=int,
        default=20,
        help="maximum per-race rows printed in JSON (0 = summary only)",
    )
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    parser.add_argument(
        "--walk-forward",
        action="store_true",
        help="calibrate each race using only terminal executions observed before it",
    )
    return parser


def _compact(payload: dict[str, Any], limit: int) -> dict[str, Any]:
    result = dict(payload)
    rows = list(result.get("results") or [])
    result["result_count"] = len(rows)
    result["results"] = rows[: max(0, limit)] if limit else []
    return result


def main() -> int:
    args = _parser().parse_args()
    if args.min_evidence < 1:
        raise SystemExit("--min-evidence must be >= 1")
    if args.limit_results < 0:
        raise SystemExit("--limit-results must be >= 0")

    from bot.config.settings import settings
    from database.db import init_db

    database_url = getattr(settings, "database_url", None)
    if not database_url:
        raise SystemExit("DATABASE_URL is required for historical replay")
    if not init_db(database_url):
        raise SystemExit("database initialization failed")

    if args.walk_forward:
        from bot.services.execution_sync_walkforward import ExecutionSyncWalkForwardStore

        summary = ExecutionSyncWalkForwardStore().run(
            window_days=args.days,
            min_provider_evidence=args.min_evidence,
        )
    else:
        from bot.services.execution_sync_replay import ExecutionSyncReplayStore

        summary = ExecutionSyncReplayStore().run(
            window_days=args.days,
            min_provider_evidence=args.min_evidence,
        )

    payload = _compact(summary.to_dict(), args.limit_results)

    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True, default=str))
        return 0

    if args.walk_forward:
        print("Execution Synchronization walk-forward replay")
        print("  MODELED COUNTERFACTUAL — each race uses prior evidence only")
        print(f"  folds: {payload['folds']}")
        print(f"  comparable: {payload['comparable_folds']}")
        print(f"  changed selection: {payload['changed_selection_folds']}")
        print(f"  positive delta folds: {payload['positive_delta_folds']}")
        print(f"  modeled total delta USD: {payload['modeled_total_delta_usd']:.4f}")
        print(f"  modeled median delta USD: {payload.get('modeled_median_delta_usd')}")
        print(f"  observed production fills: {payload['observed_production_fill_folds']}")
        print(f"  skipped for insufficient prior evidence: {payload['skipped_no_prior_evidence']}")
    else:
        print("Execution Synchronization historical replay")
        print("  MODELED COUNTERFACTUAL — rejected routes were not executed")
        print(f"  races: {payload['races']}")
        print(f"  comparable: {payload['comparable_races']}")
        print(f"  changed selection: {payload['changed_selection_races']}")
        print(f"  modeled positive delta races: {payload['modeled_positive_delta_races']}")
        print(f"  modeled total delta USD: {payload['modeled_total_delta_usd']:.4f}")
        median = payload.get("modeled_median_delta_usd")
        print(f"  modeled median delta USD: {median if median is not None else 'n/a'}")
        print("  provider evidence:")
        for provider, calibration in sorted(payload.get("calibrations", {}).items()):
            print(
                "    "
                f"{provider}: n={calibration['observations']}, "
                f"realized_n={calibration['realized_observations']}, "
                f"success={calibration['success_rate']:.3f}, "
                f"fill_ratio={calibration['median_fill_ratio']}, "
                f"latency_s={calibration['median_latency_seconds']}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
