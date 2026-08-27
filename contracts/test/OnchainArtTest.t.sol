// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../art/SuwappuPositionsArt.sol";
import "../art/SuwappuMembershipArt.sol";
import "../art/SuwappuCodex.sol";
import "../SuwappuPositions.sol";
import "./ArtMocks.sol";

/**
 * @title The engraver, under test
 *
 * These assert the properties that make on-chain art safe to ship rather than
 * the pixels, which are judged by eye against a contact sheet (see
 * contracts/preview/README.md). The properties are: it always returns a
 * well-formed data URI, it never emits markup it was handed, it never reverts
 * on any state a real token can be in, and it never depends on anything the
 * chain does not already hold.
 */
contract OnchainArtTest is Test {
    SuwappuPositionsArt art;
    SuwappuMembershipArt pass;

    function setUp() public {
        art = new SuwappuPositionsArt();
        pass = new SuwappuMembershipArt();
    }

    function _card() internal pure returns (Card memory) {
        return Card({
            tokenId: 1,
            ticker: "NVDA",
            tickerIndex: 20,
            entryPrice: 120e18,
            spotPrice: 180e18,
            returnBps: 5000,
            priced: true,
            gradeIndex: 3,
            mintRank: 17,
            isGold: false,
            mintedAt: 1_700_000_000,
            maxSupply: 4444
        });
    }

    function _startsWith(string memory s, string memory pre) internal pure returns (bool) {
        bytes memory b = bytes(s);
        bytes memory p = bytes(pre);
        if (b.length < p.length) return false;
        for (uint256 i = 0; i < p.length; i++) {
            if (b[i] != p[i]) return false;
        }
        return true;
    }

    function _contains(string memory s, bytes1 ch) internal pure returns (bool) {
        bytes memory b = bytes(s);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == ch) return true;
        }
        return false;
    }

    // ─── The card is a complete, self-contained document ──────────────────────

    function test_tokenURI_isSelfContainedDataURI() public view {
        string memory uri = art.tokenURI(_card());
        assertTrue(_startsWith(uri, "data:application/json;base64,"));
        // Nothing hosted: no scheme that resolves off-chain may appear anywhere.
        string memory s = art.svg(_card());
        assertTrue(_startsWith(s, "<svg"));
        assertEq(_indexOf(s, "http://www.w3.org/2000/svg") > 0, true); // the XML ns only
        assertFalse(_indexOf(s, "https://") > 0);
        assertFalse(_indexOf(s, "ipfs") > 0);
    }

    function _indexOf(string memory hay, string memory needle) internal pure returns (uint256) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length == 0 || h.length < n.length) return 0;
        for (uint256 i = 0; i + n.length <= h.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return i + 1;
        }
        return 0;
    }

    // ─── A symbol read from another contract is data, never markup ────────────

    /// @dev The plate names the machine that struck it. A renderer swap must be
    ///      visible on the card, or "swappable renderer" is an unauditable claim.
    function test_thePlateNamesItsEngraver() public {
        SuwappuPositionsArt other = new SuwappuPositionsArt();
        assertTrue(_indexOf(art.svg(_card()), "STRUCK BY") > 0);
        // Same source, same codehash, same mark — the mark identifies the CODE.
        assertEq(keccak256(bytes(art.svg(_card()))), keccak256(bytes(other.svg(_card()))));
    }

    function test_hostileTickerCannotInjectMarkup() public view {
        Card memory c = _card();
        c.ticker = '<script>x</script>&"';
        string memory s = art.svg(c);
        // The plate still renders, and not one character of the attack survives.
        assertTrue(_startsWith(s, "<svg"));
        assertEq(_indexOf(s, "<script"), 0);
        assertEq(_indexOf(s, "&quot"), 0);
        assertEq(_indexOf(s, "\"x\""), 0);
    }

    function test_emptyTickerStillRenders() public view {
        Card memory c = _card();
        c.ticker = "";
        assertTrue(_startsWith(art.svg(c), "<svg"));
    }

    // ─── No state a real token can reach may revert the render ────────────────

    function test_unpricedCardRenders() public view {
        Card memory c = _card();
        c.entryPrice = 0;
        c.spotPrice = 0;
        c.returnBps = 0;
        c.priced = false;
        c.gradeIndex = 1;
        assertTrue(_startsWith(art.svg(c), "<svg"));
    }

    function test_extremeReturnsRender() public view {
        int256[5] memory bps = [int256(-9999), 0, 50_000, 4_000_000, -1];
        for (uint256 i = 0; i < bps.length; i++) {
            Card memory c = _card();
            c.returnBps = bps[i];
            assertTrue(_startsWith(art.svg(c), "<svg"));
        }
    }

    function test_everyTickerIndexHasASector() public view {
        for (uint8 i = 0; i < 35; i++) {
            Card memory c = _card();
            c.tickerIndex = i;
            string memory s = art.svg(c);
            assertTrue(_startsWith(s, "<svg"));
        }
        // Out of range degrades to the last sector rather than reverting.
        Card memory oob = _card();
        oob.tickerIndex = 200;
        assertTrue(_startsWith(art.svg(oob), "<svg"));
    }

    function testFuzz_neverReverts(
        uint256 tokenId,
        uint8 tickerIndex,
        uint96 entry,
        int64 bps,
        uint16 rank,
        bool gold,
        bool priced
    ) public view {
        Card memory c = Card({
            tokenId: tokenId % 100_000,
            ticker: "TEST",
            tickerIndex: tickerIndex,
            entryPrice: entry,
            spotPrice: entry,
            returnBps: bps,
            priced: priced,
            gradeIndex: uint8(uint256(int256(bps) < 0 ? 0 : 3)),
            mintRank: rank,
            isGold: gold,
            mintedAt: 1_700_000_000,
            maxSupply: 4444
        });
        assertTrue(_startsWith(art.svg(c), "<svg"));
    }

    // ─── The art is a function of the position, and changes with it ───────────

    function test_theArtMovesWithTheMarket() public view {
        Card memory a = _card();
        Card memory b = _card();
        b.returnBps = 40_000; // same token, same entry, the market moved
        b.gradeIndex = 4;
        assertTrue(
            keccak256(bytes(art.svg(a))) != keccak256(bytes(art.svg(b))),
            "the plate must not be frozen"
        );
    }

    function test_theEngravingIsFixedAtMint() public view {
        // Two reads of the same position at the same price are byte-identical:
        // the engraving is deterministic, not animated.
        assertEq(keccak256(bytes(art.svg(_card()))), keccak256(bytes(art.svg(_card()))));
    }

    function test_goldIsADifferentPlate() public view {
        Card memory g = _card();
        g.isGold = true;
        assertTrue(keccak256(bytes(art.svg(g))) != keccak256(bytes(art.svg(_card()))));
    }

    // ─── The membership plate ─────────────────────────────────────────────────

    function _pass(uint8 tier, uint64 expires) internal pure returns (Pass memory) {
        return Pass({
            tokenId: 42,
            tier: tier,
            expiresAt: expires,
            issuedAt: 1_700_000_000,
            nowTs: 1_780_000_000
        });
    }

    function test_membershipRendersEveryTier() public view {
        for (uint8 t = 0; t < 4; t++) {
            string memory s = pass.svg(_pass(t, 1_790_000_000));
            assertTrue(_startsWith(s, "<svg"));
        }
    }

    function test_aLapsedMembershipSaysSo() public view {
        string memory live = pass.tokenURI(_pass(1, 1_790_000_000));
        string memory dead = pass.tokenURI(_pass(1, 1_770_000_000));
        assertTrue(keccak256(bytes(live)) != keccak256(bytes(dead)));
        assertTrue(_indexOf(pass.svg(_pass(1, 1_770_000_000)), "LAPSED") > 0);
        assertEq(_indexOf(pass.svg(_pass(1, 1_790_000_000)), "LAPSED"), 0);
    }

    function test_freeMembershipNeverLapses() public view {
        assertTrue(_indexOf(pass.svg(_pass(0, 0)), "PERPETUAL") > 0);
    }

    function testFuzz_membershipNeverReverts(uint8 tier, uint64 expires, uint64 nowTs)
        public
        view
    {
        Pass memory p = _pass(uint8(tier % 4), expires);
        p.nowTs = nowTs;
        assertTrue(_startsWith(pass.svg(p), "<svg"));
    }

    // ─── Dates are computed, not supplied ─────────────────────────────────────

    function test_dateIsCorrectAcrossLeapYears() public pure {
        assertEq(Ink.date(0), "1970-01-01");
        assertEq(Ink.date(951_782_400), "2000-02-29"); // a leap day in a century year
        assertEq(Ink.date(1_709_164_800), "2024-02-29");
        assertEq(Ink.date(4_102_444_800), "2100-01-01"); // 2100 is NOT a leap year
    }

    function test_moneyKeepsPrecisionUnderADollar() public pure {
        assertEq(Ink.money(1234_560_000_000_000_000_000), "$1234.56");
        assertEq(Ink.money(43_200_000_000_000_000), "$0.0432");
        assertEq(Ink.money(0), "$0.0000");
    }

    function test_percentIsAlwaysSigned() public pure {
        assertEq(Ink.pct(5000), "+50.00%");
        assertEq(Ink.pct(-3463), "-34.63%");
        assertEq(Ink.pct(0), "+0.00%");
    }

    /// @dev Bhaskara I is exact at the quadrant marks and within ~0.2% between.
    function test_sineIsAccurateEnoughToEngraveWith() public pure {
        assertEq(Trig.sin(0), 0);
        assertEq(Trig.sin(90_000), 1e6);
        assertEq(Trig.sin(180_000), 0);
        assertEq(Trig.sin(270_000), -1e6);
        assertApproxEqAbs(Trig.sin(30_000), 500_000, 2_000);
        assertApproxEqAbs(Trig.cos(60_000), 500_000, 2_000);
        assertApproxEqAbs(Trig.sin(45_000), 707_107, 3_000);
        assertApproxEqAbs(Trig.sin(-90_000), -1e6, 2);
    }
}

