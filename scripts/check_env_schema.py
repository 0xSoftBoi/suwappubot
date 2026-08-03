#!/usr/bin/env python3
"""Generate/verify `.env.schema` from code — the environment contract.

Unlike a hand-maintained `.env.example`, this is derived straight from the
source of truth for each service's config:

  - python-bot: `bot/config/settings.py` (pydantic-settings `Settings` class),
    parsed with `ast` so field name / type annotation / default / required-ness
    can never drift from what `Settings()` actually validates at boot.
  - api-ts:     `api-ts/src/config/EnvService.ts` (Effect `Schema.Struct`),
    parsed with a line-scan since it's TypeScript, not Python.

Usage:
    python3 scripts/check_env_schema.py            # check mode: diff against
                                                     # the checked-in .env.schema,
                                                     # exit 1 on drift
    python3 scripts/check_env_schema.py --write     # regenerate .env.schema in place

Exit codes: 0 = up to date (or written), 1 = drift detected (check mode only).
"""

from __future__ import annotations

import argparse
import ast
import difflib
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SETTINGS_PY = REPO_ROOT / "bot" / "config" / "settings.py"
ENV_SERVICE_TS = REPO_ROOT / "api-ts" / "src" / "config" / "EnvService.ts"
SCHEMA_PATH = REPO_ROOT / ".env.schema"

SENSITIVE_RE = re.compile(r"(?i)(key|secret|token|password|dsn|private|mnemonic|seed)")

HEADER = """\
# ============================================================================
# .env.schema — GENERATED environment contract. DO NOT hand-edit.
#
# Regenerate with:
#     python3 scripts/check_env_schema.py --write
#
# Verify no drift (used by scripts/verify.sh, the "env" lane):
#     python3 scripts/check_env_schema.py
#
# Source of truth per service:
#   - python-bot: bot/config/settings.py  (pydantic-settings `Settings`)
#   - api-ts:     api-ts/src/config/EnvService.ts  (Effect `Schema.Struct`)
#
# This file lists every env var each service reads. It never contains real
# values — sensitive vars are always blank, non-sensitive vars may show their
# code-level default for convenience. Copy this file to `.env` and fill in
# real values to run locally.
# ============================================================================

"""


@dataclass(frozen=True)
class EnvVar:
    name: str
    service: str
    required: bool
    sensitive: bool
    type_: str
    default: str | None  # rendered default, or None if required/no-default-shown


# ---------------------------------------------------------------------------
# python-bot: parse bot/config/settings.py via ast
# ---------------------------------------------------------------------------


def _annotation_to_str(node: ast.AST | None) -> str:
    if node is None:
        return "Any"
    try:
        return ast.unparse(node)
    except Exception:
        return "Any"


def _literal_default(node: ast.AST) -> str | None:
    """Best-effort render of a simple literal default (str/int/float/bool/None)."""
    try:
        val = ast.literal_eval(node)
    except Exception:
        return None
    if val is None:
        return None
    if isinstance(val, bool):
        return "true" if val else "false"
    return str(val)


def _field_call_info(call: ast.Call) -> tuple[bool, str | None]:
    """Given a `Field(...)` call, return (required, default_str).

    required=True means no usable default was found (Field(...) with `...`
    as the first positional arg, or no default/default_factory at all).
    """
    # Field(...) — Ellipsis as first positional arg => required, no default.
    for arg in call.args:
        if isinstance(arg, ast.Constant) and arg.value is Ellipsis:
            return True, None

    for kw in call.keywords:
        if kw.arg == "default":
            if isinstance(kw.value, ast.Constant) and kw.value.value is Ellipsis:
                return True, None
            return False, _literal_default(kw.value)
        if kw.arg == "default_factory":
            # Can't safely evaluate arbitrary factories; mark optional, no default shown.
            return False, None

    # Field() with no default/default_factory/Ellipsis arg at all — pydantic
    # treats this as required.
    return True, None


def parse_python_settings(path: Path) -> list[EnvVar]:
    tree = ast.parse(path.read_text())

    settings_cls = None
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "Settings":
            settings_cls = node
            break
    if settings_cls is None:
        raise SystemExit(f"Could not find `class Settings` in {path}")

    fields: list[EnvVar] = []
    for stmt in settings_cls.body:
        # We only care about top-level `name: Type = ...` annotated assignments.
        if not isinstance(stmt, ast.AnnAssign):
            continue
        if not isinstance(stmt.target, ast.Name):
            continue
        name = stmt.target.id

        # Skip ClassVar (not an env-loaded field) e.g. INFURA_NETWORKS.
        ann_str = _annotation_to_str(stmt.annotation)
        if ann_str.startswith("ClassVar"):
            continue

        required = True
        default: str | None = None

        value = stmt.value
        if value is None:
            # `name: Type` with no `=` at all — pydantic requires it.
            required = True
        elif isinstance(value, ast.Call) and getattr(value.func, "id", None) == "Field":
            required, default = _field_call_info(value)
        elif isinstance(value, ast.Constant) and value.value is Ellipsis:
            required = True
        else:
            # Plain literal default: `name: Type = <literal>`
            lit = _literal_default(value)
            required = False
            default = lit

        sensitive = bool(SENSITIVE_RE.search(name))
        fields.append(
            EnvVar(
                name=name.upper(),
                service="python-bot",
                required=required,
                sensitive=sensitive,
                type_=ann_str,
                default=None if sensitive else default,
            )
        )

    return fields


