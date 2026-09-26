#!/usr/bin/env python3
"""
env_parity.py — compare environment variable NAMES (never values) between
the repo's env schema (.env.schema) and a live Railway service.

Usage:
    python3 scripts/env_parity.py --service api-ts|python-api|python-worker --env production|dev

Source of truth for required var names is .env.schema at repo root
(generated from bot/config/settings.py + api-ts/src/config/EnvService.ts).
python-api and python-worker both run the Python monolith, so they are
checked against the `python-bot` schema section.

Railway side is read via:
    bunx @railway/cli variables --service <service> --environment <env> --kv

Only variable NAMES are ever printed for the general comparison. The only
values ever read are HACKATHON_TRUST_LAYER and WORLD_ENV, for the hackathon
gate check below — no other values are read or printed.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / ".env.schema"

SERVICE_TO_SCHEMA = {
    "api-ts": "api-ts",
    "python-api": "python-bot",
    "python-worker": "python-bot",
}

HACKATHON_REQUIRED = ["WORLD_APP_ID", "WORLD_RP_ID", "RP_SIGNING_KEY"]


def parse_schema(schema_service: str) -> tuple[set[str], set[str]]:
    """Return (required_names, all_names) for the given schema service tag."""
    required: set[str] = set()
    all_names: set[str] = set()
    if not SCHEMA_PATH.exists():
        print(f"ERROR: {SCHEMA_PATH} not found", file=sys.stderr)
        sys.exit(1)

    lines = SCHEMA_PATH.read_text().splitlines()
    pending_required = False
    pending_service = None
    for line in lines:
        m = re.match(r"^#\s*(@required|@optional).*@service=([a-zA-Z-]+)", line)
        if m:
            pending_required = m.group(1) == "@required"
            pending_service = m.group(2)
            continue
        if pending_service and re.match(r"^[A-Z0-9_]+=", line):
            name = line.split("=", 1)[0]
            if pending_service == schema_service:
                all_names.add(name)
                if pending_required:
                    required.add(name)
            pending_service = None
            pending_required = False
    return required, all_names


def get_railway_names(service: str, env: str) -> set[str]:
    bun_bin = str(Path.home() / ".bun" / "bin")
    path = os.environ.get("PATH", "")
    if bun_bin not in path:
        path = f"{bun_bin}:{path}"
    env_vars = dict(os.environ, PATH=path)

    cmd = ["bunx", "@railway/cli", "variables", "--service", service, "--environment", env, "--kv"]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, env=env_vars, timeout=60, check=False
        )
    except FileNotFoundError as e:
        print(f"ERROR: could not run bunx/@railway/cli: {e}", file=sys.stderr)
        sys.exit(1)

    if result.returncode != 0:
        print(f"ERROR: railway variables failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)

    names = set()
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line or "=" not in line:
            continue
        names.add(line.split("=", 1)[0])
    return names


def get_railway_value(service: str, env: str, var_name: str) -> str | None:
    """Read a single var's value (only used for the hackathon flag check)."""
    bun_bin = str(Path.home() / ".bun" / "bin")
    path = os.environ.get("PATH", "")
    if bun_bin not in path:
        path = f"{bun_bin}:{path}"
    env_vars = dict(os.environ, PATH=path)

    cmd = ["bunx", "@railway/cli", "variables", "--service", service, "--environment", env, "--kv"]
    result = subprocess.run(
        cmd, capture_output=True, text=True, env=env_vars, timeout=60, check=False
    )
    if result.returncode != 0:
        return None
    for line in result.stdout.splitlines():
        line = line.strip()
        if line.startswith(f"{var_name}="):
            return line.split("=", 1)[1]
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--service", required=True, choices=["api-ts", "python-api", "python-worker"]
    )
    parser.add_argument("--env", required=True, choices=["production", "dev"])
    args = parser.parse_args()

    schema_service = SERVICE_TO_SCHEMA[args.service]
    required, all_known = parse_schema(schema_service)
    railway_names = get_railway_names(args.service, args.env)

    missing_required = sorted(required - railway_names)
    unknown_present = sorted(railway_names - all_known)

    print(f"== env_parity: service={args.service} env={args.env} schema={schema_service} ==\n")

    print(f"REQUIRED BUT MISSING in Railway ({len(missing_required)}):")
    for name in missing_required:
        print(f"  - {name}")
    if not missing_required:
        print("  (none)")
    print()

    print(f"PRESENT in Railway but unknown to schema, informational ({len(unknown_present)}):")
    for name in unknown_present:
        print(f"  - {name}")
    if not unknown_present:
        print("  (none)")
    print()

    exit_code = 0
    if missing_required:
        exit_code = 1

    # Hackathon trust-layer gate check
    trust_layer = get_railway_value(args.service, args.env, "HACKATHON_TRUST_LAYER")
    if trust_layer and trust_layer.strip().lower() in ("1", "true", "yes", "on"):
        print("HACKATHON_TRUST_LAYER is enabled — checking World ID trust vars:")
        missing_hackathon = [n for n in HACKATHON_REQUIRED if n not in railway_names]
        for name in missing_hackathon:
            print(f"  MISSING: {name}")
        if missing_hackathon:
            exit_code = 1
        else:
            print("  (all present)")

        world_env = get_railway_value(args.service, args.env, "WORLD_ENV")
        if world_env and world_env.strip().lower() == "staging":
            if "WORLD_STAGING_VERIFICATION_TOKEN" not in railway_names:
                print(
                    "  WARNING: WORLD_ENV=staging but WORLD_STAGING_VERIFICATION_TOKEN is not set"
                )
        print()

    if exit_code:
        print("FAIL: required variable(s) missing.")
    else:
        print("OK: all required variables present.")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
