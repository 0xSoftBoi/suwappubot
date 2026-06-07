// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

// ─── Minimal Superfluid interfaces ──────────────────────────────────────────

interface ISuperToken is IERC20 {
    function upgrade(uint256 amount) external;
    function downgrade(uint256 amount) external;
    function getUnderlyingToken() external view returns (address);
}

interface ISuperfluidPool {
    function updateMemberUnits(address member, uint128 newUnits) external returns (bool);
    function getMemberFlowRate(address member) external view returns (int96);
    function getClaimableNow(address member) external view returns (int256 claimableBalance, uint256 timestamp);
    function getTotalUnits() external view returns (uint128);
    function getMemberUnits(address member) external view returns (uint128);
}

/// GDAv1Forwarder — the public, ctx-free entrypoint to the General Distribution
/// Agreement. Deployed at the SAME deterministic address on every Superfluid
/// chain: 0x6DA13Bde224A05a288748d857b9e7DDEffd1dE08
interface IGDAv1Forwarder {
    struct PoolConfig {
        bool transferabilityForUnitsOwner;
        bool distributionFromAnyAddress;
    }

    function createPool(
        ISuperToken token,
        address admin,
        PoolConfig memory config
    ) external returns (bool success, ISuperfluidPool pool);

    function distributeFlow(
        ISuperToken token,
        address from,
        ISuperfluidPool pool,
        int96 requestedFlowRate,
        bytes memory userData
    ) external returns (bool success);

    function distribute(
        ISuperToken token,
        address from,
        ISuperfluidPool pool,
        uint256 requestedAmount,
        bytes memory userData
    ) external returns (bool success);

    function getFlowDistributionFlowRate(
        ISuperToken token,
        address from,
        ISuperfluidPool to
    ) external view returns (int96);
}

/**
 * @title SuwppuStaking v2 — Superfluid GDA streaming rewards
 * @dev Stake SUWP → earn:
 *   (1) USDCx streaming in real-time via Superfluid GDA pool (pro-rata by stake)
 *   (2) Bonus SUWP distributed weekly via claimableSuwpBonus (batch)
 *
 * Protocol calls fundStream(usdcAmount, durationSeconds) each epoch to set
 * the flowRate on the pool. Stakers see USDCx accruing per second.
 *
 * USDC/USDCx on Base:
 *   USDC:  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *   USDCx: 0xD04383398dD2426297da660F9CCA3d439AF9ce1b
 */
