#!/usr/bin/env python3
"""Prose lint for app strings: the bot, the webapp, the terminal, the extension.

`copy_lint.py` reads Markdown and JSON. It cannot see a string literal inside a
Python handler or a JSX text node, which is where most of what a user actually
reads lives: error messages, empty states, warnings, button captions.

Only text a user could read is reported. Comments, docstrings, log calls,
developer warnings and admin-only handlers are excluded, because a dash in a log
line is not copy. Test files are excluded too.

Rules applied (see docs/WRITING.md §8):
  A01  em/en dash used as sentence glue
  A02  banned word from §10
  A03  sentence over 35 words

Run:
    python3 scripts/check_app_copy.py            # every app surface
    python3 scripts/check_app_copy.py bot        # one surface
    python3 scripts/check_app_copy.py --strict   # non-zero exit on findings
"""

from __future__ import annotations

import argparse
import ast
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

BANNED = re.compile(
    r"\b(seamless|seamlessly|powerful|robust|cutting-edge|revolutionary|"
    r"game-changing|supercharge|truly|world-class|frictionless|effortless|"
    r"delightful|empower|elevate|unleash)\b",
    re.I,
)
DASH = re.compile(r"\s[—–]\s|\s--\s")
MAX_SENTENCE_WORDS = 35

# --- Python (the Telegram bot) ------------------------------------------------
# Functions whose string arguments are rendered to a user.
PY_SEND = re.compile(r"reply_text|send_message|edit_message_text|answer|caption|reply_markdown")

# --- TypeScript / TSX (webapp, terminal, extension) ---------------------------
TS_COMMENT = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)
TS_STRING = re.compile(r"'([^'\n]{20,})'|\"([^\"\n]{20,})\"|`([^`]{20,})`")
TS_JSX_TEXT = re.compile(r">\s*([A-Z][^<>{}\n]{25,})\s*<")
# A developer warning is not copy.
TS_DEV = re.compile(r"console\.(warn|error|debug|info)|^\s*\[")
# SVG path data is letters and numbers, never prose.
SVG_PATH = re.compile(r"^[MmLlHhVvCcSsQqTtAaZz0-9,.\s+-]{20,}$")

SURFACES = {
    "bot": ("bot/handlers", "py"),
    "webapp": ("webapp/src", "ts"),
    "terminal": ("terminal/src", "ts"),
    "extension": ("extension/src", "ts"),
    # copy_lint.py reads this repo's Markdown and JSON. It cannot see a JSX
    # text node, so the marketing pages need the same treatment as the apps.
    "showcase": ("showcase/src/app", "ts"),
}
SKIP_PARTS = {"node_modules", "dist", ".next", "build", "__tests__", "coverage"}
# Legal pages are excluded on purpose, not forgotten. A warranty disclaimer or a
# risk statement is drafted for legal effect, and splitting one of its sentences
# can change what it means. Those pages are reviewed by a person, not a linter.
SKIP_DIRS = {"legal"}


def flag(text: str) -> list[str]:
    flat = re.sub(r"\s+", " ", text).strip()
    out: list[str] = []
    if DASH.search(flat):
        out.append("A01 dash as sentence glue")
    m = BANNED.search(flat)
    if m:
        out.append(f"A02 banned word {m.group(0)!r}")
    for s in re.split(r"(?<=[.!?])\s+", flat):
        if len(s.split()) > MAX_SENTENCE_WORDS:
            out.append(f"A03 sentence of {len(s.split())} words")
            break
    return out


def scan_python(root: pathlib.Path):
    for f in sorted(root.glob("*.py")):
        # Admin surfaces are internal tooling, not product copy.
        if f.name.startswith("admin"):
            continue
        try:
            tree = ast.parse(f.read_text())
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "attr", "") or getattr(node.func, "id", "")
            if not PY_SEND.search(name):
                continue
            for arg in list(node.args) + [k.value for k in node.keywords]:
                for sub in ast.walk(arg):
                    if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
                        if len(sub.value.split()) >= 4:
                            yield f, sub.lineno, sub.value


def looks_like_prose(text: str) -> bool:
    """Reject code that merely lives inside quotes or a template literal.

    A multi-line template literal of TypeScript, or a generic like Foo<Bar>, is
    not copy. Requiring sentence shape and rejecting code punctuation keeps the
    checker precise; a checker that cries wolf gets ignored.
    """
    if any(tok in text for tok in (";", "=>", "){", "};", "()", "&&", "||", "://")):
        return False
    if "\n" in text.strip():
        return False
    # SVG path data ("M17.81 4.47c-.08 0-.16…") is letters and numbers, not prose.
    if SVG_PATH.match(text.strip()):
        return False
    words = re.findall(r"[A-Za-z']{2,}", text)
    return len(words) >= 4


def scan_ts(root: pathlib.Path):
    for f in sorted(root.rglob("*.ts*")):
        if (SKIP_PARTS | SKIP_DIRS) & set(f.parts) or any(
            t in f.name for t in (".test.", ".spec.", ".stories.")
        ):
            continue
        # Blank the comments but keep their newlines, or every reported line
        # number after a block comment is wrong and the tool wastes the reader.
        src = TS_COMMENT.sub(lambda m: "\n" * m.group(0).count("\n"), f.read_text(errors="replace"))
        matches = list(TS_STRING.finditer(src))
        # A JSX text node only exists in .tsx; in .ts, "> ... <" is a generic.
        if f.suffix == ".tsx":
            matches += list(TS_JSX_TEXT.finditer(src))
        for m in matches:
            text = next(g for g in m.groups() if g)
            stripped = text.strip()
            # Template-only, arrow glyphs, JSX attribute soup, dev warnings.
            if stripped.startswith("${") or "→" in text or "className=" in text:
                continue
            if not looks_like_prose(text):
                continue
            line_start = src.rfind("\n", 0, m.start()) + 1
            if TS_DEV.search(src[line_start : m.start()]):
                continue
            yield f, src[: m.start()].count("\n") + 1, text


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("surfaces", nargs="*", help=f"any of: {', '.join(SURFACES)}")
    ap.add_argument("--strict", action="store_true")
    ns = ap.parse_args()

    unknown = [s for s in ns.surfaces if s not in SURFACES]
    if unknown:
        ap.error(f"unknown surface(s) {unknown}; choose from {', '.join(SURFACES)}")
    names = ns.surfaces or list(SURFACES)
    total = 0
    for name in names:
        rel, kind = SURFACES[name]
        root = ROOT / rel
        if not root.exists():
            continue
        scanner = scan_python if kind == "py" else scan_ts
        hits = []
        for f, line, text in scanner(root):
            for code in flag(text):
                hits.append(
                    f"  {f.relative_to(ROOT)}:{line}: {code}: "
                    f"{re.sub(r'  +', ' ', text.strip())[:80]}"
                )
        total += len(hits)
        print(f"{name}: {len(hits)} finding(s)")
        for h in hits[:25]:
            print(h)
        if len(hits) > 25:
            print(f"  … and {len(hits) - 25} more")

    print(f"\ncheck_app_copy: {total} finding(s) across {len(names)} surface(s)")
    return 1 if (ns.strict and total) else 0


if __name__ == "__main__":
    sys.exit(main())
