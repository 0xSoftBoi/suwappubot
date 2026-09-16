#!/usr/bin/env python3
"""Catch MarkdownV2 message text with unescaped reserved punctuation.

Telegram rejects a MarkdownV2 message whose reserved characters are not
backslash-escaped, at runtime, with a 400. Nothing in CI exercises a real send,
so a bad escape ships silently and the user sees nothing at all.

The hazard is specific and easy to hit while editing copy: legacy `Markdown`
(v1) does not require `.` to be escaped, MarkdownV2 does. Swapping an em-dash
for a period is safe in one and breaks the other.

Precision over recall, deliberately. A checker that cries wolf gets ignored, so
this one only reports what it can be sure about:

  * Checked: . ! - ( ) [ ] ~ > # + = | { }  — punctuation that is ALWAYS
    reserved in MarkdownV2 and never carries formatting meaning.
  * Skipped: * _ and backticks. Those are the bold, italic and code delimiters,
    so an unescaped one is usually correct formatting rather than a bug.
  * Skipped: any literal containing a backtick. Message text is built by
    concatenation, so code-span state spans several literals and cannot be
    resolved from one of them.
  * Skipped: everything that is not the message-text argument. `callback_data`
    and other keyword payloads are never rendered.

Run: python3 scripts/check_markdown_escapes.py
"""

from __future__ import annotations

import ast
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Reserved in MarkdownV2 and never a formatting delimiter.
ALWAYS_RESERVED = set(".!-()[]~>#+=|{}")
SEND = re.compile(r"^(reply_text|send_message|edit_message_text|reply_markdown_v2)$")
# The argument that actually carries rendered text.
TEXT_KWARGS = {"text", "caption"}


def is_v2(call: ast.Call) -> bool:
    for kw in call.keywords:
        if kw.arg != "parse_mode":
            continue
        v = kw.value
        if isinstance(v, ast.Constant) and isinstance(v.value, str):
            return v.value.replace("_", "").upper() == "MARKDOWNV2"
        if isinstance(v, ast.Attribute):
            return v.attr.upper() in {"MARKDOWN_V2", "MARKDOWNV2"}
    return False


def text_nodes(call: ast.Call):
    """The message-text argument only: first positional, or text=/caption=."""
    if call.args:
        yield call.args[0]
    for kw in call.keywords:
        if kw.arg in TEXT_KWARGS:
            yield kw.value


def unescaped(text: str) -> list[str]:
    bad: list[str] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        # A format placeholder is substituted before send; its braces are spec.
        if ch == "{":
            j = text.find("}", i)
            if j != -1:
                i = j + 1
                continue
        if ch in ALWAYS_RESERVED:
            bad.append(ch)
        i += 1
    return bad


def main() -> int:
    findings: list[str] = []
    checked = 0
    skipped_code = 0

    for path in sorted(ROOT.glob("bot/**/*.py")):
        try:
            tree = ast.parse(path.read_text())
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "attr", "") or getattr(node.func, "id", "")
            if not SEND.match(name) or not is_v2(node):
                continue
            for arg in text_nodes(node):
                for sub in ast.walk(arg):
                    if not (isinstance(sub, ast.Constant) and isinstance(sub.value, str)):
                        continue
                    value = sub.value
                    if len(value) < 4:
                        continue
                    if "`" in value:
                        skipped_code += 1
                        continue
                    checked += 1
                    bad = unescaped(value)
                    if bad:
                        rel = path.relative_to(ROOT)
                        preview = re.sub(r"\s+", " ", value)[:58]
                        findings.append(
                            f"  {rel}:{sub.lineno}: unescaped {sorted(set(bad))} in {preview!r}"
                        )

    if findings:
        print("✗ MarkdownV2 message text with unescaped reserved punctuation:")
        print("\n".join(findings))
        print("  Telegram rejects these at send time with a 400; CI cannot see it.")
        print("  Escape each one with a backslash, or send with parse_mode='Markdown'.")
        return 1
    print(
        f"✓ MarkdownV2 escaping valid ({checked} literal(s) checked, "
        f"{skipped_code} skipped for ambiguous code spans)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
