"""Moved to `erouter.chain.vault_params` -- ERC4626 conversion readers.

Kept as a re-export because much of `dev` imports it from here, and because
where a module lives answers "can a browser run it", not "what does it do".
`erouter.chain` is everything that reads a chain through a `Transport` and
opens no socket of its own; `tests/test_purity.py` holds it to the same rule
`core` lives under.
"""

from __future__ import annotations

from ..chain import vault_params as _moved
from ..chain.vault_params import *  # noqa: F403

__all__ = [name for name in dir(_moved) if not name.startswith("_")]
