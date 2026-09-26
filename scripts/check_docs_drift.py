#!/usr/bin/env python3
"""Check canonical docs for references to repo paths that no longer exist.

Scans the curated knowledge-base docs (not plans/research, which are allowed
to reference future or historical paths) for markdown links and backtick path
references, and fails if any point at files or directories missing from the
repo. This is the cheap version of the doc-drift gates used at Google (g3doc)
and Mercari — it catches renames/deletions that silently strand the docs.
"""

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

CANONICAL_DOCS = [
    "CLAUDE.md",
    "AGENTS.md",
    "ARCHITECTURE.md",
    "CONVENTIONS.md",
    "bot/CLAUDE.md",
    "api-ts/CLAUDE.md",
    "webapp/CLAUDE.md",
    "docs/README.md",
    "docs/ONBOARDING.md",
    "docs/DECISIONS.md",
    "docs/architecture/OVERVIEW.md",
]

MD_LINK = re.compile(r"\[[^\]]*\]\(([^)#\s]+)(?:#[^)\s]*)?\)")
BACKTICK = re.compile(r"`([^`\s]+)`")
PATH_EXTS = (".py", ".ts", ".tsx", ".md", ".sh", ".json", ".yml", ".yaml", ".css")
PLACEHOLDER_CHARS = set("*<>{}$NNNN")


IGNORED = {".next/", "dist/", "node_modules/", "bot.db"}  # gitignored/runtime


def looks_like_repo_path(ref: str) -> bool:
    if "/" not in ref or "://" in ref or ref.startswith(("http", "mailto")):
        return False
    if ref.startswith("/"):  # URL route (e.g. /.well-known/...), not a repo path
        return False
    if any(c in ref for c in "*<>{}$") or "NNNN" in ref or ref in IGNORED:
        return False
    return ref.endswith(PATH_EXTS) or ref.endswith("/")


def resolve(ref: str, doc: Path) -> bool:
    ref = ref.rstrip("/")
    return (REPO / ref).exists() or (doc.parent / ref).exists()


def main() -> int:
    missing = []
    for rel in CANONICAL_DOCS:
        doc = REPO / rel
        docs_dir = sorted((REPO / "docs" / "adr").glob("*.md")) if rel == "docs/README.md" else []
        for path in [doc] + docs_dir:
            if not path.exists():
                missing.append((rel, "(canonical doc itself is missing)"))
                continue
            text = path.read_text(encoding="utf-8")
            refs = set(MD_LINK.findall(text))
            refs |= {m for m in BACKTICK.findall(text) if looks_like_repo_path(m)}
            for ref in sorted(refs):
                if ref.startswith(("http", "mailto")) or "://" in ref:
                    continue
                if not resolve(ref, path):
                    missing.append((str(path.relative_to(REPO)), ref))

    if missing:
        print("✗ Docs reference repo paths that do not exist:")
        for doc, ref in missing:
            print(f"  {doc}: {ref}")
        print("  Fix the doc (or the path) — canonical docs must not drift.")
        return 1
    print(f"✓ {len(CANONICAL_DOCS)} canonical docs + ADRs: all path references resolve")
    return 0


if __name__ == "__main__":
    sys.exit(main())
