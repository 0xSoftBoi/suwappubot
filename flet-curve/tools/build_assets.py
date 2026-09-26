#!/usr/bin/env python3
"""Compile the subset of curve-assets this app needs into `src/assets`."""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sys
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "vendor" / "curve-assets"
TARGET = ROOT / "src" / "assets" / "curve"

#: Upstream puts Ethereum in `images/assets` and everything else in
#: `images/assets-<chain>`, where `<chain>` is the name Curve's API uses --
#: which is why Gnosis appears as `assets-xdai`.
def token_dir(chain: str) -> str:
    return "assets" if chain == "ethereum" else f"assets-{chain}"


def available_chains(source: Path) -> list[str]:
    """Every chain the submodule has token images for."""
    images = source / "images"
    if not images.is_dir():
        return []
    chains = ["ethereum"] if (images / "assets").is_dir() else []
    chains += sorted(
        item.name[len("assets-") :]
        for item in images.iterdir()
        if item.is_dir() and item.name.startswith("assets-")
    )
    return chains


#: How much breathing room a full-bleed logo gets, as a fraction of its
#: width.
BLEED_PAD = 0.20

#: The size marks are compiled down to. Defined next to the code that reads
#: them back, so the decoder cannot be told to ask for resolution this step
#: did not produce -- see `ui.assets.MARK_PIXELS`.
sys.path.insert(0, str(ROOT / "src"))
from curve.http import USER_AGENT  # noqa: E402
from ui.assets import (  # noqa: E402
    BUNDLED_TIERS,
    MARK_PIXELS,
    MARK_TIERS,
    tiered,
)


def tier_paths(target: Path) -> list[tuple[int, Path]]:
    """Every size one source image is written at, and where."""
    return [(tier, target.with_name(tiered(target.name, tier))) for tier in MARK_TIERS]


def shrink(image, target: int = MARK_PIXELS):
    """`image` at `target` pixels on the long side, or unchanged if smaller."""
    import numpy as np
    from PIL import Image

    if max(image.size) <= target:
        return image

    rgba = np.asarray(image.convert("RGBA"), dtype=np.float64)
    alpha = rgba[..., 3] / 255.0
    premultiplied = rgba[..., :3] * alpha[..., None]

    width, height = image.size
    scale = target / max(width, height)
    size = (max(1, round(width * scale)), max(1, round(height * scale)))

    def resized(plane: np.ndarray) -> np.ndarray:
        return np.asarray(
            Image.fromarray(plane.astype(np.float32), "F").resize(
                size, Image.Resampling.BOX
            ),
            dtype=np.float64,
        )

    small_alpha = resized(rgba[..., 3])
    out = np.zeros((size[1], size[0], 4))
    out[..., 3] = small_alpha

    coverage = small_alpha / 255.0
    lit = coverage > 0
    for channel in range(3):
        out[..., channel][lit] = resized(premultiplied[..., channel])[lit] / coverage[lit]

    return Image.fromarray(out.round().clip(0, 255).astype("uint8"), "RGBA")


#: How much transparent room a mark keeps around its disc, as a fraction of
#: its width.
DISC_MARGIN = 0.02

#: How finely the outline is sampled before being averaged down into the
#: alpha channel.
DISC_SUPERSAMPLE = 8


@lru_cache(maxsize=4)
def disc_alpha(size: int):
    """A circular coverage mask, 0.0 to 1.0, antialiased at its edge."""
    import numpy as np

    s = DISC_SUPERSAMPLE
    fine = size * s
    axis = (np.arange(fine) + 0.5) / s
    dx = axis - size / 2
    inside = (dx[None, :] ** 2 + dx[:, None] ** 2) <= (
        size / 2 * (1 - DISC_MARGIN)
    ) ** 2
    return inside.reshape(size, s, size, s).mean(axis=(1, 3))


