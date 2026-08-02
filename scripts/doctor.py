#!/usr/bin/env python3
"""Suwappu doctor — one command to sanity-check a local dev environment.

Prints:
  1. Toolchain            — python3/bun/node/docker present + version.
  2. Repo layout           — key directories exist where code expects them.
  3. Env contract          — delegates to scripts/check_env_schema.py (check mode).
  4. Capabilities          — per-entry in capabilities.yaml, SET/UNSET for each
                              env var. NEVER prints values, only presence.

Usage:
    python3 scripts/doctor.py            # always exits 0 (report-only)
    python3 scripts/doctor.py --strict   # exit 1 if any check fails

Only uses the standard library. Tries `import yaml` to parse capabilities.yaml
(PyYAML is already a project dependency — see requirements.txt) and falls back
to a small built-in parser for the subset of YAML this repo's capabilities.yaml
uses, so doctor.py still runs in an environment where deps aren't installed yet.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
CAPABILITIES_PATH = REPO_ROOT / "capabilities.yaml"
CHECK_ENV_SCHEMA = REPO_ROOT / "scripts" / "check_env_schema.py"

KEY_DIRS = [
    "bot",
    "bot/handlers",
    "bot/services",
    "bot/models",
    "bot/config",
    "bot/utils",
    "api",
    "database",
    "tests",
    "api-ts/src",
    "webapp",
    "scripts",
]


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------


def _section(title: str) -> None:
    print()
    print(f"== {title} ==")


def _row(status_ok: bool | None, label: str, detail: str = "") -> None:
    if status_ok is True:
        mark = "OK"
    elif status_ok is False:
        mark = "MISSING"
    else:
        mark = "?"
    line = f"  [{mark:^7}] {label}"
    if detail:
        line += f"  ({detail})"
    print(line)


# ---------------------------------------------------------------------------
# 1. Toolchain
# ---------------------------------------------------------------------------


def check_toolchain() -> bool:
    _section("Toolchain")
    all_ok = True

    py_version = sys.version.split()[0]
    _row(True, "python3", py_version)

    for tool in ("bun", "node", "docker"):
        path = shutil.which(tool)
        if not path:
            _row(False, tool, "not found on PATH")
            if tool != "docker":  # docker is optional for most dev workflows
                all_ok = False
            continue
        version = "unknown version"
        try:
            out = subprocess.run([tool, "--version"], capture_output=True, text=True, timeout=10)
            version = (out.stdout or out.stderr).strip().splitlines()[0]
        except Exception:
            pass
        _row(True, tool, version)

    return all_ok


# ---------------------------------------------------------------------------
# 2. Repo layout
# ---------------------------------------------------------------------------


def check_repo_layout() -> bool:
    _section("Repo layout")
    all_ok = True
    for rel in KEY_DIRS:
        path = REPO_ROOT / rel
        exists = path.is_dir()
        _row(exists, rel)
        all_ok = all_ok and exists
    return all_ok


# ---------------------------------------------------------------------------
# 3. Env contract
# ---------------------------------------------------------------------------


def check_env_contract() -> bool:
    _section("Env contract (.env.schema)")
    if not CHECK_ENV_SCHEMA.exists():
        _row(False, ".env.schema check", "scripts/check_env_schema.py missing")
        return False
    try:
        result = subprocess.run(
            [sys.executable, str(CHECK_ENV_SCHEMA)],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(REPO_ROOT),
        )
    except Exception as exc:
        _row(False, ".env.schema check", f"error running check_env_schema.py: {exc}")
        return False

    ok = result.returncode == 0
    summary = (result.stdout or result.stderr).strip().splitlines()
    detail = summary[0] if summary else f"exit={result.returncode}"
    _row(ok, ".env.schema up to date", detail)
    if not ok:
        print("    Run: python3 scripts/check_env_schema.py --write")
    return ok


# ---------------------------------------------------------------------------
# 4. Capabilities — minimal YAML loader
# ---------------------------------------------------------------------------


def _minimal_yaml_load(text: str) -> Any:
    """Best-effort parser for the specific subset of YAML capabilities.yaml uses:
    nested mappings/lists, `>` folded scalars, plain/quoted scalar values,
    booleans. Not a general YAML parser — only a fallback for when PyYAML
    (a declared project dependency) isn't installed.
    """
    lines = [line for line in text.split("\n") if not re.match(r"^\s*#", line)]

    def indent_of(line: str) -> int:
        return len(line) - len(line.lstrip(" "))

    def parse_scalar(raw: str) -> Any:
        raw = raw.strip()
        if raw == "":
            return None
        if raw in ("true", "True"):
            return True
        if raw in ("false", "False"):
            return False
        if len(raw) >= 2 and raw[0] == '"' and raw[-1] == '"':
            return raw[1:-1].replace('\\"', '"')
        if len(raw) >= 2 and raw[0] == "'" and raw[-1] == "'":
            return raw[1:-1]
        return raw

    pos = 0

    def parse_block(min_indent: int) -> Any:
        nonlocal pos
        # Decide whether this block is a list or a mapping based on the
        # first non-blank line at >= min_indent.
        while pos < len(lines) and lines[pos].strip() == "":
            pos += 1
        if pos >= len(lines):
            return None
        first = lines[pos]
        if indent_of(first) < min_indent:
            return None
        is_list = first.lstrip(" ").startswith("- ")

        if is_list:
            result: list = []
            list_indent = indent_of(first)
            while pos < len(lines):
                line = lines[pos]
                if line.strip() == "":
                    pos += 1
                    continue
                cur_indent = indent_of(line)
                if cur_indent < list_indent:
                    break
                if cur_indent > list_indent:
                    # Shouldn't happen at a clean list boundary; stop.
                    break
                if not line.lstrip(" ").startswith("- "):
                    break
                # Reconstruct as if the item's content starts right after "- ".
                item_content = line.lstrip(" ")[2:]
                item_col = list_indent + 2
                if ":" in item_content and not item_content.strip().startswith(('"', "'")):
                    # Inline mapping start: "- key: value" or "- key:"
                    lines[pos] = " " * item_col + item_content
                    pos_before = pos
                    value = parse_mapping(item_col)
                    result.append(value)
                    if pos == pos_before:
                        pos += 1
                else:
                    result.append(parse_scalar(item_content))
                    pos += 1
            return result
        else:
            return parse_mapping(min_indent)

    def parse_mapping(min_indent: int) -> dict:
        nonlocal pos
        mapping: dict = {}
        while pos < len(lines):
            line = lines[pos]
            if line.strip() == "":
                pos += 1
                continue
            cur_indent = indent_of(line)
            if cur_indent < min_indent:
                break
            if cur_indent > min_indent:
                break
            stripped = line.strip()
            if stripped.startswith("- "):
                break
            if ":" not in stripped:
                pos += 1
                continue
            key, _, rest = stripped.partition(":")
            key = key.strip()
            rest = rest.strip()
            if rest and not rest.startswith(('"', "'")) and " #" in rest:
                rest = rest.split(" #", 1)[0].rstrip()
            pos += 1
            if rest == ">" or rest == "|":
                # Folded/literal scalar block: gather indented lines.
                folded_lines: list[str] = []
                while pos < len(lines):
                    nxt = lines[pos]
                    if nxt.strip() == "":
                        pos += 1
                        continue
                    if indent_of(nxt) <= cur_indent:
                        break
                    folded_lines.append(nxt.strip())
                    pos += 1
                mapping[key] = " ".join(folded_lines)
            elif rest == "":
                # Nested block (mapping or list) on following lines.
                nested = parse_block(cur_indent + 1)
                mapping[key] = nested if nested is not None else {}
            else:
                mapping[key] = parse_scalar(rest)
        return mapping

    root = parse_block(0)
    return root


def load_capabilities() -> list[dict]:
    if not CAPABILITIES_PATH.exists():
        return []
    text = CAPABILITIES_PATH.read_text()
    try:
        import yaml  # type: ignore

        data = yaml.safe_load(text)
    except ImportError:
        data = _minimal_yaml_load(text)
    except Exception as exc:
        print(
            f"  ! Failed to parse capabilities.yaml with PyYAML ({exc}); "
            "falling back to minimal parser."
        )
        data = _minimal_yaml_load(text)

    if not data:
        return []
    return data.get("capabilities", []) or []


def check_capabilities() -> bool:
    _section("Capabilities (capabilities.yaml)")
    capabilities = load_capabilities()
    if not capabilities:
        _row(False, "capabilities.yaml", "no capabilities found / failed to parse")
        return False

    for cap in capabilities:
        name = cap.get("name", "<unnamed>")
        service = cap.get("service", "?")
        env_vars = cap.get("env_vars", []) or []

        var_names = []
        for v in env_vars:
            if isinstance(v, dict):
                var_names.append(v.get("name", "?"))
            else:
                var_names.append(str(v))

        set_states = {name_: (os.environ.get(name_) is not None) for name_ in var_names}
        n_set = sum(1 for v in set_states.values() if v)
        n_total = len(set_states)

        # Best-effort "capability status" — required_to_enable vars all SET.
        required_names = []
        for v in env_vars:
            if isinstance(v, dict) and v.get("required_to_enable"):
                required_names.append(v.get("name"))
        looks_enabled = bool(required_names) and all(
            set_states.get(rn, False) for rn in required_names
        )

        print(
            f"  - {name}  [{service}]  required-vars-set={n_set}/{n_total}"
            f"  looks_enabled={looks_enabled}"
        )
        for var_name in var_names:
            state = "SET" if set_states.get(var_name) else "UNSET"
            print(f"      {var_name:<40} {state}")

    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit 1 if any check fails (default: always exit 0, report-only)",
    )
    args = parser.parse_args()

    print("Suwappu doctor")
    print(f"Repo: {REPO_ROOT}")

    toolchain_ok = check_toolchain()
    layout_ok = check_repo_layout()
    env_ok = check_env_contract()
    caps_ok = check_capabilities()

    print()
    print("== Summary ==")
    _row(toolchain_ok, "Toolchain")
    _row(layout_ok, "Repo layout")
    _row(env_ok, "Env contract")
    _row(caps_ok, "Capabilities manifest")

    all_ok = toolchain_ok and layout_ok and env_ok and caps_ok
    if args.strict and not all_ok:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
