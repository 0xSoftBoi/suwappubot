"""Pin the deploy-freshness checker to the app fingerprint algorithm."""

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
    text = (REPO / "api" / "main.py").read_text()
    tree = ast.parse(text)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "_compute_source_fingerprint":
            return ast.get_source_segment(text, node) or ""
    pytest.fail("api/main.py no longer defines _compute_source_fingerprint")


def test_script_hashes_the_same_directories_as_the_app():
    mod = _load_script()
    src = _fingerprint_func_source()
    for d in mod.HASHED_DIRS:
        assert f'"{d}"' in src
    for d in ("api", "bot", "database"):
        if f'"{d}"' in src:
            assert d in mod.HASHED_DIRS


def test_script_truncates_to_the_same_length_as_the_app():
    mod = _load_script()
    src = _fingerprint_func_source()
    assert f"[:{mod.FINGERPRINT_LEN}]" in src


def test_script_skips_pycache_like_the_app():
    assert "__pycache__" in _fingerprint_func_source()
    assert "__pycache__" in SCRIPT.read_text()


def test_expected_fingerprint_matches_a_direct_hash_of_the_same_ref():
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
    mod = _load_script()
    assert mod.expected_fingerprint("HEAD") != "unknown"
