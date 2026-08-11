// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { SuwppuStaking } from "../SuwppuStaking.sol";
import { SuwppuBonds } from "../SuwppuBonds.sol";
import { SUWP } from "../SUWP.sol";

// ─── Interfaces mirrored from contracts ─────────────────────────────────────

interface ISuperfluidPool {
    function updateMemberUnits(address member, uint128 newUnits) external returns (bool);
    function getMemberFlowRate(address member) external view returns (int96);
    function getClaimableNow(address member) external view returns (int256 claimableBalance, uint256 timestamp);
    function getTotalUnits() external view returns (uint128);
    function getMemberUnits(address member) external view returns (uint128);
}

interface ISuperToken {
    function upgrade(uint256 amount) external;
    function downgrade(uint256 amount) external;
    function getUnderlyingToken() external view returns (address);
    // ERC-20
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}

// ─── MockSuperfluidPool ──────────────────────────────────────────────────────

contract MockSuperfluidPool {
    mapping(address => uint128) private _units;
    bool public shouldRevertUpdate;

    function setShouldRevert(bool v) external { shouldRevertUpdate = v; }

    function updateMemberUnits(address member, uint128 newUnits) external returns (bool) {
        require(!shouldRevertUpdate, "MockPool: forced revert");
        _units[member] = newUnits;
        return true;
    }

    function getMemberUnits(address member) external view returns (uint128) {
        return _units[member];
    }

    function getMemberFlowRate(address) external pure returns (int96) { return 0; }

    function getClaimableNow(address) external view returns (int256, uint256) {
        return (0, block.timestamp);
    }

    function getTotalUnits() external pure returns (uint128) { return 0; }
}

// ─── MockGDAForwarder ────────────────────────────────────────────────────────

contract MockGDAForwarder {
    address public immutable poolAddress;
    int96 private _flowRate;

    constructor(address _pool) { poolAddress = _pool; }

    struct PoolConfig {
        bool transferabilityForUnitsOwner;
        bool distributionFromAnyAddress;
    }

    function createPool(address /*token*/, address /*admin*/, PoolConfig memory)
        external view returns (bool success, address pool)
    {
        return (true, poolAddress);
    }

    function distributeFlow(address, address, address, int96 flowRate, bytes memory)
        external returns (bool)
    {
        _flowRate = flowRate;
        return true;
    }

    function distribute(address, address, address, uint256, bytes memory)
        external pure returns (bool) { return true; }

    function getFlowDistributionFlowRate(address, address, address)
        external view returns (int96) { return _flowRate; }
}

// ─── MockSuperToken (USDCx) ──────────────────────────────────────────────────
// upgrade(amount) pulls underlying via transferFrom.
// underlying is a separate MockERC20 supplied in constructor.

contract MockSuperToken {
    address public underlying;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(address _underlying) { underlying = _underlying; }

    // ERC-20
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    // ISuperToken
    // upgrade(superAmount) pulls superAmount/1e12 of underlying (6-dec) from msg.sender
    function upgrade(uint256 superAmount) external {
        uint256 underlyingAmount = superAmount / 1e12;
        // pull underlying from caller — caller must have approved this contract
        MockERC20Like(underlying).transferFrom(msg.sender, address(this), underlyingAmount);
        balanceOf[msg.sender] += superAmount;
    }

    function downgrade(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
    }

    function getUnderlyingToken() external view returns (address) { return underlying; }
}

// small helper interface used above
interface MockERC20Like {
    function transferFrom(address, address, uint256) external returns (bool);
}

// ─── MockERC20 ───────────────────────────────────────────────────────────────

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _sym, uint8 _dec) {
        name = _name; symbol = _sym; decimals = _dec;
    }

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    // OZ SafeERC20 / forceApprove compatibility — same as approve
    // (forceApprove first sets to 0, then sets to amount; both are separate calls)
}

// ─── MockPositionManager ─────────────────────────────────────────────────────

