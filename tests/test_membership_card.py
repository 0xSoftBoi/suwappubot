"""The Suwappu Membership card — a credential, not a collectible.

Two direction calls constrain this card, and both are load-bearing enough to
pin:

  1. It shares the BRAND with Positions but not the FORM. A Position is a
     collectible plate; a membership is a pass you carry. They must never be
     confused in a wallet.
  2. Tier is NOT rarity. Positions status is EARNED (return, mint rank);
     membership tier is BOUGHT. Giving Enterprise a louder plate for costing
     more corrupts the earned-status logic the whole collection rests on. The
     only thing that earns ornament here is unbroken time held.
"""

import importlib.util
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARD = os.path.join(REPO, "nft", "membership")


def _load():
    for p in (CARD, os.path.join(REPO, "nft", "position-cards")):
        if p not in sys.path:
            sys.path.insert(0, p)
    spec = importlib.util.spec_from_file_location(
        "membership_render", os.path.join(CARD, "render.py")
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["membership_render"] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def mr():
    return _load()


@pytest.fixture(scope="module")
def cfg():
    with open(os.path.join(CARD, "config.json")) as f:
        return json.load(f)


NOW = datetime(2026, 8, 13, tzinfo=timezone.utc)


def card(mr, cfg, tier, days_held, token_id=1):
    """Call the real signature: expiresAt verbatim from the contract (0 for
    FREE), and member_since as the start of the current unbroken streak."""
    since = NOW - timedelta(days=days_held)
    expires = 0 if tier == "Free" else int((NOW + timedelta(days=30)).timestamp())
    return mr.render_membership(
        cfg=cfg,
        token_id=token_id,
        tier=tier,
        expires_at=expires,
        member_since=since,
        now=NOW,
    )


def test_no_tier_is_visually_rarer_than_another(cfg):
    """Enterprise was briefly the only dark card, which made the highest-SPEND
    tier the loudest plate — the exact 'tier as rarity' trap this collection
    cannot afford, since its whole status logic is that ornament is earned."""
    tiers = cfg["tiers"]
    darks = [t for t in tiers["order"] if tiers[t].get("dark_plate")]
    assert not darks, f"{darks} get a louder plate for costing more"
    # and colour is a fixed identity per tier, never randomised
    accents = {t: tiers[t]["accent"] for t in tiers["order"]}
    assert len(set(accents.values())) >= 3, f"tiers are not distinguishable: {accents}"


def test_every_tier_has_a_distinct_monogram(mr, cfg):
    """Pro and Premium both start with P: a single initial made the two paid
    tiers indistinguishable at the seal."""
    seen = {}
    for tier in ("Free", "Pro", "Premium", "Enterprise"):
        svg = card(mr, cfg, tier, 200, 1)
        mono = {"Free": "FR", "Pro": "PR", "Premium": "PM", "Enterprise": "EN"}[tier]
        assert f">{mono}<" in svg, f"{tier} monogram missing"
        assert mono not in seen, f"{tier} shares a monogram with {seen.get(mono)}"
        seen[mono] = tier


def test_ornament_tracks_time_held_and_nothing_else(mr, cfg):
    """The one thing a member earns is duration. It must visibly accrue, and it
    must not be reachable by paying for a higher tier instead."""
    same_tier = [card(mr, cfg, "Pro", d, 1) for d in (3, 400, 1100)]
    assert len(set(same_tier)) == 3, "time held does not change the card"

    # a brand-new Enterprise must not out-ornament a long-held Free
    new_ent = card(mr, cfg, "Enterprise", 3, 1)
    old_free = card(mr, cfg, "Free", 1100, 1)
    assert new_ent.count("<path") <= old_free.count(
        "<path"
    ), "buying the top tier bought more ornament than three years of membership"


def test_the_card_is_a_credential_not_a_plate(mr, cfg):
    """Distinct silhouette from Positions, so the two are never confused in a
    wallet. A membership that looks mintable sends the wrong signal."""
    import re

    svg = card(mr, cfg, "Premium", 200, 1)
    w = int(re.search(r'width="(\d+)"', svg).group(1))
    h = int(re.search(r'height="(\d+)"', svg).group(1))
    assert w > h, "the credential must be landscape; Positions plates are portrait"


def test_it_never_references_anything_external(mr, cfg):
    """A marketplace renders this under a strict CSP."""
    import re

    svg = card(mr, cfg, "Pro", 90, 1)
    body = svg.replace('xmlns="http://www.w3.org/2000/svg"', "")
    for bad in ("http://", "https://", "@import", "@font-face", "<image", " src="):
        assert bad not in body, bad
    for ref in re.findall(r'href="([^"]+)"', body):
        assert ref.startswith("#") and f'id="{ref[1:]}"' in body, f"dangling ref {ref}"


def test_rendering_is_deterministic(mr, cfg):
    a = card(mr, cfg, "Premium", 365, 42)
    b = card(mr, cfg, "Premium", 365, 42)
    assert a == b


def test_the_card_never_reads_as_a_security(mr, cfg):
    """A membership is access to a product. It is not equity, not a claim, and
    it pays nothing."""
    import re

    # The disclaimer is the NEGATION of these words ("not equity, not a
    # security, not an investment"), so scanning it fires on every card and
    # would bury a real hit. Excise it first, then require it was there.
    for tier in ("Free", "Pro", "Premium", "Enterprise"):
        svg = card(mr, cfg, tier, 200, 1)
        assert "not equity" in svg.lower(), f"{tier} card has no disclaimer"
        blob = re.sub(r"[Nn]ot equity.*?issuer", " ", svg, flags=re.S).lower()
        for phrase in ("shares of", "dividend", "invest in", "guaranteed", "returns of"):
            assert phrase not in blob, f"{tier} card says {phrase!r}"

    # and the check must still be able to catch a real one
    planted = svg.replace("MEMBERSHIP", "GUARANTEED RETURNS", 1)
    planted = re.sub(r"[Nn]ot equity.*?issuer", " ", planted, flags=re.S).lower()
    assert "guaranteed" in planted, "the compliance check cannot detect a violation"