/**
 * @title The collection, wired to the engraver
 */
contract PositionsRendererTest is Test {
    SuwappuPositions pos;
    SuwappuPositionsArt art;
    MockPositionOracle oracle;

    function setUp() public {
        uint16[35] memory caps;
        address[35] memory tokens;
        // 34 x 127 + 126 == 4444, so the constructor's supply invariant holds.
        for (uint256 i = 0; i < 35; i++) {
            caps[i] = i == 34 ? 126 : 127;
            tokens[i] = address(new MockSymbolString(string.concat("T", vm.toString(i))));
        }
        tokens[1] = address(new MockSymbolBytes32("AMD"));
        tokens[2] = address(new MockSymbolMissing());
        pos = new SuwappuPositions(caps, tokens, "https://example.invalid/", address(this));
        art = new SuwappuPositionsArt();
        oracle = new MockPositionOracle();
        pos.setOracle(address(oracle));
        for (uint256 i = 0; i < 35; i++) {
            oracle.set(tokens[i], 100e18, 1e18);
        }
        pos.sealRegistry();
        pos.ownerMint(address(this), 0, 1);
    }

    function test_fallsBackToBaseURIWithNoRenderer() public view {
        assertEq(pos.tokenURI(1), "https://example.invalid/1");
    }

    function test_drawsOnChainOnceARendererIsSet() public {
        pos.setRenderer(address(art));
        string memory uri = pos.tokenURI(1);
        assertEq(bytes(uri)[0], bytes1("d")); // data:
        assertTrue(bytes(uri).length > 5000);
    }

    /// @dev The ticker on the card is the referenced ERC-20's own name for
    ///      itself. Three shapes exist in the wild and all three must resolve
    ///      without reverting the render.
    function test_tickerSymbolDecodesEveryShape() public view {
        assertEq(pos.tickerSymbol(0), "T0"); // string
        assertEq(pos.tickerSymbol(1), "AMD"); // bytes32
        assertEq(pos.tickerSymbol(2), "#2"); // no symbol() at all
        assertEq(pos.tickerSymbol(99), "?"); // not a ticker
    }

    function test_theCardTracksTheOracle() public {
        pos.setRenderer(address(art));
        string memory before = pos.tokenURI(1);
        oracle.set(pos.tickerToken(0), 250e18, 1e18);
        assertTrue(
            keccak256(bytes(before)) != keccak256(bytes(pos.tokenURI(1))),
            "the card must follow the price"
        );
    }

    function test_rendererCanBeUnset() public {
        pos.setRenderer(address(art));
        pos.setRenderer(address(0));
        assertEq(pos.tokenURI(1), "https://example.invalid/1");
    }

    function test_tokenURIRejectsAnUnmintedId() public {
        pos.setRenderer(address(art));
        vm.expectRevert();
        pos.tokenURI(2);
    }
}