struct PositionData {
    uint96 nonce;
    address operator;
    address token0;
    address token1;
    uint24 fee;
    int24 tickLower;
    int24 tickUpper;
    uint128 liquidity;
    uint256 feeGrowthInside0LastX128;
    uint256 feeGrowthInside1LastX128;
    uint128 tokensOwed0;
    uint128 tokensOwed1;
}

contract MockPositionManager {
    mapping(uint256 => PositionData) private _positions;
    mapping(uint256 => address) private _owners;
    uint256 public nextTokenId = 1;

    function setPosition(uint256 tokenId, PositionData memory p) external {
        _positions[tokenId] = p;
    }

    function setOwner(uint256 tokenId, address owner_) external {
        _owners[tokenId] = owner_;
    }

    function mintPosition(address to, PositionData memory p) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _positions[tokenId] = p;
        _owners[tokenId] = to;
    }

    function positions(uint256 tokenId) external view returns (
        uint96 nonce, address operator, address token0, address token1,
        uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity,
        uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0, uint128 tokensOwed1
    ) {
        PositionData memory p = _positions[tokenId];
        return (p.nonce, p.operator, p.token0, p.token1, p.fee,
                p.tickLower, p.tickUpper, p.liquidity,
                p.feeGrowthInside0LastX128, p.feeGrowthInside1LastX128,
                p.tokensOwed0, p.tokensOwed1);
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return _owners[tokenId];
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        require(_owners[tokenId] == from, "MockPM: wrong owner");
        _owners[tokenId] = to;
        // notify receiver if it's a contract
        if (to.code.length > 0) {
            bytes4 retval = IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, "");
            require(retval == IERC721Receiver.onERC721Received.selector, "MockPM: bad receiver");
        }
    }
}

interface IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4);
}

// ─── MockUniV3Factory ────────────────────────────────────────────────────────

contract MockUniV3Factory {
    // token0 => token1 => fee => pool
    mapping(address => mapping(address => mapping(uint24 => address))) private _pools;

    function setPool(address t0, address t1, uint24 fee, address pool) external {
        _pools[t0][t1][fee] = pool;
        _pools[t1][t0][fee] = pool; // symmetric
    }

    function getPool(address t0, address t1, uint24 fee) external view returns (address) {
        return _pools[t0][t1][fee];
    }
}

// ─── MockUniV3Pool ────────────────────────────────────────────────────────────
// Returns settable tickCumulatives so OracleLibrary.consult works correctly.

contract MockUniV3Pool {
    address public token0;
    address public token1;

    // We store [secondsAgo, 0] tick cumulatives. To get mean tick T over W seconds:
    //   tickCumulatives[1] - tickCumulatives[0]  = T * W
    // So set tickCumulative0 = -T*W, tickCumulative1 = 0  →  delta = T*W.
    int56 public tickCumulative0;
    int56 public tickCumulative1;

    constructor(address _t0, address _t1) { token0 = _t0; token1 = _t1; }

    function setTickCumulatives(int56 c0, int56 c1) external {
        tickCumulative0 = c0;
        tickCumulative1 = c1;
    }

    function observe(uint32[] calldata)
        external view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        tickCumulatives = new int56[](2);
        tickCumulatives[0] = tickCumulative0;
        tickCumulatives[1] = tickCumulative1;
        secondsPerLiquidityCumulativeX128s = new uint160[](2);
    }

    function slot0() external pure returns (
        uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool
    ) {
        return (79228162514264337593543950336, 0, 0, 1, 1, 0, true); // tick=0
    }
}

// ════════════════════════════════════════════════════════════════════════════
//  STAKING TESTS
// ════════════════════════════════════════════════════════════════════════════

