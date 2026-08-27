// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Base64.sol";
import "./SuwappuArt.sol";

/// @notice One membership, as the engraver sees it.
struct Pass {
    uint256 tokenId;
    uint8 tier; // 0 Free, 1 Pro, 2 Premium, 3 Enterprise
    uint64 expiresAt; // 0 == no expiry (Free never lapses)
    uint64 issuedAt; // when this token was first minted
    uint64 nowTs; // block.timestamp at the moment of the read
}

interface ISuwappuPassRenderer {
    function tokenURI(Pass calldata pass) external view returns (string memory);
}

/**
 * @title SuwappuMembershipArt — the member's plate
 *
 * A Position is portrait, because it is a holding. A Membership is landscape,
 * because it is a CARD — the thing in the wallet, in the Centurion aspect, and
 * the two collections should never be mistaken for one another at thumbnail size.
 *
 * WHAT IS ALIVE HERE
 *   The bezel. Twenty-four struck ticks around the seal, lit for as much of the
 *   coming year as the member has actually paid for, and going dark one at a
 *   time as the term runs down. A member can see their standing from across a
 *   room without reading a date, which is the entire job of a membership card.
 *
 *   And the metal wears. The seal's engraving is cut deep on a fresh long term
 *   and flattens as the term expires; on a lapsed plate the figure is nearly
 *   smooth, the metal goes to graphite, and the card says LAPSED. Nothing is
 *   burned, nothing is revoked, no server decides — the plate simply stops
 *   looking like a membership, on-chain, the second the term ends.
 *
 * Same instruments, same theme, same rose engine as the Positions plate. A house
 * has one hand.
 */
