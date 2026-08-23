#!/usr/bin/env python3
"""Assemble the router into `src/`, from the `electric-router` submodule.

Three things come across, and each is here for a different reason.

The **Python package** (`src/erouter/`) is copied rather than installed,
because `flet publish` tars `src/` and micropip cannot install from a git
checkout inside Pyodide.  Only `core` and `chain` are needed to route -- `dev`
owns urllib, a CLI and a socket -- but the whole package comes over anyway:
`dev` imports lazily, nothing on the browser path reaches it, and a partial
copy is a way to discover at runtime that something did.

The **committed data** (`src/assets/router/data/`) is the slot cache, the
model verdicts and the measured facts.  A checkout starts warm because of
those files; a browser fetches them over HTTP instead of reading them.

The **wasm module** (`src/assets/router/`) is the solver and the EVM.  It is
built by the submodule's own `scripts/build_wasm.sh`, which needs a rustup
toolchain -- see `vendor/electric-router/rust/README.md`.

Everything written here is gitignored: it is a build product, like
`src/assets/curve/`.

    python tools/build_router.py            # package + data + wasm
    python tools/build_router.py --native   # and the desktop extensions
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
#: The submodule is the committed truth.  `--source` points at a working
#: checkout instead, which is how the two repos are developed together without
#: a commit-and-fetch round trip between every edit.
SOURCE = ROOT / "vendor" / "electric-router"
PACKAGE = ROOT / "src" / "erouter"
ASSETS = ROOT / "src" / "assets" / "router"

#: The committed caches, and where a `DataSource` looks for each.  Names match
#: `erouter.chain.session`'s `*_FILE` constants, so one layout serves a
#: checkout and a web root.
DATA = (
    ("data/evm-state", "evm-state", "*.json.gz"),
    ("data/exact", "exact", "*.json"),
    ("data/facts", "facts", "*.json"),
    ("data/quoter", "quoter", "RouteQuoter.runtime.hex"),
)

#: What `wasm-bindgen --target web` emits that the app actually loads.  The
#: `.d.ts` files are for a TypeScript caller and would only be dead weight in
#: the bundle.
WASM_FILES = ("erouter_wasm.js", "erouter_wasm_bg.wasm")


def _use_source(path: Path) -> None:
    """Build from a working checkout rather than the submodule."""
    global SOURCE  # noqa: PLW0603 - one setting, read by every step below
    SOURCE = path


def check_submodule() -> None:
    if not (SOURCE / "src" / "erouter").is_dir():
        sys.exit(
            f"{SOURCE} is empty -- run:\n"
            f"    git submodule update --init vendor/electric-router"
        )


def copy_package() -> int:
    """The router's Python, verbatim.  Returns how many modules came over."""
    source = SOURCE / "src" / "erouter"
    if PACKAGE.exists():
        shutil.rmtree(PACKAGE)
    shutil.copytree(
        source, PACKAGE,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
    )
    return sum(1 for _ in PACKAGE.rglob("*.py"))


def copy_data() -> tuple[int, int]:
    """The committed caches.  Returns (files, bytes)."""
    files = total = 0
    for source_dir, target_dir, pattern in DATA:
        source = SOURCE / source_dir
        target = ASSETS / "data" / target_dir
        target.mkdir(parents=True, exist_ok=True)
        for path in sorted(source.glob(pattern)):
            shutil.copy2(path, target / path.name)
            files += 1
            total += path.stat().st_size
    return files, total


#: What the wasm module is built from.  Anything here newer than the module
#: means the module is stale.
CRATE_SOURCES = ("rust/**/*.rs", "rust/**/Cargo.toml", "rust/Cargo.lock",
                 "rust/rust-toolchain.toml")