# ---------------------------------------------------------------------------
# api-ts: parse api-ts/src/config/EnvService.ts via line-scan
# ---------------------------------------------------------------------------

# Matches lines like:
#   TELEGRAM_BOT_TOKEN: Schema.optional(Schema.String),
#   PORT: Schema.optionalWith(Schema.NumberFromString, { default: () => 8000 }),
#   FEE_BPS: Schema.optionalWith(Schema.NumberFromString, { default: () => DEFAULT_AGENT_FEE_BPS }),
TS_FIELD_RE = re.compile(
    r"^\s*([A-Z][A-Z0-9_]*)\s*:\s*Schema\.(optionalWith|optional)\s*\(\s*Schema\.(\w+)"
)
TS_DEFAULT_RE = re.compile(r"default:\s*\(\)\s*=>\s*(.+?)\s*\}")
# Vars checked as required-in-production inside EnvServiceLive (missing.push(...)).
TS_REQUIRED_RE = re.compile(r"missing\.push\(['\"]([A-Z0-9_]+)['\"]\)")


def parse_ts_env(path: Path) -> list[EnvVar]:
    text = path.read_text()
    lines = text.splitlines()

    prod_required: set[str] = set(TS_REQUIRED_RE.findall(text))

    fields: list[EnvVar] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = TS_FIELD_RE.match(line)
        if m:
            name, _wrapper, type_ = m.groups()
            # Field declarations may wrap onto following lines before the
            # closing `),`. Join up to a few lines to find a default.
            joined = line
            j = i
            while ")," not in joined and j < i + 6 and j + 1 < len(lines):
                j += 1
                joined += " " + lines[j]

            default_match = TS_DEFAULT_RE.search(joined)
            default_str = default_match.group(1).strip() if default_match else None
            # Only render simple string/number literal defaults; skip
            # references to imported constants (e.g. DEFAULT_FEE_WALLET_EVM)
            # since we can't safely resolve them here without a TS runtime.
            rendered_default = None
            if default_str is not None:
                if re.fullmatch(r"'[^']*'|\"[^\"]*\"", default_str):
                    rendered_default = default_str.strip("'\"")
                elif re.fullmatch(r"-?\d+(\.\d+)?", default_str):
                    rendered_default = default_str

            required = name in prod_required
            sensitive = bool(SENSITIVE_RE.search(name))
            fields.append(
                EnvVar(
                    name=name,
                    service="api-ts",
                    required=required,
                    sensitive=sensitive,
                    type_=type_,
                    default=None if sensitive else rendered_default,
                )
            )
        i += 1

    return fields


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def render_schema(fields: list[EnvVar]) -> str:
    out = [HEADER]
    by_service: dict[str, list[EnvVar]] = {}
    for f in fields:
        by_service.setdefault(f.service, []).append(f)

    for service in sorted(by_service):
        svc_fields = sorted(by_service[service], key=lambda f: f.name)
        out.append(f"# ---- service: {service} " + "-" * max(1, 50 - len(service)) + "\n")
        for f in svc_fields:
            tags = ["@required" if f.required else "@optional"]
            if f.sensitive:
                tags.append("@sensitive")
            tags.append(f"@type={f.type_}")
            tags.append(f"@service={f.service}")
            out.append(f"# {' '.join(tags)}\n")
            if not f.sensitive and f.default is not None and f.default != "":
                out.append(f"{f.name}={f.default}\n")
            else:
                out.append(f"{f.name}=\n")
        out.append("\n")

    return "".join(out).rstrip("\n") + "\n"


def collect_fields() -> list[EnvVar]:
    fields = parse_python_settings(SETTINGS_PY)
    fields += parse_ts_env(ENV_SERVICE_TS)
    return fields


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Regenerate .env.schema in place")
    args = parser.parse_args()

    fields = collect_fields()
    rendered = render_schema(fields)

    if args.write:
        SCHEMA_PATH.write_text(rendered)
        print(f"Wrote {SCHEMA_PATH} ({len(fields)} vars)")
        return 0

    if not SCHEMA_PATH.exists():
        print(f"✗ {SCHEMA_PATH} does not exist. Run with --write to generate it.")
        return 1

    existing = SCHEMA_PATH.read_text()
    if existing == rendered:
        print(f"✓ .env.schema is up to date ({len(fields)} vars)")
        return 0

    diff = difflib.unified_diff(
        existing.splitlines(keepends=True),
        rendered.splitlines(keepends=True),
        fromfile="checked-in .env.schema",
        tofile="regenerated .env.schema",
    )
    print("✗ .env.schema is out of date. Run: python3 scripts/check_env_schema.py --write\n")
    sys.stdout.writelines(diff)
    return 1


if __name__ == "__main__":
    sys.exit(main())
