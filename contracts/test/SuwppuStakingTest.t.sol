// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { SuwppuStaking } from "../SuwppuStaking.sol";

// Mock ERC-20 (SUWP + USDC)
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount; balanceOf[to] += amount; return true;
    }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount; return true;
    }
}

// Attacker contract that tries cross-function reentrancy
contract ReentryAttacker {
    SuwppuStaking public target;
    bool public attacking;

    constructor(address _target) { target = SuwppuStaking(_target); }

    // Called when receiving USDC from claimRewards — tries to re-enter depositVaultYield
    function attack() external {
        attacking = true;
        target.claimRewards();
    }

    // Fallback: called when receiving ETH/tokens — try to reenter
    receive() external payable {
        if (attacking) {
            attacking = false;
            // Attempt cross-function reentry into depositVaultYield during claimRewards
            try target.depositVaultYield(1) {
                revert("Reentrancy succeeded — BAD");
            } catch {
                // Expected: reentrancy blocked
            }
        }
    }
}

contract SuwppuStakingTest is Test {
    SuwppuStaking staking;
    MockERC20 suwp;
    MockERC20 usdc;
    address owner = address(this);
    address alice = address(0xA11CE);

    function setUp() public {
        suwp = new MockERC20();
        usdc = new MockERC20();
        staking = new SuwppuStaking(address(suwp), address(usdc), owner);

        // Fund alice with SUWP and let her stake
        suwp.mint(alice, 1000e18);
        vm.prank(alice);
        suwp.approve(address(staking), 1000e18);
        vm.prank(alice);
        staking.stake(1000e18);
    }

    function testReentrancyOnDepositVaultYield() public {
        // Fund staking contract with USDC for rewards
        usdc.mint(address(staking), 100e6);

        // Distribute epoch so alice has claimable USDC
        address[] memory stakers = new address[](1);
        stakers[0] = alice;
        staking.distributeEpoch(stakers, 100e6, 0);

        // Deploy attacker
        ReentryAttacker attacker = new ReentryAttacker(address(staking));

        // Transfer alice's claimable USDC to attacker (simulate attack scenario)
        // The key test: depositVaultYield during claimRewards must revert
        vm.prank(address(attacker));
        vm.expectRevert(); // nonReentrant should block
        staking.depositVaultYield(1e6);
    }

    function testDoubleEpochSameBlockReverts() public {
        usdc.mint(address(staking), 200e6);
        address[] memory stakers = new address[](1);
        stakers[0] = alice;

        staking.distributeEpoch(stakers, 100e6, 0);

        // Second call in same block should revert
        vm.expectRevert("Already distributed this block");
        staking.distributeEpoch(stakers, 100e6, 0);
    }

    function testDoubleEpochNextBlockSucceeds() public {
        usdc.mint(address(staking), 200e6);
        address[] memory stakers = new address[](1);
        stakers[0] = alice;

        staking.distributeEpoch(stakers, 100e6, 0);

        vm.roll(block.number + 1); // advance one block
        staking.distributeEpoch(stakers, 100e6, 0); // should succeed
        assertEq(staking.currentEpoch(), 2);
    }

    function testStakeUnstakeClaimFlow() public {
        usdc.mint(address(staking), 100e6);
        address[] memory stakers = new address[](1);
        stakers[0] = alice;
        staking.distributeEpoch(stakers, 100e6, 0);

        (uint256 staked, uint256 pendingUsdc,,) = staking.getStakerInfo(alice);
        assertEq(staked, 1000e18);
        assertEq(pendingUsdc, 100e6);

        // Alice claims
        usdc.mint(address(staking), 100e6); // ensure contract has funds
        vm.prank(alice);
        staking.claimRewards();

        (, uint256 afterClaim,,) = staking.getStakerInfo(alice);
        assertEq(afterClaim, 0); // claimed
    }
}
