// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SuwappuTimeCurve — Time-Locked Continuous Bonding Curve
 * @notice A single immutable contract implementing a continuous, time-parameterized
 *         bonding curve for one ERC-20 reserve asset. The contract itself is the
 *         curve token (mint on buy, burn on sell).
 *
 *         Price is a pure deterministic function of time and cumulative supply:
 *
 *             p(s, t) = m(t) * (basePrice + slope * s)
 *             m(t)    = e^(rate * (t - deployTime))        (rate may be negative)
 *
 *         No owner, no oracle, no upgrade path, no pause. All parameters are
 *         immutable and fixed at deployment. Anyone can buy or sell at any moment;
 *         liquidity is always available from the curve itself.
 *
 *         "Sinking": an optional immutable fraction (`sinkRate`) of every sold
 *         amount is burned without refund, permanently removing tokens from
 *         circulation and leaving a growing reserve surplus.
 *
 * @dev Solvency: with rate <= 0 (decay or flat schedules) the reserve provably
 *      covers all sells, since every unit of supply was bought at a multiplier
 *      >= the current one. With rate > 0 (growth schedules) the contract enforces
 *      `refund <= reserve balance` as a hard guard; the sink fraction builds the
 *      buffer that services growth. Deployers choosing growth schedules should
 *      pair them with a non-zero sinkRate.
 *
 *      All curve math is done in WAD (1e18) units. Reserve token amounts are
 *      normalized via `reserveScale` so tokens with fewer than 18 decimals work.
 */