contract StakingAuditTest is Test {
    SuwppuStaking staking;
    SUWP suwp;
    MockERC20 usdc;
    MockSuperToken usdcx;
    MockGDAForwarder gda;
    MockSuperfluidPool mockPool;

    address owner = address(this);
    address alice = address(0xA11CE);
    address bob   = address(0xB0B);

    function setUp() public {
        suwp = new SUWP(owner);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        mockPool = new MockSuperfluidPool();
        gda = new MockGDAForwarder(address(mockPool));
        usdcx = new MockSuperToken(address(usdc));

        staking = new SuwppuStaking(
            address(suwp),
            address(usdc),
            address(usdcx),
            address(1), // host (unused in tests)
            address(gda),
            owner
        );

        // Grant staking contract MINTER_ROLE so it can transfer-mint SUWP bonuses
        // (staking doesn't mint, it just holds; we fund it directly)
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    /// Give `user` some SUWP and approve staking.
    function _fundAndApprove(address user, uint256 amount) internal {
        suwp.mint(user, amount, "test");
        vm.prank(user);
        suwp.approve(address(staking), amount);
    }

    /// Fund staking with extra SUWP (for bonus coverage). Mints to staking directly.
    function _fundStakingBonus(uint256 amount) internal {
        suwp.mint(address(staking), amount, "test");
    }

    /// Fund the owner with USDC and approve staking for fundStream.
    function _fundOwnerUsdc(uint256 amount) internal {
        usdc.mint(owner, amount);
        usdc.approve(address(staking), amount);
    }

    // ─── Case 1: MIN_STAKE ──────────────────────────────────────────────

    function test_stake_belowMin_reverts() public {
        _fundAndApprove(alice, 1e9 - 1);
        vm.prank(alice);
        vm.expectRevert("Below minimum stake");
        staking.stake(1e9 - 1);
    }

    function test_stake_atMin_succeeds_and_sets_units() public {
        uint256 stakeAmt = 1e9;
        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);

        assertEq(staking.stakedBalance(alice), stakeAmt);
        assertEq(staking.totalStaked(), stakeAmt);
        // pool units = stakeAmt / 1e9 = 1
        assertEq(mockPool.getMemberUnits(alice), 1);
    }

    function test_stake_aboveMin_units_proRata() public {
        uint256 stakeAmt = 5_000e18;
        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);

        uint128 expectedUnits = uint128(stakeAmt / 1e9);
        assertEq(mockPool.getMemberUnits(alice), expectedUnits);
    }

    // ─── Case 2: unstake ──────────────────────────────────────────────

    function test_unstake_returns_principal_and_updates_units() public {
        uint256 stakeAmt = 2000e18;
        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);

        uint256 balBefore = suwp.balanceOf(alice);
        vm.prank(alice);
        staking.unstake(stakeAmt);

        assertEq(suwp.balanceOf(alice), balBefore + stakeAmt);
        assertEq(staking.stakedBalance(alice), 0);
        assertEq(staking.totalStaked(), 0);
        assertEq(mockPool.getMemberUnits(alice), 0);
    }

    function test_unstake_moreThanStaked_reverts() public {
        uint256 stakeAmt = 1000e18;
        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);

        vm.prank(alice);
        vm.expectRevert("Insufficient stake");
        staking.unstake(stakeAmt + 1);
    }

    // ─── Case 3: emergencyUnstake ─────────────────────────────────────

    function test_emergencyUnstake_reverts_whenNotPaused() public {
        uint256 stakeAmt = 1000e18;
        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);

        vm.prank(alice);
        vm.expectRevert(); // whenPaused modifier
        staking.emergencyUnstake();
    }

    function test_emergencyUnstake_whenPaused_returns_principal_evenIfPoolReverts() public {
        uint256 stakeAmt = 1000e18;
        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);

        // Pause the contract
        staking.pause();

        // Force pool to revert on updateMemberUnits
        mockPool.setShouldRevert(true);

        uint256 balBefore = suwp.balanceOf(alice);

        // Must succeed despite pool revert (try/catch in contract)
        vm.prank(alice);
        staking.emergencyUnstake();

        assertEq(suwp.balanceOf(alice), balBefore + stakeAmt);
        assertEq(staking.stakedBalance(alice), 0);
    }

    // ─── Case 4: recoverToken ─────────────────────────────────────────

    function test_recoverToken_cannotRecover_belowTotalStakedPlusPending() public {
        uint256 stakeAmt = 1000e18;
        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);

        // Staking holds exactly stakeAmt SUWP. pending=0.
        // Attempting to recover 1 wei should revert (balance - totalStaked - pending = 0, need amount <= 0).
        vm.expectRevert("Cannot recover staked/pending SUWP");
        staking.recoverToken(address(suwp), 1);
    }

    function test_recoverToken_canRecover_excess() public {
        uint256 stakeAmt = 1000e18;
        uint256 excess   = 500e18;
        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);

        // Send extra SUWP to staking directly
        _fundStakingBonus(excess);

        uint256 ownerBalBefore = suwp.balanceOf(owner);
        staking.recoverToken(address(suwp), excess);
        assertEq(suwp.balanceOf(owner), ownerBalBefore + excess);
    }

    function test_recoverToken_otherTokens_alwaysAllowed() public {
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        other.mint(address(staking), 100e18);

        uint256 ownerBalBefore = other.balanceOf(owner);
        staking.recoverToken(address(other), 100e18);
        assertEq(other.balanceOf(owner), ownerBalBefore + 100e18);
    }

    // ─── Case 5: distributeSuwpBonus ─────────────────────────────────

    function test_distributeSuwpBonus_lengthMismatch_reverts() public {
        address[] memory stakers = new address[](2);
        uint256[] memory amounts = new uint256[](1);
        stakers[0] = alice; stakers[1] = bob;
        amounts[0] = 100e18;

        vm.expectRevert("Length mismatch");
        staking.distributeSuwpBonus(stakers, amounts);
    }

    function test_distributeSuwpBonus_insufficientBalance_reverts() public {
        uint256 stakeAmt = 1000e18;
        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);

        // Contract holds stakeAmt SUWP. Trying to distribute 1 more than zero bonus
        // requires: balance >= totalStaked + pending + bonus
        //   i.e. stakeAmt >= stakeAmt + 0 + bonusAmt  →  fails if bonusAmt > 0
        address[] memory stakers = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        stakers[0] = alice;
        amounts[0] = 1e18; // any positive amount fails

        vm.expectRevert("Insufficient SUWP to fund bonus");
        staking.distributeSuwpBonus(stakers, amounts);
    }

    function test_distributeSuwpBonus_success_increments_claimable_and_pending() public {
        uint256 stakeAmt = 1000e18;
        uint256 bonus    = 50e18;
        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);

        // Fund staking with enough for bonuses
        _fundStakingBonus(bonus + 100e18); // a little extra

        address[] memory stakers = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        stakers[0] = alice; stakers[1] = bob;
        amounts[0] = bonus; amounts[1] = 0; // bob gets 0

        uint256 pendingBefore = staking.totalPendingBonuses();
        staking.distributeSuwpBonus(stakers, amounts);

        assertEq(staking.claimableSuwpBonus(alice), bonus);
        assertEq(staking.totalPendingBonuses(), pendingBefore + bonus);
    }

    // ─── Case 6: claimSuwpBonus ───────────────────────────────────────

    function test_claimSuwpBonus_transfers_and_decrements_pending() public {
        uint256 stakeAmt = 1000e18;
        uint256 bonus    = 50e18;
        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);
        _fundStakingBonus(bonus + 100e18);

        address[] memory stakers = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        stakers[0] = alice; amounts[0] = bonus;
        staking.distributeSuwpBonus(stakers, amounts);

        uint256 aliceBalBefore = suwp.balanceOf(alice);
        uint256 pendingBefore  = staking.totalPendingBonuses();

        vm.prank(alice);
        staking.claimSuwpBonus();

        assertEq(suwp.balanceOf(alice), aliceBalBefore + bonus);
        assertEq(staking.claimableSuwpBonus(alice), 0);
        assertEq(staking.totalPendingBonuses(), pendingBefore - bonus);
    }

    function test_claimSuwpBonus_doubleClaim_reverts() public {
        uint256 stakeAmt = 1000e18;
        uint256 bonus    = 50e18;
        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);
        _fundStakingBonus(bonus + 100e18);

        address[] memory stakers = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        stakers[0] = alice; amounts[0] = bonus;
        staking.distributeSuwpBonus(stakers, amounts);

        vm.prank(alice);
        staking.claimSuwpBonus();

        vm.prank(alice);
        vm.expectRevert("No SUWP bonus to claim");
        staking.claimSuwpBonus();
    }

    // ─── Case 7: fundStream epoch progression (brick-fix regression) ───

    function test_fundStream_epoch_progression() public {
        // We need at least one staker
        uint256 stakeAmt = 1000e18;
        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);

        uint256 usdcAmt = 1000e6; // 1000 USDC
        uint256 duration = 7 days;

        // Fund epoch 1
        _fundOwnerUsdc(usdcAmt);
        staking.fundStream(usdcAmt, duration);
        assertEq(staking.currentEpoch(), 1);
        assertEq(staking.lastEpochBlock(), block.number);

        // Advance a block
        vm.roll(block.number + 1);

        // Fund epoch 2 — must succeed (this is the brick-fix regression)
        _fundOwnerUsdc(usdcAmt);
        staking.fundStream(usdcAmt, duration);
        assertEq(staking.currentEpoch(), 2);
    }

    // ─── Case 8: fundStream same block reverts ────────────────────────

    function test_fundStream_sameBlock_reverts() public {
        uint256 stakeAmt = 1000e18;
        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);

        uint256 usdcAmt = 1000e6;
        uint256 duration = 7 days;

        _fundOwnerUsdc(usdcAmt * 2);

        staking.fundStream(usdcAmt, duration);

        // Same block — must revert
        vm.expectRevert("Already funded this block");
        staking.fundStream(usdcAmt, duration);
    }

    // ─── Case 9: fundStream int96 overflow ───────────────────────────
    // To overflow int96 we need ratePerSec > type(uint96).max.
    // ratePerSec = usdcxAmount / duration = (usdcAmt * 1e12) / duration
    // With duration = 1 second, we need usdcAmt * 1e12 > 2^95 - 1 ≈ 3.96e28
    // So usdcAmt > 3.96e16 (i.e. ~40B USDC in 6-dec units).
    // The owner must have & have approved that much USDC.

    function test_fundStream_int96Overflow_reverts() public {
        uint256 stakeAmt = 1000e18;
        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);

        // Amount that overflows int96 when duration=1
        // type(int96).max = 2^95 - 1 = 39614081257132168796771975167
        // ratePerSec = usdcAmt * 1e12 / 1 = usdcAmt * 1e12
        // We need usdcAmt * 1e12 > uint256(uint96(type(int96).max))
        // uint96(type(int96).max) = 2^95 - 1 (fits in uint96)
        // So usdcAmt > (2^95 - 1) / 1e12 ≈ 3.96e16
        uint256 hugUsdcAmt = uint256(uint96(type(int96).max)) / 1e12 + 2; // just over the limit
        uint256 duration = 1; // 1 second → ratePerSec = hugUsdcAmt * 1e12 (overflows)

        usdc.mint(owner, hugUsdcAmt);
        usdc.approve(address(staking), hugUsdcAmt);

        vm.expectRevert("Flow rate too large");
        staking.fundStream(hugUsdcAmt, duration);
    }
}

