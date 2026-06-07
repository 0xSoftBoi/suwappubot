// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

import "./lib/uniswap/TickMath.sol";
import "./lib/uniswap/FullMath.sol";
import "./lib/uniswap/LiquidityAmounts.sol";
import "./lib/uniswap/OracleLibrary.sol";

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

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
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
    address public immutable uniswapFactory; // canonical Uniswap v3 factory (pool authenticity)
    IUniswapV3Pool public suwpUsdcPool; // set post-deployment once SUWP pool exists

    uint256 public constant VESTING_DURATION = 7 days;
    uint256 public constant DISCOUNT_BPS = 500;   // 5% discount (basis points)
    uint256 public constant MAX_DISCOUNT_BPS = 2000; // 20% max
    uint32  public constant TWAP_PERIOD = 1800;   // 30 minutes

    // Mint caps (owner-settable) to bound SUWP issued via bonds
    uint256 public maxSuwpPerBond = 1_000_000e18;   // per-bond ceiling
    uint256 public globalBondCap  = 50_000_000e18;  // cumulative ceiling on totalSuwpIssued

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
    event BondCapsUpdated(uint256 maxSuwpPerBond, uint256 globalBondCap);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        address _suwp,
        address _usdc,
        address _positionManager,
        address _uniswapFactory,
        address _owner
    ) Ownable(_owner) {
        require(_suwp != address(0), "suwp=0");
        require(_usdc != address(0), "usdc=0");
        require(_positionManager != address(0), "pm=0");
        require(_uniswapFactory != address(0), "factory=0");
        suwp            = ISuwp(_suwp);
        usdc            = IERC20(_usdc);
        positionManager = INonfungiblePositionManager(_positionManager);
        uniswapFactory  = _uniswapFactory;
        nextBondId      = 1; // avoid bond ID 0 footgun
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
        uint256 suwpPayout = _computePayout(lpTokenId);

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

        // Real Uniswap v3 TWAP: arithmetic-mean tick over the TWAP window.
        // Reverts naturally if the pool's observation cardinality is too low to
        // cover TWAP_PERIOD ("OLD") — callers must seed observations first.
        int24 tick = OracleLibrary.consult(address(suwpUsdcPool), TWAP_PERIOD);

        // Quote: how much USDC (6 dec) is received for exactly 1 SUWP (1e18 base units).
        // getQuoteAtTick uses the exact 1.0001^tick relation via TickMath, handling
        // token ordering and decimals correctly regardless of which token is token0.
        priceUsdcPerSuwp = OracleLibrary.getQuoteAtTick(
            tick,
            uint128(1e18),
            address(suwp),
            address(usdc)
        );
        require(priceUsdcPerSuwp > 0, "Invalid price");
    }

    /**
     * @notice Preview how much SUWP a given LP token ID would receive.
     */
    function previewBond(uint256 lpTokenId) external view returns (uint256 suwpPayout) {
        require(address(suwpUsdcPool) != address(0), "Pool not set");
        suwpPayout = _computePayout(lpTokenId);
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
        require(_pool != address(0), "Pool=0");
        // Validate the pool actually holds the SUWP/USDC pair (in either order).
        address t0 = IUniswapV3Pool(_pool).token0();
        address t1 = IUniswapV3Pool(_pool).token1();
        address suwpAddr = address(suwp);
        address usdcAddr = address(usdc);
        require(
            (t0 == suwpAddr && t1 == usdcAddr) ||
            (t0 == usdcAddr && t1 == suwpAddr),
            "Pool not SUWP/USDC"
        );
        suwpUsdcPool = IUniswapV3Pool(_pool);
        emit PoolUpdated(_pool);
    }

    /// @notice Update the per-bond and global SUWP mint caps.
    function setBondCaps(uint256 _maxSuwpPerBond, uint256 _globalBondCap) external onlyOwner {
        require(_maxSuwpPerBond > 0, "maxPerBond=0");
        require(_globalBondCap >= totalSuwpIssued, "cap < issued");
        maxSuwpPerBond = _maxSuwpPerBond;
        globalBondCap  = _globalBondCap;
        emit BondCapsUpdated(_maxSuwpPerBond, _globalBondCap);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // Required to receive ERC-721 (LP NFTs)
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _computePayout(uint256 lpTokenId) internal view returns (uint256) {
        // Decompose the validated position into its underlying USDC/SUWP token amounts.
        // Split into a helper to keep the 12-field positions() destructuring off this
        // function's stack frame (avoids "stack too deep").
        (uint256 usdcAmt, uint256 suwpAmt) = _positionAmounts(lpTokenId);

        // Value both sides in USDC (6 dec) using the manipulation-resistant TWAP price.
        uint256 suwpPrice = getSuwpPrice(); // USDC (6 dec) per 1 SUWP
        uint256 suwpValueUsdc = FullMath.mulDiv(suwpAmt, suwpPrice, 1e18);
        uint256 totalUsdcValue = usdcAmt + suwpValueUsdc;
        require(totalUsdcValue > 0, "Zero value position");

        // SUWP payout = (USD value / SUWP price) * (1 + discount), 18-dec SUWP out.
        uint256 baseSuwp = FullMath.mulDiv(totalUsdcValue, 1e18, suwpPrice);
        uint256 payout = baseSuwp * (10000 + DISCOUNT_BPS) / 10000;
        require(payout <= maxSuwpPerBond, "Exceeds per-bond cap");
        require(totalSuwpIssued + payout <= globalBondCap, "Exceeds global bond cap");
        return payout;
    }

    /// @dev Validates the position's pool and returns its underlying (USDC, SUWP) amounts
    ///      at the pool's current price. Reverts unless the position belongs to the
    ///      canonical SUWP/USDC pool this contract prices against.
    function _positionAmounts(uint256 lpTokenId)
        internal
        view
        returns (uint256 usdcAmt, uint256 suwpAmt)
    {
        (,, address t0, address t1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity,,,,) =
            positionManager.positions(lpTokenId);
        require(liquidity > 0, "Empty position");

        // Verify the NFT belongs to the canonical SUWP/USDC pool we price against.
        // This blocks attackers from bonding a position from a low-liquidity pool
        // (different fee tier / token pair) whose tick they can manipulate.
        require(
            IUniswapV3Factory(uniswapFactory).getPool(t0, t1, fee) == address(suwpUsdcPool),
            "Wrong pool"
        );

        // Decompose the LP at the 30-min TWAP price, NOT spot (slot0). Using spot
        // here would let an attacker flash-manipulate the pool to shift the LP
        // composition toward the side valued favourably — overminting SUWP. The
        // TWAP tick is the same source used to price SUWP, keeping both consistent.
        int24 twapTick = OracleLibrary.consult(address(suwpUsdcPool), TWAP_PERIOD);
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(twapTick);
        (uint256 amount0, uint256 amount1) = LiquidityAmounts.getAmountsForLiquidity(
            sqrtPriceX96,
            TickMath.getSqrtRatioAtTick(tickLower),
            TickMath.getSqrtRatioAtTick(tickUpper),
            liquidity
        );

        // Identify USDC (6 dec) vs SUWP (18 dec) amounts.
        bool usdcIsToken0 = t0 == address(usdc);
        usdcAmt = usdcIsToken0 ? amount0 : amount1; // 6 dec
        suwpAmt = usdcIsToken0 ? amount1 : amount0; // 18 dec
    }

    function _vestedAmount(Bond storage b) internal view returns (uint256) {
        if (block.timestamp >= b.endTime) return b.suwpTotal;
        uint256 elapsed = block.timestamp - b.startTime;
        return (b.suwpTotal * elapsed) / VESTING_DURATION;
    }
}
