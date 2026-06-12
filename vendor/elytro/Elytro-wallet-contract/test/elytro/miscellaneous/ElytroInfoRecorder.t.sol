// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "@source/tools/ElytroInfoRecorder.sol";

contract ElytroInfoRecorderTest is Test {
    ElytroInfoRecorder public recorder;
    address public wallet;
    uint256 public walletPrivateKey;

    // Test categories
    bytes32 constant GUARDIAN_INFO = keccak256("GUARDIAN_INFO");

    function setUp() public {
        recorder = new ElytroInfoRecorder();
        (wallet, walletPrivateKey) = makeAddrAndKey("wallet");
    }

    function test_recordGuardianInfo() public {
        // Prepare guardian data
        address[] memory guardians = new address[](2);
        guardians[0] = address(0x1);
        guardians[1] = address(0x2);
        uint256 threshold = 2;

        // Encode guardian data
        bytes memory guardianData = abi.encode(guardians, threshold);

        // Record data
        vm.prank(wallet);

        // Verify event
        vm.expectEmit(
            true, // check wallet address (topic1)
            true, // check category (topic2)
            false, // no topic3 in our event
            true // check data field
        );
        emit ElytroInfoRecorder.DataRecorded(wallet, GUARDIAN_INFO, guardianData);
        recorder.recordData(GUARDIAN_INFO, guardianData);
    }
}