contract SuwappuMembershipArt is ISuwappuPassRenderer {
    uint24 internal constant OBSIDIAN = 0x0a0b0d;
    uint24 internal constant CHARCOAL = 0x0d0d10;
    uint24 internal constant IVORY = 0xf2ede3;
    uint24 internal constant PINK = 0xf472b6;
    uint24 internal constant BLACK = 0x000000;

    string internal constant DISPLAY =
        "Geist,Inter,system-ui,-apple-system,'Liberation Sans',Arial,sans-serif";
    string internal constant MONO =
        "'Geist Mono','SFMono-Regular',Menlo,Consolas,'DejaVu Sans Mono',monospace";

    int256 internal constant CX = 6480; // the seal sits off-centre, right
    int256 internal constant CY = 2560;

    struct Plate {
        uint24 field;
        uint24 field2;
        uint24 rim;
        uint24 metal;
        uint24 body;
        uint24 quiet;
    }

    function _tierName(uint8 t) internal pure returns (string memory) {
        if (t == 1) return "PRO";
        if (t == 2) return "PREMIUM";
        if (t == 3) return "ENTERPRISE";
        return "MEMBER";
    }

    /// @dev The tiers are three steps of one metal, not three colours. Enterprise
    ///      is the brightest and Free is bare graphite; a member should be able to
    ///      rank two plates side by side without reading either.
    function _tierMetal(uint8 t) internal pure returns (uint24) {
        if (t == 1) return 0xaab1b9; // platinum
        if (t == 2) return 0xe0bd76; // champagne gold
        if (t == 3) return 0xf0e3c8; // white gold
        return 0x8b8e94; // graphite
    }

    function _palette(Pass memory s, bool live) internal pure returns (Plate memory p) {
        uint24 metal = live ? _tierMetal(s.tier) : 0x6e7176;
        // The tint anodised into the ground is the tier's own metal, and it is
        // anodised HARDER the higher the tier. A constant mix put three plates
        // within a few RGB units of each other and the ladder stopped being
        // visible at all — which for a membership card is the only job it has.
        uint256 t = live ? [uint256(50), 105, 145, 190][s.tier] : 45;
        p.field = Hue.mix(CHARCOAL, metal, t);
        p.field2 = Hue.mix(p.field, BLACK, 380);
        p.metal = metal;
        p.rim = Hue.mix(metal, 0x6e7176, live ? 420 : 700);
        p.body = live ? IVORY : Hue.mix(IVORY, 0x6e7176, 400);
        p.quiet = Hue.mix(0x8b8e94, IVORY, 300);
    }

    /// @notice Days of term left, capped at a year — the bezel only ever shows
    ///         the coming twelve months, so a decade of prepaid time reads as a
    ///         full bezel rather than overflowing it.
    function _daysLeft(Pass memory s) internal pure returns (uint256) {
        if (s.tier == 0) return 365; // Free never lapses: a full, quiet bezel
        if (s.expiresAt <= s.nowTs) return 0;
        uint256 d = (uint256(s.expiresAt) - uint256(s.nowTs)) / 1 days;
        return d > 365 ? 365 : d;
    }

    // ─── The press ────────────────────────────────────────────────────────────

    function _defs(Plate memory p, uint256 pitch) internal pure returns (string memory) {
        return string.concat(
            "<defs>",
            "<radialGradient id='g' cx='62%' cy='30%' r='92%'>",
            "<stop offset='0' stop-color='", Hue.str(Hue.mix(p.field, IVORY, 55)), "'/>",
            "<stop offset='0.6' stop-color='", Hue.str(p.field), "'/>",
            "<stop offset='1' stop-color='", Hue.str(p.field2), "'/>",
            "</radialGradient>",
            "<linearGradient id='m' x1='0' y1='0' x2='1' y2='1'>",
            "<stop offset='0' stop-color='", Hue.str(Hue.mix(p.metal, IVORY, 420)), "'/>",
            "<stop offset='0.48' stop-color='", Hue.str(p.metal), "'/>",
            "<stop offset='1' stop-color='", Hue.str(Hue.mix(p.metal, BLACK, 460)), "'/>",
            "</linearGradient>",
            "<linearGradient id='s' x1='85%' y1='0%' x2='15%' y2='100%'>",
            "<stop offset='0' stop-color='#fff' stop-opacity='0'/>",
            "<stop offset='0.46' stop-color='#fff' stop-opacity='0.06'/>",
            "<stop offset='1' stop-color='#fff' stop-opacity='0'/>",
            "</linearGradient>",
            "<pattern id='b' width='40' height='", Ink.uintStr(pitch),
            "' patternUnits='userSpaceOnUse'>",
            "<line x1='0' x2='40' y1='2' y2='2' stroke='#f2ede3' stroke-opacity='0.055' stroke-width='4'/>",
            "<line x1='0' x2='40' y1='", Ink.uintStr(pitch / 2 + 1), "' y2='",
            Ink.uintStr(pitch / 2 + 1), "' stroke='#000' stroke-opacity='0.11' stroke-width='6'/>",
            "</pattern>",
            "<clipPath id='c'><rect x='200' y='200' width='8200' height='5000' rx='280'/></clipPath>",
            "</defs>"
        );
    }

    /// @dev The same rose engine as the Positions plate, cut at unit radius and
    ///      re-chucked for each pass. `depth` is the wear: a fresh long term is
    ///      cut deep, a term about to lapse is nearly smooth metal.
    function _figure(uint256 petals, uint256 depth) internal pure returns (string memory) {
        uint256 n = petals * 9;
        int256 d = int256(depth);
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

    function _seal(Plate memory p) internal pure returns (string memory out) {
        for (uint256 i = 0; i < 5; i++) {
            out = string.concat(
                out,
                "<use href='#r' xlink:href='#r' transform='translate(",
                Ink.intStr(CX), ",", Ink.intStr(CY), ") scale(",
                Ink.dec3(1370 - i * 112),
                ") rotate(", Ink.uintStr(i * 5), ")' stroke='",
                Hue.str(p.rim),
                "' stroke-width='", i == 0 ? "10" : "6",
                "' stroke-opacity='", i == 0 ? "0.5" : (i < 3 ? "0.34" : "0.22"),
                "' vector-effect='non-scaling-stroke'/>"
            );
        }
    }

    /// @dev The bezel: twenty-four struck ticks, lit for as much of the coming
    ///      year as the member has paid for. This is the card's clock, and it is
    ///      read at a glance rather than parsed.
    function _bezel(Plate memory p, uint256 daysLeft) internal pure returns (string memory out) {
        uint256 lit = (daysLeft * 24 + 364) / 365;
        // The rail. Without it the lit ticks float unattached and read as sun
        // rays scratched into the plate rather than as a bezel being counted down.
        out = string.concat(
            "<circle cx='", Ink.intStr(CX), "' cy='", Ink.intStr(CY),
            "' r='1500' fill='none' stroke='", Hue.str(p.rim),
            "' stroke-width='4' stroke-opacity='0.3'/>"
        );
        for (uint256 i = 0; i < 24; i++) {
            int256 a = int256(i) * 15_000 - 90_000; // start at twelve o'clock, run clockwise
            int256 co = Trig.cos(a);
            int256 si = Trig.sin(a);
            bool on = i < lit;
            out = string.concat(
                out,
                "<line x1='", Ink.intStr(CX + (1500 * co) / Trig.ONE),
                "' y1='", Ink.intStr(CY + (1500 * si) / Trig.ONE),
                "' x2='", Ink.intStr(CX + (1640 * co) / Trig.ONE),
                "' y2='", Ink.intStr(CY + (1640 * si) / Trig.ONE),
                "' stroke='", on ? "url(#m)" : Hue.str(p.rim),
                "' stroke-width='", on ? "22" : "10",
                "' stroke-opacity='", on ? "0.95" : "0.3",
                "' stroke-linecap='round'/>"
            );
        }
    }

    function _emboss(Plate memory p, string memory word) internal pure returns (string memory) {
        // The tier is set to the space it has: ENTERPRISE is ten characters and
        // PRO is three, and a fixed size would either crop the one or lose the
        // other. 3900 units of column, grotesque caps at ~0.66em.
        uint256 size = 5909 / bytes(word).length;
        if (size > 880) size = 880;
        string memory open = string.concat(
            "<text x='760' y='2560' font-family=\"",
            DISPLAY,
            "\" font-size='",
            Ink.uintStr(size),
            "' font-weight='600' letter-spacing='10' fill='"
        );
        return string.concat(
            open, Hue.str(Hue.mix(p.field2, BLACK, 420)), "' transform='translate(8,9)' fill-opacity='0.62'>", word, "</text>",
            open, Hue.str(Hue.mix(p.field, IVORY, 340)), "' transform='translate(-6,-7)' fill-opacity='0.38'>", word, "</text>",
            open, Hue.str(p.body), "'>", word, "</text>"
        );
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
            "<text x='", Ink.intStr(x), "' y='", Ink.intStr(y),
            "' font-family=\"", MONO,
            "\" font-size='", Ink.uintStr(size),
            "' letter-spacing='", Ink.uintStr(track),
            "' text-anchor='", anchor,
            "' fill='", Hue.str(fill), "'>", txt, "</text>"
        );
    }

    function _type(Pass memory s, Plate memory p, bool live)
        internal
        pure
        returns (string memory)
    {
        return string.concat(_head(s, p), _foot(s, p, live));
    }

    function _head(Pass memory s, Plate memory p) internal pure returns (string memory) {
        return string.concat(
            "<rect x='756' y='996' width='84' height='84' rx='12' transform='rotate(45 798 1038)' fill='",
            Hue.str(PINK),
            "'/>",
            _set(960, 1090, 150, 50, p.quiet, "start", "SUWAPPU MEMBERSHIP"),
            "<line x1='760' x2='4700' y1='1300' y2='1300' stroke='",
            Hue.str(p.quiet),
            "' stroke-width='6' stroke-opacity='0.34'/>",
            _emboss(p, _tierName(s.tier)),
            _set(
                760,
                3120,
                190,
                14,
                p.metal,
                "start",
                string.concat("MEMBER No ", Ink.serial(s.tokenId))
            ),
            "<line x1='760' x2='4700' y1='3900' y2='3900' stroke='",
            Hue.str(p.quiet),
            "' stroke-width='6' stroke-opacity='0.34'/>"
        );
    }

    function _foot(Pass memory s, Plate memory p, bool live)
        internal
        pure
        returns (string memory)
    {
        string memory thru = s.tier == 0 ? "PERPETUAL" : Ink.date(s.expiresAt);
        return string.concat(
            _set(760, 4160, 130, 43, p.quiet, "start", "MEMBER SINCE"),
            _set(760, 4460, 250, 18, p.body, "start", Ink.date(s.issuedAt)),
            _set(
                3100,
                4160,
                130,
                43,
                p.quiet,
                "start",
                s.tier == 0 ? "TERM" : (live ? "VALID THRU" : "LAPSED")
            ),
            _set(3100, 4460, 250, 18, live ? p.body : p.quiet, "start", thru)
        );
    }

    function svg(Pass memory s) public pure returns (string memory) {
        bool live = s.tier == 0 || s.expiresAt > s.nowTs;
        Plate memory p = _palette(s, live);
        uint256 daysLeft = _daysLeft(s);
        // Seeded from the token id alone: a membership has no entry price to be
        // struck with, and the plate must not change figure when a member renews.
        uint256 seed = uint256(keccak256(abi.encodePacked("suwappu.pass", s.tokenId)));
        uint256 petals = 7 + (seed % 8);
        // Wear: deep on a fresh term, nearly smooth on one about to lapse.
        uint256 depth = 70 + (200 * daysLeft) / 365;
        return string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'"
            " viewBox='0 0 8600 5400' width='860' height='540'>",
            _defs(p, 44 + ((seed >> 32) % 27)),
            _figure(petals, depth),
            "<rect width='8600' height='5400' fill='", Hue.str(OBSIDIAN), "'/>",
            "<rect x='200' y='200' width='8200' height='5000' rx='280' fill='url(#g)'/>",
            "<g clip-path='url(#c)'>",
            "<rect x='200' y='200' width='8200' height='5000' fill='url(#b)'/>",
            _seal(p),
            _bezel(p, daysLeft),
            "<rect x='200' y='200' width='8200' height='5000' fill='url(#s)'/>",
            "</g>",
            "<rect x='200' y='200' width='8200' height='5000' rx='280' fill='none' stroke='url(#m)' stroke-width='18'/>",
            "<rect x='320' y='320' width='7960' height='4760' rx='200' fill='none' stroke='",
            Hue.str(p.rim),
            "' stroke-width='3' stroke-opacity='0.45'/>",
            _type(s, p, live),
            "</svg>"
        );
    }

    function tokenURI(Pass calldata s) external pure returns (string memory) {
        bool live = s.tier == 0 || s.expiresAt > s.nowTs;
        string memory json = string.concat(
            '{"name":"Suwappu ',
            _tierName(s.tier),
            " No ",
            Ink.serial(s.tokenId),
            '","description":"',
            "A Suwappu membership, engraved on-chain at the moment it is read. "
            "The bezel is lit for as much of the coming year as the member has "
            "paid for and goes dark a tick at a time; the seal is cut deep on a "
            "fresh term and wears smooth as the term runs out. Nothing is hosted "
            "and nothing is revoked - when the term ends the plate simply stops "
            "looking like a membership.",
            '","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg(s))),
            '","attributes":[',
            '{"trait_type":"Tier","value":"', _tierName(s.tier), '"},',
            '{"trait_type":"Status","value":"', live ? "Active" : "Lapsed", '"},',
            '{"trait_type":"Member Since","value":"', Ink.date(s.issuedAt), '"},',
            '{"trait_type":"Valid Thru","value":"',
            s.tier == 0 ? "Perpetual" : Ink.date(s.expiresAt),
            '"},',
            '{"trait_type":"Days Remaining","value":', Ink.uintStr(_daysLeft(s)), "}",
            "]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
