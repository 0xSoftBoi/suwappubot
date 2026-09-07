"""Icons the app ships for connectors that announce none."""

from __future__ import annotations

from base64 import b64encode
from functools import cache
from pathlib import Path

_ICON_DIR = Path(__file__).parent / "icons"

_MIME = {
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}

#: Connector id (as reported by the bridge) -> bundled icon filename.
_BY_CONNECTOR = {
    "walletconnect": "walletconnect.svg",
}


@cache
def data_uri(filename: str) -> str | None:
    """Load a bundled icon as a `data:` URI, or None if it is missing."""
    path = _ICON_DIR / filename
    mime = _MIME.get(path.suffix.lower())
    if mime is None:
        return None
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    return f"data:{mime};base64,{b64encode(raw).decode('ascii')}"


def for_connector(connector: str | None) -> str | None:
    """The icon this app ships for a connector, if any."""
    filename = _BY_CONNECTOR.get(connector or "")
    return data_uri(filename) if filename else None
