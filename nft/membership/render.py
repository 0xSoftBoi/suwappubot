#!/usr/bin/env python3
"""Suwappu Membership — soulbound subscription-credential renderer.

Reads contracts/SuwappuMembership.sol as ground truth for what a card is
allowed to say: `Tier` (Free/Pro/Premium/Enterprise), `expiresAt` (0 == never,
FREE only), `pricePaidPerPeriod` (the snapshot the holder actually paid), and
`tokenOf` (one soulbound token per wallet, no burn, no transfer). Everything
this renderer draws is answerable to one of those fields or to `member_since`
— the continuous-hold timestamp the indexer resolves from `MembershipMinted` /
`SubscriptionUpdate` gap analysis and passes in, exactly the way
position-cards/render.py takes `minted_at` from outside the contract.


THE OBJECT
──────────
This is a private members' club card, not a subscription receipt. The previous
build was a competent admin credential — a big left-aligned tier word, a badge
roundel, four rows of micro-type — and it read as a SaaS plan badge. A club
card is an OBJECT: mostly empty surface, one mark doing all the work, the
member's tier stated quietly rather than shouted.

So the composition is symmetric and near-empty. A mon (家紋 — a Japanese family
crest) sits dead centre; the wordmark is a small centred masthead; the tier is
one tracked line beneath the mark; the serial and the dates live in the four
corners; everything else was deleted. The tier tagline ("reduced fees, priority
alerts") was cut outright — it is product copy, it belongs in the metadata, and
on the card it was the single thing that made the object read as a pricing tier.

The mark is `chigai-masu` — two offset, interlocking squares. It is a real crest
form, it is literally two identical things trading places, and it is the one
device tried that survives a 190px marketplace thumbnail without collapsing into
a face, a "C", or a Venn diagram. Six abstract swap-arc marks were drawn and
rejected first; the rendered proofs are why.

Materiality is carried by four SVG-only techniques, no filters and no external
assets: a tiled grain pattern, a letterpress bite on the mon (an offset shadow
in the well plus an offset white lip catching the light), a milled edge of fine
radial ticks around the whole perimeter, and — earned, not given — a foil fill
with a specular streak.


TWO RULES THIS FILE IS NOT ALLOWED TO BREAK
───────────────────────────────────────────
  1. Same brand, different SILHOUETTE. A Position is a portrait engraved plate
     (see ../position-cards/render.py); a Membership is a landscape, rounded
     -corner CREDENTIAL, cut to the ISO/IEC 7810 ID-1 ratio a real card is cut
     to (1.586:1). The aspect ratio alone keeps the two from ever being
     confused in a wallet grid, even under letterboxed thumbnails.

  2. Tier is BOUGHT, not EARNED — it must never look like rarity. Every tier
     gets one fixed ink and otherwise the IDENTICAL card. The four inks are
     tuned to a 7.14–7.84:1 band on the shared ground (measured, see
     config.json) precisely so that no tier is louder, darker or richer than
     another: they are colour-coded the way a club colour-codes its cards, and
     that is all. The previous palette failed this quietly — Free got the
     weakest grey and Enterprise got pure black, which is a rarity ramp wearing
     a colour-coding costume.

     The only axis that earns ornament is CONTINUOUS MEMBERSHIP TIME
     (`member_since` -> now, unbroken), and it earns it as a MATERIAL upgrade
     rather than as more decoration:

        New         0-89d    ink mon, letterpress bite, plain edge
        Established 90-364d  + milled long edges, + ruled intaglio ground
        Long-held   365-729d + FOIL mon w/ specular, + full milled edge
        Founding    730d+    + aged ground, + double keyline, + deep ruling

     A day-old Enterprise card is a clean ink-on-cream object. A three-year
     Free card is foiled, milled, aged and double-ruled. That ordering is the
     whole point and tests/test_membership_card.py pins it.

Reuses primitives from ../position-cards/render.py (_mix, contrast, _lum,
_small_caps, DISPLAY, MONO, esc) rather than re-deriving them — same brand,
same hand, different form.

  python3 nft/membership/render.py --gallery       # contact sheet -> preview/
  python3 nft/membership/render.py --tier Premium --token-id 42 --days 400
"""

import argparse
import hashlib
import math
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
POSITIONS = os.path.join(REPO, "nft", "position-cards")
sys.path.insert(0, POSITIONS)

import json  # noqa: E402