/**
 * @title The contract as its own subject
 *
 * The Codex's whole factual claim is that it reads INSTRUCTIONS, not bytes. A
 * byte histogram of `PUSH32 <32 x 0x55>` reports thirty-two SSTOREs in a
 * contract that has none, and a portrait built on that is decoration with a
 * false caption. These are the tests that make the caption true.
 */
contract SuwappuCodexTest is Test {
    SuwappuCodex codex;
    SuwappuPositionsArt art;

    uint256 constant DATA = 0;
    uint256 constant STACK = 1;
    uint256 constant STORAGE = 4;
    uint256 constant FLOW = 5;
    uint256 constant EXTERNAL = 6;

    function setUp() public {
        codex = new SuwappuCodex();
        art = new SuwappuPositionsArt();
    }

    /// @dev A real deployment rather than `vm.etch`, so the bytes under test are
    ///      read back out of the state trie exactly the way a subject's are.
    function _withRuntime(bytes memory runtime) internal returns (address a) {
        bytes memory n = abi.encodePacked(uint16(runtime.length));
        bytes memory init = abi.encodePacked(
            hex"61", n, hex"600e600039", hex"61", n, hex"6000f3", runtime
        );
        assembly {
            a := create(0, add(init, 0x20), mload(init))
        }
        require(a != address(0), "deploy failed");
    }

    function _census(address a) internal view returns (uint256[] memory) {
        return codex.census(a);
    }

    function test_pushOperandsAreDataNotInstructions() public {
        bytes memory code = abi.encodePacked(hex"7f", bytes32(type(uint256).max / 255 * 0x55));
        // 0x55 is SSTORE. Thirty-two of them, as the operand of one PUSH32.
        uint256[] memory c = _census(_withRuntime(code));
        assertEq(c[STORAGE], 0, "read PUSH data as storage writes");
        assertEq(c[STACK], 1, "the PUSH itself");
        assertEq(c[DATA], 32, "the operand");
    }

    function test_aGenuineStoreIsCounted() public {
        uint256[] memory c = _census(_withRuntime(hex"6001600255"));
        assertEq(c[STORAGE], 1);
        assertEq(c[STACK], 2);
    }

    /// @dev Every Solidity build ends in a CBOR block whose last two bytes are
    ///      its length. Swept as code it would put a band of phantom
    ///      instructions at the foot of every plate.
    function test_compilerMetadataIsData() public {
        bytes memory meta = new bytes(20);
        for (uint256 i = 0; i < 20; i++) {
            meta[i] = hex"55"; // twenty bytes that look exactly like SSTORE
        }
        uint256[] memory c =
            _census(_withRuntime(abi.encodePacked(hex"600150", meta, uint16(20))));
        assertEq(c[STORAGE], 0);
    }

    function test_everyWayOutIsExternal() public {
        bytes1[6] memory ops = [bytes1(hex"f0"), hex"f1", hex"f4", hex"fa", hex"ff", hex"a2"];
        for (uint256 i = 0; i < ops.length; i++) {
            assertEq(_census(_withRuntime(abi.encodePacked(ops[i])))[EXTERNAL], 1);
        }
    }

    // ─── The claim the plate makes about this repository ──────────────────────

    function test_theRenderersAreProvablyPure() public view {
        assertEq(_census(address(art))[STORAGE], 0, "a renderer must write nothing");
        assertEq(_census(address(art))[EXTERNAL], 0, "a renderer must call nobody");
        assertEq(_census(address(codex))[EXTERNAL], 0);
    }

    function test_theSelfPortraitIsOfItself() public view {
        string memory self = codex.selfPortrait();
        assertTrue(_has(self, "SELF PORTRAIT"));
        assertTrue(_has(self, "<svg"));
        assertTrue(_has(self, "</svg>"));
        // Drawn from the code at this address, so it names this address.
        assertTrue(_has(self, Ink.hexAddr(address(codex))));
        assertFalse(_has(codex.portrait(address(art)), "SELF PORTRAIT"));
    }

    function test_aPortraitOfNothingIsRefused() public {
        vm.expectRevert(SuwappuCodex.NotAContract.selector);
        codex.portrait(address(0xdeadbeef));
    }

    function test_tokenURIIsASelfContainedDataURI() public view {
        string memory uri = codex.tokenURI(address(art));
        assertTrue(_has(uri, "data:application/json;base64,"));
        assertTrue(bytes(uri).length > 5000);
    }

    function _has(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length == 0 || h.length < n.length) return false;
        for (uint256 i = 0; i + n.length <= h.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}
