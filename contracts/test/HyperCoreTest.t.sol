// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Test } from "forge-std/Test.sol";
import { L1Read } from "../hypercore/L1Read.sol";
import { CoreWriterLib } from "../hypercore/CoreWriterLib.sol";

contract CoreWriterRecorder {
    bytes public lastAction;
    uint256 public calls;

    function sendRawAction(bytes calldata data) external {
        lastAction = data;
        calls++;
    }
}

contract HyperCoreHarness {
    function placeIoc(uint32 asset, bool isBuy, uint64 px, uint64 sz, uint128 cloid) external {
        CoreWriterLib.limitOrder(asset, isBuy, px, sz, false, CoreWriterLib.TIF_IOC, cloid);
    }

    function send(address dst, uint64 token, uint64 amt) external {
        CoreWriterLib.spotSend(dst, token, amt);
    }

    function supply(uint64 token, uint64 amt) external {
        CoreWriterLib.borrowLend(0, token, amt);
    }

    function readSpotBalance(address user, uint64 token)
        external
        view
        returns (L1Read.SpotBalance memory)
    {
        return L1Read.spotBalance(user, token);
    }

    function readSpotPx(uint32 idx) external view returns (uint64) {
        return L1Read.spotPx(idx);
    }

    function readCoreUserExists(address user) external view returns (bool) {
        return L1Read.coreUserExists(user);
    }
}

contract HyperCoreTest is Test {
    CoreWriterRecorder recorder;
    HyperCoreHarness harness;

    function setUp() public {
        recorder = new CoreWriterRecorder();
        vm.etch(CoreWriterLib.CORE_WRITER, address(recorder).code);
        harness = new HyperCoreHarness();
    }

    function _recorded() internal view returns (bytes memory) {
        return CoreWriterRecorder(CoreWriterLib.CORE_WRITER).lastAction();
    }

    function test_limitOrder_wireFormat() public {
        harness.placeIoc(147, true, 25_00000000, 4_00000000, 42);
        bytes memory expected = abi.encodePacked(
            uint8(1),
            uint24(1),
            abi.encode(
                uint32(147),
                true,
                uint64(25_00000000),
                uint64(4_00000000),
                false,
                uint8(3), // IOC
                uint128(42)
            )
        );
        assertEq(_recorded(), expected);
        // version byte + 3-byte action id prefix
        assertEq(uint8(_recorded()[0]), 1);
        assertEq(uint8(_recorded()[3]), 1);
    }

    function test_spotSend_wireFormat() public {
        address dst = address(0xBEEF);
        harness.send(dst, 150, 1e8);
        bytes memory expected =
            abi.encodePacked(uint8(1), uint24(6), abi.encode(dst, uint64(150), uint64(1e8)));
        assertEq(_recorded(), expected);
    }

    function test_borrowLend_supply_wireFormat() public {
        harness.supply(0, 500e8);
        bytes memory expected =
            abi.encodePacked(uint8(1), uint24(15), abi.encode(uint8(0), uint64(0), uint64(500e8)));
        assertEq(_recorded(), expected);
    }

    function test_precompile_spotBalance_roundtrip() public {
        address user = address(0xA11CE);
        uint64 token = 150;
        vm.mockCall(
            L1Read.SPOT_BALANCE,
            abi.encode(user, token),
            abi.encode(L1Read.SpotBalance({ total: 777, hold: 11, entryNtl: 5 }))
        );
        L1Read.SpotBalance memory b = harness.readSpotBalance(user, token);
        assertEq(b.total, 777);
        assertEq(b.hold, 11);
        assertEq(b.entryNtl, 5);
    }

    function test_precompile_spotPx_and_userExists() public {
        vm.mockCall(L1Read.SPOT_PX, abi.encode(uint32(107)), abi.encode(uint64(123_456)));
        assertEq(harness.readSpotPx(107), 123_456);

        vm.mockCall(L1Read.CORE_USER_EXISTS, abi.encode(address(this)), abi.encode(true));
        assertTrue(harness.readCoreUserExists(address(this)));
    }

    function test_precompile_failure_reverts() public {
        vm.mockCallRevert(L1Read.SPOT_PX, abi.encode(uint32(9)), "boom");
        vm.expectRevert(
            abi.encodeWithSelector(L1Read.PrecompileCallFailed.selector, L1Read.SPOT_PX)
        );
        harness.readSpotPx(9);
    }
}
