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


def _link_at(text: str, i: int) -> tuple[int, str, str] | None:
    """Match an inline link starting at text[i] == "[".

    Returns (index just past the link, label, destination), or None when this
    bracket does not open one. MarkdownV2 escaping is context-dependent: the
    brackets and parentheses that form a link are syntax, and inside the
    destination only ")" and "\\" need escaping. Treating the whole literal
    with one reserved set rejects correct links, which is worse than useless in
    a gate — it teaches people to work around it.
    """
    j = i + 1
    while j < len(text):
        if text[j] == "\\":
            j += 2
            continue
        if text[j] == "]":
            break
        if text[j] == "\n":
            return None
        j += 1
    else:
        return None
    if j + 1 >= len(text) or text[j + 1] != "(":
        return None
    label = text[i + 1 : j]
    k = j + 2
    while k < len(text):
        if text[k] == "\\":
            k += 2
            continue
        if text[k] == ")":
            return k + 1, label, text[j + 2 : k]
        if text[k] == "\n":
            return None
        k += 1
    return None


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
        if ch == "[":
            link = _link_at(text, i)
            if link is not None:
                end, label, dest = link
                # The label is ordinary text and carries the full rules.
                bad.extend(unescaped(label))
                # In the destination, only ")" needs escaping, and an
                # unescaped one would have ended the link above — so a matched
                # destination is valid by construction.
                i = end
                continue
        if ch in ALWAYS_RESERVED:
            bad.append(ch)
        i += 1
    return bad


# Each case pins a rule this gate is relied on for. The link cases exist
# because an earlier version applied one reserved set to the whole literal and
# so reported a correct inline link as five errors.
SELF_TEST = [
    # (name, literal, the characters that must be reported)
    ("valid inline link", "[Read docs](https://suwappu.bot/docs)", []),
    ("valid link followed by prose", "[Docs](https://a.io/x) is ready", []),
    ("unescaped period outside a link", "Done.", ["."]),
    ("escaped period outside a link", "Done\\.", []),
    ("label with an unescaped period", "[Read docs.](https://a.io)", ["."]),
    ("label with an escaped period", "[Read docs\\.](https://a.io)", []),
    ("destination with escaped parentheses", "[x](https://a.io/a\\(b\\))", []),
    ("destination holding a period", "[a](https://a.io/v1.2/x)", []),
    ("bare opening bracket is still reserved", "an [aside here", ["["]),
    ("bracket pair with no destination", "see [this] thing", ["[", "]"]),
    ("two links in one message", "[a](https://a.io) and [b](https://b.io)", []),
    ("unescaped bang after a link", "[a](https://a.io)!", ["!"]),
    ("format placeholder is left alone", "Swapped {amount} tokens", []),
    ("hyphen outside a link", "pre-flight", ["-"]),
]


def self_test() -> int:
    failed = 0
    for name, literal, want in SELF_TEST:
        got = unescaped(literal)
        if got != want:
            failed += 1
            print(f"FAIL {name}: reported {got}, expected {want}")
    print(f"{len(SELF_TEST) - failed}/{len(SELF_TEST)} passed")
    return 1 if failed else 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()
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
