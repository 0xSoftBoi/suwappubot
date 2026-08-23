"""Electric Router -- optimal Curve routing as a linear resistor network with diodes.

`erouter.core`  pure Python + numpy, portable to Pyodide
`erouter.dev`   CPython-only: RPC, boa, Curve API, CLI
"""

import os as _os

__version__ = "0.1.0"

# Before numpy loads, and therefore before anything in this package that
# imports it.  Here rather than in an entry point because *this* module is the
# one Python is guaranteed to run first: `erouter.anything` imports `erouter`.
#
# **For reproducibility, not speed.**  A threaded reduction sums in whatever
# order the threads finish, so the 12.4 flow-conservation residual moves between
# runs -- on one pair it straddled the tolerance and the route failed with eight
# threads and succeeded with one.  Each pivot is `n` = 5-10 (9.4), where
# threading is pure overhead anyway.
#
# `setdefault`, so a caller who has already chosen keeps their choice, and
# EROUTER_BLAS_THREADS overrides.
_THREADS = _os.environ.get("EROUTER_BLAS_THREADS", "1")
for _var in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS",
             "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    _os.environ.setdefault(_var, _THREADS)
