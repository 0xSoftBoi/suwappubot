// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SuwappuArt — the drawing instruments
 *
 * Everything below is arithmetic, not data. There is no IPFS hash here, no
 * base URI, no off-chain renderer to trust and no pinning bill to keep paying:
 * a card is drawn, from nothing, by the EVM, every time someone looks at it.
 * That is the whole point of these files. A Suwappu card is not a picture of a
 * position — it *is* the position, engraved at the moment you ask.
 *
 * Three instruments:
 *
 *   Trig     — sine and cosine, via Bhaskara I's approximation (India, c. 600 CE).
 *              Chosen over a lookup table because a table is stored art and a
 *              formula is made art. It costs four multiplications and holds
 *              ~0.0016 absolute error, which is invisible at any size a
 *              guilloché is looked at.
 *
 *   Hue      — 24-bit colour as a number you can do arithmetic to: mix, dim,
 *              lift. The palette is Centurion Noir (see nft/position-cards/THEME.md)
 *              and it is computed here rather than copied, so a sector tint is a
 *              luminance-normalised anodising and not a hardcoded swatch.
 *
 *   Ink      — the small string work SVG needs: integers, signed percentages,
 *              1e18 money, and letter-spaced small caps.
 *
 * COORDINATES. The card is 600 x 840 (the Centurion aspect), drawn on a
 * viewBox of 6000 x 8400 so every coordinate is an integer in tenths of a unit.
 * Decimal formatting in a hot loop is the most expensive thing an on-chain
 * renderer can do, and a tenth of a unit is a quarter of a pixel on a phone.
 */
library Trig {
    /// @dev Angles are milli-degrees (360_000 == one turn). Returns 1e6 fixed.
    int256 internal constant ONE = 1e6;
    int256 internal constant TURN = 360_000;
    int256 internal constant HALF = 180_000;
    int256 internal constant QUARTER = 90_000;

    /// @notice sin(a), a in milli-degrees, result scaled to 1e6.
    /// @dev Bhaskara I: sin(x) ~= 4x(180-x) / (40500 - x(180-x)), x in degrees
    ///      over [0,180]. Exact at 0, 30, 90, 150 and 180 degrees; worst case
    ///      ~0.0016 in between. Everything else is range reduction.
    function sin(int256 a) internal pure returns (int256) {
        a %= TURN;
        if (a < 0) a += TURN;
        bool neg = a > HALF;
        if (neg) a -= HALF;
        int256 t = a * (HALF - a); // <= 8.1e9
        int256 v = (4 * ONE * t) / (40_500 * 1e6 - t);
        return neg ? -v : v;
    }

    /// @notice cos(a), a in milli-degrees, result scaled to 1e6.
    function cos(int256 a) internal pure returns (int256) {
        return sin(a + QUARTER);
    }
}

library Hue {
    /// @notice Linear mix of two packed RGB colours. `t` is 0..1000.
    function mix(uint24 a, uint24 b, uint256 t) internal pure returns (uint24) {
        if (t > 1000) t = 1000;
        uint256 r = (((a >> 16) & 0xff) * (1000 - t) + ((b >> 16) & 0xff) * t) / 1000;
        uint256 g = (((a >> 8) & 0xff) * (1000 - t) + ((b >> 8) & 0xff) * t) / 1000;
        uint256 bl = ((a & 0xff) * (1000 - t) + (b & 0xff) * t) / 1000;
        return uint24((r << 16) | (g << 8) | bl);
    }

    /// @notice Rec. 709 relative luminance, 0..1000.
    /// @dev Used to anodise every sector tint to the SAME darkness, so the ten
    ///      families sort a wall by HUE and never by one of them being brighter.
    ///      A flat mix let the warm tints (Crypto gold, Media rose) lift off the
    ///      black while the cool ones stayed flat — a 28% spread in field
    ///      luminance and a grid that read as unfinished.
    function lum(uint24 c) internal pure returns (uint256) {
        return (2126 * ((c >> 16) & 0xff) + 7152 * ((c >> 8) & 0xff) + 722 * (c & 0xff)) / 255_000;
    }

    /// @notice "#rrggbb" for an SVG attribute.
    function str(uint24 c) internal pure returns (string memory) {
        bytes memory H = "0123456789abcdef";
        bytes memory o = new bytes(7);
        o[0] = "#";
        for (uint256 i = 0; i < 6; i++) {
            o[6 - i] = H[(uint256(c) >> (4 * i)) & 0xf];
        }
        return string(o);
    }
}

