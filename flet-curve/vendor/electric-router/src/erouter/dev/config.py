"""Load the gitignored `networks.py`.

Uses `importlib.util.spec_from_file_location` rather than a plain import, so it
works regardless of cwd and never pollutes `sys.path` -- the same idiom as
~/Projects/yb-core/scripts/scan_conversion_discount.py:44.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
from types import ModuleType

_HERE = Path(__file__).resolve()
REPO_ROOT = _HERE.parents[3]  # src/erouter/dev/config.py -> repo root

_cached: ModuleType | None = None


def _candidates() -> list[Path]:
    found = []
    if env := os.environ.get("EROUTER_NETWORKS"):
        found.append(Path(env).expanduser())
    found.append(REPO_ROOT / "networks.py")
    cwd = Path.cwd()
    found.extend([cwd / "networks.py", *[p / "networks.py" for p in cwd.parents]])
    return found


def networks() -> ModuleType:
    """The `networks` module, loaded once."""
    global _cached
    if _cached is not None:
        return _cached
    for path in _candidates():
        if path.is_file():
            spec = importlib.util.spec_from_file_location("_erouter_networks", path)
            assert spec is not None and spec.loader is not None
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            _cached = module
            return module
    raise FileNotFoundError(
        f"networks.py not found (looked in {REPO_ROOT} and cwd upwards).\n"
        f"Copy {REPO_ROOT / 'networks.example.py'} to {REPO_ROOT / 'networks.py'} "
        "and fill in your RPC endpoints."
    )


def have_networks() -> bool:
    try:
        networks()
    except FileNotFoundError:
        return False
    return True


def rpc_url(attr: str) -> str:
    """Read one endpoint out of networks.py by attribute name."""
    module = networks()
    url = getattr(module, attr, None)
    if not url:
        raise KeyError(f"networks.py has no {attr}; add it or pick another chain")
    return str(url)