contract SuwappuTimeCurve is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant WAD = 1e18;

    /// @notice Reserve (quote) asset the curve trades against.
    IERC20 public immutable reserve;
    /// @notice 10^(18 - reserveDecimals); converts WAD amounts to reserve units.
    uint256 public immutable reserveScale;
    /// @notice Deployment timestamp; t=0 of the schedule.
    uint256 public immutable deployTime;
    /// @notice Price at zero supply and t=0, WAD.
    uint256 public immutable basePrice;
    /// @notice Linear supply slope, WAD (price increase per whole token of supply).
    uint256 public immutable slope;
    /// @notice Per-second exponential rate of the time multiplier, signed WAD.
    int256 public immutable rate;
    /// @notice Fraction of every sell burned without refund, WAD (0 = disabled).
    uint256 public immutable sinkRate;
    /// @notice Cumulative tokens permanently removed by the sink.
    uint256 public totalSunk;

    event CurveBuy(address indexed buyer, uint256 tokensOut, uint256 reserveIn);
    event CurveSell(address indexed seller, uint256 tokensIn, uint256 reserveOut, uint256 sunk);

    error ZeroAmount();
    error SlippageExceeded();
    error InsufficientReserve();
    error BadParams();

    constructor(
        string memory name_,
        string memory symbol_,
        address reserve_,
        uint256 basePrice_,
        uint256 slope_,
        int256 rate_,
        uint256 sinkRate_
    ) ERC20(name_, symbol_) {
        if (reserve_ == address(0) || basePrice_ == 0 || sinkRate_ >= WAD) revert BadParams();
        uint8 dec = IERC20Metadata(reserve_).decimals();
        if (dec > 18) revert BadParams();
        reserve = IERC20(reserve_);
        reserveScale = 10 ** (18 - dec);
        deployTime = block.timestamp;
        basePrice = basePrice_;
        slope = slope_;
        rate = rate_;
        sinkRate = sinkRate_;
    }

    // ---------------------------------------------------------------- trading

    /// @notice Buy `tokenAmount` curve tokens for at most `maxReserveIn` reserve units.
    function buy(uint256 tokenAmount, uint256 maxReserveIn)
        external
        nonReentrant
        returns (uint256 reserveIn)
    {
        if (tokenAmount == 0) revert ZeroAmount();
        reserveIn = quoteBuy(tokenAmount);
        if (reserveIn > maxReserveIn) revert SlippageExceeded();
        reserve.safeTransferFrom(msg.sender, address(this), reserveIn);
        _mint(msg.sender, tokenAmount);
        emit CurveBuy(msg.sender, tokenAmount, reserveIn);
    }

    /// @notice Sell `tokenAmount` curve tokens for at least `minReserveOut` reserve units.
    /// @dev The sink fraction of `tokenAmount` is burned without refund.
    function sell(uint256 tokenAmount, uint256 minReserveOut)
        external
        nonReentrant
        returns (uint256 reserveOut)
    {
        if (tokenAmount == 0) revert ZeroAmount();
        uint256 sunk = (tokenAmount * sinkRate) / WAD;
        reserveOut = quoteSell(tokenAmount);
        if (reserveOut < minReserveOut) revert SlippageExceeded();
        totalSunk += sunk;
        _burn(msg.sender, tokenAmount);
        reserve.safeTransfer(msg.sender, reserveOut);
        emit CurveSell(msg.sender, tokenAmount, reserveOut, sunk);
    }

    // ----------------------------------------------------------------- quotes

    /// @notice Reserve units required to buy `tokenAmount` right now (rounds up).
    function quoteBuy(uint256 tokenAmount) public view returns (uint256) {
        uint256 s = totalSupply();
        uint256 costWad = _mulWad(multiplier(), _integral(s, s + tokenAmount));
        return _ceilDiv(costWad, reserveScale);
    }

    /// @notice Reserve units returned for selling `tokenAmount` right now (rounds down),
    ///         net of the sink fraction and capped by the reserve balance.
    function quoteSell(uint256 tokenAmount) public view returns (uint256) {
        uint256 s = totalSupply();
        if (tokenAmount > s) revert ZeroAmount();
        uint256 refunded = tokenAmount - (tokenAmount * sinkRate) / WAD;
        // Refund the *lowest* `refunded` slice of the curve [s - tokenAmount, s - sunk],
        // i.e. the seller forfeits the top (most expensive) sink slice.
        uint256 refundWad = _mulWad(multiplier(), _integral(s - tokenAmount, s - tokenAmount + refunded));
        uint256 out = refundWad / reserveScale;
        uint256 bal = reserve.balanceOf(address(this));
        return out > bal ? bal : out;
    }

    /// @notice Current time multiplier m(t), WAD.
    function multiplier() public view returns (uint256) {
        int256 x = rate * int256(block.timestamp - deployTime);
        // Clamp to wadExp's domain; beyond it the multiplier saturates.
        if (x > 130e18) x = 130e18;
        if (x < -41e18) return 0; // e^-41 < 1 wei in WAD — price floor of zero
        return uint256(_wadExp(x));
    }

    /// @notice Instantaneous spot price at current supply and time, WAD.
    function spotPrice() external view returns (uint256) {
        return _mulWad(multiplier(), basePrice + _mulWad(slope, totalSupply()));
    }

    /// @notice Reserve currently held by the curve, in reserve units.
    function reserveBalance() external view returns (uint256) {
        return reserve.balanceOf(address(this));
    }

    // ------------------------------------------------------------------- math

    /// @dev Integral of (basePrice + slope*s) ds over [s1, s2], WAD in, WAD out.
    function _integral(uint256 s1, uint256 s2) internal view returns (uint256) {
        uint256 linear = _mulWad(basePrice, s2 - s1);
        // slope * (s2^2 - s1^2) / 2 with intermediate mulWad to avoid overflow
        uint256 quad = _mulWad(slope, (_mulWad(s2, s2) - _mulWad(s1, s1))) / 2;
        return linear + quad;
    }

    function _mulWad(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * b) / WAD;
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    /// @dev e^x for signed WAD x. Adapted from Remco Bloemen's exp implementation
    ///      (used by solmate/PRBMath), MIT licensed. Valid for x in (-42e18, 135e18).
    function _wadExp(int256 x) internal pure returns (int256 r) {
        unchecked {
            if (x <= -42139678854452767551) return 0;
            require(x < 135305999368893231589, "EXP_OVERFLOW");
            x = (x << 78) / 5 ** 18;
            int256 k = ((x << 96) / 54916777467707473351141471128 + 2 ** 95) >> 96;
            x = x - k * 54916777467707473351141471128;
            int256 y = x + 1346386616545796478920950773328;
            y = ((y * x) >> 96) + 57155421227552351082224309758442;
            int256 p = y + x - 94201549194550492254356042504812;
            p = ((p * y) >> 96) + 28719021644029726153956944680412240;
            p = p * x + (4385272521454847904659076985693276 << 96);
            int256 q = x - 2855989394907223263936484059900;
            q = ((q * x) >> 96) + 50020603652535783019961831881945;
            q = ((q * x) >> 96) - 533845033583426703283633433725380;
            q = ((q * x) >> 96) + 3604857256930695427073651918091429;
            q = ((q * x) >> 96) - 14423608567350463180887372962807573;
            q = ((q * x) >> 96) + 26449188498355588339934803723976023;
            assembly {
                r := sdiv(p, q)
            }
            r = int256((uint256(r) * 3822833074963236453042738258902158003155416615667) >> uint256(195 - k));
        }
    }
}
