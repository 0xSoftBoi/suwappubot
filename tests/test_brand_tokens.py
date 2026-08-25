"""One brand, one definition.

This repo carried TWO fully-realised design systems that disagreed:
`packages/design-tokens` (persimmon/sakura, Pacifico/Quicksand/Nunito — consumed
by terminal, webapp and mobile) and a standalone palette inside
`showcase/tailwind.config.ts` (warm cream, pink, Geist — consumed by the public
marketing site). Both were live. New surfaces inherited whichever they happened
to copy from, and the NFT collection ended up on one of them by luck.

Reconciled in favour of the marketing values, kept in the package that has the
architecture. These tests exist so it cannot split again.
"""

import json
import os
import re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKENS = os.path.join(REPO, "packages", "design-tokens", "src", "tokens.ts")


def _canonical_brand() -> dict:
    src = open(TOKENS).read()
    start = src.index("  brand: {")
    block = src[start : src.index("  colors: {", start)]  # noqa: E203
    pairs = re.findall(r"(\w+):\s*'(#[0-9a-fA-F]{6})'", block)
    assert pairs, "designTokens.brand is missing or unparseable"
    return dict(pairs)


def test_the_package_defines_a_canonical_brand():
    brand = _canonical_brand()
    for key in ("bg", "text", "accent", "green"):
        assert key in brand, f"canonical brand has no {key}"
    assert brand["bg"] == "#faf8f4"
    assert brand["accent"] == "#f472b6"
    assert brand["green"] == "#1a5c38"


def test_showcase_consumes_the_package_instead_of_redefining_it():
    """The public marketing site was the ONE surface not consuming the token
    package, which is how the split survived as long as it did."""
    cfg = open(os.path.join(REPO, "showcase", "tailwind.config.ts")).read()
    assert "warmPreset" in cfg, "showcase does not use the canonical preset"
    assert "presets: [warmPreset]" in cfg
    # and no longer carries its own copy of the palette
    assert "'#faf8f4'" not in cfg, "showcase still hardcodes a brand colour"
    assert "'#f472b6'" not in cfg
    pkg = json.load(open(os.path.join(REPO, "showcase", "package.json")))
    assert "@suwappu/design-tokens" in pkg["dependencies"]


def test_the_nft_collections_read_the_same_canonical_brand():
    """The cards previously read showcase/tailwind.config.ts — one of the two
    competing systems — so they were aligned by luck rather than decision."""
    brand = _canonical_brand()
    camel = {
        "surface2": "surface-2",
        "border2": "border-2",
        "text2": "text-2",
        "text3": "text-3",
        "accentHover": "accent-hover",
        "accentLight": "accent-light",
        "greenLight": "green-light",
        "darkSurface": "dark-surface",
    }
    expected = {camel.get(k, k): v for k, v in brand.items()}
    for rel in ("nft/position-cards/config.json", "nft/membership/config.json"):
        cfg = json.load(open(os.path.join(REPO, rel)))
        for key, value in expected.items():
            assert cfg["brand"].get(key) == value, f"{rel} drifted on {key}"


def test_the_canonical_type_is_geist_not_a_cursive_face():
    """The product calls itself the execution layer between intent and markets.
    A cursive display face contradicts that; the previous stack survives only as
    `legacyFontFamilies` for surfaces not yet migrated."""
    src = open(TOKENS).read()
    block = src[
        src.index("    fontFamilies: {") : src.index("    legacyFontFamilies: {")  # noqa: E203
    ]  # noqa: E203
    assert "Geist" in block
    assert "Pacifico" not in block, "the cursive face is still canonical"
    assert "legacyFontFamilies" in src, "the legacy stack must stay addressable for migration"


def test_the_legacy_system_is_marked_and_not_silently_repainted():
    """webapp/mobile/terminal still consume the legacy presets. That migration is
    a visible visual diff and must not be smuggled in with a token change — but
    the legacy values must be labelled so nothing NEW is built on them."""
    preset = open(
        os.path.join(REPO, "packages", "design-tokens", "src", "tailwind-preset.ts")
    ).read()
    assert "warmPreset" in preset
    assert "LEGACY" in preset.upper(), "the legacy presets are not marked as legacy"
