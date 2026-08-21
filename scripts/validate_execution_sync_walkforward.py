#!/usr/bin/env python3
"""Dependency-light validation for walk-forward Execution Sync replay."""

from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]


def load(name: str, relative_path: str):
    path = ROOT / relative_path
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


sync = load("execution_sync_standalone_wf", "bot/services/execution_sync.py")
cal = load("execution_sync_calibration_standalone_wf", "bot/services/execution_sync_calibration.py")
sys.modules["bot.services.execution_sync"] = sync
sys.modules["bot.services.execution_sync_calibration"] = cal
replay = load("execution_sync_replay_standalone_wf", "bot/services/execution_sync_replay.py")
sys.modules["bot.services.execution_sync_replay"] = replay
walk = load("execution_sync_walkforward_standalone", "bot/services/execution_sync_walkforward.py")


def tx(provider: str, minute: int, fill: float = 1.0):
    created = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc) + timedelta(minutes=minute)
    return SimpleNamespace(
        route_provider=provider,
        status="completed",
        to_amount_usd=1000.0,
        realized_to_amount_usd=1000.0 * fill,
        created_at=created,
        completed_at=created + timedelta(seconds=10),
    )


def route(qid: str, provider: str, minute: int, quoted: float, selected: bool):
    return SimpleNamespace(
        quote_id=qid,
        swap_id=1 if selected else None,
        provider=provider,
        from_chain="ethereum",
        to_chain="base",
        from_token="USDC",
        to_token="USDC",
        quoted_to_amount_usd=quoted,
        quoted_gas_usd=0.0,
        quoted_fee_usd=0.0,
        quoted_duration_s=10,
        was_selected=selected,
        created_at=datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc) + timedelta(minutes=minute),
        observed_to_amount_usd=quoted if selected else None,
    )


def main() -> None:
    history = [tx("lifi", i, 0.998) for i in range(25)] + [tx("across", i, 0.999) for i in range(25)]
    races = [
        [route("early", "lifi", 5, 1000.0, True), route("early", "across", 5, 999.5, False)],
        [route("late", "lifi", 40, 1000.0, True), route("late", "across", 40, 999.5, False)],
    ]
    result = walk.run_walk_forward(races, history, min_provider_evidence=20)
    assert result.walk_forward if hasattr(result, "walk_forward") else True
    # The early race cannot use future evidence; the later race can.
    assert result.skipped_no_prior_evidence >= 1
    assert result.folds >= 1
    assert all(f.training_observations < len(history) for f in result.results)
    payload = result.to_dict()
    assert payload["walk_forward"] is True
    assert "before" in payload["caveat"]
    print("execution-sync walk-forward validation: PASS")


if __name__ == "__main__":
    main()
