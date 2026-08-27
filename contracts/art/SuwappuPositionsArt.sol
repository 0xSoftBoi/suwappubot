// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Base64.sol";
import "./SuwappuArt.sol";

/// @notice Everything the engraver needs to know about one card. Assembled by
///         SuwappuPositions at read time — the renderer holds no state of its
///         own and can therefore be swapped, re-deployed, or read directly by
///         anyone who wants to see what a hypothetical card would look like.
struct Card {
    uint256 tokenId;
    string ticker; // read live from the equity ERC-20's own symbol()
    uint8 tickerIndex;
    uint256 entryPrice; // 1e18, stamped at mint
    uint256 spotPrice; // 1e18, 0 == oracle has no fresh price
    int256 returnBps; // signed, 0 when unpriced
    bool priced;
    uint8 gradeIndex; // 0 Underwater .. 5 Moonshot
    uint16 mintRank; // 1-based, across the whole collection
    bool isGold; // Founders' Gold — bought, never rolled
    uint32 mintedAt;
    uint256 maxSupply;
}

interface ISuwappuCardRenderer {
    function tokenURI(Card calldata card) external view returns (string memory);
}

/**
 * @title SuwappuPositionsArt — the engraving press
 *
 * A Suwappu Position is a plate, not a picture. It is struck here, on-chain, at
 * the instant somebody looks at it, from three inputs: what you bought, when you
 * bought it, and what the market says right now.
 *
 * WHAT IS FIXED, AT MINT, FOREVER
 *   The ticker. The entry price. The mint rank. The edition. From those, a seed,
 *   and from the seed the plate's ENGRAVING: how many petals its rosette turns,
 *   how the grain lies, which way the light falls across the metal. Two cards on
 *   the same ticker minted a block apart are different objects and always will be.
 *
 * WHAT IS ALIVE
 *   The rosette's depth of cut tracks the position's return. A card that is up
 *   4x is cut deep and turns hard in the light; a card that is underwater
 *   flattens toward a plain turned circle. The hero numeral, the grade caption
 *   and the metal of the ornament all move with the oracle. Nobody re-renders
 *   anything and nobody re-pins anything. The market moves, and the art moves,
 *   because the art is a function of the market and always was.
 *
 * WHY ON-CHAIN AT ALL
 *   Because the alternative is a URL. A URL is a promise by whoever is paying
 *   the hosting bill, and this collection's entire claim is that the card is
 *   bound to a live price with nothing in between. A renderer behind a domain
 *   would have made that claim false the first time the domain lapsed. There is
 *   no domain. There is a pure function and a chain that has to run it.
 *
 * THEME. Centurion Noir — nft/position-cards/THEME.md. Matte anodised black
 * metal, struck furniture, one diagonal sheen, engraved guilloché, ivory ink.
 * Luxury, adult, quiet. Never a pastel, never a sticker, never a jpeg.
 */
