// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title SuwppuStaking
 * @dev Stake SUWP, earn USDC (real yield from protocol fees) + bonus SUWP.
 *
 * Model:
 *   - Users stake SUWP; no lockup (can unstake any time).
 *   - Owner distributes rewards per epoch (weekly):
 *       distributeEpoch(usdcAmount, suwpBonusAmount)
 *   - Rewards accumulate as claimable balances; users pull them.
 *   - Reward per user = (userStake / totalStake) × epochRewards
 *
 * Deploy on Base. Accepts:
 *   - SUWP token (stake/unstake)
 *   - USDC on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 */
contract SuwppuStaking is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable suwp;
    IERC20 public immutable usdc;

    // Global staking state
    uint256 public totalStaked;

    // Per-user stake
    mapping(address => uint256) public stakedBalance;

    // Per-user claimable rewards (accumulated across epochs)
    mapping(address => uint256) public claimableUsdc;
    mapping(address => uint256) public claimableSuwpBonus;

    // Epoch tracking
    uint256 public currentEpoch;
    mapping(uint256 => EpochInfo) public epochs;

    struct EpochInfo {
        uint256 totalStakedSnapshot;
        uint256 usdcPool;
        uint256 suwpBonusPool;
        uint256 timestamp;
    }

    // Events
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 usdcAmount, uint256 suwpBonus);
    event EpochDistributed(uint256 indexed epoch, uint256 usdcPool, uint256 suwpBonus, uint256 totalStaked);

    constructor(address _suwp, address _usdc, address _owner) Ownable(_owner) {
        suwp = IERC20(_suwp);
        usdc = IERC20(_usdc);
    }

    // ─── Staking ──────────────────────────────────────────────────────────────

    function stake(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        suwp.safeTransferFrom(msg.sender, address(this), amount);
        stakedBalance[msg.sender] += amount;
        totalStaked += amount;
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(stakedBalance[msg.sender] >= amount, "Insufficient stake");
        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;
        suwp.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    // ─── Epoch Distribution ───────────────────────────────────────────────────

    /**
     * @notice Owner distributes a week's fee pool to all stakers.
     *         Call once per epoch after sending USDC + SUWP to this contract.
     *         Rewards are calculated pro-rata by stake at the time of distribution.
     *
     * @dev For gas efficiency with many stakers, rewards are stored as claimable
     *      balances rather than pushed. Alternatively, use a reward-per-token
     *      accumulator pattern (Synthetix style) for >10k stakers.
     *
     * @param stakers      Array of all staker addresses (fetch from DB)
     * @param usdcPool     Total USDC to distribute this epoch (already in contract)
     * @param suwpBonus    Total bonus SUWP to distribute (already in contract)
     */
    function distributeEpoch(
        address[] calldata stakers,
        uint256 usdcPool,
        uint256 suwpBonus
    ) external onlyOwner nonReentrant {
        require(totalStaked > 0, "No stakers");
        require(stakers.length > 0, "Empty stakers list");

        currentEpoch++;
        epochs[currentEpoch] = EpochInfo({
            totalStakedSnapshot: totalStaked,
            usdcPool: usdcPool,
            suwpBonusPool: suwpBonus,
            timestamp: block.timestamp
        });

        // Distribute pro-rata to each staker's claimable balance
        for (uint256 i = 0; i < stakers.length; i++) {
            address staker = stakers[i];
            uint256 stake = stakedBalance[staker];
            if (stake == 0) continue;

            uint256 usdcShare = (usdcPool * stake) / totalStaked;
            uint256 suwpShare = (suwpBonus * stake) / totalStaked;

            claimableUsdc[staker] += usdcShare;
            claimableSuwpBonus[staker] += suwpShare;
        }

        emit EpochDistributed(currentEpoch, usdcPool, suwpBonus, totalStaked);
    }

    // ─── Claiming ─────────────────────────────────────────────────────────────

    function claimRewards() external nonReentrant {
        uint256 usdcAmount = claimableUsdc[msg.sender];
        uint256 suwpAmount = claimableSuwpBonus[msg.sender];
        require(usdcAmount > 0 || suwpAmount > 0, "Nothing to claim");

        claimableUsdc[msg.sender] = 0;
        claimableSuwpBonus[msg.sender] = 0;

        if (usdcAmount > 0) usdc.safeTransfer(msg.sender, usdcAmount);
        if (suwpAmount > 0) suwp.safeTransfer(msg.sender, suwpAmount);

        emit RewardsClaimed(msg.sender, usdcAmount, suwpAmount);
    }

    // ─── View ─────────────────────────────────────────────────────────────────

    function getStakerInfo(address user) external view returns (
        uint256 staked,
        uint256 pendingUsdc,
        uint256 pendingSuwp,
        uint256 poolShareBps  // basis points (10000 = 100%)
    ) {
        staked = stakedBalance[user];
        pendingUsdc = claimableUsdc[user];
        pendingSuwp = claimableSuwpBonus[user];
        poolShareBps = totalStaked > 0 ? (staked * 10000) / totalStaked : 0;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    // Vault yield tracking
    uint256 public vaultYieldPool;

    event VaultYieldDeposited(uint256 amount, uint256 totalPool);

    /**
     * @notice Owner deposits Aave vault yield for stakers.
     *         Transfer USDC to this contract first, then call this function.
     *         Include vaultYieldPool in the next distributeEpoch's usdcPool param.
     */
    function depositVaultYield(uint256 usdcAmount) external onlyOwner {
        require(usdcAmount > 0, "Amount must be > 0");
        vaultYieldPool += usdcAmount;
        emit VaultYieldDeposited(usdcAmount, vaultYieldPool);
    }

    function getVaultYieldPool() external view returns (uint256) {
        return vaultYieldPool;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // Recover accidentally sent tokens (not SUWP staking principal)
    function recoverToken(address token, uint256 amount) external onlyOwner {
        require(token != address(suwp) || amount <= (IERC20(token).balanceOf(address(this)) - totalStaked),
            "Cannot recover staked SUWP");
        IERC20(token).safeTransfer(owner(), amount);
    }
}