contract SuwppuStaking is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Tokens ───────────────────────────────────────────────────────────────

    IERC20 public immutable suwp;
    IERC20 public immutable usdc;          // plain USDC (for deposit)
    ISuperToken public immutable usdcx;    // USDCx Super Token (for streaming)

    // ─── Superfluid ───────────────────────────────────────────────────────────

    address public immutable host;          // Superfluid Host (stored for reference)
    IGDAv1Forwarder public immutable gda;   // GDAv1Forwarder (ctx-free entrypoint)
    ISuperfluidPool public immutable pool;  // created once in constructor

    // ─── Staking state ────────────────────────────────────────────────────────

    uint256 public totalStaked;
    mapping(address => uint256) public stakedBalance;

    // ─── SUWP bonus (batch, weekly) ───────────────────────────────────────────

    mapping(address => uint256) public claimableSuwpBonus;
    uint256 public currentEpoch;
    uint256 public lastEpochBlock;

    struct EpochInfo {
        uint256 totalStakedSnapshot;
        uint256 suwpBonusPool;
        uint256 usdcStreamed;      // total USDC funded into pool this epoch
        int96   flowRate;          // GDA flowRate set this epoch
        uint256 timestamp;
    }
    mapping(uint256 => EpochInfo) public epochs;

    // ─── Vault yield pool ─────────────────────────────────────────────────────

    uint256 public vaultYieldPool;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Staked(address indexed user, uint256 amount, uint128 newUnits);
    event Unstaked(address indexed user, uint256 amount, uint128 newUnits);
    event StreamFunded(uint256 indexed epoch, uint256 usdcAmount, int96 flowRate, uint256 durationSeconds);
    event SuwpBonusDistributed(uint256 indexed epoch, uint256 suwpBonus, uint256 totalStaked);
    event SuwpBonusClaimed(address indexed user, uint256 amount);
    event VaultYieldDeposited(uint256 amount, uint256 totalPool);

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param _suwp    SUWP token address
     * @param _usdc    Plain USDC address (Base: 0x833589...)
     * @param _usdcx   USDCx Super Token (Base: 0xD04383...)
     * @param _host    Superfluid Host (Base: 0x4C073B...)
     * @param _gda     GDA forwarder (Base: 0x6DA13B...)
     * @param _owner   Protocol multisig
     */
    constructor(
        address _suwp,
        address _usdc,
        address _usdcx,
        address _host,
        address _gda,
        address _owner
    ) Ownable(_owner) {
        suwp  = IERC20(_suwp);
        usdc  = IERC20(_usdc);
        usdcx = ISuperToken(_usdcx);
        host  = _host;
        gda   = IGDAv1Forwarder(_gda);

        // Pre-approve USDCx to wrap from USDC (max once)
        IERC20(_usdc).approve(_usdcx, type(uint256).max);

        // Create the GDA pool — admin is this contract
        IGDAv1Forwarder.PoolConfig memory cfg = IGDAv1Forwarder.PoolConfig({
            transferabilityForUnitsOwner: false,
            distributionFromAnyAddress: false
        });
        (, pool) = gda.createPool(ISuperToken(_usdcx), address(this), cfg);
    }

    // ─── Staking ──────────────────────────────────────────────────────────────

    /**
     * @notice Stake SUWP. Updates pool member units pro-rata.
     */
    function stake(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        suwp.safeTransferFrom(msg.sender, address(this), amount);

        stakedBalance[msg.sender] += amount;
        totalStaked += amount;

        uint128 newUnits = _toUnits(stakedBalance[msg.sender]);
        pool.updateMemberUnits(msg.sender, newUnits);

        emit Staked(msg.sender, amount, newUnits);
    }

    /**
     * @notice Unstake SUWP. Updates pool member units.
     */
    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(stakedBalance[msg.sender] >= amount, "Insufficient stake");

        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;

        uint128 newUnits = _toUnits(stakedBalance[msg.sender]);
        pool.updateMemberUnits(msg.sender, newUnits);

        suwp.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount, newUnits);
    }

    // ─── USDC Streaming (Superfluid GDA) ─────────────────────────────────────

    /**
     * @notice Fund the epoch's USDC stream. Wraps USDC → USDCx, sets flowRate on pool.
     *         Call once per epoch (weekly). USDC must be approved to this contract first.
     *
     * @param usdcAmount       Total USDC to stream this epoch (6 decimals)
     * @param durationSeconds  Stream duration (typically 7 days = 604800)
     */
    function fundStream(uint256 usdcAmount, uint256 durationSeconds)
        external
        onlyOwner
        nonReentrant
    {
        require(usdcAmount > 0, "Amount must be > 0");
        require(durationSeconds > 0, "Duration must be > 0");
        require(totalStaked > 0, "No stakers");
        require(block.number > lastEpochBlock, "Already funded this block");

        lastEpochBlock = block.number;
        currentEpoch++;

        // Pull USDC from caller
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Wrap USDC → USDCx. Superfluid upgrade() takes the 18-decimal super-token
        // amount and pulls the equivalent 6-decimal USDC via the constructor approval.
        uint256 usdcxAmount = usdcAmount * 1e12; // scale 6→18 decimals
        usdcx.upgrade(usdcxAmount);

        // Calculate flowRate: USDCx per second (18 decimals)
        int96 flowRate = int96(int256(usdcxAmount / durationSeconds));
        require(flowRate > 0, "Flow rate too small");

        // Set the pool flowRate via GDA — replaces any previous rate
        gda.distributeFlow(usdcx, address(this), pool, flowRate, "");

        epochs[currentEpoch] = EpochInfo({
            totalStakedSnapshot: totalStaked,
            suwpBonusPool: 0,
            usdcStreamed: usdcAmount,
            flowRate: flowRate,
            timestamp: block.timestamp
        });

        emit StreamFunded(currentEpoch, usdcAmount, flowRate, durationSeconds);
    }

    /**
     * @notice Distribute weekly SUWP bonus to stakers (batch, same as before).
     *         SUWP must already be in this contract.
     */
    function distributeSuwpBonus(
        address[] calldata stakers,
        uint256 suwpBonus
    ) external onlyOwner nonReentrant {
        require(stakers.length > 0, "Empty stakers list");
        require(totalStaked > 0, "No stakers");

        epochs[currentEpoch].suwpBonusPool = suwpBonus;

        for (uint256 i = 0; i < stakers.length; i++) {
            address staker = stakers[i];
            uint256 stake = stakedBalance[staker];
            if (stake == 0) continue;
            uint256 share = (suwpBonus * stake) / totalStaked;
            claimableSuwpBonus[staker] += share;
        }

        emit SuwpBonusDistributed(currentEpoch, suwpBonus, totalStaked);
    }

    // ─── Claiming ─────────────────────────────────────────────────────────────

    /**
     * @notice Claim pending SUWP bonus rewards.
     *         USDCx streams directly from pool — claim via Superfluid SDK / pool.claimAll().
     */
    function claimSuwpBonus() external nonReentrant {
        uint256 amount = claimableSuwpBonus[msg.sender];
        require(amount > 0, "No SUWP bonus to claim");
        claimableSuwpBonus[msg.sender] = 0;
        suwp.safeTransfer(msg.sender, amount);
        emit SuwpBonusClaimed(msg.sender, amount);
    }

    // ─── View ─────────────────────────────────────────────────────────────────

    /**
     * @notice Get staker info including real-time USDCx claimable from pool.
     */
    function getStakerInfo(address user) external view returns (
        uint256 staked,
        uint128 poolUnits,
        int256  claimableUsdcx,   // accrued USDCx (18 decimals) — claimable now
        int96   streamRatePerSec, // user's share of current flowRate
        uint256 pendingSuwpBonus,
        uint256 poolShareBps      // basis points (10000 = 100%)
    ) {
        staked = stakedBalance[user];
        poolUnits = pool.getMemberUnits(user);
        (claimableUsdcx,) = pool.getClaimableNow(user);
        streamRatePerSec = pool.getMemberFlowRate(user);
        pendingSuwpBonus = claimableSuwpBonus[user];
        poolShareBps = totalStaked > 0 ? (staked * 10000) / totalStaked : 0;
    }

    /**
     * @notice Current GDA flowRate from protocol to pool (USDCx/second, 18 decimals).
     */
    function getPoolFlowRate() external view returns (int96) {
        return gda.getFlowDistributionFlowRate(usdcx, address(this), pool);
    }

    // ─── Vault yield ──────────────────────────────────────────────────────────

    function depositVaultYield(uint256 usdcAmount) external onlyOwner nonReentrant {
        require(usdcAmount > 0, "Amount must be > 0");
        vaultYieldPool += usdcAmount;
        emit VaultYieldDeposited(usdcAmount, vaultYieldPool);
    }

    function getVaultYieldPool() external view returns (uint256) {
        return vaultYieldPool;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function recoverToken(address token, uint256 amount) external onlyOwner nonReentrant {
        require(
            token != address(suwp) || amount <= IERC20(token).balanceOf(address(this)) - totalStaked,
            "Cannot recover staked SUWP"
        );
        IERC20(token).safeTransfer(owner(), amount);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /**
     * @dev Convert SUWP stake (18 decimals) to pool units (uint128).
     *      Scale down by 1e9 to fit uint128 — supports up to ~340B SUWP staked.
     */
    function _toUnits(uint256 suwpAmount) internal pure returns (uint128) {
        return uint128(suwpAmount / 1e9);
    }
}
