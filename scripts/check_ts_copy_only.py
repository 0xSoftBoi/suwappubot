#!/usr/bin/env python3
"""Prove a TypeScript/TSX edit changed only copy, not code.

Blanks the prose and compares the remaining skeleton against HEAD. Identical
skeletons mean no identifier, call, import, prop, or control-flow token moved.

Two things that live inside quotes are code, not copy, and this gate treats
them that way:

- An expression inside a template literal's `${...}`. `${price * amount}` and
  `${price / amount}` must never compare equal, so interpolations are kept
  verbatim and only the literal's text chunks are blanked.
- A URL or a path, anywhere in a string. These are addresses, so a reworded
  sentence that also retargets a fetch is reported rather than waved through.

Why those two and not a general string-is-an-address rule: a one-word button
label is shaped exactly like an identifier, so any rule broad enough to catch
`"btn primary"` also rejects `"Cancel"` and the gate stops being usable on the
large copy rewrites it exists to certify. URLs and paths can be recognised
exactly; short prose cannot be told from a selector by shape. The checks below
are therefore the ones that can be made precise, and the diff is still read.

Known limitation: a JSX text node broken up by inline expressions such as
`{' '}` is compared segment by segment, so re-wrapping a paragraph can move a
word across a segment boundary and be reported as a code change. When that
happens, confirm by hand that the diff is text only; comparing the word
multiset of the changed block before and after is the usual proof.

This is the TS analogue of comparing Python syntax trees, and it is what makes
a large delegated copy rewrite safe to accept even when a workspace has no
node_modules and cannot be built.

    python3 scripts/check_ts_copy_only.py             # all modified .ts/.tsx
    python3 scripts/check_ts_copy_only.py a.tsx b.ts  # specific files
    python3 scripts/check_ts_copy_only.py --self-test # the gate checks itself
"""

import re
import subprocess
import sys
from collections import Counter

JSX_TEXT = re.compile(r">([^<>{}]*[A-Za-z][^<>{}]*)<")
WS = re.compile(r"\s+")

# An address, recognisable without guessing. Two forms only, because a looser
# rule fires on every slash in ordinary prose ("and/or", "24/7", "price/amount")
# and then a comma moved three words away reads as a retargeted request.
SCHEME_URL = re.compile(r"[A-Za-z][A-Za-z0-9+.\-]*://[^\s'\"`]+")
# A path is an address only when it is the WHOLE string. An import target, an
# href and a fetch path always are; a slash inside a sentence never is.
WHOLE_PATH = re.compile(r"^\s*(\.{0,2}/[A-Za-z0-9_\-./%?=&#:~@+\[\]]*)\s*$")
# Punctuation a URL picks up from the prose around it, above all the closing
# paren of a Markdown link. Trimmed so rewording the sentence that holds a link
# does not read as changing the link.
BORROWED = "),.;:!?'\"*]}"


def addresses(text: str) -> list[str]:
    found = [u.rstrip(BORROWED) for u in SCHEME_URL.findall(text)]
    whole = WHOLE_PATH.match(text)
    if whole:
        found.append(whole.group(1))
    return found


def _walk(src: str) -> tuple[str, list[str]]:
    """Return (skeleton source, every address found inside a string literal).

    Walks the source rather than running one regex over it, because a template
    literal is not a flat token: its `${...}` holds arbitrary code, which may
    itself contain strings and further template literals. A regex that swallows
    the whole literal cannot tell the two apart.
    """
    out: list[str] = []
    found: list[str] = []
    i, n = 0, len(src)
    # Brace depth per open template-literal interpolation, innermost last.
    tmpl: list[int] = []

    def chunk(buf: list[str]) -> None:
        """Emit one template-literal text chunk as blanked prose."""
        body = "".join(buf)
        found.extend(addresses(body))
        out.append("<STR>")

    def text_run() -> bool:
        """Consume template text up to ` or ${. True if the literal closed."""
        nonlocal i
        buf: list[str] = []
        while i < n:
            if src[i] == "\\":
                buf.append(src[i : i + 2])
                i += 2
                continue
            if src[i] == "`":
                chunk(buf)
                out.append("`")
                i += 1
                return True
            if src[i] == "$" and i + 1 < n and src[i + 1] == "{":
                chunk(buf)
                out.append("${")
                i += 2
                tmpl.append(0)
                return False
            buf.append(src[i])
            i += 1
        chunk(buf)  # unterminated literal; keep the file comparable
        return True

    while i < n:
        ch = src[i]

        # Comments are neither copy nor code: copied through, so a reworded
        # comment reads as a change. That is deliberate.
        if ch == "/" and i + 1 < n and src[i + 1] in "/*":
            if src[i + 1] == "/":
                j = src.find("\n", i)
                j = n if j == -1 else j
            else:
                j = src.find("*/", i + 2)
                j = n if j == -1 else j + 2
            out.append(src[i:j])
            i = j
            continue

        # Quoted string: one flat token, no interpolation.
        if ch in "'\"":
            j, buf = i + 1, []
            while j < n and src[j] != ch:
                if src[j] == "\\":
                    buf.append(src[j : j + 2])
                    j += 2
                    continue
                if src[j] == "\n":  # unterminated; treat as code
                    break
                buf.append(src[j])
                j += 1
            if j < n and src[j] == ch:
                found.extend(addresses("".join(buf)))
                out.append(f"{ch}<STR>{ch}")
                i = j + 1
                continue
            out.append(ch)
            i += 1
            continue

        if ch == "`":
            out.append("`")
            i += 1
            text_run()
            continue

        # Inside ${...}: ordinary code until its own brace closes.
        if tmpl:
            if ch == "{":
                tmpl[-1] += 1
            elif ch == "}":
                if tmpl[-1] == 0:
                    tmpl.pop()
                    out.append("}")
                    i += 1
                    text_run()  # the literal resumes after the interpolation
                    continue
                tmpl[-1] -= 1

        out.append(ch)
        i += 1

    return "".join(out), found


