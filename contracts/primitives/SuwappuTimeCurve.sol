// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

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
 *         "Sinking": an optional immutable `sinkRate` withholds a fixed fraction
 *         of every sell's gross proceeds, leaving that value in the reserve as a
 *         permanent surplus. It is a flat haircut on value (not on the integration
 *         bounds), so splitting a sale into many small sells cannot dodge it.
 *
 * @dev Solvency: the time multiplier is restricted to decay/flat schedules
 *      (`rate <= 0`), which makes the reserve provably sufficient for every sell —
 *      each unit of supply was bought at a multiplier >= the current one, and the
 *      sink only ever withholds value, never adds. Time-based *growth* (rate > 0)
 *      is rejected at deployment because a self-contained reserve cannot honor
 *      quotes that appreciate faster than inflows without becoming a first-come
 *      bank run; express an upward price path via a positive `slope` (supply-based
 *      appreciation, which stays solvent) instead. `sell` additionally reverts
 *      (InsufficientReserve) rather than truncating if a payout ever exceeds the
 *      balance — a guard that should be unreachable given the above.
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
    /// @notice Per-second exponential rate of the time multiplier, signed WAD (<= 0).
    int256 public immutable rate;
    /// @notice Fraction of every sell's gross proceeds withheld into reserve, WAD.
    uint256 public immutable sinkRate;
    /// @notice Cumulative reserve units permanently retained by the sink.
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
        // Only decay/flat time schedules keep the reserve provably solvent.
        if (rate_ > 0) revert BadParams();
        // Bound magnitudes so rate*dt (multiplier) and slope*s^2 (integral) stay
        // safely within int256/uint256 for any realistic timestamp and supply.
        if (rate_ < -1e24 || slope_ > 1e24) revert BadParams();
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
        // Never mint for zero reserve: blocks the free-mint at a vanishing
        // multiplier and dust rounding to a zero price.
        if (reserveIn == 0) revert ZeroAmount();
        if (reserveIn > maxReserveIn) revert SlippageExceeded();
        reserve.safeTransferFrom(msg.sender, address(this), reserveIn);
        _mint(msg.sender, tokenAmount);
        emit CurveBuy(msg.sender, tokenAmount, reserveIn);
    }

    /// @notice Sell `tokenAmount` curve tokens for at least `minReserveOut` reserve units.
    /// @dev All sold tokens are burned; the sink withholds `sinkRate` of the gross
    ///      proceeds into the reserve as permanent surplus.
    function sell(uint256 tokenAmount, uint256 minReserveOut)
        external
        nonReentrant
        returns (uint256 reserveOut)
    {
        if (tokenAmount == 0) revert ZeroAmount();
        (uint256 grossOut, uint256 netOut) = _sellQuote(tokenAmount);
        if (netOut < minReserveOut) revert SlippageExceeded();
        // Solvency guard: with rate <= 0 this is unreachable, but never pay out
        // more than the reserve holds.
        if (netOut > reserve.balanceOf(address(this))) revert InsufficientReserve();
        reserveOut = netOut;
        totalSunk += grossOut - netOut;
        _burn(msg.sender, tokenAmount);
        reserve.safeTransfer(msg.sender, netOut);
        emit CurveSell(msg.sender, tokenAmount, netOut, grossOut - netOut);
    }

    // ----------------------------------------------------------------- quotes

    /// @notice Reserve units required to buy `tokenAmount` right now (rounds up).
    function quoteBuy(uint256 tokenAmount) public view returns (uint256) {
        uint256 s = totalSupply();
        uint256 costWad = _mulWad(multiplier(), _integral(s, s + tokenAmount));
        return _ceilDiv(costWad, reserveScale);
    }

    /// @notice Reserve units returned for selling `tokenAmount` right now (rounds down),
    ///         net of the sink haircut. Reverts if it would exceed the reserve.
    function quoteSell(uint256 tokenAmount) public view returns (uint256 netOut) {
        (, netOut) = _sellQuote(tokenAmount);
    }

    /// @dev Gross proceeds = m(t) * integral over the top slice [s - tokenAmount, s];
    ///      net = gross * (1 - sinkRate). The sink is a flat fraction of value, so it
    ///      is invariant to how a sale is split. Reverts if net exceeds the reserve.
    function _sellQuote(uint256 tokenAmount) internal view returns (uint256 grossOut, uint256 netOut) {
        uint256 s = totalSupply();
        if (tokenAmount == 0 || tokenAmount > s) revert ZeroAmount();
        uint256 grossWad = _mulWad(multiplier(), _integral(s - tokenAmount, s));
        grossOut = grossWad / reserveScale;
        netOut = grossOut - (grossOut * sinkRate) / WAD;
        if (netOut > reserve.balanceOf(address(this))) revert InsufficientReserve();
    }

    /// @notice Current time multiplier m(t), WAD.
    function multiplier() public view returns (uint256) {
        int256 x = rate * int256(block.timestamp - deployTime);
        // rate <= 0, so x <= 0. Clamp to wadExp's domain floor instead of
        // returning a hard zero — a zero multiplier would let buyers mint for
        // free. e^-41 is ~1 wei in WAD, an effective (nonzero) price floor.
        if (x < -41e18) x = -41e18;
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
        if (slope == 0) return linear;
        // slope * (s2^2 - s1^2) / 2, using mulDiv so the squared terms never
        // overflow uint256 (which would impose a spurious supply ceiling).
        uint256 sq = Math.mulDiv(s2, s2, WAD) - Math.mulDiv(s1, s1, WAD);
        return linear + _mulWad(slope, sq) / 2;
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