from render import (  # noqa: E402
    DISPLAY,
    MONO,
    _lum,
    _mix,
    _small_caps,
    contrast,
    esc,
)

TIERS = ("Free", "Pro", "Premium", "Enterprise")

# ISO/IEC 7810 ID-1 is 85.60 x 53.98 mm — 1.5858:1. The card body is cut to
# that ratio exactly; the canvas just adds bleed for the lift shadow.
W, H = 1000, 640
CARD_W = 940
CARD_H = round(CARD_W / 1.5858)  # 593
X0 = (W - CARD_W) // 2  # 30
Y0 = 20
X1, Y1 = X0 + CARD_W, Y0 + CARD_H
R = 34  # corner radius, ID-1-proportional

MONO_CODE = {"Free": "FR", "Pro": "PR", "Premium": "PM", "Enterprise": "EN"}

D = math.pi / 180


def load_config() -> dict:
    with open(os.path.join(HERE, "config.json")) as f:
        return json.load(f)


def tier_name(tier) -> str:
    """Accept either the contract's Tier index (0-3) or its name."""
    if isinstance(tier, int):
        return TIERS[tier]
    if tier not in TIERS:
        raise ValueError(f"unknown tier {tier!r}")
    return tier


def days_held(member_since: datetime, now: datetime) -> int:
    return max(0, (now - member_since).days)


def patina_band_for(cfg: dict, days: int) -> dict:
    """Continuous-hold days -> patina band. Evaluated top-down (bands are
    sorted richest-first in config.json), never gated by tier."""
    for band in cfg["patina"]["bands"]:
        if days >= band["min_days"]:
            return band
    return cfg["patina"]["bands"][-1]


def is_lapsed(tier: str, expires_at: int | None, now: datetime) -> bool:
    """Honesty gate: a card must never look active for a benefit the holder
    no longer has. FREE never expires (expiresAt is always 0 on-chain); a
    paid tier is lapsed once `now` has passed its stamped expiry, mirroring
    `tierOf()`'s expiry-collapse exactly."""
    if tier == "Free":
        return False
    if not expires_at:
        return False  # defensive: a paid tier with no expiry is not yet real
    return now.timestamp() >= expires_at


def _text_safe(fg: str, ink: str, bg: str, floor: float) -> str:
    """Nudge `fg` toward `ink` until it clears `floor` against `bg`. Used only
    for colour used AS TEXT — decorative strokes (the milled edge, the ruled
    ground, the tenure arc) are not required to clear it, matching
    position-cards' own precedent of exempting line art from the text floor."""
    if contrast(fg, bg) >= floor:
        return fg
    for i in range(1, 21):
        candidate = _mix(fg, ink, i / 20)
        if contrast(candidate, bg) >= floor:
            return candidate
    return ink


def _seed(token_id: int, tier: str) -> int:
    """A stable integer derived from what the token IS.

    hashlib, not builtins.hash — Python randomises str hashing per process
    (PYTHONHASHSEED), so the previous `hash(tier)` seed made the grain and
    milled-edge phase differ between two runs of the same card. The old
    determinism test only compared two calls inside ONE process, so it never
    caught it.
    """
    key = f"{tier}|{token_id}"
    return int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big")


def card_traits(cfg: dict, tier, expires_at, member_since: datetime, now: datetime | None = None):
    """The structural/legibility facts a card resolves to, split out so the
    quality harness can check every state without re-parsing SVG (same shape
    as position-cards/render.py::card_traits)."""
    now = now or datetime.now(timezone.utc)
    t = tier_name(tier)
    tcfg = cfg["tiers"][t]
    d = days_held(member_since, now)
    band = patina_band_for(cfg, d)
    band_i = cfg["patina"]["bands"].index(band)  # 0 = richest .. 3 = New
    lapsed = is_lapsed(t, expires_at, now)

    b = cfg["brand"]
    plate = b["bg"]  # every tier shares the ground. Identity is the ink.
    ink = tcfg["accent"]  # a literal hex; see config.json for why
    neutral = b["text"]
    quiet = b["text-2"]

    if lapsed:
        # Desaturated toward the plate — inactive reads cooler and flatter,
        # never louder. Still forced back over the text floor below.
        ink = _text_safe(_mix(ink, quiet, 0.55), neutral, plate, 4.5)

    return {
        "tier": t,
        "lapsed": lapsed,
        "days_held": d,
        "years_held": d // 365,
        "patina": band["name"],
        "patina_level": 3 - band_i,  # 0 New .. 3 Founding
        "dark_plate": False,
        "plate": plate,
        "ink": ink,
        "neutral": neutral,
        "quiet": quiet,
        "accent": ink,
        "text_accent": ink,
        "tier_contrast": round(contrast(ink, plate), 2),
        "accent_contrast": round(contrast(ink, plate), 2),
        "label_contrast": round(contrast(quiet, plate), 2),
        "foil": band_i <= 1,  # Long-held and Founding only
    }