def skeleton(src: str) -> str:
    s, _ = _walk(src)
    s = JSX_TEXT.sub("><TXT><", s)
    return WS.sub(" ", s).strip()


def string_addresses(src: str) -> Counter:
    return Counter(_walk(src)[1])


def head(path: str) -> str | None:
    r = subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


# Each case pins a behaviour this gate is relied on for. The pairs that must
# compare EQUAL are the copy rewrites it has to let through; the pairs that must
# DIFFER are the code changes it must never certify as prose. The template and
# address cases exist because an earlier version of this script blanked whole
# template literals, so `${price * amount}` and `${price / amount}` compared
# equal and a retargeted fetch read as a copy edit.
SELF_TEST = [
    # (name, before, after, must compare equal)
    ("interpolation operator changed",
     "const x = `Total: ${price * amount}`;", "const x = `Total: ${price / amount}`;", False),
    ("interpolation call changed",
     "const x = `${fmt(a)} left`;", "const x = `${raw(a)} left`;", False),
    ("prose inside a template reworded",
     "const x = `Total cost is`;", "const x = `The total cost is`;", True),
    ("template text reworded around a stable interpolation",
     "const x = `Total: ${price * amount} due`;", "const x = `Amount: ${price * amount} owed`;",
     True),
    ("prose in quotes reworded",
     'const m = "Swap failed. Try again.";', 'const m = "The swap failed. Please retry.";', True),
    ("one-word label reworded",
     'const m = "Cancel";', 'const m = "Dismiss";', True),
    ("fetch host retargeted",
     'fetch("https://api.suwappu.bot/v1/x");', 'fetch("https://evil.example/v1/x");', False),
    ("fetch path retargeted",
     'fetch("https://a.io/v1/quote");', 'fetch("https://a.io/v1/execute");', False),
    ("import target changed",
     "import a from './alpha';", "import a from './beta';", False),
    ("href changed",
     '<a href="/pricing">Go</a>', '<a href="/enterprise">Go</a>', False),
    ("href kept, label reworded",
     '<a href="/pricing">Go</a>', '<a href="/pricing">Open</a>', True),
    ("URL inside a template literal retargeted",
     "const u = `https://a.io/${id}`;", "const u = `https://b.io/${id}`;", False),
    ("nested template inside an interpolation, code changed",
     "const x = `A ${f(`B ${y + 1}`)} C`;", "const x = `A ${f(`B ${y - 1}`)} C`;", False),
    ("nested template, inner prose reworded",
     "const x = `A ${f(`B now`)} C`;", "const x = `A ${f(`B later`)} C`;", True),
    ("object literal inside an interpolation",
     "const x = `v ${ {a:1}.a } w`;", "const x = `v ${ {a:2}.a } w`;", False),
    ("JSX text reworded",
     "<p>Old wording here</p>", "<p>New wording there</p>", True),
    ("reworded comment reads as a change",
     "// old note\nconst a = 1;", "// new note\nconst a = 1;", False),
    ("control flow negated",
     'if (a) { x("Hi"); }', 'if (!a) { x("Hi"); }', False),
    ("apostrophe in double-quoted prose",
     'const m = "You can\'t swap yet.";', 'const m = "You cannot swap yet.";', True),
    ("escaped quote in prose",
     'const m = "She said \\"go\\" now.";', 'const m = "She said \\"stop\\" now.";', True),
    ("division after a template is not read as a comment",
     "const x = `a`; const y = b / c;", "const x = `z`; const y = b / c;", True),
    # A string used as a key or selector is shaped like an identifier, so this
    # gate cannot tell it from a one-word label. Pinned so the gap stays known.
    ("known gap: string object key changed reads as copy",
     'o["userId"] = 1;', 'o["adminId"] = 1;', True),
]


def equivalent(before: str, after: str) -> bool:
    return skeleton(before) == skeleton(after) and (
        string_addresses(before) == string_addresses(after)
    )


def self_test() -> int:
    failed = 0
    for name, before, after, want_equal in SELF_TEST:
        got = equivalent(before, after)
        if got != want_equal:
            failed += 1
            print(f"FAIL {name}: equal={got}, expected {want_equal}")
            print(f"  before: {skeleton(before)}")
            print(f"  after : {skeleton(after)}")
    print(f"{len(SELF_TEST) - failed}/{len(SELF_TEST)} passed")
    return 1 if failed else 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()
    files = sys.argv[1:]
    if not files:
        r = subprocess.run(
            ["git", "diff", "--name-only", "--diff-filter=M"],
            capture_output=True,
            text=True,
            check=True,
        )
        files = [f for f in r.stdout.split() if f.endswith((".ts", ".tsx"))]

    bad = 0
    for f in files:
        old = head(f)
        if old is None:
            continue
        try:
            new = open(f).read()
        except OSError:
            continue
        if skeleton(old) != skeleton(new):
            bad += 1
            print(f"FAIL {f}: code skeleton changed, not just copy")
            continue
        before, after = string_addresses(old), string_addresses(new)
        if before != after:
            bad += 1
            gone = sorted((before - after).elements())
            added = sorted((after - before).elements())
            print(f"FAIL {f}: a URL or path inside a string changed")
            for a in gone:
                print(f"  - {a}")
            for a in added:
                print(f"  + {a}")
    print(f"{len(files)} file(s) checked, {bad} with code changes")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
