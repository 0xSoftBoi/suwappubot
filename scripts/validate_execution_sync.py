#!/usr/bin/env python3
"""Dependency-light validation for Execution Synchronization primitives."""

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
        raise RuntimeError(f"unable to load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


sync = load("execution_sync_standalone", "bot/services/execution_sync.py")
receipt = load("execution_sync_receipt_standalone", "bot/services/execution_sync_receipt.py")
calibration = load("execution_sync_calibration_standalone", "bot/services/execution_sync_calibration.py")
# Replay imports these by their production package names. Alias the already
# dependency-light modules so validation does not import the full bot package.
sys.modules["bot.services.execution_sync"] = sync
sys.modules["bot.services.execution_sync_calibration"] = calibration
replay = load("execution_sync_replay_standalone", "bot/services/execution_sync_replay.py")


def candidate(**overrides):
    values = dict(
        provider="safe",
        from_chain="ethereum",
        to_chain="base",
        from_token="USDC",
        to_token="USDC",
        from_amount_human=1000.0,
        expected_output=999.0,
        guaranteed_min_output=998.5,
        gas_cost_usd=0.2,
        fee_cost_usd=0.2,
        total_cost_usd=0.4,
        expected_latency_seconds=10.0,
        price_impact=0.01,
        settlement_probability=0.999,
        security_score=0.95,
        mev_protected=True,
        quote_timestamp=datetime.now(timezone.utc),
        expires_in_seconds=30,
        raw_quote={},
    )
    values.update(overrides)
    return sync.ExecutionCandidate(**values)


def _history(provider: str, count: int, *, fill_ratio: float, failures: int = 0, latency: int = 12):
    rows = []
    base = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)
    for i in range(count):
        failed = i < failures
        created = base + timedelta(minutes=i)
        rows.append(
            SimpleNamespace(
                route_provider=provider,
                status="failed" if failed else "completed",
                to_amount_usd=1000.0,
                realized_to_amount_usd=None if failed else 1000.0 * fill_ratio,
                created_at=created,
                completed_at=None if failed else created + timedelta(seconds=latency),
            )
        )
    return rows


def _route(
    quote_id: str,
    provider: str,
    quoted_usd: float,
    *,
    selected: bool,
    gas: float = 0.0,
    fee: float = 0.0,
    duration: int = 20,
):
    return SimpleNamespace(
        quote_id=quote_id,
        swap_id=77 if selected else None,
        provider=provider,
        from_chain="ethereum",
        to_chain="base",
        from_token="USDC",
        to_token="USDC",
        quoted_to_amount_usd=quoted_usd,
        quoted_gas_usd=gas,
        quoted_fee_usd=fee,
        quoted_duration_s=duration,
        was_selected=selected,
        created_at=datetime(2026, 8, 20, 14, 0, tzinfo=timezone.utc),
    )