# ─── the mon ────────────────────────────────────────────────────────────────
# chigai-masu: two offset squares (masu = a square measuring box), interlocked.
# Drawn as a woven overlap rather than two crossing outlines, because at
# thumbnail size a plain crossing reads as one muddy shape while a weave keeps
# reading as two distinct objects passing each other — which is the whole point.


def _diamond(cx, cy, s):
    p = [(cx, cy - s), (cx + s, cy), (cx, cy + s), (cx - s, cy)]
    return "M" + "L".join(f"{x:.2f} {y:.2f}" for x, y in p) + "Z"


def _mon(cx, cy, r, stroke, plate, weight=1.0):
    """The club mark. `stroke` may be a colour or a url(#foil) reference; the
    knockout that creates the weave always uses the literal plate colour, so it
    must be drawn over a plate-coloured disc (see _mon_field)."""
    s, off = r * 0.42, r * 0.25
    w = r * 0.115 * weight
    a, b = _diamond(cx - off, cy - off, s), _diamond(cx + off, cy + off, s)
    ring = (
        f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r - r * 0.055 / 2:.2f}" fill="none" '
        f'stroke="{stroke}" stroke-width="{r * 0.055:.2f}"/>'
    )
    return (
        ring
        + f'<path d="{a}" fill="none" stroke="{stroke}" stroke-width="{w:.2f}"/>'
        # knock the near square out of the far one, then redraw it: the weave
        + f'<path d="{b}" fill="none" stroke="{plate}" stroke-width="{w * 2.5:.2f}"/>'
        + f'<path d="{b}" fill="none" stroke="{stroke}" stroke-width="{w:.2f}"/>'
        # ...and put back the one segment of the far square that passes over
        + f'<path d="{a}" fill="none" stroke="{stroke}" stroke-width="{w:.2f}" '
        f'stroke-dasharray="{s * 0.9:.1f} {s * 3.4:.1f}" stroke-dashoffset="{s * 0.45:.1f}"/>'
    )


# ─── materiality ────────────────────────────────────────────────────────────


def _grain_pattern(seed: int, ink: str) -> str:
    """A tiled speck field. Paper is not flat; a perfectly clean vector ground
    is the single loudest tell that a card is a UI mockup rather than a printed
    object. One 64px tile of deterministic specks costs ~1.5kB and covers the
    whole plate, instead of the ~120kB a full-bleed scatter would."""
    rnd = seed
    specks = []
    for _ in range(34):
        rnd = (rnd * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
        x = (rnd >> 8) % 640 / 10
        y = (rnd >> 24) % 640 / 10
        rr = 0.5 + ((rnd >> 40) % 9) / 10
        op = 0.030 + ((rnd >> 48) % 5) / 100
        specks.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rr:.2f}" opacity="{op:.3f}"/>')
    return (
        f'<pattern id="grain" width="64" height="64" patternUnits="userSpaceOnUse">'
        f'<g fill="{ink}">{"".join(specks)}</g></pattern>'
    )


