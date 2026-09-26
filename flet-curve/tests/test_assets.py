"""Resolving compiled curve-assets paths, and the marks built from them."""

from __future__ import annotations

import base64
import json
import struct
from pathlib import Path

import flet as ft
import pytest

from curve.models import Coin, Pool
from ui import logos
from ui.assets import ASSET_ROOT, chain_logo, chain_name, curve_logo, token_logo
from ui.logos import (
    OVERLAP,
    coin_stack,
    fallback_color,
    pool_stack,
    token_mark,
)

USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"


# -- chain names -----------------------------------------------------------


def test_chain_names_are_capitalised() -> None:
    assert chain_name("ethereum") == "Ethereum"
    assert chain_name("arbitrum") == "Arbitrum"
    assert chain_name("polygon") == "Polygon"


def test_chains_with_real_names_are_not_just_capitalised() -> None:
    assert chain_name("bsc") == "BNB Chain"
    assert chain_name("xdai") == "Gnosis"
    assert chain_name("zksync") == "zkSync"


def test_hyphens_are_word_breaks() -> None:
    assert chain_name("x-layer") == "X Layer"


def test_chain_name_of_nothing_is_nothing() -> None:
    assert chain_name("") == ""


# -- paths -----------------------------------------------------------------


def test_a_known_token_resolves_under_the_asset_root() -> None:
    url = token_logo("ethereum", USDC)
    assert url and url.endswith(".png")
    assert ASSET_ROOT in url
    assert "ethereum" in url


def test_token_lookup_is_case_insensitive() -> None:
    assert token_logo("ethereum", USDC) == token_logo("ethereum", USDC.lower())


def test_a_token_with_no_image_returns_none() -> None:
    assert token_logo("ethereum", "0x" + "de" * 20) is None


def test_missing_inputs_are_handled() -> None:
    assert token_logo("", USDC) is None
    assert token_logo("ethereum", "") is None
    assert chain_logo("") is None


def test_chain_and_curve_logos_resolve() -> None:
    assert chain_logo("ethereum")
    assert chain_logo("ETHEREUM") == chain_logo("ethereum")
    assert curve_logo()


def test_an_unknown_chain_has_no_logo() -> None:
    assert chain_logo("not-a-chain") is None


# -- marks -----------------------------------------------------------------


def coin(symbol: str, address: str = "0x" + "11" * 20) -> Coin:
    return Coin(address=address, symbol=symbol, decimals=18)


def test_a_token_with_an_image_renders_one() -> None:
    mark = token_mark(coin("USDC", USDC), "ethereum", 24)
    assert isinstance(mark.content, ft.Image)


def test_a_token_without_an_image_renders_its_initials() -> None:
    mark = token_mark(coin("WOOF"), "ethereum", 24)
    assert isinstance(mark.content, ft.Container)
    assert mark.content.content.value == "WOO"


def test_the_initials_mark_only_tints_with_its_hue() -> None:
    from ui.logos import initials_mark

    mark = initials_mark("WOOF", 24)
    assert mark.content.color == ft.Colors.ON_SURFACE_VARIANT
    assert "0.18" in str(mark.bgcolor) or "," in str(mark.bgcolor)
    assert mark.bgcolor != fallback_color("WOOF")


def last_resort(mark):
    """Walk a mark's retry chain to whatever it settles for."""
    node = mark.content
    while isinstance(node, ft.Image):
        node = node.error_content
    return node


def attempts(mark) -> list[str]:
    """The URLs a mark will ask for, in order.

    A `data:` src is not one of them, and neither is a src that is bytes
    rather than a string -- both carry the image already and fetch
    nothing. `src` can be either; only a string can be a URL.
    """
    urls: list[str] = []
    node = mark.content
    while isinstance(node, ft.Image):
        if isinstance(node.src, str) and not node.src.startswith("data:"):
            urls.append(node.src)
        node = node.error_content
    return urls


def decoded(src: str | None) -> bytes | None:
    """The PNG carried by a `data:` src."""
    if src is None:
        return None
    head, _, payload = src.partition(",")
    assert head == "data:image/png;base64"
    return base64.b64decode(payload)


def test_a_missing_image_falls_back_to_the_same_mark() -> None:
    from ui.logos import initials_mark

    with_image = token_mark(coin("USDC", USDC), "ethereum", 24)
    assert isinstance(last_resort(with_image), type(initials_mark("USDC", 24)))


def test_a_mark_is_asked_for_twice_before_giving_up() -> None:
    from ui.logos import MARK_ATTEMPTS

    urls = attempts(token_mark(coin("USDC", USDC), "ethereum", 24))

    assert len(urls) == MARK_ATTEMPTS == 2


def test_the_retry_asks_for_a_different_url() -> None:
    urls = attempts(token_mark(coin("USDC", USDC), "ethereum", 24))

    assert len(set(urls)) == len(urls)
    assert urls[0].endswith(".png")  # the file's own address, untouched
    assert urls[1].startswith(urls[0] + "?")


def test_a_token_with_no_art_at_all_never_asks_twice() -> None:
    from ui.logos import initials_mark

    mark = token_mark(coin("NOPE", "0x" + "99" * 20), "ethereum", 24)

    assert attempts(mark) == []
    assert isinstance(mark.content, type(initials_mark("NOPE", 24)))


