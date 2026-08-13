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

TWO RULES THIS FILE IS NOT ALLOWED TO BREAK:

  1. Same brand, different SILHOUETTE. A Position is a portrait engraved
     plate (see ../position-cards/render.py); a Membership is a landscape,
     rounded-corner CREDENTIAL — the shape of a card you carry, not a plate
     you'd hang. The aspect ratio alone (1.5625:1 vs 0.8:1) keeps the two from
     ever being confused in a wallet grid, even under letterboxed thumbnails.

  2. Tier is BOUGHT, not EARNED — it must never look like rarity. Every tier
     gets exactly one fixed, deterministic look (config.json `tiers`), the
     same way a real membership programme colour-codes its cards. The only
     axis that earns ornament is CONTINUOUS MEMBERSHIP TIME (`member_since`
     -> now, unbroken): the longer an unbroken subscription is held, the
     deeper the engraved patina — independent of tier, so a Free member who
     joined at genesis reaches the same patina as a long-held Enterprise
     member. See card_traits() / patina_band_for().

Reuses primitives from ../position-cards/render.py (_mix, contrast, _lum,
_small_caps, _guilloche, DISPLAY, MONO) rather than re-deriving them — same
brand, same hand, different form.

  python3 nft/membership/render.py --gallery       # contact sheet -> preview/
  python3 nft/membership/render.py --tier Premium --token-id 42 --days 400