def _milled_edge(x0, y0, x1, y1, r, coverage, stroke, seed):
    """A coin's milled edge: fine radial ticks around the perimeter. `coverage`
    is 0 (none), 1 (the two long edges) or 2 (the full ring including corners).

    Pitch and tick length are set for the 190px thumbnail, where the ticks
    resolve below a pixel and fuse into a soft tonal band around the card —
    which is exactly what a milled edge looks like from arm's length. Drawn as
    <line>, so it never inflates the <path> count the patina ordering test
    reads.
    """
    if coverage <= 0:
        return ""
    inset_a, inset_b = 8.5, 18.0
    pitch = 7.0
    out = []
    edges = [
        ((x0 + r, y0), (x1 - r, y0), (0, -1)),
        ((x0 + r, y1), (x1 - r, y1), (0, 1)),
    ]
    if coverage >= 2:
        edges += [
            ((x0, y0 + r), (x0, y1 - r), (-1, 0)),
            ((x1, y0 + r), (x1, y1 - r), (1, 0)),
        ]
    for (ax, ay), (bx, by), (nx, ny) in edges:
        length = math.hypot(bx - ax, by - ay)
        n = max(1, int(length / pitch))
        for i in range(n + 1):
            t = i / n
            px, py = ax + (bx - ax) * t, ay + (by - ay) * t
            sx, sy = px - nx * inset_a, py - ny * inset_a
            ex, ey = px - nx * inset_b, py - ny * inset_b
            out.append(
                f'<line x1="{sx:.1f}" y1="{sy:.1f}" x2="{ex:.1f}" y2="{ey:.1f}"/>'
            )
    if coverage >= 2:
        # carry the milling around the four corner arcs so the ring closes
        for cx, cy, a0 in (
            (x0 + r, y0 + r, 180),
            (x1 - r, y0 + r, 270),
            (x1 - r, y1 - r, 0),
            (x0 + r, y1 - r, 90),
        ):
            steps = max(1, int((math.pi / 2 * r) / pitch))
            for i in range(steps + 1):
                a = (a0 + 90 * i / steps) * D
                ca, sa = math.cos(a), math.sin(a)
                out.append(
                    f'<line x1="{cx + (r - inset_a) * ca:.1f}" y1="{cy + (r - inset_a) * sa:.1f}" '
                    f'x2="{cx + (r - inset_b) * ca:.1f}" y2="{cy + (r - inset_b) * sa:.1f}"/>'
                )
    return f'<g stroke="{stroke}" stroke-width="1.7" stroke-opacity="0.42">{"".join(out)}</g>'


def _ruled_ground(x0, y0, x1, y1, level, ink):
    """Intaglio ruling — the fine horizontal line-work an engraver lays under a
    banknote vignette to give a flat area tone and depth. It deepens with
    tenure, which is the literal reading of "patina": the plate has been struck
    more.

    Each density band is emitted as ONE <path>, so the element count rises
    monotonically with patina and the "three years of Free out-ornaments a
    day-old Enterprise" ordering holds structurally, not by accident.
    """
    if level <= 0:
        return ""
    bands = [
        # (spacing, y-extent as fraction of card height, opacity)
        (5.0, (0.16, 0.84), 0.030),
        (5.0, (0.07, 0.93), 0.026),
        (2.5, (0.28, 0.72), 0.024),
    ][:level]
    h = y1 - y0
    out = []
    for spacing, (f0, f1), op in bands:
        ya, yb = y0 + h * f0, y0 + h * f1
        d = []
        y = ya
        while y <= yb:
            d.append(f"M{x0:.1f} {y:.1f}H{x1:.1f}")
            y += spacing
        out.append(
            f'<path d="{"".join(d)}" fill="none" stroke="{ink}" stroke-width="0.8" '
            f'stroke-opacity="{op}"/>'
        )
    return "".join(out)


def _tenure_arc(cx, cy, r, years, rim, ink):
    """The one piece of ornament that is a direct, legible function of TIME.

    It is drawn ON the medallion's rim, not floating outside it: the member's
    unbroken years progressively strike the rim in the tier ink, one tenth per
    year, capped at ten. Two earlier cuts failed here and the renders are why —
    a ring of hairline year-ticks rasterized as floating debris, and an arc at
    its own radius read as a second, broken circle bumping into the mon. Making
    the arc and the rim the same circle is what turns it from a mistake into
    "the edge fills in".
    """
    if years <= 0:
        return ""
    frac = min(years, 10) / 10
    if frac >= 0.999:
        return (
            f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="none" '
            f'stroke="{ink}" stroke-width="4.6"/>'
        )
    a0 = -90 * D
    a1 = a0 + 2 * math.pi * frac
    large = 1 if frac > 0.5 else 0
    return (
        f'<path d="M{cx + r * math.cos(a0):.2f} {cy + r * math.sin(a0):.2f}'
        f"A{r:.2f} {r:.2f} 0 {large} 1 "
        f'{cx + r * math.cos(a1):.2f} {cy + r * math.sin(a1):.2f}" fill="none" '
        f'stroke="{ink}" stroke-width="4.6" stroke-linecap="butt"/>'
    )