def round_off(image):
    """Cut the mark to a disc *in the alpha channel*, with a soft edge."""
    import numpy as np
    from PIL import Image

    square = image.convert("RGBA")
    width, height = square.size
    if width != height:
        side = max(width, height)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(square, ((side - width) // 2, (side - height) // 2))
        square = canvas

    rgba = np.asarray(square).astype(np.float64)
    rgba[..., 3] *= disc_alpha(rgba.shape[0])
    return Image.fromarray(rgba.round().clip(0, 255).astype("uint8"), "RGBA")


def pad_full_bleed(path: Path, target: Path) -> bool:
    """Copy a token image, giving a full-bleed one room to be a circle."""
    from PIL import Image

    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        width, height = rgba.size
        spots = ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1))
        corners = [rgba.getpixel(spot) for spot in spots]
        if any(not isinstance(pixel, tuple) or pixel[3] == 0 for pixel in corners):
            for tier, out in tier_paths(target):
                round_off(shrink(rgba, tier)).save(out, optimize=True)
            return False

        pad = round(width * BLEED_PAD)
        canvas = Image.new("RGBA", (width + pad * 2, height + pad * 2), corners[0])
        canvas.paste(rgba, (pad, pad), rgba)
        for tier, out in tier_paths(target):
            round_off(shrink(canvas, tier)).save(out, optimize=True)
    return True


def shrink_file(path: Path, target: Path) -> None:
    """Copy one image at every tier a mark is compiled at."""
    from PIL import Image

    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        for tier, out in tier_paths(target):
            round_off(shrink(rgba, tier)).save(out, optimize=True)


def copy_tree(source: Path, target: Path, *, tokens: bool = False) -> tuple[int, int]:
    if not source.is_dir():
        return 0, 0
    target.mkdir(parents=True, exist_ok=True)
    files = size = padded = 0
    for item in source.iterdir():
        if not item.is_file():
            continue
        destination = target / item.name
        if item.suffix.lower() == ".png":
            if tokens:
                padded += pad_full_bleed(item, destination)
            else:
                shrink_file(item, destination)
            for _tier, out in tier_paths(destination):
                files += 1
                size += out.stat().st_size
            continue
        shutil.copy2(item, destination)
        files += 1
        size += destination.stat().st_size
    if padded:
        print(f"  padded {padded} full-bleed logo(s) in {target.name}")
    return files, size


#: The per-chain bundle: every mark of one chain at one tier, end to end.
BUNDLE_STEM = "marks"

#: Which tiers get a bundle, against all four for the individual files.
BUNDLE_TIERS = BUNDLED_TIERS

#: Split a chain's bundle in two once it is worth splitting.
SPLIT_ABOVE = 1 << 20

#: How many tokens go in the hot half. Measured against the top 50 pools on
#: Ethereum, which is the first page anybody sees: 100 tokens 460 KB 86.4%
#: of the marks on that page 150 tokens 657 KB 93.2% 200 tokens 883 KB 96.1%
#: 627 tokens 2852 KB 100% 150 buys most of the page for a quarter of the
#: bytes.
HOT_TOKENS = 150

#: Where the second half goes. `marks@80.bin` stays the name of the one that
#: must arrive, so a chain that is not split needs no special case and
#: neither does a reader.
REST_INFIX = "-rest"


def bundle_name(tier: int, suffix: str, *, rest: bool = False) -> str:
    """`marks@80.bin`, `marks@80.json`, and the `-rest` pair beside them."""
    return f"{BUNDLE_STEM}@{tier}{REST_INFIX if rest else ''}{suffix}"


def hot_order(chain: str) -> list[str]:
    """Token addresses for one chain, most-used first, or `[]`."""
    import urllib.request
    from collections import Counter

    registries = (
        "main", "factory-stable-ng", "factory-crypto",
        "factory-twocrypto", "factory-tricrypto", "crypto", "factory",
    )
    pools: list[dict] = []
    for registry in registries:
        url = f"https://api.curve.finance/api/getPools/{chain}/{registry}"
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                pools += json.load(response).get("data", {}).get("poolData", []) or []
        except Exception:
            continue
    if not pools:
        return []
    pools.sort(key=lambda p: -(p.get("volumeUSD") or p.get("usdTotal") or 0))
    seen: Counter = Counter()
    for pool in pools:
        for coin in pool.get("coins") or []:
            if address := (coin.get("address") or "").lower():
                seen[address] += 1
    return [address for address, _count in seen.most_common()]


def pack(marks: list[Path]) -> tuple[bytes, dict]:
    """The PNGs end to end, and where each one starts."""
    blob, index, at = bytearray(), {}, 0
    for mark in marks:
        data = mark.read_bytes()
        index[mark.name.split("@")[0]] = (at, len(data))
        blob += data
        at += len(data)
    return bytes(blob), index


def write_bundle(target: Path, tier: int, marks: list[Path], *, rest: bool = False) -> int:
    blob, index = pack(marks)
    (target / bundle_name(tier, ".bin", rest=rest)).write_bytes(blob)
    (target / bundle_name(tier, ".json", rest=rest)).write_text(
        json.dumps(index, separators=(",", ":"))
    )
    return len(blob)


