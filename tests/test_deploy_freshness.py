"""Pin the deploy-freshness checker to the app's own fingerprint algorithm.

`scripts/check_deploy_freshness.py` deliberately re-implements
`api/main.py::_compute_source_fingerprint` — it must run in CI without booting
the app (which needs settings, a DB and Redis). A re-implementation is only
safe if something fails when the two drift apart, otherwise the checker
silently starts comparing the wrong thing and reports every deploy as stale
(noise, then ignored) or every deploy as fresh (the incident, again).

Context: on 2026-08-15 python-worker served three-week-old code while the
Railway deploy said SUCCESS and /health said ready. Nothing compared what was
running against what was merged.
"""

from __future__ import annotations

import ast
import hashlib
import importlib.util
import pathlib
import subprocess

import pytest

REPO = pathlib.Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "check_deploy_freshness.py"


def _load_script():
    spec = importlib.util.spec_from_file_location("check_deploy_freshness", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _fingerprint_func_source() -> str:
    """The body of api/main.py::_compute_source_fingerprint, as text."""
    tree = ast.parse((REPO / "api" / "main.py").read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "_compute_source_fingerprint":
            return ast.get_source_segment((REPO / "api" / "main.py").read_text(), node) or ""
    pytest.fail("api/main.py no longer defines _compute_source_fingerprint")


def test_script_hashes_the_same_directories_as_the_app():
    mod = _load_script()
    src = _fingerprint_func_source()
    for d in mod.HASHED_DIRS:
        assert f'"{d}"' in src, f"script hashes {d!r} but api/main.py does not"
    # And the reverse: the app must not hash a directory the script ignores.
    for d in ("api", "bot", "database"):
        if f'"{d}"' in src:
            assert d in mod.HASHED_DIRS, f"api/main.py hashes {d!r} but the script does not"


def test_script_truncates_to_the_same_length_as_the_app():
    mod = _load_script()
    src = _fingerprint_func_source()
    assert (
        f"[:{mod.FINGERPRINT_LEN}]" in src
    ), f"script truncates to {mod.FINGERPRINT_LEN} chars; api/main.py disagrees"


def test_script_skips_pycache_like_the_app():
    mod = _load_script()
    src = _fingerprint_func_source()
    assert "__pycache__" in src
    assert "__pycache__" in SCRIPT.read_text()


def test_expected_fingerprint_matches_a_direct_hash_of_the_same_ref():
    """The git-blob walk must agree with a plain hash of the same content.

    This is the part that actually has to be right: if the ordering, the path
    encoding or the file selection differs from the app's `sorted(rglob)`, the
    checker compares two unrelated hashes and its verdict is meaningless.
    """
    mod = _load_script()
    try:
        subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        pytest.skip("not a git checkout")

    from_git = mod.expected_fingerprint("HEAD")

    listing = subprocess.run(
        ["git", "ls-tree", "-r", "--name-only", "HEAD"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    paths = sorted(
        p
        for p in listing
        if p.endswith(".py")
        and p.split("/", 1)[0] in ("api", "bot", "database")
        and "__pycache__" not in p.split("/")
    )
    digest = hashlib.sha256()
    for p in paths:
        blob = subprocess.run(
            ["git", "show", f"HEAD:{p}"], cwd=REPO, capture_output=True, check=True
        ).stdout
        digest.update(p.encode())
        digest.update(blob)

    assert from_git == digest.hexdigest()[:12]
    assert len(from_git) == 12


def test_unknown_worker_fingerprint_is_never_treated_as_fresh():
    """A worker that has not published a build in 24h reports 'unknown'.

    That is a missing signal, not agreement — treating it as a match would
    reproduce exactly the blind spot this script exists to close.
    """
    mod = _load_script()
    assert mod.expected_fingerprint("HEAD") != "unknown"