library Ink {
    function uintStr(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 n = v;
        uint256 len;
        while (n != 0) {
            len++;
            n /= 10;
        }
        bytes memory o = new bytes(len);
        while (v != 0) {
            o[--len] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(o);
    }

    function intStr(int256 v) internal pure returns (string memory) {
        return v < 0 ? string.concat("-", uintStr(uint256(-v))) : uintStr(uint256(v));
    }

    /// @notice Basis points as a signed percentage: 12345 -> "+123.45%".
    /// @dev    Always signed, always two decimals. A return that renders as
    ///         "123%" one day and "123.4%" the next makes a wall of cards look
    ///         like a wall of different collections.
    function pct(int256 bps) internal pure returns (string memory) {
        bool neg = bps < 0;
        uint256 a = uint256(neg ? -bps : bps);
        return string.concat(
            neg ? "-" : "+", uintStr(a / 100), ".", pad2(a % 100), "%"
        );
    }

    /// @notice 1e18 fixed point as money: "$1234.56", or "$0.0432" under a dollar.
    /// @dev    Four decimals below $1 because several of the referenced tokens
    ///         trade there. At two decimals a card whose position was up 13.65%
    ///         printed the same "$0.04" for entry and mark, and read as a bug.
    function money(uint256 v) internal pure returns (string memory) {
        if (v >= 1e18) return string.concat("$", uintStr(v / 1e18), ".", pad2((v % 1e18) / 1e16));
        return string.concat("$0.", pad(v / 1e14, 4));
    }

    /// @notice Zero-padded to `n` digits, truncating from the left if longer.
    function pad(uint256 v, uint256 n) internal pure returns (string memory) {
        bytes memory b = bytes(uintStr(v));
        if (b.length >= n) return string(b);
        bytes memory z = new bytes(n - b.length);
        for (uint256 i = 0; i < z.length; i++) z[i] = "0";
        return string.concat(string(z), string(b));
    }

    /// @notice A permille as a decimal an SVG transform can read: 943 -> "0.943".
    function dec3(uint256 permille) internal pure returns (string memory) {
        return string.concat(uintStr(permille / 1000), ".", pad(permille % 1000, 3));
    }

    function pad2(uint256 v) internal pure returns (string memory) {
        return v < 10 ? string.concat("0", uintStr(v)) : uintStr(v);
    }

    /// @notice XML/JSON-safe copy of a string read from somewhere else.
    /// @dev    The ticker on a card is `symbol()` on a live ERC-20, which is a
    ///         string an external contract chose. It is drawn into an SVG and
    ///         into a JSON name, so it is escaped here rather than trusted, and
    ///         clipped to `maxLen` so nobody can push a novel through the plate.
    ///         Anything outside printable ASCII is dropped entirely: a token
    ///         whose symbol carries a quote, an angle bracket or a control byte
    ///         renders as the letters it has left, never as markup.
    function esc(string memory s, uint256 maxLen) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        uint256 n = b.length > maxLen ? maxLen : b.length;
        bytes memory o = new bytes(n);
        uint256 j;
        for (uint256 i = 0; i < n; i++) {
            uint8 ch = uint8(b[i]);
            if (ch < 0x20 || ch > 0x7e) continue;
            if (ch == 0x3c || ch == 0x3e || ch == 0x26 || ch == 0x22 || ch == 0x27) continue;
            if (ch == 0x5c) continue;
            o[j++] = b[i];
        }
        assembly {
            mstore(o, j)
        }
        return j == 0 ? "?" : string(o);
    }

    /// @notice A unix second as "2026-09-30".
    /// @dev    Hinnant's civil-from-days, shifted to an era beginning 0000-03-01
    ///         so leap years fall at the end of the cycle and the month/day
    ///         arithmetic is branchless. Proleptic Gregorian, correct for any
    ///         timestamp this contract can hold. Dates are drawn on the card, so
    ///         they are computed here rather than passed in — a caller-supplied
    ///         date string is a caller-supplied claim.
    function date(uint256 ts) internal pure returns (string memory) {
        uint256 z = ts / 86400 + 719468;
        uint256 era = z / 146097;
        uint256 doe = z % 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 y = yoe + era * 400;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        uint256 d = doy - (153 * mp + 2) / 5 + 1;
        uint256 m = mp < 10 ? mp + 3 : mp - 9;
        if (m <= 2) y += 1;
        return string.concat(uintStr(y), "-", pad(m, 2), "-", pad(d, 2));
    }

    /// @notice Zero-padded serial, e.g. 42 -> "0042".
    function serial(uint256 v) internal pure returns (string memory) {
        return pad(v, 4);
    }
}

library Root {
    /// @notice Integer square root, Babylonian. Used only to luminance-normalise
    ///         the anodising, which is a perceptual curve and wants the root.
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = x / 2 + 1;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
