#!/usr/bin/env python3
"""Verify that marketing-site API claims match the real agent API.

Why this exists: /solutions shipped four fabricated code examples at once
(a header name that existed nowhere in the codebase, a query param that was
never read, a response field that was never returned, and a status value that
was not in the enum). The docs were correct the whole time; only the
hand-typed marketing snippets had drifted.

This checks every `/v1/agent/...` path and query parameter mentioned anywhere
in the showcase site against `api-ts/openapi-agent.json`, which `verify.sh`
already drift-checks against the Zod validators that actually run. So the
chain is: Zod validators -> OpenAPI spec -> marketing copy.

Usage: python3 scripts/check-marketing-claims.py
Exit 0 = clean, 1 = violations found.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "api-ts" / "openapi-agent.json"
SCAN_ROOTS = [ROOT / "showcase" / "src"]
SCAN_SUFFIXES = {".tsx", ".ts", ".json", ".mdx", ".md"}

# Paths referenced in prose that the agent OpenAPI spec does not cover.
# Keep this list short and justified; it is an escape hatch, not a dumping ground.
PATH_ALLOWLIST = {
    "/v1/agent",  # bare prefix mentions, e.g. "routes under /v1/agent/*"
    # Real routes (api-ts/src/routes/agent.ts:3891, :4104) that are MISSING from
    # openapi-agent.json. Drift in the other direction; the spec should gain them.
    "/v1/agent/billing/subscribe",
    "/v1/agent/billing/recurring",
}

# Substrings that are known-false claims. Each entry is (needle, why).
BANNED = [
    ("X-Payment:", "no such header exists; real ones are X-Payment-Required and x-402"),
    ("?tokens=", "the prices endpoint takes ?symbols=, not ?tokens="),
    ('"wallet_id"', "POST /v1/agent/wallets returns a nested `wallet` object, not wallet_id"),
    ('"filled"', 'not a swap status; real terminal values include "completed" and "failed"'),
    ("allowed_pairs", "wallet policies whitelist addresses, not trading pairs"),
    ("max_spend_usd", "spending_limit policies take maxAmountWei and timeWindowSeconds"),
]

URL_RE = re.compile(r"(?:https?://[a-z0-9.\-]*suwappu\.bot)?(/v1/agent[A-Za-z0-9/_\-{}]*)(\?[A-Za-z0-9_=,\-&%{}\.]*)?")


def load_spec() -> tuple[set[str], dict[str, set[str]]]:
    """Return (known paths, path -> allowed query param names)."""
    data = json.loads(SPEC.read_text())
    paths: set[str] = set()
    params: dict[str, set[str]] = {}
    for raw, methods in data.get("paths", {}).items():
        full = "/v1/agent" + raw
        paths.add(full)
        names: set[str] = set()
        for spec in methods.values():
            if not isinstance(spec, dict):
                continue
            for p in spec.get("parameters", []) or []:
                if p.get("in") == "query" and p.get("name"):
                    names.add(p["name"])
        params[full] = names
    return paths, params


def matches_template(candidate: str, known: set[str]) -> str | None:
    """Match a path against the spec, allowing {param} segments.

    Also accepts a candidate that is a strict prefix of a known route, because
    prose and code often write the id in a form the URL regex cannot capture
    (`/swap/status/:id`, `/predict/market/<id>`). Those still prove the route
    family exists, which is what we care about.
    """
    cand = candidate.strip("/").split("/")
    for tmpl in known:
        parts = tmpl.strip("/").split("/")
        if len(parts) != len(cand):
            continue
        if all(p.startswith("{") or p == c for p, c in zip(parts, cand)):
            return tmpl
    for tmpl in known:
        parts = tmpl.strip("/").split("/")
        if len(parts) > len(cand) and all(
            p.startswith("{") or p == c for p, c in zip(parts[: len(cand)], cand)
        ):
            return tmpl
    return None


def scan_files() -> list[Path]:
    out: list[Path] = []
    for root in SCAN_ROOTS:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if p.is_file() and p.suffix in SCAN_SUFFIXES:
                out.append(p)
    return out


def main() -> int:
    if not SPEC.exists():
        print(f"✗ Missing {SPEC.relative_to(ROOT)} — run (cd api-ts && bun run generate:openapi)")
        return 1

    known, allowed_params = load_spec()
    violations: list[str] = []
    checked = 0

    for path in scan_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        rel = path.relative_to(ROOT)

        for lineno, line in enumerate(text.splitlines(), 1):
            for needle, why in BANNED:
                if needle in line:
                    violations.append(f"{rel}:{lineno}  banned claim {needle!r} — {why}")

            for m in URL_RE.finditer(line):
                route, query = m.group(1), m.group(2)
                route = route.rstrip("/")
                if route in PATH_ALLOWLIST:
                    continue
                checked += 1

                resolved = route if route in known else matches_template(route, known)
                if resolved is None:
                    violations.append(
                        f"{rel}:{lineno}  unknown route {route!r} — not in openapi-agent.json"
                    )
                    continue

                if query and len(query) > 1:
                    for pair in query[1:].split("&"):
                        name = pair.split("=", 1)[0]
                        if not name or name.startswith("{"):
                            continue
                        if name not in allowed_params.get(resolved, set()):
                            ok = sorted(allowed_params.get(resolved, set())) or ["(none)"]
                            violations.append(
                                f"{rel}:{lineno}  {resolved} has no query param {name!r}"
                                f" — accepts: {', '.join(ok)}"
                            )

    if violations:
        print(f"✗ Marketing copy disagrees with the agent API ({len(violations)} issue(s)):\n")
        for v in violations:
            print(f"  {v}")
        print("\n  Fix the copy, or regenerate the spec if the API genuinely changed.")
        return 1

    print(f"✓ Marketing API claims OK ({checked} route reference(s) checked against openapi-agent.json)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
