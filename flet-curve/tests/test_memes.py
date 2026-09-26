"""The stickers that wait where a route will go.

Listed in code rather than discovered, because in the browser there is no
directory to read -- only files that can be fetched by name.  So the list and
the files have to be checked against each other somewhere, and this is it.
"""

from __future__ import annotations

from pathlib import Path

from ui.assets import MEMES, meme

MEME_DIR = Path(__file__).resolve().parents[1] / "src" / "assets" / "memes"


def test_every_listed_sticker_is_actually_bundled():
    missing = [name for name in MEMES if not (MEME_DIR / name).is_file()]
    assert not missing, f"listed but not shipped: {missing}"


def test_every_bundled_sticker_is_listed():
    """One that is shipped and not listed is bytes nobody will ever see."""
    shipped = {path.name for path in MEME_DIR.glob("*.webp")}
    assert shipped == set(MEMES), f"shipped but never shown: {shipped - set(MEMES)}"


def test_a_sticker_is_asked_for_by_its_bundled_path():
    assert meme(pick=lambda names: names[0]) == f"memes/{MEMES[0]}"


def test_the_pick_is_made_from_the_whole_pack():
    seen = {meme(pick=lambda names, at=index: names[at])
            for index in range(len(MEMES))}
    assert len(seen) == len(MEMES)
