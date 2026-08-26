"""The compiled halves, when they arrive as a wasm module instead of a wheel.

Pyodide cannot load this repo's extensions: a PyO3 wheel would have to match
Pyodide's own Emscripten build *and* be built with a pyo3 that targets its
CPython, which 0.23 does not for 3.14.  `rust/wasm` sidesteps both by being a
wasm-bindgen module for the browser's own target -- and this package is what
makes it answer to the names the rest of the tree imports.

`install()` registers `erouter_solve` and `erouter_evm` in `sys.modules`, so
`core/accel.py` finds a solver by doing exactly what it already does.  **It has
to run before `erouter.core` is first imported**, because that import is what
decides whether the accelerator is there.

Nothing in `erouter.core` imports this, and nothing here is importable outside
a browser: `js` and `pyodide` do not exist anywhere else.
"""

from __future__ import annotations

import sys

__all__ = ["install", "installed"]

_MODULE = "erouter_wasm.js"


def installed() -> bool:
    """Whether the two names are already served."""
    return "erouter_solve" in sys.modules and "erouter_evm" in sys.modules


async def install(base_url: str, *, force: bool = False) -> str:
    """Load the module from `base_url` and register both names.

    Returns the module's version.  `base_url` is a directory URL -- the glue
    fetches its `.wasm` from beside itself, so the two must stay together.
    """
    if installed() and not force:
        from . import _solve

        return _solve.version()

    from pyodide.code import run_js

    url = base_url.rstrip("/") + "/" + _MODULE
    # A dynamic `import()` rather than `importScripts`: the Flet worker is a
    # module worker (Pyodide >= 0.29 refuses to run in a classic one), so ESM
    # is the only shape that loads.  `run_js` hands back the promise.
    module = await run_js(f"import({url!r})")
    # `default` is wasm-bindgen's `init`, which fetches the .wasm beside the
    # glue.  Calling it twice is harmless -- it returns early once initialised
    # -- but a *reload* needs a fresh URL, which `force` does not give it.
    await module.default()

    from . import _evm, _solve

    _solve.bind(module)
    _evm.bind(module)
    sys.modules["erouter_solve"] = _solve
    sys.modules["erouter_evm"] = _evm
    return _solve.version()
