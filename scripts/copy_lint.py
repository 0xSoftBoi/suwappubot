#!/usr/bin/env python3
"""Advisory prose lint for docs/WRITING.md.

Checks Markdown files, JSON string tables (showcase/messages/*.json), and TypeScript
files that carry Markdown in template literals (showcase/src/content/research.ts).

    python3 scripts/copy_lint.py docs/WRITING.md showcase/src/content/research.ts
    python3 scripts/copy_lint.py --strict docs/research   # non-zero exit on findings

Rules (see docs/WRITING.md):
  W01 sentence over 35 words
  W02 em-dash used as sentence glue
  W03 paragraph over 4 sentences
  W04 banned word or phrase
  W05 stacked hedge ("may potentially", "could arguably", ...)
  W06 parenthetical aside longer than 6 words
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

MAX_SENTENCE_WORDS = 35
MAX_PARAGRAPH_SENTENCES = 4
MAX_PAREN_WORDS = 6

BANNED = [
    "seamless",
    "seamlessly",
    "powerful",
    "robust",
    "cutting-edge",
    "state-of-the-art",
    "revolutionary",
    "game-changing",
    "unlock",
    "unleash",
    "supercharge",
    "synergy",
    "truly",
    "world-class",
    "best-in-class",
    "next-generation",
    "frictionless",
    "effortless",
    "delightful",
    "empower",
    "elevate",
    "dive into",
    "deep dive",
    "in today's fast-paced",
    "at the end of the day",
    "it's worth noting",
    "it is worth noting",
    "it is important to note",
]
BANNED_RE = re.compile(r"\b(" + "|".join(re.escape(b) for b in BANNED) + r")\b", re.I)
LEVERAGE_VERB_RE = re.compile(r"\bleverag(e|es|ed|ing)\b\s+(the|a|an|our|its|their|this)\b", re.I)
HEDGE_RE = re.compile(
    r"\b(may|might|could|can)\s+(potentially|arguably|possibly|perhaps)\b"
    r"|\bis\s+likely\s+to\s+(possibly|potentially)\b",
    re.I,
)
# Em-dash with or without surrounding spaces, or the "--" habit.
EMDASH_RE = re.compile(r"\s?[—–]\s?|\s--\s")
PAREN_RE = re.compile(r"\(([^()]{1,400})\)")
# A dash that separates a leading label from its definition ("**Term** — what it
# is") is punctuation, not sentence glue, so one is stripped from a list item
# before the glue check. It must be flanked by spaces on BOTH sides: an en-dash
# closed up inside the label ("**June–July 2025** — backlash") is part of a
# range, and a non-greedy match would otherwise stop there and strip the wrong
# dash, leaving the real separator to misfire.
LABEL_DASH_RE = re.compile(r"^[^.!?]{1,80}?\s[—–]\s")
# A closed-up dash between numbers, or between a magnitude suffix and a number,
# is a range ("$5–25", "2019–2024", "500k–1M", "Levels 0–2"). Ranges are not
# glue, so they are neutralised before the glue check runs.
NUMERIC_RANGE_RE = re.compile(
    r"(?<=\d)[—–](?=[\d$])" r"|(?<=[kKmMbB%])[—–](?=[\d$])" r"|(?<=\d)[—–](?=[kKmMbB])"
)
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'“(\[])")

SKIP_DIRS = {"node_modules", ".next", "dist", "build", ".git", "vendor", "lib"}
SKIP_LINE_PREFIXES = ("|", ">", "    ", "\t", "- [", "* [", "![", "<", "[!")
URL_RE = re.compile(r"https?://\S+|`[^`]*`|\[[^\]]*\]\([^)]*\)")


def strip_inline(text: str) -> str:
    return URL_RE.sub(" ", text)


def prose_paragraphs_from_markdown(text: str) -> list[tuple[int, str, bool]]:
    """Return (line_number, paragraph_text) for plain prose paragraphs.

    Skips fenced code, tables, headings, blockquotes, images, HTML, and list items
    (list items are checked sentence-by-sentence but not for paragraph length).
    """
    out: list[tuple[int, str, bool]] = []
    in_fence = False
    lint_off = False
    buf: list[str] = []
    start = 0
    for i, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip()
        # `<!-- copy-lint: off -->` ... `<!-- copy-lint: on -->` exempts a region
        # (used where a doc quotes the banned list or a bad example on purpose).
        if "copy-lint: off" in line:
            lint_off = True
            continue
        if "copy-lint: on" in line:
            lint_off = False
            continue
        if lint_off:
            continue
        if line.lstrip().startswith("```") or line.lstrip().startswith("~~~"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        stripped = line.strip()
        is_block = (
            not stripped
            or stripped.startswith("#")
            or line.startswith(SKIP_LINE_PREFIXES)
            or stripped.startswith(("- ", "* ", "+ "))
            or re.match(r"^\d+\.\s", stripped)
            or stripped.startswith("---")
        )
        if is_block:
            if buf:
                out.append((start, " ".join(buf), False))
                buf = []
            # List items still get sentence-level checks, as their own paragraph.
            if stripped.startswith(("- ", "* ", "+ ")) or re.match(r"^\d+\.\s", stripped):
                out.append((i, re.sub(r"^(\s*[-*+]|\s*\d+\.)\s+", "", stripped), True))
            continue
        # An indented line directly after a list item is that item's continuation.
        if raw.startswith((" ", "\t")) and not buf and out and out[-1][2]:
            ln, prev, _ = out[-1]
            out[-1] = (ln, prev + " " + stripped, True)
            continue
        if not buf:
            start = i
        buf.append(stripped)
    if buf:
        out.append((start, " ".join(buf), False))
    return out


def paragraphs_from_ts(text: str) -> list[tuple[int, str, bool]]:
    """Markdown bodies in template literals plus string fields named excerpt/title/pullQuote."""
    out: list[tuple[int, str, bool]] = []
    for m in re.finditer(r"= `(.*?)`;", text, re.S):
        body = m.group(1).replace("\\`", "`")
        base_line = text[: m.start(1)].count("\n") + 1
        for ln, para, is_list in prose_paragraphs_from_markdown(body):
            out.append((base_line + ln - 1, para, is_list))
    for m in re.finditer(
        r"^\s*(excerpt|title|pullQuote|caption|subtitle):\s*'((?:[^'\\]|\\.)*)'", text, re.M
    ):
        out.append((text[: m.start()].count("\n") + 1, m.group(2).replace("\\'", "'"), False))
    return out


def paragraphs_from_json(text: str) -> list[tuple[int, str, bool]]:
    out: list[tuple[int, str, bool]] = []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return out

    def walk(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, path + [k])
        elif isinstance(node, list):
            for idx, v in enumerate(node):
                walk(v, path + [str(idx)])
        elif isinstance(node, str) and len(node.split()) >= 4:
            out.append((0, node, False))

    walk(data, [])
    return out


def sentences(para: str) -> list[str]:
    para = strip_inline(para)
    return [s.strip() for s in SENTENCE_SPLIT_RE.split(para) if s.strip()]


def lint_paragraph(path: Path, line: int, para: str, is_list: bool = False) -> list[str]:
    findings: list[str] = []
    loc = f"{path}:{line}" if line else str(path)
    clean = strip_inline(para)
    sents = sentences(para)
    if len(sents) > MAX_PARAGRAPH_SENTENCES and not is_list:
        findings.append(
            f"{loc}: W03 paragraph has {len(sents)} sentences (max {MAX_PARAGRAPH_SENTENCES})"
        )
    for s in sents:
        words = len(s.split())
        if words > MAX_SENTENCE_WORDS:
            findings.append(f"{loc}: W01 sentence of {words} words: {s[:80]}…")
    # A dash right after a short label at the start of a list item ("**Term** — what
    # it is", "[Link](x) — summary") is a separator, not sentence glue. Strip one.
    dash_text = LABEL_DASH_RE.sub("", clean, count=1) if is_list else clean
    dash_text = NUMERIC_RANGE_RE.sub("-", dash_text)
    if EMDASH_RE.search(dash_text):
        findings.append(f"{loc}: W02 em-dash as glue: {clean[:80]}…")
    for m in BANNED_RE.finditer(clean):
        findings.append(f"{loc}: W04 banned word '{m.group(0)}'")
    for m in LEVERAGE_VERB_RE.finditer(clean):
        findings.append(f"{loc}: W04 banned verb '{m.group(0)}'")
    for m in HEDGE_RE.finditer(clean):
        findings.append(f"{loc}: W05 stacked hedge '{m.group(0)}'")
    for m in PAREN_RE.finditer(clean):
        inner = m.group(1)
        if len(inner.split()) > MAX_PAREN_WORDS and not re.match(r"^[\w./:-]+$", inner):
            findings.append(
                f"{loc}: W06 parenthetical of {len(inner.split())} words: ({inner[:60]}…)"
            )
    return findings


def lint_file(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    if path.suffix == ".md":
        paras = prose_paragraphs_from_markdown(text)
    elif path.suffix in {".ts", ".tsx"}:
        paras = paragraphs_from_ts(text)
    elif path.suffix == ".json":
        paras = paragraphs_from_json(text)
    else:
        return []
    findings: list[str] = []
    for line, para, is_list in paras:
        findings.extend(lint_paragraph(path, line, para, is_list))
    return findings


def iter_targets(args: list[str]):
    for a in args:
        p = Path(a)
        if p.is_dir():
            for f in sorted(p.rglob("*")):
                if (
                    f.is_file()
                    and f.suffix in {".md", ".ts", ".tsx", ".json"}
                    and not (SKIP_DIRS & set(f.parts))
                ):
                    yield f
        elif p.is_file():
            yield p


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--strict", action="store_true", help="exit 1 when there are findings")
    ap.add_argument("--summary", action="store_true", help="print counts per file only")
    ns = ap.parse_args()

    total = 0
    per_file: dict[str, int] = {}
    for f in iter_targets(ns.paths):
        findings = lint_file(f)
        if findings:
            per_file[str(f)] = len(findings)
            total += len(findings)
            if not ns.summary:
                print("\n".join(findings))
    if ns.summary:
        for k, v in sorted(per_file.items(), key=lambda kv: -kv[1]):
            print(f"{v:5d}  {k}")
    print(f"copy_lint: {total} finding(s) in {len(per_file)} file(s)", file=sys.stderr)
    return 1 if (ns.strict and total) else 0


if __name__ == "__main__":
    sys.exit(main())
