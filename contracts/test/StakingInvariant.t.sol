// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import { Test } from "forge-std/Test.sol";
import { MedusaHarness } from "../MedusaHarness.sol";

/// Foundry native invariant fuzzing — calls the harness's fuzz_* functions in
/// random sequences and asserts solvency holds after every call.
contract StakingInvariantTest is Test {
    MedusaHarness h;
    function setUp() public {
        h = new MedusaHarness();
        targetContract(address(h));
    }
    /// INVARIANT: contract always holds >= staked principal + unclaimed bonuses.
    function invariant_solvency() public view {
        assertTrue(h.property_solvency(), "INSOLVENT");
    }
}
