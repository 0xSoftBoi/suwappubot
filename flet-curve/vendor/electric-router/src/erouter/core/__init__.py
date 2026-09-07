"""Pure routing core: stdlib + numpy only, no chain access, no I/O.

This package is lifted wholesale into the Pyodide/Flet frontend, so it must not
import boa, requests, eth_abi, or scipy.  `tests/test_purity.py` enforces that.
"""
