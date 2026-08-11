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

    // SUWP bonus allocated to stakers but not yet claimed (protected from recoverToken)
    uint256 public totalPendingBonuses;

    uint256 public constant MIN_STAKE = 1e9; // below this, _toUnits rounds to 0 units

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

        // USDC→USDCx approval is granted per-call in fundStream (no standing allowance)

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
        require(amount >= MIN_STAKE, "Below minimum stake");
        suwp.safeTransferFrom(msg.sender, address(this), amount);

        stakedBalance[msg.sender] += amount;
        totalStaked += amount;

        uint128 newUnits = _toUnits(stakedBalance[msg.sender]);
        require(pool.updateMemberUnits(msg.sender, newUnits), "Unit update failed");

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
        require(pool.updateMemberUnits(msg.sender, newUnits), "Unit update failed");

        suwp.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount, newUnits);
    }

    /**
     * @notice Recover ALL staked principal even if the Superfluid pool reverts
     *         (pool upgrade / pause / outage). Only callable while the contract is
     *         paused. The pool unit update is best-effort: if it fails, principal is
     *         still returned and units may be stale until the admin corrects them —
     *         principal recovery must never be blocked by an external dependency.
     */
    function emergencyUnstake() external nonReentrant whenPaused {
        uint256 amount = stakedBalance[msg.sender];
        require(amount > 0, "Nothing staked");

        stakedBalance[msg.sender] = 0;
        totalStaked -= amount;

        try pool.updateMemberUnits(msg.sender, 0) returns (bool) {} catch {}

        suwp.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount, 0);
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
        // NOTE: GDA distributeFlow sets an ABSOLUTE, continuous rate — it never
        // auto-stops when durationSeconds elapses, and a new call REPLACES the old
        // rate (flows don't stack). So we deliberately do NOT require the prior rate
        // to be zero; the new rate below streams from the contract's full USDCx
        // balance (residual from the prior epoch + the newly upgraded amount).

        lastEpochBlock = block.number;
        currentEpoch++;

        // Pull USDC from caller
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Wrap USDC → USDCx. upgrade() takes the 18-dec super-token amount and pulls
        // the equivalent 6-dec USDC. Approve exactly this amount (no standing allowance).
        uint256 usdcxAmount = usdcAmount * 1e12; // scale 6→18 decimals
        usdc.forceApprove(address(usdcx), usdcAmount);
        usdcx.upgrade(usdcxAmount);

        // Calculate flowRate (USDCx/sec, 18 dec) with explicit int96 bound check
        uint256 ratePerSec = usdcxAmount / durationSeconds;
        require(ratePerSec <= uint256(uint96(type(int96).max)), "Flow rate too large");
        int96 flowRate = int96(int256(ratePerSec));
        require(flowRate > 0, "Flow rate too small");

        // Set the pool flowRate via GDA
        require(
            gda.distributeFlow(usdcx, address(this), pool, flowRate, ""),
            "GDA distributeFlow failed"
        );

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
     * @notice Distribute weekly SUWP bonus. Amounts are pre-computed off-chain from
     *         an EPOCH-START snapshot of each staker's balance (see Python
     *         create_distribution_epoch). Passing explicit amounts — rather than
     *         reading live stakedBalance — prevents a flash-stake front-run from
     *         capturing a share they didn't hold during the epoch, and eliminates
     *         integer-division dust. SUWP must already be in this contract.
     */
    function distributeSuwpBonus(
        address[] calldata stakers,
        uint256[] calldata amounts
    ) external onlyOwner nonReentrant {
        require(stakers.length == amounts.length, "Length mismatch");
        require(stakers.length > 0 && stakers.length <= 500, "Bad stakers length");

        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }
        // Contract must hold staked principal + all pending bonuses + this batch.
        require(
            suwp.balanceOf(address(this)) >= totalStaked + totalPendingBonuses + total,
            "Insufficient SUWP to fund bonus"
        );

        epochs[currentEpoch].suwpBonusPool = total;
        for (uint256 i = 0; i < stakers.length; i++) {
            claimableSuwpBonus[stakers[i]] += amounts[i];
        }
        totalPendingBonuses += total;

        emit SuwpBonusDistributed(currentEpoch, total, totalStaked);
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
        totalPendingBonuses -= amount;
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
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
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
        // Never let the owner pull staked principal OR unclaimed bonus SUWP.
        require(
            token != address(suwp) ||
                amount <= IERC20(token).balanceOf(address(this)) - totalStaked - totalPendingBonuses,
            "Cannot recover staked/pending SUWP"
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