contract SuwappuPositionsArt is ISuwappuCardRenderer {
    using Ink for uint256;

    // ─── Centurion Noir ───────────────────────────────────────────────────────
    uint24 internal constant OBSIDIAN = 0x0a0b0d; // the wall the card hangs on
    uint24 internal constant CHARCOAL = 0x0d0d10; // the matte ground
    uint24 internal constant IVORY = 0xf2ede3; // ink on the dark plate
    uint24 internal constant GOLD = 0xe0bd76; // Founder metal
    uint24 internal constant GRAPHITE = 0x8b8e94; // base metal
    uint24 internal constant PINK = 0xf472b6; // the one saturated element
    uint24 internal constant BLACK = 0x000000;

    string internal constant DISPLAY =
        "Geist,Inter,system-ui,-apple-system,'Liberation Sans',Arial,sans-serif";
    string internal constant MONO =
        "'Geist Mono','SFMono-Regular',Menlo,Consolas,'DejaVu Sans Mono',monospace";

    // ─── Registry ─────────────────────────────────────────────────────────────
    /// @notice Sector of each of the 35 tickers, one nibble per ticker, in the
    ///         same sorted order SuwappuPositions seals into `tickerToken`.
    ///         Packed rather than an array because it is read on every render
    ///         and a 35-slot array would be 35 SLOADs to draw one card.
    bytes internal constant SECTOR_OF = hex"803034441198306324010229659905980790";

    function _sectorColor(uint8 s) internal pure returns (uint24) {
        if (s == 0) return 0x6ea8c9; // Semiconductors    — steel
        if (s == 1) return 0x9a8fc7; // AI Infrastructure — violet steel
        if (s == 2) return 0x5fb3a1; // Software          — verdigris
        if (s == 3) return 0xc98a86; // Internet & Media  — rose bronze
        if (s == 4) return 0xd4b46a; // Crypto & Fintech  — brass
        if (s == 5) return 0x7d9cc9; // Space & Defense   — gunmetal blue
        if (s == 6) return 0xb78ec2; // Quantum           — amethyst
        if (s == 7) return 0xc99a6b; // Energy & Materials— copper
        if (s == 8) return 0x86b894; // Consumer          — patina
        return 0xa8a8ad; //            Index & Commodity  — nickel
    }

    /// @dev `xml` picks the SVG-safe spelling. A bare ampersand is not valid
    ///      XML and would break the whole plate; an escaped one shown inside a
    ///      JSON trait renders literally as "&amp;" on a marketplace. Both
    ///      spellings, one table, so the two can never drift apart.
    function _sectorName(uint8 s, bool xml) internal pure returns (string memory) {
        string memory amp = xml ? "&amp;" : "&";
        if (s == 0) return "Semiconductors";
        if (s == 1) return "AI Infrastructure";
        if (s == 2) return "Software";
        if (s == 3) return string.concat("Internet ", amp, " Media");
        if (s == 4) return string.concat("Crypto ", amp, " Fintech");
        if (s == 5) return string.concat("Space ", amp, " Defense");
        if (s == 6) return "Quantum";
        if (s == 7) return string.concat("Energy ", amp, " Materials");
        if (s == 8) return "Consumer";
        return string.concat("Index ", amp, " Commodity");
    }

    function _gradeName(uint8 g) internal pure returns (string memory) {
        if (g == 0) return "Underwater";
        if (g == 1) return "Flat";
        if (g == 2) return "In Profit";
        if (g == 3) return "Runner";
        if (g == 4) return "Multiple";
        return "Moonshot";
    }

    /// @dev The jade -> champagne ramp. Gains climb toward metal; a loss takes a
    ///      muted oxblood, which is expensive rather than alarming. The minus
    ///      sign and the grade caption already do the semantic work, so the
    ///      colour does not need to shout.
    function _gradeAccent(uint8 g) internal pure returns (uint24) {
        if (g == 0) return 0xb0666c;
        if (g == 1) return 0xa09c93;
        if (g == 2) return 0x5da97f;
        if (g == 3) return 0x59c19a;
        if (g == 4) return 0xc3bf95;
        return 0xd4af6e;
    }

    // ─── The plate ────────────────────────────────────────────────────────────

    /// @notice Every colour one plate uses, derived once and passed down.
    struct Plate {
        uint24 field; // ground, centre
        uint24 field2; // ground, falling off toward the edge
        uint24 rim; // the ornament's ink
        uint24 metal; // furniture: frame, seal, serial
        uint24 body; // body ink
        uint24 quiet; // captions
        uint24 hero; // the numeral, which is the whole card
    }

    /// @notice The engraving itself: fixed at mint except for `depth`, which is
    ///         the market, cut into the metal.
    struct Cut {
        uint8 petals; // 5..14 — how many times the rosette turns
        uint8 rings; // 5..8 concentric passes, engine-turned
        uint16 depth; // 90..330 of 1000 — LIVE, from |return|
        uint16 phase; // milli-degrees of offset between passes
        uint8 grain; // pitch of the brushed-metal hairlines
        uint16 sheen; // where the lamp is standing
    }

    function _sectorIndex(uint8 tickerIndex) internal pure returns (uint8) {
        if (tickerIndex >= 35) return 9;
        uint8 b = uint8(SECTOR_OF[tickerIndex / 2]);
        return tickerIndex % 2 == 0 ? b >> 4 : b & 0x0f;
    }

    /// @dev Founder <= 222, Early <= 888 — 5% and 20% of a 4,444 supply. Earned
    ///      by mint rank, never rolled, never bought.
    function _badge(uint16 rank) internal pure returns (string memory) {
        if (rank != 0 && rank <= 222) return "Founder";
        if (rank != 0 && rank <= 888) return "Early";
        return "Standard";
    }

    function _badgeCaps(uint16 rank) internal pure returns (string memory) {
        if (rank != 0 && rank <= 222) return "FOUNDER";
        if (rank != 0 && rank <= 888) return "EARLY";
        return "STANDARD";
    }

    function _palette(Card memory c, uint8 sector) internal pure returns (Plate memory p) {
        uint24 tint = _sectorColor(sector);
        uint24 accent = _gradeAccent(c.gradeIndex);

        if (c.isGold) {
            // Founders' Gold leaves the sector wall entirely. A tint-only variant
            // read as "warm sector" at thumbnail size and the paid edition has to
            // be a different METAL, not a warmer anodising — so the ground is
            // struck in gold at 24% and sector survives only in the ornament.
            p.field = Hue.mix(CHARCOAL, GOLD, 240);
            p.metal = GOLD;
            p.rim = Hue.mix(GOLD, 0x8a6f3c, 350);
            p.hero = c.priced && c.returnBps < -200
                ? Hue.mix(GOLD, 0x6f6258, 300) // a loss stays in the family, struck darker
                : Hue.mix(GOLD, IVORY, 350);
        } else {
            // Anodising is luminance-normalised, not a flat mix: scaling by the
            // tint's own luminance holds all ten grounds at the same darkness
            // while the HUE still sorts the wall.
            uint256 l = Hue.lum(tint);
            if (l < 50) l = 50;
            uint256 t = (150 * Root.sqrt((340 * 1e6) / l)) / 1000;
            if (t < 100) t = 100;
            if (t > 180) t = 180;
            p.field = Hue.mix(CHARCOAL, tint, t);
            p.metal = c.mintRank != 0 && c.mintRank <= 222
                ? GOLD
                : (c.mintRank != 0 && c.mintRank <= 888 ? 0xaab1b9 : Hue.mix(0x6e7176, tint, 180));
            p.rim = Hue.mix(tint, GRAPHITE, 550);
            // A winner's ornament takes the grade's metal. Warm sector ornament
            // otherwise reads as a loss from across a wall, however green the
            // numeral — the ornament is the largest colour field on the plate.
            if (c.priced && c.returnBps >= 200) p.rim = Hue.mix(p.rim, accent, 350);
            p.hero = Hue.mix(accent, IVORY, c.priced && c.returnBps >= 2500 ? 320 : 450);
            if (c.priced && c.returnBps < -200) p.hero = 0xbfa9a2; // warm ash, not pink
        }
        p.field2 = Hue.mix(p.field, BLACK, 350);
        p.body = IVORY;
        p.quiet = Hue.mix(GRAPHITE, IVORY, 300);
        if (!c.priced) p.hero = p.quiet; // an unpriced card does not get to claim a colour
    }

    /// @notice The plate's permanent character, plus the one thing that is not.
    /// @dev    Seeded from what was stamped at mint and nothing else, so an
    ///         engraving is as immutable as the entry price it was struck with.
    ///         `depth` is the exception and the point: the rosette cuts deeper
    ///         the further the position has run, so the metal itself reports the
    ///         P&L before you have read a single character on the card.
    function _cut(Card memory c) internal pure returns (Cut memory k) {
        uint256 s = uint256(
            keccak256(abi.encodePacked(c.tokenId, c.ticker, c.entryPrice, c.mintRank))
        );
        k.petals = uint8(5 + (s % 10));
        k.rings = uint8(5 + ((s >> 8) % 4)); // engine turning is many passes, not three
        k.phase = uint16((s >> 16) % 30_000);
        k.grain = uint8(44 + ((s >> 32) % 27)); // pitch of the brush, in tenths of a unit
        // The lamp always stands off to one side. Constrained to 110-160 degrees
        // because the sheen runs PERPENDICULAR to its own gradient vector, and an
        // unconstrained seed put a vertical stripe down a third of the collection.
        k.sheen = uint16(110_000 + ((s >> 48) % 50_000));

        uint256 mag = c.priced
            ? uint256(c.returnBps >= 0 ? c.returnBps : -c.returnBps)
            : uint256(0);
        if (mag > 50_000) mag = 50_000; // a Moonshot is the deepest cut there is
        // sqrt so the first double is felt as much as the tenth: 0 -> 90,
        // +25% -> ~160, +100% -> ~230, +500% -> 330. The ceiling is 330 and not
        // higher because past about a third the petals stop being a turned rose
        // and become spikes — the figure loses its metal and reads as a graph.
        k.depth = uint16(90 + (240 * Root.sqrt((mag * 1e6) / 50_000)) / 1000);
    }

    // ─── The press ────────────────────────────────────────────────────────────
    // 600 x 840 at ten units to the unit, so every coordinate below is an
    // integer and no decimal is ever formatted inside a loop.

    int256 internal constant W = 6000;
    int256 internal constant H = 8400;
    int256 internal constant CX = 3000; // the medallion's centre
    int256 internal constant CY = 4980;
    int256 internal constant R0 = 1980; // outermost pass of the rosette

    function _defs(Plate memory p, Cut memory k) internal pure returns (string memory) {
        return string.concat(
            "<defs>",
            // The ground: light gathers above the middle, as it does on a plate
            // lying under a lamp, and falls away into the corners.
            "<radialGradient id='g' cx='50%' cy='34%' r='86%'>",
            "<stop offset='0' stop-color='", Hue.str(Hue.mix(p.field, IVORY, 55)), "'/>",
            "<stop offset='0.62' stop-color='", Hue.str(p.field), "'/>",
            "<stop offset='1' stop-color='", Hue.str(p.field2), "'/>",
            "</radialGradient>",
            // Furniture metal has to TURN like metal: three stops, never a flat hex.
            "<linearGradient id='m' x1='0' y1='0' x2='1' y2='1'>",
            "<stop offset='0' stop-color='", Hue.str(Hue.mix(p.metal, IVORY, 420)), "'/>",
            "<stop offset='0.48' stop-color='", Hue.str(p.metal), "'/>",
            "<stop offset='1' stop-color='", Hue.str(Hue.mix(p.metal, BLACK, 460)), "'/>",
            "</linearGradient>",
            _sheenDef(k),
            _grainDef(k),
            _figure(k),
            "<radialGradient id='v' cx='50%' cy='50%' r='75%'>",
            "<stop offset='0.55' stop-color='#000' stop-opacity='0'/>",
            "<stop offset='1' stop-color='#000' stop-opacity='0.75'/>",
            "</radialGradient>",
            "<clipPath id='c'><rect x='240' y='240' width='5520' height='7920' rx='300'/></clipPath>",
            "</defs>"
        );
    }

    /// @dev One diagonal sheen, at the angle this plate was struck under. It is
    ///      the only thing on the card that suggests a light source, and it is
    ///      seeded, so no two plates are lit from quite the same place.
    function _sheenDef(Cut memory k) internal pure returns (string memory) {
        int256 a = int256(uint256(k.sheen));
        int256 dx = Trig.cos(a) / 1000; // -1000..1000
        int256 dy = Trig.sin(a) / 1000;
        return string.concat(
            "<linearGradient id='s' x1='",
            Ink.intStr(50 - dx / 20),
            "%' y1='",
            Ink.intStr(50 - dy / 20),
            "%' x2='",
            Ink.intStr(50 + dx / 20),
            "%' y2='",
            Ink.intStr(50 + dy / 20),
            "%' gradientUnits='objectBoundingBox'>",
            "<stop offset='0' stop-color='#fff' stop-opacity='0'/>",
            "<stop offset='0.3' stop-color='#fff' stop-opacity='0.028'/>",
            "<stop offset='0.5' stop-color='#fff' stop-opacity='0.062'/>",
            "<stop offset='0.7' stop-color='#fff' stop-opacity='0.022'/>",
            "<stop offset='1' stop-color='#fff' stop-opacity='0'/>",
            "</linearGradient>"
        );
    }

    /// @dev Brushed metal. A tiled two-line pattern, not forty <line> elements:
    ///      a real brushed finish wants a hairline every fraction of a unit, and
    ///      drawing those one at a time made the grain both coarse enough to read
    ///      as corduroy and expensive enough to matter. The pair is one light
    ///      scratch and one dark one, which is what a dragged surface actually
    ///      is — the pitch between them is seeded, so no two plates were brushed
    ///      with quite the same wheel.
    function _grainDef(Cut memory k) internal pure returns (string memory) {
        string memory pitch = Ink.uintStr(uint256(k.grain));
        return string.concat(
            "<pattern id='b' width='40' height='",
            pitch,
            "' patternUnits='userSpaceOnUse'>",
            "<line x1='0' x2='40' y1='2' y2='2' stroke='#f2ede3' stroke-opacity='0.055' stroke-width='4'/>",
            "<line x1='0' x2='40' y1='",
            Ink.uintStr(uint256(k.grain) / 2 + 1),
            "' y2='",
            Ink.uintStr(uint256(k.grain) / 2 + 1),
            "' stroke='#000' stroke-opacity='0.11' stroke-width='6'/>",
            "</pattern>",
            // The reserve panel: the band the numeral sits in is sunk a little,
            // so the figure has a ground of its own and does not have to fight
            // the engraving. An ellipse rather than a disc — a disc large enough
            // to clear a five-figure return blanked out the whole medallion.
            "<radialGradient id='d' cx='50%' cy='50%' r='50%'>",
            "<stop offset='0' stop-color='#000' stop-opacity='0.4'/>",
            "<stop offset='0.4' stop-color='#000' stop-opacity='0.28'/>",
            "<stop offset='0.78' stop-color='#000' stop-opacity='0.1'/>",
            "<stop offset='1' stop-color='#000' stop-opacity='0'/>",
            "</radialGradient>"
        );
    }

    /// @dev The rosette. r(t) = 1 - d + d*cos(petals*t), sampled nine times per
    ///      petal and struck ONCE, at unit radius, about the origin.
    ///
    ///      Every concentric pass after that is the same cut, re-chucked: scaled
    ///      down a little and rotated a little, which is precisely what a rose
    ///      engine does — one cutter, one figure, the chuck moved between passes.
    ///      Emitting nine independent paths was the first version; it produced a
    ///      byte-identical picture for ~4x the SVG and several million gas of
    ///      string copying, because it re-derived from trigonometry a figure the
    ///      renderer already had. The lathe was right and the first draft was not.
    ///
    ///      `d` is the depth of cut and `d` is the market. Everything else about
    ///      this figure was decided at mint and can never change again.
    function _figure(Cut memory k) internal pure returns (string memory) {
        uint256 petals = uint256(k.petals);
        uint256 n = petals * 9;
        int256 d = int256(uint256(k.depth));
        string memory path = "";
        for (uint256 i = 0; i < n; i++) {
            int256 t = (Trig.TURN * int256(i)) / int256(n);
            int256 r = 1000 - d + (d * Trig.cos(int256(petals) * t)) / Trig.ONE;
            path = string.concat(
                path,
                i == 0 ? "M" : "L",
                Ink.intStr((r * Trig.cos(t)) / Trig.ONE),
                " ",
                Ink.intStr((r * Trig.sin(t)) / Trig.ONE),
                " "
            );
        }
        return string.concat("<path id='r' d='", path, "Z' fill='none'/>");
    }

    /// @dev One pass of the cutter: the figure, re-chucked and re-inked.
    /// @param permille scale of this pass against the unit figure
    /// @param spin     rotation in whole degrees
    function _pass(
        Plate memory p,
        uint256 permille,
        int256 spin,
        string memory width,
        string memory op
    ) internal pure returns (string memory) {
        return string.concat(
            "<use href='#r' xlink:href='#r' transform='translate(3000,",
            Ink.intStr(CY),
            ") scale(",
            Ink.dec3(permille),
            ") rotate(",
            Ink.intStr(spin),
            ")' stroke='",
            Hue.str(p.rim),
            "' stroke-width='",
            width,
            "' stroke-opacity='",
            op,
            "' vector-effect='non-scaling-stroke'/>"
        );
    }

    function _rosette(Plate memory p, Cut memory k) internal pure returns (string memory out) {
        // Pass 0 is oversized and runs off the plate on every side. Without it
        // the medallion read as a badge glued to the lower half and the ticker
        // sat on bare metal — two cards in one frame. Clipped by the plate, it
        // turns the engraving into the FIELD the whole card is struck into.
        out = _pass(p, 2860, 0, "5", "0.14");
        uint256 rings = uint256(k.rings);
        int256 spin = int256(uint256(k.phase)) / 1000 / int256(uint256(k.petals));
        for (uint256 i = 0; i < rings; i++) {
            out = string.concat(
                out,
                _pass(
                    p,
                    uint256(R0) - i * 112,
                    spin * int256(i),
                    i == 0 ? "11" : "7",
                    // The outermost struck pass carries the figure; each pass
                    // inside it is lighter, so the medallion has a depth of
                    // field instead of reading as a stack of identical outlines.
                    i == 0 ? "0.52" : (i < 3 ? "0.38" : "0.26")
                )
            );
        }
        // Two struck rules outside the figure — the turned border that stops the
        // engraving from floating in the middle of the plate — then the reserve.
        out = string.concat(
            out,
            _ring(p, R0 + 130, "6", "0.4"),
            _ring(p, R0 + 172, "3", "0.22"),
            "<ellipse cx='3000' cy='5040' rx='2120' ry='800' fill='url(#d)'/>"
        );
    }

    function _ring(Plate memory p, int256 r, string memory w, string memory op)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            "<circle cx='3000' cy='",
            Ink.intStr(CY),
            "' r='",
            Ink.intStr(r),
            "' fill='none' stroke='",
            Hue.str(p.rim),
            "' stroke-width='",
            w,
            "' stroke-opacity='",
            op,
            "'/>"
        );
    }

    /// @dev Small caps with wide tracking — the serial-plate voice. Everything
    ///      that is not the ticker or the numeral is set this way.
    function _caps(
        int256 x,
        int256 y,
        uint256 size,
        uint24 fill,
        string memory anchor,
        string memory txt
    ) internal pure returns (string memory) {
        return _set(x, y, size, size / 3, fill, anchor, txt);
    }

    /// @dev Figures are set tight. Serial-plate tracking on a dollar amount
    ///      spaces the digits so far apart the number stops being one number.
    function _fig(
        int256 x,
        int256 y,
        uint256 size,
        uint24 fill,
        string memory anchor,
        string memory txt
    ) internal pure returns (string memory) {
        return _set(x, y, size, size / 14, fill, anchor, txt);
    }

    function _set(
        int256 x,
        int256 y,
        uint256 size,
        uint256 track,
        uint24 fill,
        string memory anchor,
        string memory txt
    ) internal pure returns (string memory) {
        return string.concat(
            "<text x='",
            Ink.intStr(x),
            "' y='",
            Ink.intStr(y),
            "' font-family=\"",
            MONO,
            "\" font-size='",
            Ink.uintStr(size),
            "' letter-spacing='",
            Ink.uintStr(track),
            "' text-anchor='",
            anchor,
            "' fill='",
            Hue.str(fill),
            "'>",
            txt,
            "</text>"
        );
    }

    /// @dev The one piece of type that is not printed but STRUCK: a shadow
    ///      below-right, a highlight above-left, the face between them. Three
    ///      draws of the same four letters is what turns ink into relief.
    function _emboss(Plate memory p, string memory ticker) internal pure returns (string memory) {
        string memory open = string.concat(
            "<text x='3000' y='2500' font-family=\"",
            DISPLAY,
            "\" font-size='1120' font-weight='600' letter-spacing='24' text-anchor='middle' fill='"
        );
        return string.concat(
            "<g>",
            open, Hue.str(Hue.mix(p.field2, BLACK, 420)), "' transform='translate(8,9)' fill-opacity='0.62'>", ticker, "</text>",
            open, Hue.str(Hue.mix(p.field, IVORY, 340)), "' transform='translate(-6,-7)' fill-opacity='0.38'>", ticker, "</text>",
            open, Hue.str(p.body), "'>", ticker, "</text>",
            "</g>"
        );
    }

    function _type(Card memory c, Plate memory p, uint8 sector)
        internal
        pure
        returns (string memory)
    {
        string memory ticker = Ink.esc(c.ticker, 6);
        return string.concat(
            // Header: what family this is, and which plate of the run.
            _caps(620, 1230, 150, p.quiet, "start", _sectorName(sector, true)),
            _fig(
                5380,
                1230,
                150,
                p.metal,
                "end",
                string.concat("No ", Ink.serial(c.tokenId), " / ", Ink.uintStr(c.maxSupply))
            ),
            "<line x1='620' x2='5380' y1='1400' y2='1400' stroke='",
            Hue.str(p.quiet),
            "' stroke-width='7' stroke-opacity='0.38'/>",
            _emboss(p, ticker),
            // The single saturated element on the whole plate: one small struck
            // lozenge on the centre line. The brand mark is meant to be found,
            // not announced — a wordmark on a Centurion plate would be a sticker.
            "<rect x='2952' y='1352' width='96' height='96' rx='14' transform='rotate(45 3000 1400)' fill='",
            Hue.str(PINK),
            "'/>",
            _hero(c, p),
            _footer(c, p)
        );
    }

    /// @dev The numeral is the card. It is set on the medallion, in the metal of
    ///      its own grade, and it is the only thing here that was not decided
    ///      when the token was minted.
    function _hero(Card memory c, Plate memory p) internal pure returns (string memory) {
        string memory n = c.priced ? Ink.pct(c.returnBps) : "--";
        return string.concat(
            "<text x='3000' y='5170' font-family=\"",
            DISPLAY,
            "\" font-size='",
            Ink.uintStr(_heroSize(bytes(n).length)),
            "' font-weight='600' letter-spacing='-16' text-anchor='middle' fill='",
            Hue.str(p.hero),
            "'>",
            n,
            "</text>",
            _caps(
                3000,
                5660,
                190,
                c.priced ? Hue.mix(p.hero, p.quiet, 400) : p.quiet,
                "middle",
                c.priced ? _gradeName(c.gradeIndex) : "Unpriced"
            )
        );
    }

    /// @dev The numeral is set to the plate, not to a fixed size. A position is
    ///      allowed to be up 400x, and "+40000.00%" at the size "+50.00%" wants
    ///      would have run clean off the metal — the one failure mode a live
    ///      card has that a frozen one does not. 4400 units of clear width,
    ///      grotesque figures averaging ~0.58em, capped at the display size.
    function _heroSize(uint256 len) internal pure returns (uint256) {
        uint256 fit = 7586 / (len == 0 ? 1 : len);
        return fit > 840 ? 840 : fit;
    }

    function _footer(Card memory c, Plate memory p) internal pure returns (string memory) {
        return string.concat(
            "<line x1='620' x2='5380' y1='7060' y2='7060' stroke='",
            Hue.str(p.quiet),
            "' stroke-width='7' stroke-opacity='0.38'/>",
            _caps(620, 7320, 130, p.quiet, "start", "ENTRY"),
            _fig(620, 7620, 260, p.body, "start", c.entryPrice == 0 ? "--" : Ink.money(c.entryPrice)),
            _caps(5380, 7320, 130, p.quiet, "end", "MARK"),
            _fig(5380, 7620, 260, p.body, "end", c.spotPrice == 0 ? "--" : Ink.money(c.spotPrice)),
            _caps(
                3000,
                7960,
                140,
                p.metal,
                "middle",
                string.concat(
                    c.isGold ? "FOUNDERS GOLD" : "SUWAPPU POSITIONS",
                    unicode"  ·  ",
                    _badgeCaps(c.mintRank)
                )
            )
        );
    }

    /// @notice The plate, struck.
    function svg(Card memory c) public pure returns (string memory) {
        uint8 sector = _sectorIndex(c.tickerIndex);
        Plate memory p = _palette(c, sector);
        Cut memory k = _cut(c);
        return string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'"
            " viewBox='0 0 6000 8400' width='600' height='840'>",
            _defs(p, k),
            "<rect width='6000' height='8400' fill='",
            Hue.str(OBSIDIAN),
            "'/><rect width='6000' height='8400' fill='url(#v)'/>",
            "<rect x='240' y='240' width='5520' height='7920' rx='300' fill='url(#g)'/>",
            "<g clip-path='url(#c)'>",
            "<rect x='240' y='240' width='5520' height='7920' fill='url(#b)'/>",
            _rosette(p, k),
            "<rect x='240' y='240' width='5520' height='7920' fill='url(#s)'/>",
            "</g>",
            // Furniture last, so nothing clipped can climb over the frame.
            "<rect x='240' y='240' width='5520' height='7920' rx='300' fill='none' stroke='url(#m)' stroke-width='10'/>",
            "<rect x='380' y='380' width='5240' height='7640' rx='220' fill='none' stroke='",
            Hue.str(p.rim),
            "' stroke-width='3' stroke-opacity='0.45'/>",
            _type(c, p, sector),
            "</svg>"
        );
    }

    /// @notice ERC-721 metadata for one card, complete, with nothing hosted.
    function tokenURI(Card calldata c) external pure returns (string memory) {
        uint8 sector = _sectorIndex(c.tickerIndex);
        Cut memory k = _cut(c);
        string memory ticker = Ink.esc(c.ticker, 6);
        string memory json = string.concat(
            '{"name":"',
            ticker,
            " No ",
            Ink.serial(c.tokenId),
            '","description":"',
            _description(),
            '","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg(c))),
            '","attributes":[',
            _attributes(c, sector, k, ticker),
            "]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _description() internal pure returns (string memory) {
        return
            "A Suwappu Position is drawn on-chain, from nothing, every time it is "
            "looked at. Ticker, entry price and mint rank were struck into the plate "
            "at mint and cannot change. The depth of the rosette is the position's "
            "live return, read from the oracle at the moment you asked - so the "
            "engraving moves with the market instead of sitting frozen in a jpeg. "
            "No IPFS, no render server, no base URI: only a pure function and a "
            "chain obliged to run it. Not a financial instrument - a Position pays "
            "nothing, is redeemable for nothing, and confers no economic exposure "
            "to any issuer or referenced token.";
    }

    function _attributes(Card memory c, uint8 sector, Cut memory k, string memory ticker)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            _attr("Ticker", ticker),
            ",",
            _attr("Sector", _sectorName(sector, false)),
            ",",
            _attr("Grade", c.priced ? _gradeName(c.gradeIndex) : "Unpriced"),
            ",",
            _attr("Edition", c.isGold ? "Founders Gold" : "Standard"),
            ",",
            _attr("Badge", _badge(c.mintRank)),
            ",",
            _attr("Engraving", string.concat(Ink.uintStr(k.petals), "-petal rosette")),
            ",",
            _attr("Passes", Ink.uintStr(k.rings)),
            ",",
            _attr("Entry", c.entryPrice == 0 ? "Unpriced" : Ink.money(c.entryPrice)),
            ",",
            '{"trait_type":"Return","value":',
            Ink.intStr(c.priced ? c.returnBps / 100 : int256(0)),
            "}",
            ",",
            '{"trait_type":"Mint Rank","value":',
            Ink.uintStr(c.mintRank),
            "}"
        );
    }

    function _attr(string memory t, string memory v) internal pure returns (string memory) {
        return string.concat('{"trait_type":"', t, '","value":"', v, '"}');
    }
}