"""

import argparse
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
    _guilloche,
    _lum,
    _mix,
    _small_caps,
    contrast,
    esc,
)

TIERS = ("Free", "Pro", "Premium", "Enterprise")

W, H = 1000, 640
M = 36
R = 26  # card corner radius


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
    """Nudge `fg` toward `ink` (the plate's own guaranteed-high-contrast ink
    colour) until it clears `floor` against `bg`. Used only for colour used AS
    TEXT — decorative strokes (seal rings, tenure ticks, border marks) are not
    required to clear it, matching position-cards' own precedent of exempting
    line art from the text contrast floor."""
    if contrast(fg, bg) >= floor:
        return fg
    for i in range(1, 21):
        candidate = _mix(fg, ink, i / 20)
        if contrast(candidate, bg) >= floor:
            return candidate
    return ink


def card_traits(cfg: dict, tier, expires_at, member_since: datetime, now: datetime | None = None):
    """The structural/legibility facts a card resolves to, split out so the
    quality harness can check every state without re-parsing SVG (same shape
    as position-cards/render.py::card_traits)."""
    now = now or datetime.now(timezone.utc)
    t = tier_name(tier)
    tcfg = cfg["tiers"][t]
    d = days_held(member_since, now)
    band = patina_band_for(cfg, d)
    lapsed = is_lapsed(t, expires_at, now)
    years = d // 365

    b = cfg["brand"]
    dark = tcfg["dark_plate"]
    plate = b["dark"] if dark else b["bg"]
    ink = b["bg"] if dark else b["text"]
    quiet = _mix(ink, plate, 0.42)
    accent = b[tcfg["accent"]]
    if lapsed:
        accent = _mix(accent, quiet, 0.6)  # desaturated toward the plate — inactive, not vivid
    # text_accent: the SAME tier colour, nudged just enough to clear the text
    # floor. Brand pink measures 2.50:1 on the cream ground on its own (this
    # is the exact reason position-cards/render.py never puts raw accent
    # under body text either) — decorative strokes keep the pure accent,
    # anything that is actually TEXT reads text_accent instead.
    text_accent = _text_safe(accent, ink, plate, 4.4)

    return {
        "tier": t,
        "lapsed": lapsed,
        "days_held": d,
        "years_held": years,
        "patina": band["name"],
        "dark_plate": dark,
        "plate": plate,
        "ink": ink,
        "quiet": quiet,
        "accent": accent,
        "text_accent": text_accent,
        "tier_contrast": round(contrast(ink, plate), 2),
        "accent_contrast": round(contrast(text_accent, plate), 2),
    }


def _seal_engraving(cx, cy, r, passes, seed_bias=0):
    """A restrained security-print roundel, not a collectible rosette: fewer
    arms, tighter opacity, sized to survive a 5x thumbnail downscale without
    ever reading as loud. `passes` (0-3) is patina-driven, never tier-driven."""
    out = []
    for i in range(passes):
        rr = r * (0.62 + 0.13 * i)
        petals = 9 + i * 2
        path = _guilloche(cx, cy, rr, petals, 0.16 + 0.05 * i, points=160)
        out.append(f'<path d="{path}"/>')
    return "".join(out)


def _border_engraving(x0, y0, x1, y1, density, seed):
    """A thin running security pattern along the inner edge — what a passport
    or a real membership card carries — rather than a full-bleed collectible
    field. `density` in (0, 1, 2) controls how much of the border it covers:
    0 = none, 1 = the two long edges only, 2 = the full ring."""
    if density <= 0:
        return ""
    out = []
    step = 26
    edges = [(x0, y0, x1, y0), (x0, y1, x1, y1)]
    if density >= 2:
        edges += [(x0, y0, x0, y1), (x1, y0, x1, y1)]
    for ex0, ey0, ex1, ey1 in edges:
        length = max(abs(ex1 - ex0), abs(ey1 - ey0))
        n = max(1, int(length / step))
        for i in range(n + 1):
            t = i / n
            x = ex0 + (ex1 - ex0) * t
            y = ey0 + (ey1 - ey0) * t
            horiz = ey0 == ey1
            r = 6 if (i + seed) % 2 == 0 else 4
            if horiz:
                out.append(f'<line x1="{x:.1f}" y1="{y - r:.1f}" x2="{x:.1f}" y2="{y + r:.1f}"/>')
            else:
                out.append(f'<line x1="{x - r:.1f}" y1="{y:.1f}" x2="{x + r:.1f}" y2="{y:.1f}"/>')
    return "".join(out)


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
    tcfg = cfg["tiers"][t]
    band = patina_band_for(cfg, tr["days_held"])
    band_i = cfg["patina"]["bands"].index(band)  # 0 = richest .. 3 = New
    passes = 3 - band_i  # New=0, Established=1, Long-held=2, Founding=3
    border_density = 0 if passes == 0 else (1 if passes == 1 else 2)

    plate, ink, quiet, accent = tr["plate"], tr["ink"], tr["quiet"], tr["accent"]
    text_accent = tr["text_accent"]
    plate2 = _mix(plate, accent, 0.05 if not tr["dark_plate"] else 0.08)
    rim = _mix(ink, plate, 0.55)

    x0, y0, x1, y1 = M, M, W - M, H - M
    ix0, iy0, ix1, iy1 = x0 + 26, y0 + 26, x1 - 26, y1 - 26
    scx, scy, sr = x1 - 148, (y0 + y1) / 2 + 6, 92

    seed = (token_id * 2654435761 + hash(t)) & 0xFFFFFFFF

    p = [
        "<defs>",
        f'<clipPath id="cardCut"><rect x="{x0}" y="{y0}" width="{x1 - x0}" '
        f'height="{y1 - y0}" rx="{R}"/></clipPath>',
        f'<linearGradient id="plate" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{plate}"/>'
        f'<stop offset="1" stop-color="{plate2}"/></linearGradient>',
        f'<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0.3">'
        f'<stop offset="0" stop-color="#ffffff" stop-opacity="0"/>'
        f'<stop offset="0.46" stop-color="#ffffff" '
        f'stop-opacity="{0.05 + 0.025 * passes}"/>'
        f'<stop offset="0.54" stop-color="#ffffff" stop-opacity="0"/></linearGradient>',
        f'<radialGradient id="sealGlow" cx="0.5" cy="0.5" r="0.5">'
        f'<stop offset="0" stop-color="{accent}" stop-opacity="0.16"/>'
        f'<stop offset="1" stop-color="{accent}" stop-opacity="0"/></radialGradient>',
        "</defs>",
    ]

    # ── the card body ────────────────────────────────────────────────────────
    # A soft lift shadow — this is a thing you carry, not a plate laid flat —
    # drawn as two offset, low-opacity rounded rects rather than a blur filter
    # (cairosvg/marketplace renderers vary in filter support; a stacked-rect
    # shadow is guaranteed to rasterize identically everywhere).
    p.append(
        f'<rect x="{x0 + 6}" y="{y0 + 10}" width="{x1 - x0}" height="{y1 - y0}" rx="{R}" '
        f'fill="#000000" opacity="0.05"/>'
        f'<rect x="{x0 + 3}" y="{y0 + 5}" width="{x1 - x0}" height="{y1 - y0}" rx="{R}" '
        f'fill="#000000" opacity="0.05"/>'
    )
    p.append(
        f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="{R}" '
        f'fill="url(#plate)"/>'
    )

    # ── patina: the running security border, richness driven by hold time ──
    if border_density:
        p.append(
            f'<g clip-path="url(#cardCut)" stroke="{rim}" stroke-width="1.3" '
            f'stroke-opacity="{0.30 + 0.08 * passes}">'
            f"{_border_engraving(ix0, iy0, ix1, iy1, border_density, seed)}</g>"
        )
    p.append(f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="{R}" ' f'fill="url(#sheen)"/>')
    p.append(
        f'<rect x="{x0 + 1.5}" y="{y0 + 1.5}" width="{x1 - x0 - 3}" height="{y1 - y0 - 3}" '
        f'rx="{R - 1.5}" fill="none" stroke="{rim}" stroke-opacity="0.55" stroke-width="2"/>'
    )

    # ── header ───────────────────────────────────────────────────────────────
    p.append(_small_caps("Suwappu", ix0, y0 + 58, 17, text_accent, 6.5, "bold"))
    p.append(_small_caps("Membership", ix0, y0 + 80, 11.5, quiet, 4.0))
    p.append(
        f'<text x="{ix1}" y="{y0 + 58}" font-family="{MONO}" font-size="13" fill="{quiet}" '
        f'text-anchor="end" letter-spacing="1">4663 · {token_id:06d}</text>'
    )
    p.append(
        _small_caps(
            "soulbound · non-transferable", ix1, y0 + 80, 10.5, quiet, 2.6, anchor="end"
        )
    )
    p.append(f'<line x1="{ix0}" y1="{y0 + 98}" x2="{ix1}" y2="{y0 + 98}" ' f'stroke="{rim}" stroke-opacity="0.4" stroke-width="1.1"/>')

    # ── tier, stated plainly (no size/ornament scaling with tier) ──────────
    tier_y = y0 + 208
    p.append(
        f'<text x="{ix0}" y="{tier_y}" font-family="{DISPLAY}" font-size="66" font-weight="700" '
        f'fill="{ink}" letter-spacing="-1.5" opacity="{0.55 if lapsed else 1}">{esc(t.upper())}</text>'
    )
    if lapsed:
        p.append(
            f'<text x="{ix0}" y="{tier_y}" font-family="{DISPLAY}" font-size="66" '
            f'font-weight="700" fill="none" stroke="{quiet}" stroke-width="1.4" '
            f'letter-spacing="-1.5">{esc(t.upper())}</text>'
        )
    p.append(
        _small_caps(
            "lapsed — renew to restore" if lapsed else tcfg["tagline"],
            ix0,
            tier_y + 30,
            13,
            text_accent if not lapsed else _mix(quiet, "#a4243b", 0.5),
            3.0,
        )
    )

    # ── seal: the patina lives here, not on the tier ────────────────────────
    p.append(f'<circle cx="{scx}" cy="{scy}" r="{sr + 44}" fill="url(#sealGlow)"/>')
    p.append(
        f'<circle cx="{scx}" cy="{scy}" r="{sr}" fill="{_mix(plate, ink, 0.05)}" '
        f'fill-opacity="0.5"/>'
    )
    eng = _seal_engraving(scx, scy, sr, passes)
    if eng:
        p.append(
            f'<g stroke="{accent}" fill="none" stroke-width="1.7" opacity="0.55">{eng}</g>'
        )
    p.append(
        f'<circle cx="{scx}" cy="{scy}" r="{sr}" fill="none" stroke="{accent}" '
        f'stroke-width="2.6" stroke-opacity="0.85"/>'
        f'<circle cx="{scx}" cy="{scy}" r="{sr - 12}" fill="none" stroke="{accent}" '
        f'stroke-width="1" stroke-opacity="0.35"/>'
    )
    # Two letters, not one: Pro and Premium both start with P, so a single
    # initial made the two paid tiers indistinguishable at the seal.
    mono = {"Free": "FR", "Pro": "PR", "Premium": "PM", "Enterprise": "EN"}.get(t, t[:2].upper())
    p.append(
        f'<text x="{scx}" y="{scy + 13}" font-family="{DISPLAY}" font-size="36" '
        f'font-weight="bold" fill="{ink}" text-anchor="middle" '
        f'letter-spacing="0.5">{esc(mono)}</text>'
    )
    # Tenure ring: one tick per whole unbroken year, capped visually at 12 so a
    # very old member reads as "full ring + years label" instead of an
    # unreadable tick soup. This is the one piece of ornament that is a direct,
    # legible function of TIME — nothing here depends on tier.
    if tr["years_held"] > 0:
        import math

        shown = min(tr["years_held"], 12)
        for i in range(shown):
            a = -math.pi / 2 + 2 * math.pi * i / 12
            r0, r1 = sr + 14, sr + 24
            p.append(
                f'<line x1="{scx + r0 * math.cos(a):.1f}" y1="{scy + r0 * math.sin(a):.1f}" '
                f'x2="{scx + r1 * math.cos(a):.1f}" y2="{scy + r1 * math.sin(a):.1f}" '
                f'stroke="{accent}" stroke-width="2.4" stroke-opacity="0.7"/>'
            )
        p.append(
            _small_caps(
                f"{tr['years_held']}Y HELD",
                scx,
                scy + sr + 42,
                10.5,
                quiet,
                2.4,
                anchor="middle",
            )
        )

    # ── footer: member number, since, valid-thru, status ────────────────────
    fy = y1 - 66
    p.append(f'<line x1="{ix0}" y1="{fy - 26}" x2="{ix1}" y2="{fy - 26}" ' f'stroke="{rim}" stroke-opacity="0.35" stroke-width="1"/>')
    since_s = member_since.strftime("%d %b %Y").upper()
    if t == "Free":
        thru_s, thru_lab = "NO EXPIRY", "valid thru"
    elif lapsed:
        thru_s = datetime.fromtimestamp(expires_at, tz=timezone.utc).strftime("%d %b %Y").upper()
        thru_lab = "expired"
    else:
        thru_s = datetime.fromtimestamp(expires_at, tz=timezone.utc).strftime("%d %b %Y").upper()
        thru_lab = "valid thru"

    cols = [
        ("member since", since_s, ix0, "start"),
        (thru_lab, thru_s, (ix0 + ix1) / 2, "middle"),
    ]
    for lab, val, x, anc in cols:
        p.append(_small_caps(lab, x, fy, 10.5, quiet, 2.6, anchor=anc))
        p.append(
            f'<text x="{x}" y="{fy + 22}" font-family="{MONO}" font-size="16" fill="{ink}" '
            f'text-anchor="{anc}">{esc(val)}</text>'
        )
    status = "LAPSED" if lapsed else "ACTIVE"
    status_col = _mix(quiet, "#a4243b", 0.5) if lapsed else accent
    p.append(_small_caps("status", ix1, fy, 10.5, quiet, 2.6, anchor="end"))
    p.append(
        f'<text x="{ix1}" y="{fy + 22}" font-family="{MONO}" font-size="16" fill="{status_col}" '
        f'text-anchor="end" letter-spacing="1">{esc(status)}</text>'
    )

    # ── compliance rail — outranks every visual idea in this file ───────────
    p.append(
        _small_caps(
            "credential · not equity · not a security · not an investment · "
            "pays nothing · no claim on any issuer",
            ix0,
            y1 - 12,
            9,
            _mix(quiet, plate, 0.3),
            1.8,
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
        f"A soulbound Suwappu {t} membership. This token IS the subscription — "
        f"the bot reads it directly to resolve which tier a wallet holds. "
        f"{status_line} Continuously held for {tr['days_held']} days "
        f"({tr['patina']} patina).\n\n"
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
                price = {"Free": 0, "Pro": 9_990_000, "Premium": 29_990_000, "Enterprise": 99_990_000}[
                    tier
                ]
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