// ════════════════════════════════════════════════════════════════════════════
//  BONDS TESTS
// ════════════════════════════════════════════════════════════════════════════

contract BondsAuditTest is Test {
    SuwppuBonds bonds;
    SUWP suwp;
    MockERC20 usdc;
    MockPositionManager pm;
    MockUniV3Factory factory;
    MockUniV3Pool pool;

    address owner = address(this);
    address alice = address(0xA11CE);
    address bob   = address(0xB0B);

    // We use a fixed fee tier for all positions
    uint24 constant FEE = 3000;

    function setUp() public {
        suwp    = new SUWP(owner);
        usdc    = new MockERC20("USD Coin", "USDC", 6);
        pm      = new MockPositionManager();
        factory = new MockUniV3Factory();

        // Deploy pool with SUWP as token0, USDC as token1
        // (address ordering: if address(suwp) < address(usdc) suwp is token0)
        address suwpAddr = address(suwp);
        address usdcAddr = address(usdc);
        address t0 = suwpAddr < usdcAddr ? suwpAddr : usdcAddr;
        address t1 = suwpAddr < usdcAddr ? usdcAddr : suwpAddr;

        pool = new MockUniV3Pool(t0, t1);

        // Set TWAP: both tick cumulatives = 0 → mean tick = 0
        pool.setTickCumulatives(0, 0);

        factory.setPool(t0, t1, FEE, address(pool));

        bonds = new SuwppuBonds(
            address(suwp),
            address(usdc),
            address(pm),
            address(factory),
            owner
        );

        // Set SUWP/USDC pool (passes token0/token1 check since pool.token0/token1 are set)
        bonds.setSuwpUsdcPool(address(pool));

        // Grant bonds contract MINTER_ROLE so it can mint SUWP on redeem
        suwp.grantRole(suwp.MINTER_ROLE(), address(bonds));

        // Unpause SUWP (it's not paused, but just be safe)
    }

    // ─── Helper: mint a valid LP position NFT to `to` ─────────────────

    function _mintValidLP(address to, uint128 liquidity) internal returns (uint256 tokenId) {
        address suwpAddr = address(suwp);
        address usdcAddr = address(usdc);
        address t0 = suwpAddr < usdcAddr ? suwpAddr : usdcAddr;
        address t1 = suwpAddr < usdcAddr ? usdcAddr : suwpAddr;

        PositionData memory p = PositionData({
            nonce: 0,
            operator: address(0),
            token0: t0,
            token1: t1,
            fee: FEE,
            tickLower: -60,  // valid ticks around tick=0
            tickUpper: 60,
            liquidity: liquidity,
            feeGrowthInside0LastX128: 0,
            feeGrowthInside1LastX128: 0,
            tokensOwed0: 0,
            tokensOwed1: 0
        });

        tokenId = pm.mintPosition(to, p);

        // Approve bonds contract to take the NFT
        // (MockPositionManager's safeTransferFrom checks owner, not approval,
        //  but we prank as `to` when calling bond())
    }

    // ─── Case 10: cancelBond ──────────────────────────────────────────

    function test_cancelBond_ownerCancels_returnsNFT_marksInactive() public {
        uint256 tokenId = _mintValidLP(alice, 1e6);

        vm.prank(alice);
        uint256 bondId = bonds.bond(tokenId);

        // Contract now owns the NFT
        assertEq(pm.ownerOf(tokenId), address(bonds));

        // Owner cancels
        bonds.cancelBond(bondId);

        // NFT returned to alice
        assertEq(pm.ownerOf(tokenId), alice);

        // Bond is inactive
        (, , , , , , bool active) = bonds.bonds(bondId);
        assertFalse(active);
    }

    function test_cancelBond_nonOwner_reverts() public {
        uint256 tokenId = _mintValidLP(alice, 1e6);
        vm.prank(alice);
        uint256 bondId = bonds.bond(tokenId);

        vm.prank(alice);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        bonds.cancelBond(bondId);
    }

    function test_cancelBond_inactiveBond_reverts() public {
        uint256 tokenId = _mintValidLP(alice, 1e6);
        vm.prank(alice);
        uint256 bondId = bonds.bond(tokenId);

        bonds.cancelBond(bondId);

        // Attempt to cancel again
        vm.expectRevert("Bond not active");
        bonds.cancelBond(bondId);
    }

    // ─── Case 11: vesting linear schedule ─────────────────────────────

    function test_redeem_linearVest_halfwayGivesHalf() public {
        uint256 tokenId = _mintValidLP(alice, 1e6);
        vm.prank(alice);
        uint256 bondId = bonds.bond(tokenId);

        (, , uint256 suwpTotal, , uint256 startTime, uint256 endTime, ) = bonds.bonds(bondId);
        assertTrue(suwpTotal > 0, "payout must be nonzero");

        // Warp to 50% vesting
        uint256 half = startTime + (endTime - startTime) / 2;
        vm.warp(half);

        uint256 claimable_ = bonds.claimable(bondId);
        // Should be ~half ± dust
        assertApproxEqRel(claimable_, suwpTotal / 2, 0.01e18); // within 1%

        vm.prank(alice);
        uint256 claimed = bonds.redeem(bondId);
        assertEq(claimed, claimable_);
        assertEq(suwp.balanceOf(alice), claimed);
    }

    function test_redeem_fullVest_claimsAll_marksInactive() public {
        uint256 tokenId = _mintValidLP(alice, 1e6);
        vm.prank(alice);
        uint256 bondId = bonds.bond(tokenId);

        (, , uint256 suwpTotal, , , uint256 endTime, ) = bonds.bonds(bondId);

        // Warp past vesting end
        vm.warp(endTime + 1);

        vm.prank(alice);
        bonds.redeem(bondId);

        assertEq(suwp.balanceOf(alice), suwpTotal);

        // Bond must be marked inactive after full claim
        (, , , , , , bool active) = bonds.bonds(bondId);
        assertFalse(active);
    }

    // ─── Case 12: bond caps ────────────────────────────────────────────

    function test_bond_exceedsPerBondCap_reverts() public {
        // First, find the real payout by preview
        uint256 tokenId = _mintValidLP(alice, 1e6);
        uint256 payout = bonds.previewBond(tokenId);
        assertTrue(payout > 0, "payout must be nonzero for cap test");

        // Set per-bond cap just below payout
        bonds.setBondCaps(payout - 1, type(uint256).max);

        uint256 tokenId2 = _mintValidLP(alice, 1e6); // fresh NFT
        vm.prank(alice);
        vm.expectRevert("Exceeds per-bond cap");
        bonds.bond(tokenId2);
    }

    function test_bond_exceedsGlobalCap_reverts() public {
        uint256 tokenId = _mintValidLP(alice, 1e6);
        uint256 payout = bonds.previewBond(tokenId);
        assertTrue(payout > 0);

        // Set global cap just below payout
        bonds.setBondCaps(type(uint256).max, payout - 1);

        uint256 tokenId2 = _mintValidLP(alice, 1e6);
        vm.prank(alice);
        vm.expectRevert("Exceeds global bond cap");
        bonds.bond(tokenId2);
    }

    // ─── Case 13: bond with wrong pool reverts ─────────────────────────

    function test_bond_wrongPool_reverts() public {
        // Deploy a second pool with the same tokens/fee but not the canonical suwpUsdcPool
        address suwpAddr = address(suwp);
        address usdcAddr = address(usdc);
        address t0 = suwpAddr < usdcAddr ? suwpAddr : usdcAddr;
        address t1 = suwpAddr < usdcAddr ? usdcAddr : suwpAddr;

        MockUniV3Pool pool2 = new MockUniV3Pool(t0, t1);

        // Use a different fee so factory returns pool2
        uint24 wrongFee = 10000;
        factory.setPool(t0, t1, wrongFee, address(pool2));

        // Mint LP with wrong fee → factory returns pool2, not suwpUsdcPool
        PositionData memory p = PositionData({
            nonce: 0, operator: address(0),
            token0: t0, token1: t1,
            fee: wrongFee,
            tickLower: -60, tickUpper: 60,
            liquidity: 1e6,
            feeGrowthInside0LastX128: 0,
            feeGrowthInside1LastX128: 0,
            tokensOwed0: 0, tokensOwed1: 0
        });
        uint256 tokenId = pm.mintPosition(alice, p);

        vm.prank(alice);
        vm.expectRevert("Wrong pool");
        bonds.bond(tokenId);
    }

    // ─── Case 14: double-bond same NFT reverts ─────────────────────────

    function test_bond_doubleUse_sameNFT_reverts() public {
        uint256 tokenId = _mintValidLP(alice, 1e6);

        vm.prank(alice);
        bonds.bond(tokenId); // contract now owns NFT

        // Alice tries to bond the same token again
        // ownerOf(tokenId) == bonds contract ≠ alice → "Not NFT owner"
        vm.prank(alice);
        vm.expectRevert("Not NFT owner");
        bonds.bond(tokenId);
    }
}