def split_marks(marks: list[Path], order: list[str]) -> tuple[list[Path], list[Path]]:
    """The hot half and the rest, in `order`'s ranking."""
    rank = {address: i for i, address in enumerate(order)}
    hot = sorted(
        (m for m in marks if m.name.split("@")[0] in rank),
        key=lambda m: rank[m.name.split("@")[0]],
    )[:HOT_TOKENS]
    chosen = set(hot)
    return hot, [m for m in marks if m not in chosen]


def bundle_marks(target: Path, order: list[str] | None = None) -> list[tuple[int, int, int]]:
    """Bundle one chain's marks, per tier. Returns `(tier, count, bytes)`."""
    written = []
    for tier in BUNDLE_TIERS:
        marks = sorted(target.glob(f"*@{tier}.png"))
        if not marks:
            continue
        total = sum(m.stat().st_size for m in marks)
        hot, rest = (
            split_marks(marks, order) if order and total > SPLIT_ABOVE else (marks, [])
        )
        size = write_bundle(target, tier, hot)
        if rest:
            size += write_bundle(target, tier, rest, rest=True)
        written.append((tier, len(marks), size))
    return written


#: What this script cannot run without, as `(module, what to install)`.
BUILD_REQUIREMENTS = (("PIL", "Pillow"), ("numpy", "numpy"))


def missing_requirements() -> list[str]:
    """Which build-time libraries are not installed."""
    return [
        package
        for module, package in BUILD_REQUIREMENTS
        if importlib.util.find_spec(module) is None
    ]


def main() -> int:
    # Before anything else, and fatal -- which it was not, and that is
    # the whole reason this check exists.
    missing = missing_requirements()
    if missing:
        print(
            f"{', '.join(missing)} not installed -- the marks would be copied "
            "at upstream's size rather than compiled.\n"
            "Install the build tools: uv pip install -r pyproject.toml --group dev",
            file=sys.stderr,
        )
        return 1

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--chains",
        nargs="*",
        default=None,
        help="chains to copy token images for (default: every one upstream has)",
    )
    options = parser.parse_args()

    if not SOURCE.is_dir():
        print(
            f"{SOURCE} is missing. Run: git submodule update --init",
            file=sys.stderr,
        )
        return 1

    chains = options.chains or available_chains(SOURCE)
    if not chains:
        print(f"No token images under {SOURCE / 'images'}", file=sys.stderr)
        return 1

    if TARGET.exists():
        shutil.rmtree(TARGET)
    TARGET.mkdir(parents=True)

    total = 0

    branding = TARGET / "branding"
    branding.mkdir()
    logo = SOURCE / "branding" / "logo.svg"
    if logo.is_file():
        shutil.copy2(logo, branding / "logo.svg")
        total += logo.stat().st_size
        print(f"  branding/logo.svg  {logo.stat().st_size / 1024:.0f} KB")

    files, size = copy_tree(SOURCE / "chains", TARGET / "chains")
    total += size
    chain_bundles = bundle_marks(TARGET / "chains")
    print(
        f"  chains/            {files} files, {size / 1024:.0f} KB"
        + (f"  -> {len(chain_bundles)} bundles" if chain_bundles else "")
    )

    for chain in chains:
        files, size = copy_tree(
            SOURCE / "images" / token_dir(chain), TARGET / "tokens" / chain, tokens=True
        )
        total += size
        if files:
            directory = TARGET / "tokens" / chain
            biggest = max(
                (
                    sum(m.stat().st_size for m in directory.glob(f"*@{tier}.png"))
                    for tier in BUNDLE_TIERS
                ),
                default=0,
            )
            order = hot_order(chain) if biggest > SPLIT_ABOVE else []
            if biggest > SPLIT_ABOVE and not order:
                print(f"  ! no ranking for {chain}: bundling it whole")
            bundles = bundle_marks(directory, order)
            packed = sum(count for _tier, count, _bytes in bundles)
            split = " (split)" if order else ""
            print(
                f"  tokens/{chain:<12} {files} files, {size / 1024 / 1024:.1f} MB"
                + (f"  -> {len(bundles)} bundles of {packed}{split}" if bundles else "")
            )
        else:
            print(f"  tokens/{chain:<12} nothing upstream — will draw initials")

    print(
        f"\n{TARGET.relative_to(ROOT)}: {total / 1024 / 1024:.1f} MB "
        f"across {len(chains)} chains"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