def wasm_is_stale(pkg: Path) -> bool:
    """Whether the built module is older than the crates it came from.

    Presence is not currency, and treating it as such is not a hypothetical:
    bumping the submodule to a commit that changed a wasm signature left the
    previous build sitting in `pkg/`, so the new Python called the old module
    with an argument it did not have.  Every quote through the split optimiser
    answered `curve_rate0/curve_tail must have one entry per curve` -- an
    error about arguments, from a module that was simply out of date.
    """
    built = min((pkg / name).stat().st_mtime for name in WASM_FILES)
    for pattern in CRATE_SOURCES:
        for path in SOURCE.glob(pattern):
            if path.is_file() and path.stat().st_mtime > built:
                return True
    return False


def build_wasm(rebuild: bool) -> int:
    """The wasm module, built if it is missing or out of date.

    Returns its size in bytes.
    """
    pkg = SOURCE / "rust" / "wasm" / "pkg"
    missing = [name for name in WASM_FILES if not (pkg / name).exists()]
    if not missing and not rebuild and wasm_is_stale(pkg):
        print("  wasm:    out of date against the crates -- rebuilding")
        rebuild = True
    if missing or rebuild:
        script = SOURCE / "scripts" / "build_wasm.sh"
        # The toolchain lives under the user's home rather than on the system
        # path -- the distribution's rust has no wasm32 target at all.
        env = dict(os.environ)
        env["PATH"] = (f"{Path.home()}/.cargo/bin:{Path.home()}/.local/bin:"
                       + env.get("PATH", ""))
        done = subprocess.run([str(script)], env=env, check=False,
                              capture_output=True, text=True)
        if done.returncode != 0:
            sys.exit(
                f"{script} failed:\n{done.stderr[-2000:]}\n"
                f"See vendor/electric-router/rust/README.md for the toolchain."
            )
    ASSETS.mkdir(parents=True, exist_ok=True)
    size = 0
    for name in WASM_FILES:
        source = pkg / name
        if not source.exists():
            sys.exit(f"{source} was not built")
        shutil.copy2(source, ASSETS / name)
        size += source.stat().st_size
    return size


def build_native() -> None:
    """The desktop extensions, into this checkout's venv.

    The browser loads one wasm module; a desktop build loads two CPython
    extensions built from the same crates.  Both are optional -- the pure
    Python solver answers without `erouter_solve`, and only the EVM is a hard
    requirement, so a missing `erouter_evm` is what the Swap tab checks for.
    """
    venv = ROOT / ".venv"
    if not venv.exists():
        sys.exit(f"no venv at {venv}")
    env = dict(os.environ)
    env["VIRTUAL_ENV"] = str(venv)
    env["PATH"] = (f"{Path.home()}/.cargo/bin:{Path.home()}/.local/bin:"
                   + env.get("PATH", ""))
    for manifest in ("rust/Cargo.toml", "rust/evm/Cargo.toml"):
        done = subprocess.run(
            ["maturin", "develop", "--release", "-m", str(SOURCE / manifest)],
            env=env, check=False, capture_output=True, text=True,
        )
        if done.returncode != 0:
            sys.exit(f"maturin failed for {manifest}:\n{done.stderr[-2000:]}")
        print(f"  built {manifest}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native", action="store_true",
                        help="also build the desktop extensions into .venv")
    parser.add_argument("--rebuild-wasm", action="store_true",
                        help="rebuild the wasm module even if it is present")
    parser.add_argument("--source", type=Path, default=None,
                        help="a working checkout to build from, instead of the "
                             "submodule")
    args = parser.parse_args()

    if args.source is not None:
        _use_source(args.source.resolve())
        print(f"  source:  {SOURCE}")
    check_submodule()
    modules = copy_package()
    print(f"  package: {modules} modules -> {PACKAGE.relative_to(ROOT)}")
    files, total = copy_data()
    print(f"  data:    {files} files, {total / 1e6:.1f} MB -> "
          f"{(ASSETS / 'data').relative_to(ROOT)}")
    size = build_wasm(args.rebuild_wasm)
    print(f"  wasm:    {size / 1e6:.2f} MB -> {ASSETS.relative_to(ROOT)}")
    if args.native:
        build_native()


if __name__ == "__main__":
    main()
