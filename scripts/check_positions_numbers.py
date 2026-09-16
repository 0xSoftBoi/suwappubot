#!/usr/bin/env python3
"""Reconcile the Positions launch copy against the contract and the mint config.

Customer-facing copy drifted from the collection's renumbering (2026-08-26): the
launch narrative advertised 10,000 cards while citing the very constant that
says 4,444, quoted a Founder wallet cap of 3 against a configured cap of 1, and
promised an Enterprise fee discount that `fee_service.py` explicitly refuses to
grant. Numbers in marketing copy that cite a source must agree with that source.

Source of truth, in order:
  contracts/SuwappuPositions.sol   supply, wallet backstop, reserve
  nft/position-cards/config.json   phase allocations, caps, prices, discounts
  bot/services/fee_service.py      which tiers a card discount may touch

Run: python3 scripts/check_positions_numbers.py
Wired into: scripts/verify.sh docs
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOC = ROOT / "docs/marketing/positions-launch.md"
CFG = ROOT / "nft/position-cards/config.json"
SOL = ROOT / "contracts/SuwappuPositions.sol"
FEES = ROOT / "bot/services/fee_service.py"


def sol_const(src: str, name: str) -> int | None:
    m = re.search(rf"{name}\s*=\s*([0-9_]+)", src)
    return int(m.group(1).replace("_", "")) if m else None


def main() -> int:
    if not DOC.exists():
        print("skip: positions-launch.md not present")
        return 0
    doc = DOC.read_text()
    cfg = json.loads(CFG.read_text())
    sol = SOL.read_text()
    econ = cfg["economics"]
    phases = cfg["mint"]["phases"]

    failures: list[str] = []

    def want(label: str, needle: str, source_ok: bool = True) -> None:
        if not source_ok:
            failures.append(f"{label}: source of truth moved; update this check")
        elif needle not in doc:
            failures.append(f"{label}: expected {needle!r} in positions-launch.md")

    supply = sol_const(sol, "MAX_SUPPLY")
    want("supply", f"{supply:,}", supply == cfg["collection"]["supply"])
    want("tickers", f"| {sol_const(sol, 'TICKER_COUNT')} |")
    want("hold discount", f"{int(econ['hold_discount_fraction'] * 100)}%")
    want("gold discount", f"{int(econ['gold_discount_fraction'] * 100)}%")
    want("royalty", f"{econ['royalty_bps']} bps")
    want("reserve", f"| {sol_const(sol, 'RESERVE_MAX')} |")
    want("wallet backstop", f"| {sol_const(sol, 'MAX_PER_WALLET')} |")

    for name, ph in phases.items():
        if not isinstance(ph, dict) or "allocation" not in ph:
            continue
        cents = ph.get("price_usd_cents", 0)
        price = "free" if ph.get("free") else f"{cents}c"
        want(f"phase {name}", f"{ph['allocation']:,} / {ph['wallet_cap']} / {price}")

    # The Enterprise exclusion is a commercial promise, so the copy must not
    # advertise a discounted Enterprise rate.
    if "ENTERPRISE" in FEES.read_text() and "SubscriptionTier.ENTERPRISE" in FEES.read_text():
        if re.search(r"\|\s*Enterprise\s*\|\s*10 bps\s*\|\s*6 bps", doc):
            failures.append(
                "Enterprise: copy advertises a discounted Enterprise rate, but "
                "fee_service.py excludes ENTERPRISE from both perks"
            )

    # Nothing from the superseded numbering may survive.
    for stale in ("10,000 position", "| 10,000 |", "1,500 / 3", "4,300 / 5"):
        if stale in doc:
            failures.append(f"stale pre-renumbering value still present: {stale!r}")

    if failures:
        print("✗ Positions launch copy disagrees with source:")
        for f in failures:
            print(f"  - {f}")
        print("  Fix the copy, or update this check if the source genuinely moved.")
        return 1
    print(f"✓ Positions launch copy reconciles with contract + config ({supply:,} cards)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