// ════════════════════════════════════════════════════════════════════════════
//  SUWP TOKEN TESTS
// ════════════════════════════════════════════════════════════════════════════

contract SuwpTokenAuditTest is Test {
    SUWP suwp;

    address admin = address(this);
    address minter = address(0xC0FFEE);
    address rando  = address(0xDEAD);

    function setUp() public {
        suwp = new SUWP(admin);
        // Grant minter role to a separate address for role tests
        suwp.grantRole(suwp.MINTER_ROLE(), minter);
    }

    // ─── Case 15: mint / batchMint require MINTER_ROLE ────────────────

    function test_mint_withMinterRole_succeeds() public {
        vm.prank(minter);
        suwp.mint(rando, 100e18, "test");
        assertEq(suwp.balanceOf(rando), 100e18);
    }

    function test_mint_withoutMinterRole_reverts() public {
        vm.prank(rando);
        vm.expectRevert(); // AccessControlUnauthorizedAccount
        suwp.mint(rando, 100e18, "test");
    }

    function test_batchMint_withMinterRole_succeeds() public {
        address[] memory recipients = new address[](3);
        uint256[] memory amounts = new uint256[](3);
        recipients[0] = address(0x1);
        recipients[1] = address(0x2);
        recipients[2] = address(0x3);
        amounts[0] = 10e18;
        amounts[1] = 20e18;
        amounts[2] = 30e18;

        vm.prank(minter);
        suwp.batchMint(recipients, amounts, "test");

        assertEq(suwp.balanceOf(address(0x1)), 10e18);
        assertEq(suwp.balanceOf(address(0x2)), 20e18);
        assertEq(suwp.balanceOf(address(0x3)), 30e18);
    }

    function test_batchMint_withoutMinterRole_reverts() public {
        address[] memory recipients = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        recipients[0] = rando;
        amounts[0] = 1e18;

        vm.prank(rando);
        vm.expectRevert(); // AccessControlUnauthorizedAccount
        suwp.batchMint(recipients, amounts, "test");
    }

    // ─── Case 16: batchMint length/size checks ────────────────────────

    function test_batchMint_over500Recipients_reverts() public {
        address[] memory recipients = new address[](501);
        uint256[] memory amounts = new uint256[](501);
        for (uint256 i = 0; i < 501; i++) {
            recipients[i] = address(uint160(i + 1));
            amounts[i] = 1e18;
        }

        vm.prank(minter);
        vm.expectRevert("Batch too large");
        suwp.batchMint(recipients, amounts, "test");
    }

    function test_batchMint_exactly500Recipients_succeeds() public {
        address[] memory recipients = new address[](500);
        uint256[] memory amounts = new uint256[](500);
        for (uint256 i = 0; i < 500; i++) {
            recipients[i] = address(uint160(i + 1));
            amounts[i] = 1e18;
        }

        vm.prank(minter);
        suwp.batchMint(recipients, amounts, "test"); // must not revert
    }

    function test_batchMint_lengthMismatch_reverts() public {
        address[] memory recipients = new address[](2);
        uint256[] memory amounts = new uint256[](3);
        recipients[0] = address(0x1);
        recipients[1] = address(0x2);
        amounts[0] = 1e18;
        amounts[1] = 2e18;
        amounts[2] = 3e18;

        vm.prank(minter);
        vm.expectRevert("Length mismatch");
        suwp.batchMint(recipients, amounts, "test");
    }
}
