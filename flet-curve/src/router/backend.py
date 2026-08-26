"""Loading the compiled half, whichever form this platform can take it in.

Two forms of one Rust workspace.  A desktop build imports `erouter_evm` and
`erouter_solve` as CPython extensions, built by `tools/build_router.py
--native`.  A browser cannot: a PyO3 wheel would have to match Pyodide's own
Emscripten build *and* a pyo3 that targets its CPython, so the browser loads a
`wasm-bindgen` module instead and `erouter.wasm` registers it under those two
names before anything imports them.

The EVM is required -- there is no pure-Python fallback for executing a pool's
bytecode -- and the solver is not: `erouter.core.accel` answers in numpy when
it is absent, more slowly.  So a missing solver is a note and a missing EVM is
the end of the tab.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

#: Where `tools/build_router.py` puts the wasm module, relative to the web
#: root.  `flet publish` copies `src/assets/*` there, so this is also its path
#: under `src/assets/`.
ASSET_DIR = "router"

#: The Rust solver answers every quote when it is loaded.  It reproduces the
#: Python active set byte for byte -- `test_wasm_differential.py` in the router
#: holds it there, including the cycling and `maxit`-exhaustion paths a clean
#: problem never reaches -- and a warm quote drops from ~600 ms to ~170 ms,
#: which is the difference between quoting as someone types and not.
ACCEL_ENV = "EROUTER_ACCEL"


class BackendError(RuntimeError):
    """The compiled half could not be loaded, with what stopped it."""


@dataclass(frozen=True, slots=True)
class Backend:
    """What loaded, and how to make an EVM with it."""

    evm_factory: Callable[..., Any]
    solver: str          # "rust" | "python"
    platform: str        # "wasm" | "native"
    version: str = ""

    def evm(self, spec: str, chain_id: int):
        return self.evm_factory(spec, chain_id)


def is_browser() -> bool:
    return sys.platform == "emscripten"


async def load_backend(base_url: str = "") -> Backend:
    """Import the extensions, or load and register the wasm module.

    Must run **before** `erouter.core` is first imported: `accel.py` decides
    whether there is a solver at import time, and a registration that arrives
    afterwards is a registration nothing will look at.
    """
    if is_browser():
        return await _load_wasm(base_url)
    return _load_native()


def _load_native() -> Backend:
    try:
        import erouter_evm
    except ImportError as exc:  # pragma: no cover - depends on the build
        raise BackendError(
            "erouter_evm is not installed -- run "
            "`python tools/build_router.py --native`"
        ) from exc
    solver = "python"
    try:
        import erouter_solve  # noqa: F401
    except ImportError:
        pass
    else:
        solver = "rust"
        os.environ.setdefault(ACCEL_ENV, "1")
    return Backend(erouter_evm.Evm, solver, "native",
                   getattr(erouter_evm, "__version__", ""))


async def _load_wasm(base_url: str) -> Backend:
    try:
        from erouter import wasm
    except ImportError as exc:  # pragma: no cover - depends on the build
        raise BackendError(
            "the router package is not in this build -- run "
            "`python tools/build_router.py`"
        ) from exc
    try:
        version = await wasm.install(base_url or _web_base())
    except Exception as exc:
        raise BackendError(f"could not load the wasm module: {exc}") from exc
    import erouter_evm

    os.environ.setdefault(ACCEL_ENV, "1")
    return Backend(erouter_evm.Evm, "rust", "wasm", version)


def _web_base() -> str:
    """Where the module sits, from the worker's own location.

    There is no `window` in a Web Worker but there is a `location`, which is
    what `ui/assets.py` leans on for the same reason.
    """
    from urllib.parse import urljoin

    import js

    return urljoin(js.location.href, ASSET_DIR + "/")