def main() -> None:
    safe = candidate()
    unsafe = candidate(provider="unsafe", expected_output=1005.0, security_score=0.2)
    decision = sync.optimize(
        [safe, unsafe], sync.ExecutionIntent(min_output=990.0, min_security_score=0.8)
    )
    assert decision.selected == safe

    expired = candidate(
        quote_timestamp=datetime.now(timezone.utc) - timedelta(seconds=31),
        expires_in_seconds=30,
    )
    assert "stale_quote" in {
        v.code for v in sync.validate_candidate(expired, sync.ExecutionIntent())
    }

    production = candidate(provider="lifi", expected_output=1000.0, total_cost_usd=5.0)
    cheaper = candidate(provider="across", expected_output=999.9, total_cost_usd=0.1)
    shadow = sync.optimize([production, cheaper], sync.ExecutionIntent())
    event = sync.shadow_event(
        production_provider="lifi", production_output=1000.0, decision=shadow
    )
    assert event["event"] == "execution_sync_shadow_decision"
    assert event["candidate_count"] == 2

    tx = SimpleNamespace(
        id=7,
        route_provider="lifi",
        from_chain="ethereum",
        to_chain="base",
        from_token="USDC",
        to_token="USDC",
        to_amount_usd=999.5,
        realized_to_amount_usd=999.7,
        gas_fee=0.1,
        bridge_fee=0.0,
        status="completed",
        created_at=datetime(2026, 8, 21, 6, 0, tzinfo=timezone.utc),
        completed_at=datetime(2026, 8, 21, 6, 0, 12, tzinfo=timezone.utc),
        tx_hash="0xabc",
        destination_tx_hash="0xdef",
    )
    r = receipt.receipt_from_swap_transaction(tx, baseline_output=999.0)
    assert r.quoted_output == 999.5
    assert r.realized_output == 999.7
    assert r.settlement_latency_seconds == 12.0
    assert r.execution_welfare_bps is not None and r.execution_welfare_bps > 0

    history = [
        tx,
        SimpleNamespace(
            route_provider="lifi",
            status="completed",
            to_amount_usd=1000.0,
            realized_to_amount_usd=995.0,
            created_at=datetime(2026, 8, 21, 7, 0, tzinfo=timezone.utc),
            completed_at=datetime(2026, 8, 21, 7, 0, 20, tzinfo=timezone.utc),
        ),
        SimpleNamespace(
            route_provider="lifi",
            status="failed",
            to_amount_usd=1000.0,
            realized_to_amount_usd=None,
            created_at=datetime(2026, 8, 21, 8, 0, tzinfo=timezone.utc),
            completed_at=None,
        ),
    ]
    cal = calibration.calibrate_provider("lifi", history)
    assert cal.observations == 3
    assert cal.realized_observations == 2
    assert 0 < cal.success_rate < 1

    rejected = SimpleNamespace(provider="lifi", quoted_to_amount_usd=1002.0)
    modeled = calibration.model_candidate(rejected, cal)
    assert modeled.is_counterfactual is True
    assert modeled.modeled_realized_output_usd is not None

    # Historical replay: enough observed evidence admits both providers, and
    # the replay is evaluated at quote time so archived quotes are not stale.
    replay_history = [
        *_history("lifi", 24, fill_ratio=0.998, failures=1, latency=35),
        *_history("across", 24, fill_ratio=0.9998, failures=0, latency=10),
    ]
    calibrations = replay.build_calibrations(replay_history)
    race_rows = [
        _route("q-1", "lifi", 1000.0, selected=True, gas=2.0, fee=0.5, duration=40),
        _route("q-1", "across", 999.5, selected=False, gas=0.2, fee=0.0, duration=12),
    ]
    replayed = replay.replay_race(race_rows, calibrations, min_provider_evidence=20)
    assert replayed.modeled is True
    assert replayed.eligible_candidate_count == 2
    assert replayed.shadow_provider == "across"
    assert replayed.modeled_delta_usd is not None

    # Evidence gate: a provider with only a handful of observations must not
    # become a seemingly precise historical counterfactual.
    thin_history = [
        *_history("lifi", 24, fill_ratio=0.998),
        *_history("thin", 3, fill_ratio=1.01),
    ]
    thin_cals = replay.build_calibrations(thin_history)
    thin_race = replay.replay_race(
        [
            _route("q-2", "lifi", 1000.0, selected=True),
            _route("q-2", "thin", 1200.0, selected=False),
        ],
        thin_cals,
        min_provider_evidence=20,
    )
    assert "thin" in thin_race.insufficient_evidence_providers
    assert thin_race.eligible_candidate_count == 1
    assert thin_race.shadow_provider == "lifi"

    summary = replay.summarize_replay([replayed, thin_race], calibrations)
    payload = summary.to_dict()
    assert payload["modeled"] is True
    assert "counterfactual" in payload["caveat"]
    assert summary.races == 2

    print("execution-sync validation: PASS")


if __name__ == "__main__":
    main()