def _reeding(cx, cy, r, ink, n=120):
    """Reeding around the medallion rim — the milled edge of a struck coin,
    applied to the mark's field. A Founding card only. Emitted as <line> so it
    does not inflate the <path> count the patina ordering test reads, and
    pitched tight enough (3 degrees) that at a 190px thumbnail it fuses into a
    textured band rather than disappearing, which is the whole reason it is
    here and the fine border ticks it replaces were not."""
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        ca, sa = math.cos(a), math.sin(a)
        out.append(
            f'<line x1="{cx + (r + 4) * ca:.1f}" y1="{cy + (r + 4) * sa:.1f}" '
            f'x2="{cx + (r + 11) * ca:.1f}" y2="{cy + (r + 11) * sa:.1f}"/>'
        )
    return f'<g stroke="{ink}" stroke-width="1.7" stroke-opacity="0.38">{"".join(out)}</g>'


def render_membership(
    cfg: dict,
    token_id: int,
    tier,
    expires_at: int | None,
    member_since: datetime,
    price_paid_per_period: int = 0,
    now: datetime | None = None,
) -> str:
    """Render one membership credential.

    `expires_at` is `Membership.expiresAt` verbatim (0 for FREE). `member_since`
    is the continuous-hold start of the CURRENT unbroken streak — resolved off
    -chain from mint + subscription-gap events, the same way position-cards
    takes `minted_at` from outside the contract rather than storing it again.
    A gap (lapse then re-subscribe) resets `member_since`; that is what makes
    the patina an honest signal of an unbroken hold, not just token age.
    """
    now = now or datetime.now(timezone.utc)
    tr = card_traits(cfg, tier, expires_at, member_since, now)
    t, lapsed = tr["tier"], tr["lapsed"]
    level = tr["patina_level"]  # 0 New .. 3 Founding

    plate, ink = tr["plate"], tr["ink"]
    neutral, quiet = tr["neutral"], tr["quiet"]
    seed = _seed(token_id, t)

    # Rule/edge colour: warm, low-contrast, never black. Line art on a cream
    # ground goes muddy the moment it is neutral grey.
    rule = _mix(neutral, plate, 0.60)
    deep = _mix(ink, "#000000", 0.35)  # the shadow in a letterpress well
    # Age warms stock, it does not grey it. Mixing the vignette in the tier ink
    # turned the slate tier's Founding card dirty rather than rich, so it is
    # cast toward tobacco — the colour cream actually goes with handling.
    aged = _mix(ink, "#8a5a2b", 0.55)

    ix0, ix1 = X0 + 58, X1 - 58
    mcx, mcy, mr = W / 2, Y0 + 292, 104

    p = []

    # ── defs ────────────────────────────────────────────────────────────────
    foil_id = f"foil{token_id}"
    defs = [
        f'<clipPath id="cut{token_id}"><rect x="{X0}" y="{Y0}" width="{CARD_W}" '
        f'height="{CARD_H}" rx="{R}"/></clipPath>',
        _grain_pattern(seed, neutral),
        # Foil. On a CREAM stock, foil does not read as a bright flash — a
        # light band across the mark just looks like the mark was erased, which
        # is exactly what the first cut did. Real foil on light paper reads as a
        # shifting DEEPENING with one narrow glint. So the ramp runs
        # deep -> ink -> glint -> ink -> deep, and the glint is capped at a 20%
        # tint: measured, that keeps even the brightest point of the hero mark
        # at 4.34-4.56:1 on the ground, clear of the 4:1 hero floor. A 30% tint
        # was tried and measured 3.4-3.6:1 — rejected on contrast, not taste.
        f'<linearGradient id="{foil_id}" x1="0.05" y1="0.1" x2="0.95" y2="0.9">'
        f'<stop offset="0" stop-color="{deep}"/>'
        f'<stop offset="0.34" stop-color="{ink}"/>'
        f'<stop offset="0.47" stop-color="{_mix(ink, "#ffffff", 0.20)}"/>'
        f'<stop offset="0.53" stop-color="{_mix(ink, "#ffffff", 0.20)}"/>'
        f'<stop offset="0.66" stop-color="{ink}"/>'
        f'<stop offset="1" stop-color="{deep}"/></linearGradient>',
        # Aged ground: a warm vignette that only a Founding card earns.
        f'<radialGradient id="age{token_id}" cx="0.5" cy="0.46" r="0.72">'
        f'<stop offset="0.42" stop-color="{aged}" stop-opacity="0"/>'
        f'<stop offset="1" stop-color="{aged}" stop-opacity="0.10"/></radialGradient>',
    ]
    p.append("<defs>" + "".join(defs) + "</defs>")

    # ── the card body ───────────────────────────────────────────────────────
    # A soft lift shadow — this is a thing you carry, not a plate laid flat —
    # drawn as stacked offset rects rather than a blur filter, because
    # marketplace renderers vary in filter support and stacked rects rasterize
    # identically everywhere.
    for dy, op in ((11, 0.045), (6, 0.045), (2.5, 0.05)):
        p.append(
            f'<rect x="{X0 + dy * 0.4:.1f}" y="{Y0 + dy}" width="{CARD_W}" height="{CARD_H}" '
            f'rx="{R}" fill="#000000" opacity="{op}"/>'
        )
    p.append(
        f'<rect x="{X0}" y="{Y0}" width="{CARD_W}" height="{CARD_H}" rx="{R}" fill="{plate}"/>'
    )

    p.append(f'<g clip-path="url(#cut{token_id})">')

    # patina 1: the ruled intaglio ground, deepening with tenure
    p.append(_ruled_ground(X0, Y0, X1, Y1, level, ink))
    # patina 2: the aged vignette, Founding only
    if level >= 2:
        p.append(
            f'<rect x="{X0}" y="{Y0}" width="{CARD_W}" height="{CARD_H}" '
            f'fill="url(#age{token_id})" opacity="{0.55 if level == 2 else 1}"/>'
        )
    # paper grain, on every card — the floor, not a reward
    p.append(
        f'<rect x="{X0}" y="{Y0}" width="{CARD_W}" height="{CARD_H}" fill="url(#grain)"/>'
    )
    # patina 3: the milled edge
    p.append(
        _milled_edge(X0, Y0, X1, Y1, R, 0 if level < 1 else (1 if level == 1 else 2), rule, seed)
    )
    p.append("</g>")

    # the keyline frame. A Founding card earns a second, inner rule — the
    # oldest and cheapest signal of ceremony there is.
    k = 26
    p.append(
        f'<rect x="{X0 + k}" y="{Y0 + k}" width="{CARD_W - 2 * k}" height="{CARD_H - 2 * k}" '
        f'rx="{R - k * 0.55:.0f}" fill="none" stroke="{rule}" stroke-width="1.4"/>'
    )
    if level >= 2:
        k2 = k + 7
        p.append(
            f'<rect x="{X0 + k2}" y="{Y0 + k2}" width="{CARD_W - 2 * k2}" '
            f'height="{CARD_H - 2 * k2}" rx="{R - k2 * 0.55:.0f}" fill="none" '
            f'stroke="{rule}" stroke-width="0.8" stroke-opacity="0.7"/>'
        )
    # the card's own edge, last, so nothing bleeds over it
    p.append(
        f'<rect x="{X0 + 0.75}" y="{Y0 + 0.75}" width="{CARD_W - 1.5}" height="{CARD_H - 1.5}" '
        f'rx="{R}" fill="none" stroke="{_mix(neutral, plate, 0.45)}" stroke-width="1.5"/>'
    )

    # ── masthead: centred, small, tracked. Four words on the whole card. ────
    p.append(
        f'<text x="{W / 2}" y="{Y0 + 84}" font-family="{DISPLAY}" font-size="17" '
        f'font-weight="600" fill="{neutral}" text-anchor="middle" '
        f'letter-spacing="12">SUWAPPU</text>'
    )
    p.append(_small_caps("Membership", W / 2, Y0 + 106, 9, quiet, 6.5, anchor="middle"))

    # corner marks: class code left, serial right. Nothing else up here.
    p.append(
        f'<text x="{ix0}" y="{Y0 + 84}" font-family="{MONO}" font-size="12.5" '
        f'fill="{quiet}" letter-spacing="2.4">{esc(MONO_CODE[t])}</text>'
    )
    p.append(
        f'<text x="{ix1}" y="{Y0 + 84}" font-family="{MONO}" font-size="12.5" '
        f'fill="{quiet}" text-anchor="end" letter-spacing="1.4">'
        f"No.&#160;{token_id:06d}</text>"
    )

    # ── the mon ─────────────────────────────────────────────────────────────
    # A plate-coloured disc first: the weave knocks out with the plate colour,
    # so it needs clean ground under it, and the disc doubles as the floor of
    # the debossed well.
    # The struck medallion field: a clean disc of stock the ruling stops at,
    # the way an engraver leaves a vignette its own ground. It is also load
    # -bearing — the mon's weave knocks out with the plate colour and needs
    # clean ground under it — so its edge is made deliberate with a hairline
    # rather than left as an accidental circle in the ruling.
    fr = mr + 34
    p.append(f'<circle cx="{mcx}" cy="{mcy}" r="{fr}" fill="{plate}"/>')
    if level >= 3:
        p.append(_reeding(mcx, mcy, fr, rule))
    p.append(
        f'<circle cx="{mcx}" cy="{mcy}" r="{fr}" fill="none" stroke="{rule}" '
        f'stroke-width="{1.4 if level < 2 else 2.2}" stroke-opacity="0.5"/>'
    )
    # letterpress bite: the shadow cast inside the impression...
    p.append(
        f'<g opacity="0.30" transform="translate(2.4,2.8)">'
        f'{_mon(mcx, mcy, mr, _mix(neutral, plate, 0.25), plate)}</g>'
    )
    # ...and the lip of paper on the far side catching the light.
    p.append(
        f'<g opacity="0.85" transform="translate(-1.5,-1.7)">'
        f'{_mon(mcx, mcy, mr, "#ffffff", plate)}</g>'
    )
    p.append(_mon(mcx, mcy, mr, f"url(#{foil_id})" if tr["foil"] else ink, plate))

    p.append(_tenure_arc(mcx, mcy, fr, tr["years_held"], rule, ink))

    # ── the tier, stated quietly ────────────────────────────────────────────
    # One tracked line, 19px, in the tier ink. Not a 66px grotesk headline.
    ty = mcy + mr + 76
    p.append(
        f'<text x="{W / 2}" y="{ty}" font-family="{DISPLAY}" font-size="19" '
        f'font-weight="600" fill="{ink}" text-anchor="middle" '
        f'letter-spacing="13">{esc(t.upper())}</text>'
    )
    if lapsed:
        p.append(
            _small_caps(
                "lapsed — renew to restore",
                W / 2,
                ty + 26,
                9.5,
                _text_safe("#8f3355", neutral, plate, 4.5),
                4.0,
                anchor="middle",
            )
        )

    # ── the corners: since, and valid through. Fine print, and that is all. ─
    fy = Y1 - 74
    since_s = member_since.strftime("%d %b %Y").upper()
    if t == "Free":
        thru_lab, thru_s = "valid", "NO EXPIRY"
    else:
        thru_lab = "expired" if lapsed else "valid through"
        thru_s = datetime.fromtimestamp(expires_at, tz=timezone.utc).strftime("%d %b %Y").upper()

    for lab, val, x, anc in (
        ("member since", since_s, ix0, "start"),
        (thru_lab, thru_s, ix1, "end"),
    ):
        p.append(_small_caps(lab, x, fy, 9, quiet, 3.4, anchor=anc))
        p.append(
            f'<text x="{x}" y="{fy + 24}" font-family="{MONO}" font-size="14.5" '
            f'fill="{neutral}" text-anchor="{anc}" letter-spacing="0.6">{esc(val)}</text>'
        )

    # ── compliance rail — outranks every visual idea in this file ───────────
    p.append(
        _small_caps(
            "credential · not equity · not a security · not an investment · "
            "pays nothing · no claim on any issuer",
            W / 2,
            Y1 - 26,
            8.5,
            quiet,
            1.6,
            anchor="middle",
        )
    )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" role="img" aria-label="Suwappu {esc(t)} membership">'
        + "".join(p)
        + "</svg>"
    )


