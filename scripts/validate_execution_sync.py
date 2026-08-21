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

    # Public/production repo already persists realized_to_amount_usd. The
    # receipt layer must distinguish it from quote-time to_amount_usd.
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

    print("execution-sync validation: PASS")


if __name__ == "__main__":
    main()