def test_the_fallback_colour_is_stable_per_symbol() -> None:
    assert fallback_color("USDC") == fallback_color("USDC")
    assert fallback_color("USDC") != fallback_color("WBTC")


def test_fallback_colour_of_nothing_does_not_crash() -> None:
    assert fallback_color("")


# -- the stack -------------------------------------------------------------


def test_logos_overlap_rather_than_sit_side_by_side() -> None:
    size = 24
    stack = coin_stack([coin("A"), coin("B"), coin("C")], "ethereum", size)
    lefts = sorted(c.left for c in stack.content.controls)
    step = lefts[1] - lefts[0]
    assert 0 < step < size, "each logo must overlap its neighbour"
    assert step == pytest.approx(size * (1 - OVERLAP))


def test_the_stack_is_wide_enough_for_every_logo() -> None:
    size = 24
    stack = coin_stack([coin("A"), coin("B"), coin("C")], "ethereum", size)
    last = max(c.left for c in stack.content.controls)
    assert stack.width >= last + size


def test_a_long_pool_is_truncated_with_a_counter() -> None:
    coins = [coin(f"C{i}") for i in range(9)]
    stack = coin_stack(coins, "ethereum", 24, limit=4)
    labels = [
        c.content.value
        for c in stack.content.controls
        if isinstance(c.content, ft.Text)
    ]
    assert "+5" in labels


def test_an_empty_pool_still_produces_a_control() -> None:
    stack = coin_stack([], "ethereum", 24)
    assert stack.width == 0


def test_a_single_coin_needs_exactly_one_logo_of_width() -> None:
    stack = coin_stack([coin("A")], "ethereum", 24)
    assert stack.width == 24


# -- metapools -------------------------------------------------------------


def metapool() -> Pool:
    """A real shape: v2 returns [meta, baseLP, ...underlying]."""
    return Pool.from_v2(
        {
            "base_pool": "0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2",
            "is_metapool": True,
            "chain_id": 1,
            "coins": [
                {"symbol": "msUSD", "address": "0x" + "aa" * 20},
                {"symbol": "crvFRAX", "address": "0x" + "bb" * 20},
                {"symbol": "FRAX", "address": "0x" + "cc" * 20},
                {"symbol": "USDC", "address": USDC},
            ],
        },
        "ethereum",
    )


def test_a_metapool_shows_its_underlying_not_its_lp_token() -> None:
    assert metapool().coin_symbols == ["msUSD", "FRAX", "USDC"]


def test_the_stack_draws_the_decomposed_assets() -> None:
    stack = pool_stack(metapool(), size=24)
    assert len(stack.content.controls) == 3


def test_a_plain_pool_is_left_alone() -> None:
    plain = Pool.from_v2(
        {"coins": [{"symbol": s} for s in ("DAI", "USDC", "USDT")]}, "ethereum"
    )
    assert plain.coin_symbols == ["DAI", "USDC", "USDT"]
    assert len(pool_stack(plain).content.controls) == 3


def test_an_undecomposed_metapool_keeps_both_coins() -> None:
    pool = Pool.from_v2(
        {"base_pool": "0xabc", "coins": [{"symbol": "X"}, {"symbol": "3Crv"}]}
    )
    assert pool.coin_symbols == ["X", "3Crv"]


def test_contract_coins_stay_separate_from_displayed_ones() -> None:
    pool = metapool()
    pool.merge_detail({"n_coins": 2, "balances": [1.0, 2.0]})
    assert pool.n_coins == 2
    assert [c.symbol for c in pool.pool_coins] == ["msUSD", "crvFRAX"]
    assert pool.coin_symbols == ["msUSD", "FRAX", "USDC"]


def test_the_swap_and_withdraw_pickers_carry_marks() -> None:
    from ui.actions import _coin_options

    options = _coin_options([coin("USDC", USDC), coin("WOOF")], "ethereum")
    assert [o.key for o in options] == ["0", "1"]
    assert [o.text for o in options] == ["USDC", "WOOF"]
    for option in options:
        assert isinstance(option.content, ft.Row)
        assert len(option.content.controls) == 2  # mark, then symbol


def test_balances_line_up_with_the_contract_coins() -> None:
    pool = metapool()
    pool.merge_detail({"n_coins": 2, "balances": [10.0, 20.0], "balances_usd": [10.0, 20.0]})
    assert [c.balance for c in pool.pool_coins] == [10.0, 20.0]


def test_marks_are_minified_with_mipmaps_from_the_full_image() -> None:
    mark = token_mark(coin("USDC", USDC), "ethereum", 26)
    image = mark.content
    assert isinstance(image, ft.Image)
    assert image.filter_quality == ft.FilterQuality.MEDIUM
    assert image.cache_width is None
    assert image.cache_height is None


# -- the app's own icons ---------------------------------------------------
# Unlike everything above, these are committed rather than compiled: a site
# needs a favicon whether or not whoever cloned it has initialised the curve-
# assets submodule, and `flet build` cannot read an SVG.

ICONS = Path(__file__).resolve().parent.parent / "src" / "assets"

