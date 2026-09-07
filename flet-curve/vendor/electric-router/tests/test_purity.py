"""`erouter.core` must stay importable in a browser.

The eventual target is a Pyodide/Flet frontend whose entire runtime dependency
list is `flet` + `flet-charts` -- no web3.py, no eth-abi, no titanoboa, because
compiled dependencies make a wasm32 build impossible or enormous.

The failure mode this guards is slow, not loud: `eth_abi` creeping into the leg
codec, `scipy` into the solve, `requests` into discovery.  Each is individually
reasonable and collectively a rewrite, and nothing else would notice until port
day.  So it is a test, from the first commit.
"""

from __future__ import annotations

import ast
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1] / "src" / "erouter"
CORE = ROOT / "core"
#: Everything that reads a chain through a `Transport` and opens no socket:
#: the dialects and balances, the wrapper stages, the exact-model readers, the
#: slot cache and the local EVM.  Held to the same rule as `core`, because the
#: frontend runs the wei-exact gate itself rather than trusting verdicts it did
#: not check (`docs/browser-port.md` section 4) -- so this is the other half of
#: what has to survive under Pyodide.
CHAIN = ROOT / "chain"

# Anything that is not stdlib or numpy.  scipy is allowed *inside functions*
# (an optional fast path) but never at module scope, so it can never be a hard
# import requirement.
FORBIDDEN = {
    "boa",
    "titanoboa",
    "requests",
    "eth_abi",
    "eth_account",
    "eth_utils",
    "web3",
    "vyper",
    "urllib",
    "scipy",
}
FORBIDDEN_AT_MODULE_SCOPE_ONLY = {"scipy"}

CORE_FILES = sorted(CORE.rglob("*.py"))
CHAIN_FILES = sorted(CHAIN.rglob("*.py"))
PORTABLE = CORE_FILES + CHAIN_FILES


def test_core_package_is_populated():
    assert CORE_FILES, f"no modules found under {CORE}"


def test_chain_package_is_populated():
    assert CHAIN_FILES, f"no modules found under {CHAIN}"


def _module_scope_imports(tree: ast.Module):
    """Top-level imports only -- imports inside a function are lazy and fine."""
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield alias.name, node.lineno
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            yield node.module, node.lineno


@pytest.mark.parametrize("path", PORTABLE, ids=lambda p: p.name)
def test_no_forbidden_module_scope_imports(path):
    tree = ast.parse(path.read_text(), filename=str(path))
    package = path.parent.name
    for name, lineno in _module_scope_imports(tree):
        root = name.split(".")[0]
        assert root not in FORBIDDEN, (
            f"{path.name}:{lineno} imports {name!r} at module scope. "
            f"erouter.{package} must stay stdlib + numpy so it can run "
            f"under Pyodide."
        )


@pytest.mark.parametrize("path", PORTABLE, ids=lambda p: p.name)
def test_no_imports_from_dev(path):
    """Neither may reach into dev; the dependency arrow points one way.

    `chain` may import `core` and does, so it is allowed one level of escape
    -- what it must not do is reach sideways into `dev`, which owns the socket
    and the CLI.  `core` may not escape at all.
    """
    tree = ast.parse(path.read_text(), filename=str(path))
    in_core = path.parent.name == "core"
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom):
            continue
        if node.module and "dev" in node.module.split("."):
            pytest.fail(f"{path.name}:{node.lineno} imports from erouter.dev")
        if node.level >= 2 and in_core:
            pytest.fail(
                f"{path.name}:{node.lineno} uses a relative import that escapes erouter.core"
            )
        if node.level >= 3:
            pytest.fail(
                f"{path.name}:{node.lineno} uses a relative import that escapes erouter"
            )


def test_the_portable_half_imports_with_forbidden_packages_blocked():
    """Import every portable module where the banned packages cannot load.

    Stronger than the AST check: it catches a transitive dependency that only
    shows up at import time, which is exactly how a port breaks.  Covers
    `chain` as well as `core`, since the frontend imports both.
    """
    import subprocess
    import sys
    import textwrap

    blocked = sorted(FORBIDDEN - {"urllib"})
    modules = [
        f"erouter.{path.parent.name}.{path.stem}"
        for path in PORTABLE
        if path.name != "__init__.py"
    ]
    script = textwrap.dedent(f"""
        import importlib, sys
        BLOCKED = {blocked!r}

        class Blocker:
            def find_module(self, name, path=None):
                return self.find_spec(name, path)
            def find_spec(self, name, path=None, target=None):
                if name.split(".")[0] in BLOCKED:
                    raise ImportError(
                        f"{{name}} is banned in the portable half (Pyodide portability)"
                    )
                return None

        sys.meta_path.insert(0, Blocker())
        for name in {modules!r}:
            importlib.import_module(name)
        print("ok")
    """)
    result = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, timeout=120
    )
    assert result.returncode == 0, result.stderr
    assert "ok" in result.stdout
