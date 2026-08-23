"""Finding the compiled curve-assets images, on either platform."""

from __future__ import annotations

import asyncio
import base64
import json
import random
import sys
from functools import lru_cache
from pathlib import Path

#: Where `build_assets.py` writes, relative to the Flet assets directory.
ASSET_ROOT = "curve"

#: How large a compiled mark is, in pixels, on the long side.
MARK_TIERS = (20, 40, 80, 160)

#: The largest tier, and so the size nothing is compiled above.
MARK_PIXELS = MARK_TIERS[-1]


def mark_tier(device_pixels: float) -> int:
    """The smallest compiled size that still covers what will be drawn."""
    for tier in MARK_TIERS:
        if device_pixels <= tier:
            return tier
    return MARK_TIERS[-1]


def tiered(filename: str, tier: int) -> str:
    """`0xabc.png` at tier 64 is `0xabc@64.png`."""
    stem, dot, suffix = filename.rpartition(".")
    return f"{stem}@{tier}{dot}{suffix}" if dot else f"{filename}@{tier}"

#: The same directory on the Python filesystem, for existence checks.
_LOCAL_ROOT = Path(__file__).resolve().parent.parent / "assets" / ASSET_ROOT


def is_browser() -> bool:
    return sys.platform == "emscripten"


@lru_cache(maxsize=1)
def _web_base() -> str:
    """The URL the app was served from, for building absolute asset URLs."""
    try:
        import js

        href = str(js.location.href)
    except Exception:
        return ""
    return href.rsplit("/", 1)[0] + "/"


def asset_url(*parts: str) -> str:
    """Something `ft.Image` can load, for a file under the assets root."""
    path = "/".join((ASSET_ROOT, *parts))
    if not is_browser():
        return path
    return f"{_web_base()}{path}"


@lru_cache(maxsize=4096)
def _exists(relative: str) -> bool:
    """Is the file actually there? Always True in the browser."""
    if is_browser():
        return True
    return (_LOCAL_ROOT / relative).is_file()


#: One bundle at one tier, once fetched: `(directory, tier)` -> image src
#: per name.
_BUNDLES: dict[tuple[str, int], dict[str, str]] = {}

#: Where a chain's coin marks live, and where the network marks do.
TOKENS = "tokens"
CHAINS = "chains"


def token_bundle(chain: str) -> str:
    return f"{TOKENS}/{chain}"

#: Which `(chain, tier, rest)` are settled: fetched, or asked for as often
#: as they are going to be.
_FETCHED: set[tuple[str, int, bool]] = set()

#: How many times each has been asked for, so a failure can be asked again
#: and a success never is.
_TRIES: dict[tuple[str, int, bool], int] = {}

#: Which `(directory, tier)` hold *every* mark there is.  `build_assets`
#: bundles a chain by globbing its whole directory, so once the second half
#: has landed -- or come back 404, meaning there was never a second half --
#: an address the bundle does not know is an address with no image anywhere.
#: Which is worth knowing, because otherwise it is asked for one by one.
_COMPLETE: set[tuple[str, int]] = set()

#: How many times a bundle is asked for before the page settles for
#: individual marks.
BUNDLE_ATTEMPTS = 2


#: Which tiers a build actually bundles, and the source of truth for it --
#: `tools/build_assets.py` imports this rather than keeping its own copy,
#: because the two drifting apart is invisible: the build would write one
#: set and the app would ask for another, every mark would miss, and the
#: only symptom is that the bundles quietly stop being used.
BUNDLED_TIERS = (40, 80)


def bundle_tier(device_pixels: float) -> int:
    """The bundled tier to use for a mark of this size on this screen."""
    wanted = mark_tier(device_pixels)
    covered = [tier for tier in BUNDLED_TIERS if tier >= wanted]
    return min(covered) if covered else max(BUNDLED_TIERS)


#: What the second half of a split bundle is called.
REST_INFIX = "-rest"


def bundle_url(directory: str, tier: int, suffix: str, *, rest: bool = False) -> str:
    """Where a bundle lives. See `BUNDLE_STEM` in build_assets."""
    infix = REST_INFIX if rest else ""
    return asset_url(*directory.split("/"), f"marks@{tier}{infix}{suffix}")


def mark_src(png: bytes) -> str:
    """A PNG held in memory, as something `ft.Image` will paint.

    A string, never the bytes themselves: WebKit -- so every browser on an
    iPhone -- draws `src=<bytes>` as nothing at all, and reports no error,
    so `error_content` never stands in either. Blink draws both.
    """
    return f"data:image/png;base64,{base64.b64encode(png).decode()}"


def remember_bundle(directory: str, tier: int, blob: bytes, index: dict) -> int:
    """Cut a fetched bundle into one drawable mark per address."""
    marks = dict(_BUNDLES.get((directory, tier), {}))
    for address, span in (index or {}).items():
        try:
            start, length = int(span[0]), int(span[1])
        except (TypeError, ValueError, IndexError):
            continue
        chunk = blob[start : start + length]
        if len(chunk) == length and chunk[:4] == b"\x89PNG":
            marks[str(address).lower()] = mark_src(chunk)
    if marks:
        _BUNDLES[(directory, tier)] = marks
    return len(marks)


def forget_bundles() -> None:
    """Drop every cached bundle. For tests, and for a chain switch that wants
    the memory back.
    """
    _BUNDLES.clear()
    _FETCHED.clear()
    _TRIES.clear()
    _COMPLETE.clear()


