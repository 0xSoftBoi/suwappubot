"""Local, per-installation configuration."""

from __future__ import annotations

import os
import tomllib
from functools import lru_cache
from pathlib import Path
from typing import Any

CONFIG_PATH = Path(__file__).resolve().parents[1] / "local_config.toml"

#: TOML key -> environment variable, per section.
_ENV = {
    ("walletconnect", "project_id"): "FLET_PAY_WALLETCONNECT_PROJECT_ID",
    ("walletconnect", "module_url"): "FLET_PAY_WALLETCONNECT_MODULE_URL",
    ("walletconnect", "icon"): "FLET_PAY_WALLETCONNECT_ICON",
}

#: TOML key -> the key the JS bridge expects.
_BRIDGE_KEYS = {
    ("walletconnect", "project_id"): "walletConnectProjectId",
    ("walletconnect", "module_url"): "walletConnectModuleUrl",
    ("walletconnect", "icon"): "walletConnectIcon",
    ("walletconnect", "chains"): "walletConnectChains",
}


#: What the app has offered for keys nobody configured.  A WalletConnect
#: session is proposed once, at connect time, with every chain it may ever
#: use, and a chain left out of that proposal cannot be switched to
#: afterwards -- the wallet answers "the chain is not approved", and a Safe
#: says the dApp does not support its network.  Which chains those are is a
#: question about the *app*, not about this installation, so the app answers
#: it and a configured value still wins.
_offered: dict[str, Any] = {}


def offer_default(bridge_key: str, value: Any) -> None:
    """Supply a bridge setting for anyone who has not configured one."""
    if value in (None, "", []):
        _offered.pop(bridge_key, None)
        return
    _offered[bridge_key] = value


@lru_cache(maxsize=1)
def _file_values() -> dict[str, Any]:
    """Parse the config file. Missing or malformed is not fatal."""
    try:
        return tomllib.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, tomllib.TOMLDecodeError) as exc:
        print(f"[wallet] ignoring {CONFIG_PATH.name}: {exc}")
        return {}


def get(section: str, key: str, default: Any = None) -> Any:
    """One setting: environment first, then the file, then `default`."""
    env_var = _ENV.get((section, key))
    if env_var and os.environ.get(env_var):
        return os.environ[env_var]
    value = _file_values().get(section, {}).get(key, default)
    return default if value in ("", []) else value


def bridge_config() -> dict[str, Any]:
    """Settings to hand to the browser bridge, in its own key names."""
    resolved: dict[str, Any] = dict(_offered)
    for (section, key), bridge_key in _BRIDGE_KEYS.items():
        value = get(section, key)
        if value not in (None, "", []):
            resolved[bridge_key] = value
    return resolved


def describe() -> str:
    """One line for logs: what was configured, without dumping the values."""
    keys = sorted(bridge_config())
    if not keys:
        return f"no local config ({CONFIG_PATH.name} absent or empty)"
    return f"local config: {', '.join(keys)}"