def build_metadata(
    cfg: dict,
    token_id: int,
    tier,
    expires_at: int | None,
    member_since: datetime,
    price_paid_per_period: int = 0,
    now: datetime | None = None,
) -> dict:
    """ERC-721 metadata. Regenerated on every fetch — status and patina move
    with time and renewal state, so this is deliberately dynamic, same as
    position-cards' build_metadata."""
    now = now or datetime.now(timezone.utc)
    tr = card_traits(cfg, tier, expires_at, member_since, now)
    t = tr["tier"]
    col = cfg["collection"]

    attrs = [
        {"trait_type": "Tier", "value": t},
        {"trait_type": "Status", "value": "Lapsed" if tr["lapsed"] else "Active"},
        {"trait_type": "Continuous Hold (days)", "value": tr["days_held"], "display_type": "number"},
        {"trait_type": "Patina", "value": tr["patina"]},
        {"trait_type": "Finish", "value": "Foil" if tr["foil"] else "Ink"},
        {
            "trait_type": "Member Since",
            "value": int(member_since.timestamp()),
            "display_type": "date",
        },
    ]
    if t != "Free":
        attrs.append(
            {
                "trait_type": "Valid Through",
                "value": int(expires_at),
                "display_type": "date",
            }
        )
    if price_paid_per_period:
        attrs.append(
            {
                "trait_type": "USDG Paid Per Period",
                "value": round(price_paid_per_period / 1_000_000, 2),
                "display_type": "number",
            }
        )

    if t == "Free":
        status_line = "Never expires."
    elif tr["lapsed"]:
        exp = datetime.fromtimestamp(expires_at, tz=timezone.utc).strftime("%d %b %Y")
        status_line = f"Lapsed on {exp}. Resolves to Free tier until renewed."
    else:
        exp = datetime.fromtimestamp(expires_at, tz=timezone.utc).strftime("%d %b %Y")
        status_line = f"Active through {exp}."

    desc = (
        f"A soulbound Suwappu {t} membership — {cfg['tiers'][t]['tagline'].lower()}. "
        f"This token IS the subscription: the bot reads it directly to resolve "
        f"which tier a wallet holds. {status_line} Continuously held for "
        f"{tr['days_held']} days ({tr['patina']} patina).\n\n"
        f"Tier is bought and is colour-coded only — every tier is issued on the "
        f"same card, in the same weight of ink. The card's finish is earned by "
        f"unbroken tenure alone: the ground deepens, the edge mills, and at a "
        f"year the mark is struck in foil.\n\n"
        f"One membership per wallet. It cannot be transferred, sold or listed — "
        f"approvals are disabled on the contract. {col['compliance']}"
    )

    return {
        "name": f"Suwappu {t} Membership · #{token_id:06d}",
        "description": desc,
        "image": f"{col['external_url']}/card/{token_id}.svg",
        "external_url": f"{col['external_url']}/{token_id}",
        "attributes": attrs,
        "properties": {
            "chain_id": col["chain"]["chain_id"],
            "soulbound": True,
            "disclaimer": col["compliance"],
        },
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--gallery", action="store_true")
    ap.add_argument("--tier", default="Premium")
    ap.add_argument("--token-id", type=int, default=42)
    ap.add_argument("--days", type=int, default=200, help="continuous days held")
    ap.add_argument("--lapsed", action="store_true")
    ap.add_argument("--out", default=os.path.join(HERE, "preview"))
    args = ap.parse_args()

    cfg = load_config()
    os.makedirs(args.out, exist_ok=True)
    now = datetime(2026, 8, 13, tzinfo=timezone.utc)

    if args.gallery:
        DAY_SAMPLES = [3, 120, 400, 1100]  # New / Established / Long-held / Founding
        for tier in TIERS:
            for days in DAY_SAMPLES:
                since = now - timedelta(days=days)
                expires = None if tier == "Free" else int((now + timedelta(days=10)).timestamp())
                price = {
                    "Free": 0,
                    "Pro": 9_990_000,
                    "Premium": 29_990_000,
                    "Enterprise": 99_990_000,
                }[tier]
                svg = render_membership(cfg, 1, tier, expires, since, price, now)
                open(os.path.join(args.out, f"{tier}_{days}d.svg"), "w").write(svg)
        # one lapsed sample per paid tier
        for tier in ("Pro", "Premium", "Enterprise"):
            since = now - timedelta(days=200)
            expires = int((now - timedelta(days=15)).timestamp())
            svg = render_membership(cfg, 2, tier, expires, since, 9_990_000, now)
            open(os.path.join(args.out, f"{tier}_lapsed.svg"), "w").write(svg)
        print(f"gallery -> {args.out}")
    else:
        since = now - timedelta(days=args.days)
        if args.tier == "Free":
            expires = None
        elif args.lapsed:
            expires = int((now - timedelta(days=15)).timestamp())
        else:
            expires = int((now + timedelta(days=10)).timestamp())
        svg = render_membership(cfg, args.token_id, args.tier, expires, since, 9_990_000, now)
        path = os.path.join(args.out, f"{args.tier}_{args.token_id}.svg")
        open(path, "w").write(svg)
        print(path)