async def load_bundle(
    directory: str, device_pixels: float, fetch, *, rest: bool = False
) -> int:
    """Fetch one chain's mark bundle and remember it."""
    tier = bundle_tier(device_pixels)
    key = (directory, tier, rest)
    if key in _FETCHED:
        return len(_BUNDLES.get((directory, tier), {}))
    _FETCHED.add(key)
    tries = _TRIES[key] = _TRIES.get(key, 0) + 1
    try:
        blob = await fetch(bundle_url(directory, tier, ".bin", rest=rest))
        raw = await fetch(bundle_url(directory, tier, ".json", rest=rest))
        index = json.loads(bytes(raw))
    except asyncio.CancelledError:
        _FETCHED.discard(key)
        _TRIES[key] = tries - 1
        raise
    except Exception as exc:
        # A 404 on the second half is an answer: `build_assets` only writes
        # one when the first was too big to hold everything, so its absence
        # says the first half *is* everything.
        if rest and getattr(exc, "status", None) == 404:
            _COMPLETE.add((directory, tier))
            return len(_BUNDLES.get((directory, tier), {}))
        if tries < BUNDLE_ATTEMPTS:
            _FETCHED.discard(key)
        return 0
    if rest:
        _COMPLETE.add((directory, tier))
    return remember_bundle(directory, tier, bytes(blob), index)


def have_every_mark(directory: str, device_pixels: float) -> bool:
    """Whether what is held for this directory is all there is to hold."""
    return (directory, bundle_tier(device_pixels)) in _COMPLETE


def bundled_mark(chain: str, address: str, device_pixels: float) -> str | None:
    """One mark out of a fetched bundle, or None if it is not there."""
    if not chain or not address:
        return None
    return _bundled(token_bundle(chain), address, device_pixels)


def bundled_chain(name: str, device_pixels: float) -> str | None:
    """A network's mark out of the `chains` bundle, or None."""
    return _bundled(CHAINS, name, device_pixels)


def _held(directory: str, tier: int) -> dict[str, str] | None:
    """The bundle to serve this tier from, out of what was actually fetched."""
    loaded = sorted(
        held for (held_directory, held) in _BUNDLES if held_directory == directory
    )
    if not loaded:
        return None
    covering = [held for held in loaded if held >= tier]
    return _BUNDLES[(directory, covering[0] if covering else loaded[-1])]


def _bundled(directory: str, name: str, device_pixels: float) -> str | None:
    if not directory or not name:
        return None
    marks = _held(directory, bundle_tier(device_pixels))
    return marks.get(name.strip().lower()) if marks else None


def chain_logo(chain: str, device_pixels: float = MARK_PIXELS) -> str | None:
    """The network's mark, for the chain picker."""
    name = (chain or "").strip().lower()
    if not name:
        return None
    filename = tiered(f"{name}.png", mark_tier(device_pixels))
    relative = f"chains/{filename}"
    return asset_url("chains", filename) if _exists(relative) else None


def token_logo(
    chain: str, address: str, device_pixels: float = MARK_PIXELS
) -> str | None:
    """A token's mark, as a file of its own.  Named by lowercased address.

    Only reached when the bundle did not have it, so once the bundle holds
    everything this is asking for a file that is not there.  On a desktop
    build `_exists` catches that; in a browser nothing can, and the Swap
    tab's picker -- which offers every routable coin, hundreds of them, where
    the pool list only ever showed a page -- turned that into a screenful of
    404s and a retry for each.
    """
    if not chain or not address:
        return None
    if is_browser() and have_every_mark(token_bundle(chain), device_pixels):
        return None
    filename = tiered(f"{address.strip().lower()}.png", mark_tier(device_pixels))
    relative = f"tokens/{chain}/{filename}"
    return asset_url("tokens", chain, filename) if _exists(relative) else None


def curve_logo() -> str | None:
    """The Curve mark, without the wordmark, for the header."""
    return asset_url("branding", "logo.svg") if _exists("branding/logo.svg") else None


def bundled(name: str) -> str:
    """A file committed straight into `src/assets`."""
    return name if not is_browser() else f"{_web_base()}{name}"


def chad_mark() -> str:
    """The Chad, for the theme button."""
    return bundled("chad.png")


#: The sticker pack that sits where a route will go, before there is one.
#: Listed rather than discovered: in the browser there is no directory to
#: read, only files that can be fetched by name.
MEMES = (
    "001.webp", "002.webp", "003.webp", "004.webp", "005.webp", "006.webp",
    "007.webp", "008.webp", "009.webp", "010.webp", "011.webp", "012.webp",
    "013.webp", "014.webp", "015.webp", "016.webp", "017.webp", "018.webp",
    "019.webp", "020.webp", "021.webp", "022.webp", "024.webp", "025.webp",
    "026.webp", "028.webp", "030.webp",
)


def meme(pick=random.choice) -> str | None:
    """One of the stickers, at random, or nothing if none were bundled."""
    return bundled(f"memes/{pick(MEMES)}") if MEMES else None


#: Chains whose display name is not just a capitalisation of the API's.
CHAIN_NAMES = {
    "bsc": "BNB Chain",
    "xdai": "Gnosis",
    "zksync": "zkSync",
    "zkevm": "Polygon zkEVM",
    "x-layer": "X Layer",
    "arbitrum": "Arbitrum",
    "avalanche": "Avalanche",
    "fraxtal": "Fraxtal",
    "hyperliquid": "Hyperliquid",
}


def chain_name(chain: str) -> str:
    """"ethereum" -> "Ethereum", "bsc" -> "BNB Chain"."""
    if not chain:
        return ""
    known = CHAIN_NAMES.get(chain.lower())
    if known:
        return known
    return " ".join(part.capitalize() for part in chain.replace("_", "-").split("-"))
