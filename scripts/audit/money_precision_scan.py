"""Float-money and atomic-state scanner (W1.4 + W2.1).

Two correctness classes, both from the Tektonic study (docs/plans/tektonic-blog-study.md):

**Float money (W1.4).** A perp clearinghouse keeps money in fixed point. Suwappu keeps
it in ``Float`` columns and does arithmetic on those floats. Every such site is a place
where a fee schedule that reads as 1.00% charges something else, and where a replay
cannot reconcile because the ledger itself is not reproducible. The fix is
``bot/utils/money``: accumulate in ``Decimal``, round once at the published precision.

**Atomic state (W2.1).** Tektonic counted a payment only when the chain said it
succeeded - ``tx.err = ''`` on Solana, ``receipt_status = 1`` on Base - giving "exactly
0.00% inflation from reverted or failed executions". Our analogue is a status check
before a swap contributes to volume, fees, points, or revenue. An aggregate over
``swap_transactions`` with no status predicate counts swaps that never settled.

This is a linter, not a proof: it reports candidate sites ranked by how much they look
like money, and it is deliberately noisy in the direction of reporting too much. Run it,
read it, fix the real ones.

    python3 scripts/audit/money_precision_scan.py
    python3 scripts/audit/money_precision_scan.py --json .audit/money-precision.json
    python3 scripts/audit/money_precision_scan.py --class atomic-state
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re

from dataclasses import asdict, dataclass
from typing import Iterable, Iterator, Optional

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Column/identifier names that denote money. Kept narrow on purpose: "amount" alone is
# too broad (it matches point awards and slippage bps), so it only counts when paired
# with a currency-ish qualifier.
MONEY_TOKENS = (
    "fee_amount",
    "fee_amount_usd",
    "fee_percentage",
    "fee_usd",
    "amount_usd",
    "swap_amount",
    "volume_usd",
    "total_fees_usd",
    "total_volume_usd",
    "notional",
    "notional_usd",
    "price_usd",
    "usd_value",
    "balance_usd",
    "gas_fee",
    "bridge_fee",
    "commission_rate",
    "payout_usd",
    "earned_usd",
    "revenue_usd",
    "cost_usd",
    "principal",
    "collateral_usd",
)

_MONEY_RE = re.compile("|".join(re.escape(t) for t in MONEY_TOKENS))

# Tables whose rows only count when the underlying execution actually succeeded.
STATUS_GATED_TABLES = {
    "swap_transactions": "status",
    "fee_transactions": "collected",
    "bridge_transfers": "status",
    "btc_swaps": "status",
    "cctp_deposits": "status",
}

SUCCESS_MARKERS = (
    "completed",
    "success",
    "confirmed",
    "settled",
    "SwapStatus.COMPLETED",
    "TERMINAL_SUCCESS",
    "receipt_status",
    "tx.err",
)

AGGREGATE_RE = re.compile(r"\b(SUM|COUNT|AVG|TOTAL)\s*\(", re.IGNORECASE)

SKIP_DIRS = {
    ".git",
    "node_modules",
    "__pycache__",
    ".next",
    "dist",
    "build",
    ".venv",
    "venv",
    "sbom",
    "gitbook",
    "docs",
    "tests",
}


@dataclass
class Finding:
    file: str
    line: int
    finding_class: str
    severity: str
    title: str
    snippet: str
    why: str
    fix: str
    confidence: str = "medium"


# --- W1.4: float money ----------------------------------------------------------------


class FloatMoneyVisitor(ast.NodeVisitor):
    """Flags ``Column(..., Float)`` on money-named columns and float math on money."""

    def __init__(self, path: str, source: str) -> None:
        self.path = path
        self.lines = source.splitlines()
        self.findings: list[Finding] = []

    def _snippet(self, node: ast.AST) -> str:
        i = getattr(node, "lineno", 1) - 1
        return self.lines[i].strip()[:160] if 0 <= i < len(self.lines) else ""

    def visit_Assign(self, node: ast.Assign) -> None:
        target = node.targets[0] if node.targets else None
        name = getattr(target, "id", None) or getattr(target, "attr", None) or ""
        if _MONEY_RE.search(name) and isinstance(node.value, ast.Call):
            func = node.value.func
            fname = getattr(func, "id", None) or getattr(func, "attr", None)
            if fname == "Column":
                for arg in node.value.args:
                    arg_name = getattr(arg, "id", None) or getattr(arg, "attr", None)
                    if arg_name == "Float":
                        self.findings.append(
                            Finding(
                                file=self.path,
                                line=node.lineno,
                                finding_class="float-money-column",
                                severity="high",
                                title=f"money column {name!r} stored as Float",
                                snippet=self._snippet(node),
                                why=(
                                    "IEEE-754 cannot represent most decimal money values "
                                    "exactly, so stored totals drift from the sum of their "
                                    "parts and a replay can never reconcile to zero."
                                ),
                                fix=(
                                    "Numeric(38, 18) for new columns. For existing ones, "
                                    "quantize through bot.utils.money at every write so the "
                                    "stored value is at least the published precision."
                                ),
                                confidence="high",
                            )
                        )
        self.generic_visit(node)

    def visit_BinOp(self, node: ast.BinOp) -> None:
        if isinstance(node.op, (ast.Mult, ast.Div, ast.Add, ast.Sub)):
            text = ast.unparse(node) if hasattr(ast, "unparse") else ""
            if _MONEY_RE.search(text) and "Decimal" not in text and "money." not in text:
                # Division by a literal 100 is the classic percentage bug.
                pct = isinstance(node.op, ast.Div) and _is_hundred(node.right)
                self.findings.append(
                    Finding(
                        file=self.path,
                        line=node.lineno,
                        finding_class="float-money-arithmetic",
                        severity="high" if pct else "medium",
                        title=(
                            "percentage math on money in float"
                            if pct
                            else "arithmetic on a money value outside Decimal"
                        ),
                        snippet=self._snippet(node),
                        why=(
                            "Rounding at each step accumulates a directional error; a 1.00% "
                            "fee schedule stops charging 1.00%."
                        ),
                        fix=(
                            "bot.utils.money.apply_rate(amount, pct_to_rate(pct)) - one "
                            "rounding, half-to-even, at the published precision."
                        ),
                        confidence="medium" if pct else "low",
                    )
                )
        self.generic_visit(node)


def _is_hundred(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and node.value in (100, 100.0)


# --- W2.1: atomic state ---------------------------------------------------------------


def scan_atomic_state(path: str, source: str) -> Iterator[Finding]:
    """Flag aggregates over execution tables with no success predicate.

    Heuristic and intentionally conservative in scope: it only looks at statements that
    both aggregate and name a status-gated table, then asks whether any success marker
    appears in the same statement.
    """
    lines = source.splitlines()
    for table, status_column in STATUS_GATED_TABLES.items():
        for match in re.finditer(rf"\b{re.escape(table)}\b", source):
            line_no = source[: match.start()].count("\n") + 1
            # A statement-ish window: the SQL string or expression around the match.
            window = "\n".join(lines[max(0, line_no - 8) : line_no + 8])
            if not AGGREGATE_RE.search(window):
                continue
            if any(marker in window for marker in SUCCESS_MARKERS):
                continue
            if status_column in window:
                continue
            yield Finding(
                file=path,
                line=line_no,
                finding_class="atomic-state",
                severity="high",
                title=f"aggregate over {table} with no success predicate",
                snippet=lines[line_no - 1].strip()[:160] if line_no <= len(lines) else "",
                why=(
                    "Pending, failed and cancelled rows are counted as if money moved. "
                    "Tektonic's institutional constraint is that only atomically "
                    "successful executions contribute to volume - anything else is "
                    "inflation in a number someone reports."
                ),
                fix=(
                    f"Filter on {table}.{status_column} at extraction time, not at query "
                    "time, so a caller cannot forget it. See "
                    "scripts/replay/canonical.py TERMINAL_SUCCESS_STATUSES."
                ),
                confidence="low",
            )


# --- driver ---------------------------------------------------------------------------


def iter_python_files(roots: Iterable[str]) -> Iterator[str]:
    for root in roots:
        base = os.path.join(REPO_ROOT, root)
        if os.path.isfile(base):
            yield base
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
            for name in filenames:
                if name.endswith(".py"):
                    yield os.path.join(dirpath, name)


def scan(roots: Iterable[str], classes: Optional[set[str]] = None) -> list[Finding]:
    findings: list[Finding] = []
    for path in iter_python_files(roots):
        rel = os.path.relpath(path, REPO_ROOT)
        try:
            source = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue

        if classes is None or {"float-money-column", "float-money-arithmetic"} & classes:
            try:
                tree = ast.parse(source)
            except SyntaxError:
                continue
            visitor = FloatMoneyVisitor(rel, source)
            visitor.visit(tree)
            findings.extend(visitor.findings)

        if classes is None or "atomic-state" in classes:
            findings.extend(scan_atomic_state(rel, source))

    if classes:
        findings = [f for f in findings if f.finding_class in classes]

    severity_rank = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda f: (severity_rank.get(f.severity, 9), f.file, f.line))
    return findings


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--roots", nargs="*", default=["bot", "api", "database", "scripts"])
    p.add_argument(
        "--class",
        dest="classes",
        nargs="*",
        choices=["float-money-column", "float-money-arithmetic", "atomic-state"],
    )
    p.add_argument("--json", dest="json_path")
    p.add_argument("--limit", type=int, default=40)
    args = p.parse_args(argv)

    findings = scan(args.roots, set(args.classes) if args.classes else None)

    by_class: dict[str, int] = {}
    for f in findings:
        by_class[f.finding_class] = by_class.get(f.finding_class, 0) + 1

    print(f"{len(findings)} candidate sites across {', '.join(args.roots)}")
    for name, count in sorted(by_class.items(), key=lambda kv: -kv[1]):
        print(f"  {count:5d}  {name}")
    print()

    for f in findings[: args.limit]:
        print(f"[{f.severity}] {f.file}:{f.line}  {f.title}")
        print(f"         {f.snippet}")
    if len(findings) > args.limit:
        print(f"... {len(findings) - args.limit} more (use --json for the full set)")

    if args.json_path:
        os.makedirs(os.path.dirname(os.path.abspath(args.json_path)), exist_ok=True)
        with open(args.json_path, "w") as fh:
            json.dump([asdict(f) for f in findings], fh, indent=2)
        print(f"\nwritten to {args.json_path}")

    # Always exit 0: this is a report, not a gate. Gating on a heuristic linter with
    # known false positives trains people to ignore it.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
