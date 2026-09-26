#!/usr/bin/env python3
"""Map changed repository paths to the CI lanes that must run.

The workflow itself always starts and finishes with one stable gate.  This
script only decides which expensive jobs are relevant; it deliberately fails
open (all lanes) when a diff cannot be calculated.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import subprocess
import sys
from collections.abc import Iterable

DOMAINS = (
    "python",
    "api_ts",
    "terminal",
    "mobile",
    "showcase",
    "migration",
    "docs",
    "sdk",
    "webapp",
    "dependencies",
)

GLOBAL_PATTERNS = (
    ".github/workflows/test.yml",
    "scripts/ci_changed_domains.py",
    "tests/test_ci_changed_domains.py",
)

DOMAIN_PATTERNS = {
    "python": (
        "api/**",
        "bot/**",
        "database/**",
        "tests/**",
        "requirements*.txt",
        "pyproject.toml",
        "uv.lock",
        ".env.schema",
        "capabilities.yaml",
        "scripts/check_env_schema.py",
    ),
    "api_ts": ("api-ts/**",),
    "terminal": ("terminal/**", "packages/design-tokens/**"),
    "mobile": ("mobile/**", "packages/design-tokens/**"),
    "showcase": (
        "showcase/**",
        "packages/design-tokens/**",
        "bot/config/chains.py",
        "bot/services/swap_engine.py",
        "api-ts/src/services/TokenService.ts",
        "api-ts/src/routes/agent.ts",
        "api-ts/src/routes/mcpTools.ts",
    ),
    "migration": ("api-ts/drizzle/**", "database/**", "bot/models/**"),
    "docs": (
        "docs/**",
        "gitbook/**",
        "scripts/check_docs_drift.py",
        "showcase/scripts/regen-docs.mjs",
        "showcase/scripts/gen-llms.mjs",
        "showcase/scripts/check-doc-contract.mjs",
    ),
    "sdk": (
        "packages/sdk/**",
        "packages/sdk-python/**",
        "packages/openclaw/**",
        "packages/mcp-server/**",
        "scripts/verify-ts-packages.sh",
    ),
    "webapp": ("webapp/**", "packages/design-tokens/**"),
    "dependencies": (
        "requirements*.txt",
        "pyproject.toml",
        "uv.lock",
        "**/package.json",
        "**/package-lock.json",
        "**/bun.lock",
    ),
}


def _matches(path: str, patterns: Iterable[str]) -> bool:
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)


def domains_for_paths(paths: Iterable[str], *, force_all: bool = False) -> dict[str, bool]:
    normalized = tuple(
        cleaned[2:] if cleaned.startswith("./") else cleaned
        for path in paths
        if (cleaned := path.strip())
    )
    if force_all or any(_matches(path, GLOBAL_PATTERNS) for path in normalized):
        return {domain: True for domain in DOMAINS}

    return {
        domain: any(_matches(path, DOMAIN_PATTERNS[domain]) for path in normalized)
        for domain in DOMAINS
    }


def git_changed_paths(base: str, head: str) -> list[str]:
    if not base or set(base) == {"0"}:
        raise ValueError("no usable base commit")

    result = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=ACMRD", base, head],
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in result.stdout.splitlines() if line]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base")
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--path", action="append", default=[])
    parser.add_argument("--all", action="store_true", dest="force_all")
    parser.add_argument("--format", choices=("github", "json"), default="github")
    args = parser.parse_args()

    force_all = args.force_all
    paths = args.path
    if not paths and not force_all:
        try:
            paths = git_changed_paths(args.base or "", args.head)
        except (ValueError, subprocess.CalledProcessError) as exc:
            print(f"warning: cannot calculate diff ({exc}); running every CI lane", file=sys.stderr)
            force_all = True

    result = domains_for_paths(paths, force_all=force_all)
    if args.format == "json":
        print(json.dumps({"paths": paths, "domains": result}, sort_keys=True))
    else:
        for domain in DOMAINS:
            print(f"{domain}={'true' if result[domain] else 'false'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
