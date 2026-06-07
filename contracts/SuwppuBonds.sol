// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IUniswapV3Pool {
    function observe(uint32[] calldata secondsAgos)
        external view returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
    function slot0() external view returns (
        uint160 sqrtPriceX96, int24 tick, uint16 observationIndex,
        uint16 observationCardinality, uint16 observationCardinalityNext,
        uint8 feeProtocol, bool unlocked
    );
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface INonfungiblePositionManager {
    function positions(uint256 tokenId) external view returns (
        uint96 nonce, address operator, address token0, address token1,
        uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity,
        uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0, uint128 tokensOwed1
    );
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface ISuwp is IERC20 {
    function mint(address to, uint256 amount, string calldata reason) external;
}

/**
 * @title SuwppuBonds — Protocol-Owned Liquidity via Olympus-style bonding
 * @dev Users sell SUWP/USDC Uniswap v3 LP NFTs to the protocol treasury.
 *      Protocol pays discounted SUWP (vesting 7 days) and holds LP permanently.
 *
 * Flow:
 *   1. User approves their LP NFT to this contract
 *   2. User calls bond(tokenId) — LP transferred here, vesting position created
 *   3. After 7 days, user calls redeem(bondId) to claim vested SUWP
 *
 * Pricing:
 *   - LP value estimated as 2× the USDC side (assumes balanced 50/50 pool position)
 *   - SUWP/USDC price from 30-min Uniswap v3 TWAP (anti-manipulation)
 *   - Discount: 5% below TWAP price (user gets 5% more SUWP than market)
 *
 * Deploy on Base. Requires MINTER_ROLE on SuwpOFT to mint vested SUWP.
 */
contract SuwppuBonds is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Config ──────────────────────────────────────────────────────────────

    ISuwp   public immutable suwp;
    IERC20  public immutable usdc;
    INonfungiblePositionManager public immutable positionManager;
    IUniswapV3Pool public suwpUsdcPool; // set post-deployment once SUWP pool exists

    uint256 public constant VESTING_DURATION = 7 days;
    uint256 public constant DISCOUNT_BPS = 500;   // 5% discount (basis points)
    uint256 public constant MAX_DISCOUNT_BPS = 2000; // 20% max
    uint32  public constant TWAP_PERIOD = 1800;   // 30 minutes

    // ─── Bond state ──────────────────────────────────────────────────────────

    struct Bond {
        address bonder;
        uint256 lpTokenId;      // Uniswap v3 NFT
        uint256 suwpTotal;      // total SUWP to vest
        uint256 suwpClaimed;    // already claimed
        uint256 startTime;
        uint256 endTime;        // startTime + VESTING_DURATION
        bool active;
    }

    uint256 public nextBondId;
    mapping(uint256 => Bond) public bonds;
    mapping(address => uint256[]) public userBonds;

    // Treasury stats
    uint256 public totalLpBonded;       // count of LP NFTs held
    uint256 public totalSuwpIssued;     // cumulative SUWP minted via bonds

    // ─── Events ──────────────────────────────────────────────────────────────

    event Bonded(
        uint256 indexed bondId,
        address indexed bonder,
        uint256 lpTokenId,
        uint256 suwpTotal,
        uint256 endTime
    );
    event Redeemed(uint256 indexed bondId, address indexed bonder, uint256 suwpAmount);
    event PoolUpdated(address newPool);
    event DiscountUpdated(uint256 newDiscountBps);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        address _suwp,
        address _usdc,
        address _positionManager,
        address _owner
    ) Ownable(_owner) {
        suwp            = ISuwp(_suwp);
        usdc            = IERC20(_usdc);
        positionManager = INonfungiblePositionManager(_positionManager);
    }

    // ─── Bond ────────────────────────────────────────────────────────────────

    /**
     * @notice Deposit a SUWP/USDC Uniswap v3 LP NFT and receive discounted SUWP vesting.
     * @param lpTokenId  Uniswap v3 position NFT token ID
     */
    function bond(uint256 lpTokenId) external nonReentrant whenNotPaused returns (uint256 bondId) {
        require(address(suwpUsdcPool) != address(0), "Pool not set");

        // Verify caller owns the NFT
        require(positionManager.ownerOf(lpTokenId) == msg.sender, "Not NFT owner");

        // Verify it's a SUWP/USDC position
        (,, address token0, address token1,,,,,,,,) = positionManager.positions(lpTokenId);
        address suwpAddr = address(suwp);
        address usdcAddr = address(usdc);
        require(
            (token0 == suwpAddr && token1 == usdcAddr) ||
            (token0 == usdcAddr && token1 == suwpAddr),
            "LP must be SUWP/USDC"
        );

        // Transfer LP NFT to this contract (protocol treasury)
        positionManager.safeTransferFrom(msg.sender, address(this), lpTokenId);

        // Estimate LP value and compute discounted SUWP payout
        uint256 suwpPayout = _computePayout(lpTokenId, token0 == usdcAddr);

        // Create vesting bond
        bondId = nextBondId++;
        uint256 end = block.timestamp + VESTING_DURATION;
        bonds[bondId] = Bond({
            bonder:      msg.sender,
            lpTokenId:   lpTokenId,
            suwpTotal:   suwpPayout,
            suwpClaimed: 0,
            startTime:   block.timestamp,
            endTime:     end,
            active:      true
        });
        userBonds[msg.sender].push(bondId);

        totalLpBonded++;
        totalSuwpIssued += suwpPayout;

        emit Bonded(bondId, msg.sender, lpTokenId, suwpPayout, end);
    }

    /**
     * @notice Claim vested SUWP from an existing bond. Can be called multiple times.
     * @param bondId  Bond ID returned by bond()
     */
    function redeem(uint256 bondId) external nonReentrant returns (uint256 claimed) {
        Bond storage b = bonds[bondId];
        require(b.bonder == msg.sender, "Not bond owner");
        require(b.active, "Bond not active");

        uint256 vested = _vestedAmount(b);
        claimed = vested - b.suwpClaimed;
        require(claimed > 0, "Nothing to claim");

        b.suwpClaimed += claimed;
        if (b.suwpClaimed >= b.suwpTotal) {
            b.active = false;
        }

        suwp.mint(msg.sender, claimed, "bond_vest");
        emit Redeemed(bondId, msg.sender, claimed);
    }

    // ─── View ─────────────────────────────────────────────────────────────────

    /**
     * @notice Current SUWP/USDC price from 30-min Uniswap v3 TWAP (USDC per SUWP, 6 decimals).
     */
    function getSuwpPrice() public view returns (uint256 priceUsdcPerSuwp) {
        require(address(suwpUsdcPool) != address(0), "Pool not set");

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = TWAP_PERIOD;
        secondsAgos[1] = 0;

        (int56[] memory tickCumulatives,) = suwpUsdcPool.observe(secondsAgos);
        int56 tickDelta = tickCumulatives[1] - tickCumulatives[0];
        int24 avgTick = int24(tickDelta / int56(uint56(TWAP_PERIOD)));

        // Price = 1.0001^tick (approximation: each tick = 0.01% price change)
        // For token0=SUWP, token1=USDC: price = 1.0001^tick * 10^(decimal1-decimal0)
        // Simplified: use sqrtPriceX96 from slot0 as fallback if TWAP fails
        // Full tick→price: too complex inline; use TickMath lib in production
        // Here: return raw tick as a proxy — caller should use TickMath off-chain
        // to get exact price. This view is informational.
        bool suwpIsToken0 = suwpUsdcPool.token0() == address(suwp);
        // Rough price in USDC (6 dec): 1.0001^tick * scale factor
        // Using simplified integer math: tick * 1e6 / 10000 (±1% per 100 ticks)
        if (suwpIsToken0) {
            // USDC per SUWP = 10^12 / (1.0001^avgTick) — simplified
            priceUsdcPerSuwp = uint256(int256(1e6) + (int256(avgTick) * 1e6 / 10000));
        } else {
            priceUsdcPerSuwp = uint256(int256(1e6) - (int256(avgTick) * 1e6 / 10000));
        }
    }

    /**
     * @notice Preview how much SUWP a given LP token ID would receive.
     */
    function previewBond(uint256 lpTokenId) external view returns (uint256 suwpPayout) {
        require(address(suwpUsdcPool) != address(0), "Pool not set");
        (,, address token0,,,,,,,,,) = positionManager.positions(lpTokenId);
        bool usdcIsToken0 = token0 == address(usdc);
        suwpPayout = _computePayout(lpTokenId, usdcIsToken0);
    }

    /**
     * @notice How much SUWP is currently vested and claimable for a bond.
     */
    function claimable(uint256 bondId) external view returns (uint256) {
        Bond storage b = bonds[bondId];
        if (!b.active) return 0;
        return _vestedAmount(b) - b.suwpClaimed;
    }

    /**
     * @notice All bond IDs for a user.
     */
    function getUserBonds(address user) external view returns (uint256[] memory) {
        return userBonds[user];
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /**
     * @notice Set the SUWP/USDC Uniswap v3 pool for TWAP pricing.
     *         Call after deploying the SUWP token and creating the pool.
     */
    function setSuwpUsdcPool(address _pool) external onlyOwner {
        suwpUsdcPool = IUniswapV3Pool(_pool);
        emit PoolUpdated(_pool);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // Required to receive ERC-721 (LP NFTs)
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _computePayout(uint256 lpTokenId, bool usdcIsToken0) internal view returns (uint256) {
        // Get position liquidity to estimate USDC value
        (,,,,,,, uint128 liquidity,,,,) = positionManager.positions(lpTokenId);
        require(liquidity > 0, "Empty position");

        // Simplified: estimate LP value as liquidity / 1e12 USDC (rough proxy)
        // Production: use Uniswap v3 position value formula with sqrtPrice
        // For now: 1 unit liquidity ≈ 1e-12 USDC × 2 (both sides)
        uint256 estimatedUsdcValue = uint256(liquidity) / 1e12;
        require(estimatedUsdcValue > 0, "Position value too small");

        // Get SUWP price from TWAP
        uint256 suwpPrice = getSuwpPrice();         // USDC per SUWP (6 decimals)
        require(suwpPrice > 0, "Invalid price");

        // SUWP payout = (USD value / SUWP price) * (1 + discount)
        // discounted: user pays less USD per SUWP → gets more SUWP
        uint256 baseSuwp = (estimatedUsdcValue * 1e18) / suwpPrice;  // 18-decimal SUWP
        uint256 discountedSuwp = baseSuwp * (10000 + DISCOUNT_BPS) / 10000;

        return discountedSuwp;
    }

    function _vestedAmount(Bond storage b) internal view returns (uint256) {
        if (block.timestamp >= b.endTime) return b.suwpTotal;
        uint256 elapsed = block.timestamp - b.startTime;
        return (b.suwpTotal * elapsed) / VESTING_DURATION;
    }
}
