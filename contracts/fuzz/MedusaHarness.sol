// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SuwppuStaking } from "../SuwppuStaking.sol";

// ─── Minimal self-contained mocks ────────────────────────────────────────────

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        if (allowance[f][msg.sender] != type(uint256).max) allowance[f][msg.sender] -= a;
        balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

contract MockSuperToken is MockERC20 {
    MockERC20 public underlying;
    constructor(MockERC20 u) { underlying = u; }
    function upgrade(uint256 superAmount) external {
        underlying.transferFrom(msg.sender, address(this), superAmount / 1e12);
        balanceOf[msg.sender] += superAmount;
    }
}

contract MockPool {
    mapping(address => uint128) public u;
    function updateMemberUnits(address m, uint128 n) external returns (bool) { u[m] = n; return true; }
    function getMemberUnits(address m) external view returns (uint128) { return u[m]; }
    function getClaimableNow(address) external pure returns (int256, uint256) { return (0, 0); }
    function getMemberFlowRate(address) external pure returns (int96) { return 0; }
    function getTotalUnits() external pure returns (uint128) { return 0; }
}

// PoolConfig must match IGDAv1Forwarder.PoolConfig {bool,bool}
contract MockGDA {
    struct PoolConfig { bool a; bool b; }
    MockPool public pool;
    constructor() { pool = new MockPool(); }
    function createPool(address, address, PoolConfig memory) external view returns (bool, address) {
        return (true, address(pool));
    }
    function distributeFlow(address, address, address, int96, bytes memory) external pure returns (bool) {
        return true;
    }
    function getFlowDistributionFlowRate(address, address, address) external pure returns (int96) {
        return 0;
    }
}

/**
 * @title MedusaHarness — coverage-guided fuzz target for SuwppuStaking solvency.
 * @dev The harness IS the actor and the owner. Medusa calls the fuzz_* functions
 *      with random args and checks property_solvency after each. Invariant: the
 *      contract always holds >= staked principal + unclaimed bonuses, so every
 *      staker can be made whole. If recoverToken or distributeSuwpBonus could
 *      break that, the fuzzer will find a sequence that returns false here.
 */
contract MedusaHarness {
    SuwppuStaking public staking;
    MockERC20 public suwp;
    MockERC20 public usdc;
    MockSuperToken public usdcx;
    MockGDA public gda;

    constructor() {
        suwp = new MockERC20();
        usdc = new MockERC20();
        usdcx = new MockSuperToken(usdc);
        gda = new MockGDA();
        staking = new SuwppuStaking(
            address(suwp), address(usdc), address(usdcx),
            address(0x1), address(gda), address(this)
        );
        suwp.mint(address(this), 10_000_000e18);
        suwp.approve(address(staking), type(uint256).max);
    }

    function fuzz_stake(uint256 amount) external {
        amount = 1e9 + (amount % 100_000e18);
        suwp.mint(address(this), amount);
        try staking.stake(amount) {} catch {}
    }

    function fuzz_unstake(uint256 amount) external {
        uint256 bal = staking.stakedBalance(address(this));
        if (bal == 0) return;
        try staking.unstake(1 + (amount % bal)) {} catch {}
    }

    function fuzz_distributeBonus(uint256 amount) external {
        amount = amount % 50_000e18;
        suwp.mint(address(staking), amount); // fund the bonus pool
        address[] memory s = new address[](1);
        s[0] = address(this);
        uint256[] memory a = new uint256[](1);
        a[0] = amount;
        try staking.distributeSuwpBonus(s, a) {} catch {}
    }

    function fuzz_claimBonus() external {
        try staking.claimSuwpBonus() {} catch {}
    }

    function fuzz_recover(uint256 amount) external {
        try staking.recoverToken(address(suwp), amount % 20_000_000e18) {} catch {}
    }

    /// INVARIANT: contract stays solvent for principal + pending bonuses.
    function property_solvency() external view returns (bool) {
        return suwp.balanceOf(address(staking))
            >= staking.totalStaked() + staking.totalPendingBonuses();
    }
}