EXPECTED_ICONS = {
    "favicon.png": 32,
    "icon.png": 1024,
    "icons/icon-192.png": 192,
    "icons/icon-512.png": 512,
    "icons/icon-maskable-192.png": 192,
    "icons/icon-maskable-512.png": 512,
    "icons/apple-touch-icon-192.png": 192,
    # What the page shows while the Python runtime starts, in place of
    # Flet's own logo.
    "icons/loading-animation.png": 512,
}


def png_size(path: Path) -> tuple[int, int]:
    """Width and height out of the IHDR chunk."""
    header = path.read_bytes()[:24]
    assert header[:8] == b"\x89PNG\r\n\x1a\n", f"{path.name} is not a PNG"
    return struct.unpack(">II", header[16:24])


@pytest.mark.parametrize("name,size", EXPECTED_ICONS.items())
def test_the_icon_exists_at_the_name_flet_expects(name: str, size: int) -> None:
    path = ICONS / name
    assert path.is_file(), f"{name} is missing -- run tools/build_icons.py"
    assert png_size(path) == (size, size)


@pytest.mark.parametrize(
    "name", [n for n in EXPECTED_ICONS if "maskable" in n or "apple" in n]
)
def test_a_cropped_icon_is_opaque_and_inside_its_safe_zone(name: str) -> None:
    image_module = pytest.importorskip("PIL.Image", reason="Pillow: pip install flet[test]")
    with image_module.open(ICONS / name) as image:
        image = image.convert("RGBA")
        assert image.getchannel("A").getextrema() == (255, 255), "not opaque"
        size = image.width
        assert image.getpixel((1, 1))[:3] == (255, 255, 255), "no backdrop"
        for point in ((size // 2, 1), (size // 2, size - 2), (1, size // 2)):
            assert image.getpixel(point)[:3] == (255, 255, 255)


def test_there_is_an_ico_for_the_path_browsers_probe() -> None:
    path = ICONS / "favicon.ico"
    assert path.is_file(), "missing -- run tools/build_icons.py"
    assert path.read_bytes()[:4] == b"\x00\x00\x01\x00", "not an ICO"


def test_the_favicon_is_not_flets_default() -> None:
    stock = Path(ft.__file__).resolve().parent.parent / "flet_web" / "web" / "favicon.png"
    if not stock.is_file():  # pragma: no cover - depends on the install
        pytest.skip("flet_web is not installed")
    assert (ICONS / "favicon.png").read_bytes() != stock.read_bytes()


# -- how a mark is drawn ----------------------------------------------------


def test_a_mark_asks_the_browser_to_resize_nothing() -> None:
    marks = [
        logos.chain_mark("ethereum", 18),
        logos.token_mark(coin("USDC", USDC), "ethereum", 24).content,
    ]
    for mark in marks:
        assert isinstance(mark, ft.Image)
        assert mark.cache_width is None, "no mark may ask the browser to resize"
        assert mark.filter_quality is logos.SAMPLING


# -- what build_assets compiles them down to --------------------------------


def test_no_compiled_mark_is_larger_than_it_is_drawn(monkeypatch) -> None:
    from PIL import Image

    from ui.assets import MARK_PIXELS

    root = Path(__file__).resolve().parent.parent / "src/assets/curve"
    marks = [*(root / "chains").glob("*.png")]
    marks += sorted((root / "tokens/ethereum").glob("*.png"))[:120]
    assert marks, "assets are not compiled -- run tools/build_assets.py"

    for mark in marks:
        with Image.open(mark) as image:
            assert max(image.size) <= MARK_PIXELS, (
                f"{mark.name} is {image.size}, larger than MARK_PIXELS"
            )


def test_the_biggest_mark_still_has_pixels_for_a_dense_screen() -> None:
    from ui.assets import MARK_PIXELS

    assert MARK_PIXELS >= 38 * 4


# -- and how far above it they are allowed to be ----------------------------
# The half that was missing, and the reason this bug outlived three fixes.


def test_no_mark_is_drawn_from_far_more_art_than_it_needs() -> None:
    from ui.assets import MARK_TIERS, mark_tier

    for size in (14, 18, 20, 22, 24, 26, 28, 34, 38):
        for ratio in (1.0, 1.140625, 1.25, 1.5, 2.0, 2.625, 3.0, 3.5, 4.0):
            drawn = size * ratio
            tier = mark_tier(drawn)
            assert tier >= drawn or tier == MARK_TIERS[-1], (
                f"{size}px at {ratio}x wants {drawn:.0f} and got {tier}"
            )
            assert tier <= drawn * 2, (
                f"{size}px at {ratio}x is {drawn:.0f} device pixels drawn from "
                f"{tier}px of art -- a {tier / drawn:.1f}x reduction for a "
                "filter that manages two"
            )


def test_a_tier_is_never_smaller_than_what_it_is_asked_for() -> None:
    from ui.assets import MARK_TIERS, mark_tier

    for wanted in range(1, MARK_TIERS[-1] + 1):
        assert mark_tier(wanted) >= wanted
    assert mark_tier(MARK_TIERS[-1] + 1) == MARK_TIERS[-1]
    assert mark_tier(10_000) == MARK_TIERS[-1]


def test_every_mark_is_compiled_at_every_tier() -> None:
    from PIL import Image

    from ui.assets import MARK_TIERS

    root = Path(__file__).resolve().parent.parent / "src/assets/curve"
    stems = {p.name.split("@")[0] for p in (root / "chains").glob("*.png")}
    assert stems, "assets are not compiled -- run tools/build_assets.py"

    for stem in sorted(stems):
        for tier in MARK_TIERS:
            mark = root / "chains" / f"{stem}@{tier}.png"
            assert mark.is_file(), f"{mark.name} was never written"
            with Image.open(mark) as image:
                assert max(image.size) <= tier, (
                    f"{mark.name} is {image.size}, larger than the tier it names"
                )


def test_a_mark_its_parent_resizes_asks_for_the_top_tier() -> None:
    from ui.assets import MARK_PIXELS
    from ui.logos import chain_mark

    try:
        logos.set_pixel_ratio(1.0)
        stretched = chain_mark("ethereum", 14, sized_by_parent=True)
        assert f"@{MARK_PIXELS}.png" in str(stretched.src)
        laid_out = chain_mark("ethereum", 14)
        assert f"@{MARK_PIXELS}.png" not in str(laid_out.src)
    finally:
        logos.set_pixel_ratio(2.0)


def test_a_mark_asks_for_the_tier_that_covers_the_ratio_it_is_drawn_at() -> None:
    from ui import logos

    try:
        logos.set_pixel_ratio(1.0)
        assert "@20.png" in str(logos.chain_mark("ethereum", 18).src)
        logos.set_pixel_ratio(3.0)
        assert "@80.png" in str(logos.chain_mark("ethereum", 18).src)
        logos.set_pixel_ratio(4.0)
        assert "@160.png" in str(logos.chain_mark("ethereum", 38).src)
    finally:
        logos.set_pixel_ratio(2.0)


def test_a_compiled_mark_has_no_pale_rim() -> None:
    import numpy as np
    from PIL import Image

    from ui.assets import MARK_TIERS

    root = Path(__file__).resolve().parent.parent / "src/assets/curve/chains"
    for tier in MARK_TIERS:
        mark = root / f"ethereum@{tier}.png"
        assert mark.is_file(), "assets are not compiled -- run tools/build_assets.py"

        pixels = np.asarray(Image.open(mark).convert("RGBA")).astype(int)
        solid = pixels[pixels[..., 3] == 255][..., :3]
        assert len(solid), f"the {tier}px mark has no opaque pixels at all"
        brightest_solid = solid.max()

        edge = pixels[(pixels[..., 3] > 0) & (pixels[..., 3] < 255)][..., :3]
        assert len(edge), f"the {tier}px mark has no antialiased edge to check"

        assert edge.max() <= brightest_solid + 1, (
            f"rim of the {tier}px mark reaches {edge.max()} where the artwork "
            f"peaks at {brightest_solid} -- that is a halo"
        )


def test_every_mark_fades_out_rather_than_stopping() -> None:
    import numpy as np
    from PIL import Image

    root = Path(__file__).resolve().parent.parent / "src/assets/curve"
    marks = [*(root / "chains").glob("*.png")][:20]
    marks += sorted((root / "tokens/ethereum").glob("*.png"))[:40]
    assert marks, "assets are not compiled -- run tools/build_assets.py"

    for mark in marks:
        alpha = np.asarray(Image.open(mark).convert("RGBA")).astype(int)[..., 3]
        border = np.concatenate(
            [alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]]
        )
        assert border.max() < 250, (
            f"{mark.name} is opaque against the bitmap border -- that edge "
            "is a crop, not an outline"
        )
        partial = ((alpha > 8) & (alpha < 248)).sum()
        assert partial > alpha.shape[0], (
            f"{mark.name} has {partial} part-transparent pixels, too few for "
            "an antialiased outline of that circumference"
        )


# -- the build refuses rather than degrades ---------------------------------
# The two tests above are what caught a silent half-build: run without
# Pillow, `build_assets.py` used to fall through to `shutil.copy2` and ship
# upstream's 200px art.


def test_missing_requirements_names_the_package_not_the_module() -> None:
    import importlib.util

    from tools import build_assets

    real = importlib.util.find_spec
    try:
        importlib.util.find_spec = lambda name: None  # type: ignore[assignment]
        assert build_assets.missing_requirements() == ["Pillow", "numpy"]
    finally:
        importlib.util.find_spec = real  # type: ignore[assignment]


def test_a_dev_environment_is_missing_nothing() -> None:
    from tools import build_assets

    assert build_assets.missing_requirements() == []


def test_the_build_refuses_before_it_deletes_anything(monkeypatch, capsys) -> None:
    from tools import build_assets

    def never(*_args, **_kwargs):
        raise AssertionError("the build started before checking its tools")

    monkeypatch.setattr(build_assets, "missing_requirements", lambda: ["Pillow"])
    monkeypatch.setattr(build_assets.shutil, "rmtree", never)

    assert build_assets.main() == 1
    message = capsys.readouterr().err
    assert "Pillow" in message
    assert "--group dev" in message, "say how to fix it, not just what broke"


# -- one file per chain instead of one per coin ----------------------------


def make_bundle(marks: dict) -> tuple[bytes, dict]:
    """A bundle the way `tools/build_assets.bundle_marks` writes one: the PNGs
    end to end, and where each one starts.
    """
    blob, index, at = bytearray(), {}, 0
    for address, data in marks.items():
        index[address] = (at, len(data))
        blob += data
        at += len(data)
    return bytes(blob), index


def remember_bundle_at(directory: str, tier: int, blob: bytes, index: dict) -> int:
    """`remember_bundle`, imported where it is used rather than at the top:
    this file loads `ui.assets` lazily inside each test.
    """
    from ui.assets import remember_bundle

    return remember_bundle(directory, tier, blob, index)


PNG_A = b"\x89PNG" + b"aaaa"
PNG_B = b"\x89PNG" + b"bbbbbb"


@pytest.fixture(autouse=True)
def _clean_bundles():
    from ui.assets import forget_bundles

    forget_bundles()
    yield
    forget_bundles()


def test_a_slice_is_the_original_file_byte_for_byte() -> None:
    from ui.assets import bundled_mark, remember_bundle, token_bundle

    blob, index = make_bundle({"0xaa": PNG_A, "0xbb": PNG_B})

    assert remember_bundle(token_bundle("xdai"), 80, blob, index) == 2
    assert decoded(bundled_mark("xdai", "0xAA", 80)) == PNG_A
    assert decoded(bundled_mark("xdai", "0xbb", 80)) == PNG_B


def test_a_bundled_mark_is_a_string_and_never_the_bytes() -> None:
    """`ft.Image(src=<bytes>)` paints nothing on WebKit -- so on every
    browser an iPhone has -- and raises no error, so `error_content` does
    not stand in either. It shipped that way and the phone lost every
    logo. Blink drew it, which is why it took a WebKit to see.
    """
    from ui.assets import bundled_chain, bundled_mark, remember_bundle, token_bundle

    blob, index = make_bundle({"0xaa": PNG_A})
    remember_bundle(token_bundle("xdai"), 80, blob, index)
    remember_bundle("chains", 80, *make_bundle({"xdai": PNG_B}))

    for mark in (bundled_mark("xdai", "0xaa", 80), bundled_chain("xdai", 80)):
        assert isinstance(mark, str)
        assert mark.startswith("data:image/png;base64,")


def test_a_token_not_in_the_bundle_falls_back_rather_than_blanking() -> None:
    from ui.assets import bundled_mark, remember_bundle, token_bundle

    blob, index = make_bundle({"0xaa": PNG_A})
    remember_bundle(token_bundle("xdai"), 80, blob, index)

    assert bundled_mark("xdai", "0xffff", 80) is None
    assert bundled_mark("ethereum", "0xaa", 80) is None  # another chain


def test_a_truncated_slice_is_dropped_rather_than_shown() -> None:
    from ui.assets import bundled_mark, remember_bundle, token_bundle

    blob, index = make_bundle({"0xaa": PNG_A})
    index["0xbb"] = (0, len(blob) + 999)  # runs off the end
    index["0xcc"] = (2, 4)  # lands mid-file, so no PNG magic

    assert remember_bundle(token_bundle("xdai"), 80, blob, index) == 1
    assert bundled_mark("xdai", "0xbb", 80) is None
    assert bundled_mark("xdai", "0xcc", 80) is None


async def test_a_missing_bundle_is_zero_rather_than_an_error() -> None:
    from ui.assets import bundled_mark, load_bundle, token_bundle

    async def dead(_url):
        raise OSError("404")

    assert await load_bundle(token_bundle("xdai"), 80, dead) == 0
    assert bundled_mark("xdai", "0xaa", 80) is None


async def test_a_bundle_is_fetched_once_per_chain_and_tier() -> None:
    from ui.assets import load_bundle, token_bundle

    blob, index = make_bundle({"0xaa": PNG_A, "0xbb": PNG_B})
    asked = []

    async def fetch(url):
        asked.append(url)
        return json.dumps(index).encode() if url.endswith(".json") else blob

    assert await load_bundle(token_bundle("xdai"), 80, fetch) == 2
    assert await load_bundle(token_bundle("xdai"), 80, fetch) == 2  # cached, no new requests

    assert len(asked) == 2  # the blob and its index, once
    assert asked[0].endswith("marks@80.bin")
    assert asked[1].endswith("marks@80.json")


async def test_the_tier_asked_for_is_the_one_the_screen_needs() -> None:
    from ui.assets import load_bundle, mark_tier, token_bundle

    asked = []

    async def fetch(url):
        asked.append(url)
        raise OSError("stop here")

    await load_bundle(token_bundle("xdai"), 24 * 3, fetch)

    assert f"marks@{mark_tier(72)}.bin" in asked[0]


def test_a_bundled_mark_needs_no_retry_chain() -> None:
    from ui.assets import mark_src, remember_bundle, token_bundle

    blob, index = make_bundle({USDC.lower(): PNG_A})
    remember_bundle(token_bundle("ethereum"), 80, blob, index)

    mark = token_mark(coin("USDC", USDC), "ethereum", 24)
    urls = [src for src in attempts(mark) if isinstance(src, str)]

    assert urls == []  # nothing is fetched, so nothing can fail
    assert mark.content.src == mark_src(PNG_A)
    assert mark.content.error_content is not None  # still guards a bad slice


def test_only_the_tiers_screens_use_are_bundled() -> None:
    from tools.build_assets import BUNDLE_TIERS
    from ui.assets import MARK_TIERS, mark_tier
    from ui.logos import MARK_SIZE

    assert set(BUNDLE_TIERS) < set(MARK_TIERS)
    assert 160 not in BUNDLE_TIERS
    assert mark_tier(MARK_SIZE * 3) == 160


def test_the_bundle_asked_for_is_the_tier_the_screen_draws() -> None:
    from ui.assets import MARK_PIXELS, mark_tier
    from ui.logos import MARK_SIZE

    assert mark_tier(MARK_SIZE * 2) != MARK_PIXELS


# -- the big chains arrive in two halves -----------------------------------


def test_the_second_half_adds_to_the_first_rather_than_replacing_it() -> None:
    from ui.assets import bundled_mark, remember_bundle, token_bundle

    hot_blob, hot_index = make_bundle({"0xaa": PNG_A})
    rest_blob, rest_index = make_bundle({"0xbb": PNG_B})

    assert remember_bundle(token_bundle("ethereum"), 80, hot_blob, hot_index) == 1
    assert remember_bundle(token_bundle("ethereum"), 80, rest_blob, rest_index) == 2

    assert decoded(bundled_mark("ethereum", "0xaa", 80)) == PNG_A
    assert decoded(bundled_mark("ethereum", "0xbb", 80)) == PNG_B


async def test_the_tail_is_asked_for_under_its_own_name() -> None:
    from ui.assets import REST_INFIX, load_bundle, token_bundle

    asked = []

    async def fetch(url):
        asked.append(url)
        raise OSError("404")

    await load_bundle(token_bundle("ethereum"), 80, fetch, rest=True)

    assert asked[0].endswith(f"marks@80{REST_INFIX}.bin")


async def test_a_chain_that_was_never_split_just_returns_zero() -> None:
    from ui.assets import load_bundle, token_bundle

    async def missing(_url):
        raise OSError("404")

    assert await load_bundle(token_bundle("xdai"), 80, missing, rest=True) == 0


async def test_the_tail_is_fetched_even_though_the_head_is_cached() -> None:
    from ui.assets import load_bundle, token_bundle

    hot_blob, hot_index = make_bundle({"0xaa": PNG_A})
    rest_blob, rest_index = make_bundle({"0xbb": PNG_B})
    asked = []

    async def fetch(url):
        asked.append(url)
        blob, index = (rest_blob, rest_index) if "-rest" in url else (hot_blob, hot_index)
        return json.dumps(index).encode() if url.endswith(".json") else blob

    assert await load_bundle(token_bundle("ethereum"), 80, fetch) == 1
    assert await load_bundle(token_bundle("ethereum"), 80, fetch, rest=True) == 2
    assert sum("-rest" in url for url in asked) == 2


def test_the_hot_half_is_ranked_and_capped() -> None:
    from pathlib import Path

    from tools.build_assets import HOT_TOKENS, split_marks

    marks = [Path(f"0x{i:02x}@80.png") for i in range(200)]
    order = [f"0x{i:02x}" for i in reversed(range(200))]

    hot, rest = split_marks(marks, order)

    assert len(hot) == HOT_TOKENS == 150
    assert hot[0].name.startswith("0xc7")  # the top of the ranking
    assert len(rest) == 50
    assert not set(hot) & set(rest)


def test_a_token_no_pool_holds_goes_in_the_tail() -> None:
    from pathlib import Path

    from tools.build_assets import split_marks

    marks = [Path("0xaa@80.png"), Path("0xzz@80.png")]

    hot, rest = split_marks(marks, ["0xaa"])

    assert [m.name for m in hot] == ["0xaa@80.png"]
    assert [m.name for m in rest] == ["0xzz@80.png"]


def test_no_ranking_means_one_bundle_rather_than_a_bad_split(tmp_path) -> None:
    from tools.build_assets import bundle_marks

    for i in range(3):
        (tmp_path / f"0x{i:02x}@80.png").write_bytes(b"\x89PNG" + b"x" * 100)

    bundle_marks(tmp_path, [])

    assert (tmp_path / "marks@80.bin").is_file()
    assert not (tmp_path / "marks@80-rest.bin").exists()


async def test_a_bundle_in_hand_is_never_fetched_twice() -> None:
    from ui.assets import load_bundle, token_bundle

    hot_blob, hot_index = make_bundle({"0xaa": PNG_A})
    asked = []

    async def fetch(url):
        asked.append(url)
        if "-rest" in url:
            raise OSError("404")
        return json.dumps(hot_index).encode() if url.endswith(".json") else hot_blob

    for _ in range(3):
        await load_bundle(token_bundle("ethereum"), 80, fetch)
        await load_bundle(token_bundle("ethereum"), 80, fetch, rest=True)

    assert sum("-rest" not in url for url in asked) == 2  # the blob and its index


async def test_a_failed_bundle_is_asked_for_once_more_and_then_left() -> None:
    from ui.assets import BUNDLE_ATTEMPTS, load_bundle, token_bundle

    asked = []

    async def cold(url):
        asked.append(url)
        raise OSError("504")

    for _ in range(4):
        await load_bundle(token_bundle("ethereum"), 80, cold)

    assert BUNDLE_ATTEMPTS == 2
    assert sum(url.endswith(".bin") for url in asked) == BUNDLE_ATTEMPTS


async def test_the_second_ask_is_the_one_that_lands() -> None:
    from ui.assets import bundled_mark, load_bundle, token_bundle

    blob, index = make_bundle({"0xaa": PNG_A})
    tries = []

    async def warming(url):
        tries.append(url)
        if len(tries) == 1:
            raise OSError("504")
        return json.dumps(index).encode() if url.endswith(".json") else blob

    assert await load_bundle(token_bundle("xdai"), 80, warming) == 0
    assert await load_bundle(token_bundle("xdai"), 80, warming) == 1
    assert decoded(bundled_mark("xdai", "0xaa", 80)) == PNG_A


async def test_two_page_loads_do_not_pull_the_same_bundle_at_once() -> None:
    import asyncio

    from ui.assets import load_bundle, token_bundle

    blob, index = make_bundle({"0xaa": PNG_A})
    asked = []

    async def slow(url):
        asked.append(url)
        await asyncio.sleep(0)
        return json.dumps(index).encode() if url.endswith(".json") else blob

    await asyncio.gather(
        load_bundle(token_bundle("ethereum"), 80, slow),
        load_bundle(token_bundle("ethereum"), 80, slow),
    )

    assert sum(url.endswith(".bin") for url in asked) == 1


# -- the tier a phone actually asks for ------------------------------------


def test_a_screen_past_the_largest_bundle_still_gets_one() -> None:
    from ui.assets import BUNDLED_TIERS, bundle_tier, mark_tier
    from ui.logos import MARK_SIZE

    assert mark_tier(MARK_SIZE * 3) not in BUNDLED_TIERS  # the trap
    assert bundle_tier(MARK_SIZE * 3) in BUNDLED_TIERS  # and the way out
    assert bundle_tier(MARK_SIZE * 4) in BUNDLED_TIERS


@pytest.mark.parametrize("ratio", [1, 2, 2.625, 3, 4])
def test_every_ratio_a_real_screen_reports_gets_a_bundle(ratio) -> None:
    from ui.assets import BUNDLED_TIERS, bundle_tier
    from ui.logos import MARK_SIZE

    assert bundle_tier(MARK_SIZE * ratio) in BUNDLED_TIERS


def test_the_clamp_never_asks_for_art_smaller_than_it_must() -> None:
    from ui.assets import bundle_tier

    assert bundle_tier(20) == 40
    assert bundle_tier(41) == 80
    assert bundle_tier(80) == 80
    assert bundle_tier(81) == 80  # past the top: the largest there is
    assert bundle_tier(400) == 80


def test_the_loader_and_the_lookup_agree_on_the_tier() -> None:
    from ui.assets import bundle_tier, bundled_mark, remember_bundle, token_bundle
    from ui.logos import MARK_SIZE

    drawn = MARK_SIZE * 3
    blob, index = make_bundle({"0xaa": PNG_A})
    remember_bundle(token_bundle("xdai"), bundle_tier(drawn), blob, index)

    assert decoded(bundled_mark("xdai", "0xaa", drawn)) == PNG_A


def test_the_build_and_the_app_share_one_list_of_tiers() -> None:
    from tools.build_assets import BUNDLE_TIERS
    from ui.assets import BUNDLED_TIERS

    assert BUNDLE_TIERS is BUNDLED_TIERS


# -- the network marks, 160 files down to two ------------------------------


def test_the_network_marks_share_one_bundle() -> None:
    from ui.assets import CHAINS, bundled_chain, remember_bundle

    blob, index = make_bundle({"ethereum": PNG_A, "xdai": PNG_B})
    remember_bundle(CHAINS, 80, blob, index)

    assert decoded(bundled_chain("ethereum", 80)) == PNG_A
    assert decoded(bundled_chain("xdai", 80)) == PNG_B
    assert bundled_chain("nowhere", 80) is None


def test_the_two_families_do_not_collide() -> None:
    from ui.assets import (
        CHAINS,
        bundled_chain,
        bundled_mark,
        remember_bundle,
        token_bundle,
    )

    chain_blob, chain_index = make_bundle({"ethereum": PNG_A})
    token_blob, token_index = make_bundle({"ethereum": PNG_B})
    remember_bundle(CHAINS, 80, chain_blob, chain_index)
    remember_bundle(token_bundle("ethereum"), 80, token_blob, token_index)

    assert decoded(bundled_chain("ethereum", 80)) == PNG_A
    assert decoded(bundled_mark("ethereum", "ethereum", 80)) == PNG_B


def test_a_network_mark_from_the_bundle_needs_no_retry() -> None:
    from ui.assets import CHAINS, bundle_tier, remember_bundle
    from ui.logos import chain_mark, pixel_ratio

    blob, index = make_bundle({"ethereum": PNG_A})
    remember_bundle(CHAINS, bundle_tier(18 * pixel_ratio()), blob, index)

    mark = chain_mark("ethereum", 18)

    assert decoded(mark.src) == PNG_A  # the bundle's own slice, not a URL


def test_a_bundle_is_read_at_the_tier_it_was_fetched_at() -> None:
    from ui.assets import CHAINS, bundle_tier, bundled_chain
    from ui.logos import MARK_SIZE, chain_mark, set_pixel_ratio

    set_pixel_ratio(2.0)
    try:
        blob, index = make_bundle({"ethereum": PNG_A})
        fetched = bundle_tier(MARK_SIZE * 2.0)
        remember_bundle_at(CHAINS, fetched, blob, index)

        assert bundle_tier(18 * 2.0) != fetched, "the sizes must disagree"
        assert decoded(bundled_chain("ethereum", 18 * 2.0)) == PNG_A
        assert decoded(chain_mark("ethereum", 18).src) == PNG_A
    finally:
        set_pixel_ratio(2.0)


def test_a_mark_wanted_larger_than_anything_fetched_uses_the_largest() -> None:
    from ui.assets import CHAINS, bundled_chain

    blob, index = make_bundle({"ethereum": PNG_A})
    remember_bundle_at(CHAINS, 40, blob, index)

    assert decoded(bundled_chain("ethereum", 400)) == PNG_A


def test_a_tier_that_covers_it_is_preferred_to_a_larger_one() -> None:
    from ui.assets import CHAINS, bundled_chain

    small, small_index = make_bundle({"ethereum": PNG_A})
    large, large_index = make_bundle({"ethereum": PNG_B})
    remember_bundle_at(CHAINS, 40, small, small_index)
    remember_bundle_at(CHAINS, 80, large, large_index)

    assert decoded(bundled_chain("ethereum", 30)) == PNG_A
    assert decoded(bundled_chain("ethereum", 70)) == PNG_B


async def test_a_complete_bundle_stops_marks_being_asked_for_one_by_one(
        monkeypatch) -> None:
    """`build_assets` bundles a chain by globbing its whole directory, so a
    mark the bundle does not know is a mark with no file anywhere.  Asking for
    it is a 404 the browser cannot foresee -- and the Swap tab's picker offers
    hundreds of coins at once, which made it a screenful of them."""
    from ui import assets

    monkeypatch.setattr(assets, "is_browser", lambda: True)
    blob, index = make_bundle({"0xaa": PNG_A})

    async def fetch(url):
        return json.dumps(index).encode() if url.endswith(".json") else blob

    await assets.load_bundle(assets.token_bundle("xdai"), 80, fetch)
    assert assets.token_logo("xdai", "0xbb", 80), "not settled yet, so still asked"

    await assets.load_bundle(assets.token_bundle("xdai"), 80, fetch, rest=True)

    assert assets.have_every_mark(assets.token_bundle("xdai"), 80)
    assert assets.token_logo("xdai", "0xbb", 80) is None, "no file, so no request"
    assert assets.bundled_mark("xdai", "0xaa", 80), "and the ones there still draw"


async def test_no_second_half_means_the_first_half_was_everything(monkeypatch) -> None:
    """Only a chain too big for one bundle gets a `-rest`.  Its absence is an
    answer, not a failure -- so a 404 there settles the chain rather than
    leaving every mark to be asked for individually."""
    from curve.http import ApiError
    from ui import assets

    monkeypatch.setattr(assets, "is_browser", lambda: True)
    blob, index = make_bundle({"0xaa": PNG_A})

    async def fetch(url):
        if assets.REST_INFIX in url:
            raise ApiError(f"HTTP 404 from {url}", status=404)
        return json.dumps(index).encode() if url.endswith(".json") else blob

    await assets.load_bundle(assets.token_bundle("xdai"), 80, fetch)
    await assets.load_bundle(assets.token_bundle("xdai"), 80, fetch, rest=True)

    assert assets.have_every_mark(assets.token_bundle("xdai"), 80)
    assert assets.token_logo("xdai", "0xbb", 80) is None


async def test_a_second_half_that_never_arrived_leaves_marks_askable(
        monkeypatch) -> None:
    """A dropped connection says nothing about whether the file exists, so
    the individual ask has to stay -- otherwise half a chain's marks would go
    missing until the tab was reloaded."""
    from curve.http import ApiError
    from ui import assets

    monkeypatch.setattr(assets, "is_browser", lambda: True)
    blob, index = make_bundle({"0xaa": PNG_A})

    async def fetch(url):
        if assets.REST_INFIX in url:
            raise ApiError("the connection went away", status=None)
        return json.dumps(index).encode() if url.endswith(".json") else blob

    await assets.load_bundle(assets.token_bundle("xdai"), 80, fetch)
    await assets.load_bundle(assets.token_bundle("xdai"), 80, fetch, rest=True)

    assert not assets.have_every_mark(assets.token_bundle("xdai"), 80)
    assert assets.token_logo("xdai", "0xbb", 80), "still worth asking"


def test_a_desktop_build_answers_from_the_filesystem_as_it_did(monkeypatch) -> None:
    """None of this applies where a file can simply be looked for."""
    from ui import assets

    monkeypatch.setattr(assets, "is_browser", lambda: False)
    monkeypatch.setattr(assets, "_exists", lambda _relative: False)
    assert assets.token_logo("xdai", "0xbb", 80) is None
    monkeypatch.setattr(assets, "_exists", lambda _relative: True)
    assert assets.token_logo("xdai", "0xbb", 80)
