#!/usr/bin/env python3
"""Refuse a locked dependency published in the last week.

A compromised release is usually caught fast.  The arrayref/internment incident
of 2026-08-20 had its malicious versions on crates.io for 86 to 107 minutes; the
npm incidents that motivated the same control ran to a few hours.  Waiting a week
before adopting anything costs nothing here -- nothing in this tree needs a
same-day release -- and removes the whole class.

`uv` enforces this itself, with `exclude-newer` in `pyproject.toml`, so the
Python side is decided at resolution time.  **Cargo has no equivalent.**  RFC
3923 proposes `registry.global-min-publish-age`, it was opened in February 2026
and tracks at rust-lang/cargo#17009, and as of cargo 1.96.1 it is not
implemented -- the key is absent from the config reference and setting
`CARGO_REGISTRY_GLOBAL_MIN_PUBLISH_AGE` is silently ignored.  So this checks the
lockfile after the fact instead.

Deliberately stdlib-only.  The alternative was a cargo plugin, and installing a
third-party binary to defend against third-party code is a poor trade.

Both lockfiles are checked, not just Cargo's: `exclude-newer` governs *new*
resolutions, and this says whether what is committed today still satisfies the
rule -- which is the question CI actually wants answered.

    uv run python scripts/check_dependency_age.py            # 7 days
    uv run python scripts/check_dependency_age.py --days 14
    uv run python scripts/check_dependency_age.py --rust     # one ecosystem

Exits non-zero if anything is too young, so it can gate a merge.  Network
failures are reported and do *not* pass silently: an unknown age is not a safe
age.
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
# crates.io asks for a descriptive agent with a contact; PyPI is happy with one
# too, and the default urllib agent is refused often enough to be worth setting.
AGENT = "electric-router-dependency-age-check (github.com/curvefi)"
TIMEOUT_S = 20


def fetch(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
        return json.loads(response.read())


def cargo_locked(path: Path) -> list[tuple[str, str]]:
    """`(name, version)` for every crate that comes from a registry.

    Path and git dependencies have no publish date to check -- ours is the
    workspace crate itself -- and are the caller's own code either way.
    """
    blocks = re.findall(r"\[\[package\]\]\n((?:[a-z]+ = .*\n)+)", path.read_text())
    out = []
    for block in blocks:
        fields = dict(re.findall(r'([a-z]+) = "([^"]*)"', block))
        if "source" not in fields:
            continue  # the local crate
        out.append((fields["name"], fields["version"]))
    return out


def uv_locked(path: Path) -> list[tuple[str, str]]:
    """`(name, version)` for every package that comes from a registry.

    Anchored on the package's *own* `source` line.  Matching "registry"
    anywhere in the block catches the workspace package too, because its
    `dependencies` list spells out a registry for each entry -- which asked PyPI
    about `electric-router` and got a 404.
    """
    out = []
    for block in path.read_text().split("[[package]]"):
        name = re.search(r'^name = "([^"]+)"', block, re.M)
        version = re.search(r'^version = "([^"]+)"', block, re.M)
        source = re.search(r"^source = \{ (\w+)", block, re.M)
        if name and version and source and source.group(1) == "registry":
            out.append((name.group(1), version.group(1)))
    return out


def crates_io_published(name: str, version: str) -> datetime:
    got = fetch(f"https://crates.io/api/v1/crates/{name}/{version}")
    return datetime.fromisoformat(got["version"]["created_at"])


def pypi_published(name: str, version: str) -> datetime:
    got = fetch(f"https://pypi.org/pypi/{name}/{version}/json")
    stamps = [file["upload_time_iso_8601"] for file in got.get("urls", [])]
    if not stamps:
        raise LookupError("no files listed")
    # The earliest artifact: that is when the version became installable.
    return min(datetime.fromisoformat(s.replace("Z", "+00:00")) for s in stamps)


def check(label: str, packages, published, cutoff: datetime) -> tuple[int, int]:
    young, unknown = [], []
    for name, version in packages:
        try:
            when = published(name, version)
        except (urllib.error.URLError, urllib.error.HTTPError, LookupError,
                KeyError, ValueError, TimeoutError) as exc:
            unknown.append((name, version, f"{type(exc).__name__}: {str(exc)[:44]}"))
            continue
        if when > cutoff:
            young.append((name, version, when))
    print(f"\n  {label}: {len(packages)} locked, {len(young)} younger than the "
          f"window, {len(unknown)} could not be dated")
    for name, version, when in sorted(young, key=lambda row: row[2], reverse=True):
        age = datetime.now(UTC) - when
        print(f"    TOO YOUNG  {name} {version}  published "
              f"{when:%Y-%m-%d %H:%M}Z ({age.days}d {age.seconds // 3600}h ago)")
    for name, version, why in unknown:
        print(f"    UNKNOWN    {name} {version}  {why}")
    return len(young), len(unknown)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=7,
                        help="minimum age, in days, of any locked dependency")
    parser.add_argument("--rust", action="store_true", help="only rust/Cargo.lock")
    parser.add_argument("--python", action="store_true", help="only uv.lock")
    args = parser.parse_args()

    cutoff = datetime.now(UTC) - timedelta(days=args.days)
    print(f"  nothing published after {cutoff:%Y-%m-%d %H:%M}Z "
          f"(the last {args.days} days) may be locked")

    both = not (args.rust or args.python)
    young = unknown = 0
    if both or args.rust:
        got = check("rust/Cargo.lock", cargo_locked(REPO / "rust/Cargo.lock"),
                    crates_io_published, cutoff)
        young, unknown = young + got[0], unknown + got[1]
    if both or args.python:
        got = check("uv.lock", uv_locked(REPO / "uv.lock"), pypi_published, cutoff)
        young, unknown = young + got[0], unknown + got[1]

    if young:
        print(f"\n  {young} dependency(s) inside the {args.days}-day window. "
              f"Wait, or justify each one explicitly.")
    if unknown:
        print(f"\n  {unknown} could not be dated -- an unknown age is not a safe "
              f"age, so this fails too.")
    if not young and not unknown:
        print(f"\n  all locked dependencies are at least {args.days} days old")
    return 1 if (young or unknown) else 0


if __name__ == "__main__":
    raise SystemExit(main())
