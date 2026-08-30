#!/usr/bin/env python3
"""Drift gate: docs/reference/contracts.json vs the fee/referral code it documents.

The public contracts reference (docs/reference/production-contracts.md and the
gitbook Contracts section) is generated from the same facts as contracts.json,
so this script keeps the whole chain honest: if a fee constant changes in
bot/services/fee_service.py or bot/services/referral_service.py without the
reference being updated, `scripts/verify.sh docs` fails.

Constants are read via AST so nothing from bot/ is imported (no settings/db).
"""

import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REF = ROOT / "docs" / "reference" / "contracts.json"


def module_constants(path: Path) -> dict:
    """Top-level `NAME = <literal>` assignments, best-effort literal eval."""
    tree = ast.parse(path.read_text())
    out = {}
    for node in tree.body:
        targets = []
        if isinstance(node, ast.Assign):
            targets, value = node.targets, node.value
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets, value = [node.target], node.value
        else:
            continue
        for t in targets:
            if isinstance(t, ast.Name):
                try:
                    out[t.id] = ast.literal_eval(value)
                except ValueError:
                    # Non-literal (Decimal(...), enum-keyed dict, etc.) — walk it.
                    try:
                        out[t.id] = _eval_loose(value)
                    except ValueError:
                        pass
    return out


def _eval_loose(node):
    """Evaluate literals plus Decimal("...") calls and enum-attribute dict keys."""
    if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "Decimal":
        return float(_eval_loose(node.args[0]))
    if isinstance(node, ast.Dict):
        return {_key(k): _eval_loose(v) for k, v in zip(node.keys, node.values)}
    if isinstance(node, (ast.List, ast.Tuple)):
        vals = [_eval_loose(e) for e in node.elts]
        return tuple(vals) if isinstance(node, ast.Tuple) else vals
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
        return _eval_loose(node.left) / _eval_loose(node.right)
    return ast.literal_eval(node)


def _key(node):
    if isinstance(node, ast.Attribute):  # SubscriptionTier.FREE -> "free"
        return node.attr.lower()
    return ast.literal_eval(node)


def main() -> int:
    ref = json.loads(REF.read_text())
    fee = module_constants(ROOT / "bot" / "services" / "fee_service.py")
    referral = module_constants(ROOT / "bot" / "services" / "referral_service.py")
    errors = []

    def check(label, documented, actual):
        if documented != actual:
            errors.append(f"{label}: contracts.json says {documented!r}, code says {actual!r}")

    tiers_bps = {t: round(r * 10000) for t, r in fee["TIER_FEE_RATES"].items()}
    check("fees.swap_tiers_bps", ref["fees"]["swap_tiers_bps"], tiers_bps)
    check(
        "fees.absolute_floor_bps",
        ref["fees"]["absolute_floor_bps"],
        round(fee["ABSOLUTE_FLOOR"] * 10000),
    )
    check(
        "fees.points_discount_max_fraction_of_tier",
        ref["fees"]["points_discount_max_fraction_of_tier"],
        fee["MAX_POINTS_DISCOUNT_FRACTION"],
    )
    # MIN_EFFECTIVE_FEE_RATE is defined as TIER_FEE_RATES[ENTERPRISE] in code.
    check(
        "fees.points_discount_floor_bps",
        ref["fees"]["points_discount_floor_bps"],
        tiers_bps["enterprise"],
    )
    check("fees.swap_min_usd", ref["fees"]["swap_min_usd"], fee["MIN_SWAP_USD"])
    check("fees.swap_max_usd", ref["fees"]["swap_max_usd"], fee["MAX_SWAP_USD"])

    check(
        "fee_sharing.swap_commission_fraction.standard",
        ref["fee_sharing"]["swap_commission_fraction"]["standard"],
        fee["REFERRAL_REWARD_PERCENTAGE"] / 100,
    )
    # Perps tiers: code stores (threshold, rate) descending; snapshot stores
    # ascending rows. Compare the rate ladder and thresholds.
    code_tiers = sorted(referral["PERPS_TIERS"])  # ascending by threshold
    doc_rows = ref["fee_sharing"]["perps_commission_tiers"]
    doc_ladder = [row["fraction_of_builder_fee"] for row in doc_rows]
    check("fee_sharing.perps rate ladder", doc_ladder, [r for _, r in code_tiers])
    # Each doc row's upper bound ("lt") is the NEXT code tier's floor; the last
    # row's "gte" equals the top tier's own floor.
    doc_thresholds = [
        row.get("referee_volume_14d_usd_lt", row.get("referee_volume_14d_usd_gte"))
        for row in doc_rows
    ]
    check(
        "fee_sharing.perps thresholds",
        doc_thresholds,
        [t for t, _ in code_tiers[1:]] + [code_tiers[-1][0]],
    )
    check(
        "fee_sharing.milestone_bonuses_usd",
        {int(k): v for k, v in ref["fee_sharing"]["milestone_bonuses_usd"].items()},
        referral["MILESTONE_BONUSES"],
    )

    # Address consistency: every address in the snapshot must appear verbatim in
    # both the reference markdown and the gitbook page (catches half-updated docs).
    md = (ROOT / "docs" / "reference" / "production-contracts.md").read_text()
    gb = (ROOT / "gitbook" / "contracts" / "README.md").read_text()
    net = ref["networks"]["base-sepolia"]
    for name, addr in {**net["contracts"], **net["external"]}.items():
        for doc_name, text in [
            ("production-contracts.md", md),
            ("gitbook/contracts/README.md", gb),
        ]:
            if addr not in text:
                errors.append(f"address {name} ({addr}) missing from {doc_name}")

    if errors:
        print("Contracts reference drift detected:")
        for e in errors:
            print(f"  ✗ {e}")
        return 1
    print(
        f"✓ contracts reference in sync ({len(tiers_bps)} tiers, "
        f"{len(doc_rows)} perps tiers, {len(net['contracts']) + len(net['external'])} addresses)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
