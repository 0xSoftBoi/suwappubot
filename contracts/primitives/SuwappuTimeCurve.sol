// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/*//////////////////////////////////////////////////////////////////////////
                    SuwappuTimeCurve — Time-Locked Continuous Bonding Curve

    A single immutable, dependency-free contract implementing a continuous,
    time-parameterized bonding curve for one ERC-20 reserve asset. The contract
    is itself the curve token (mint on buy, burn on sell). No owner, no oracle,
    no upgrade path, no pause, no imports — a permanent Lego brick in the spirit
    of Uniswap v1 / Ajna.

    Price is a pure deterministic function of time and cumulative supply:

        p(s, t) = m(t) * (basePrice + slope * s)
        m(t)    = e^(rate * (t - deployTime))            (rate <= 0)

    "Sinking": an optional immutable `sinkRate` withholds a fixed fraction of
    every sell's gross proceeds into the reserve as a permanent surplus. It is a
    flat haircut on *value* (not on integration bounds), so splitting a sale into
    many small sells cannot dodge it.

    Solvency: the multiplier is restricted to decay/flat schedules (rate <= 0),
    which makes the reserve provably sufficient for every sell — each unit of
    supply was bought at a multiplier >= the current one. Time-based *growth*
    (rate > 0) is rejected at deployment; express an upward path via `slope`.
//////////////////////////////////////////////////////////////////////////*/

/// @dev Minimal external-token interface (named to avoid clashing with any ERC20 lib).
interface ICurveToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract SuwappuTimeCurve {
    /*////////////////////////////////////////////////////////////
                          INLINED ERC-20 (the curve token)
    ////////////////////////////////////////////////////////////*/
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "ALLOWANCE");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "ZERO_TO");
        uint256 bal = balanceOf[from];
        require(bal >= amount, "BALANCE");
        unchecked {
            balanceOf[from] = bal - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        unchecked {
            balanceOf[to] += amount;
        }
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        uint256 bal = balanceOf[from];
        require(bal >= amount, "BALANCE");
        unchecked {
            balanceOf[from] = bal - amount;
            totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    /*////////////////////////////////////////////////////////////
                          REENTRANCY GUARD (inlined)
    ////////////////////////////////////////////////////////////*/
    // EIP-1153 transient reentrancy guard (~200 gas vs ~5k for an SSTORE pair).
    // Uses tstore/tload directly since the 0.8.27 `transient` keyword predates support.
    uint256 private constant _LOCK_SLOT = 0;

    modifier nonReentrant() {
        assembly {
            if tload(_LOCK_SLOT) { revert(0, 0) }
            tstore(_LOCK_SLOT, 1)
        }
        _;
        assembly {
            tstore(_LOCK_SLOT, 0)
        }
    }

    /*////////////////////////////////////////////////////////////
                                CURVE STATE
    ////////////////////////////////////////////////////////////*/
    uint256 private constant WAD = 1e18;

    ICurveToken public immutable reserve;
    uint256 public immutable reserveScale; // 10^(18 - reserveDecimals)
    uint256 public immutable deployTime;
    uint256 public immutable basePrice; // WAD
    uint256 public immutable slope; // WAD, price per whole token of supply
    int256 public immutable rate; // per-second exp rate, signed WAD, <= 0
    uint256 public immutable sinkRate; // WAD fraction of gross sell proceeds withheld
    uint256 public totalSunk; // cumulative reserve units retained by the sink

    event CurveBuy(address indexed buyer, uint256 tokensOut, uint256 reserveIn);
    event CurveSell(address indexed seller, uint256 tokensIn, uint256 reserveOut, uint256 sunk);

    error ZeroAmount();
    error SlippageExceeded();
    error InsufficientReserve();
    error BadParams();
    error TransferFailed();

    constructor(
        string memory name_,
        string memory symbol_,
        address reserve_,
        uint256 basePrice_,
        uint256 slope_,
        int256 rate_,
        uint256 sinkRate_
    ) {
        if (reserve_ == address(0) || basePrice_ == 0 || sinkRate_ >= WAD) revert BadParams();
        if (rate_ > 0) revert BadParams(); // only decay/flat stays solvent
        if (rate_ < -1e24 || slope_ > 1e24) revert BadParams(); // keep math in range
        uint8 dec = ICurveToken(reserve_).decimals();
        if (dec > 18) revert BadParams();
        name = name_;
        symbol = symbol_;
        reserve = ICurveToken(reserve_);
        reserveScale = 10 ** (18 - dec);
        deployTime = block.timestamp;
        basePrice = basePrice_;
        slope = slope_;
        rate = rate_;
        sinkRate = sinkRate_;
    }

    /*////////////////////////////////////////////////////////////
                                  TRADING
    ////////////////////////////////////////////////////////////*/

    /// @notice Buy `tokenAmount` curve tokens for at most `maxReserveIn` reserve units.
    function buy(uint256 tokenAmount, uint256 maxReserveIn)
        external
        nonReentrant
        returns (uint256 reserveIn)
    {
        if (tokenAmount == 0) revert ZeroAmount();
        reserveIn = quoteBuy(tokenAmount);
        if (reserveIn == 0) revert ZeroAmount(); // never mint for free
        if (reserveIn > maxReserveIn) revert SlippageExceeded();
        _safeTransferFrom(msg.sender, address(this), reserveIn);
        _mint(msg.sender, tokenAmount);
        emit CurveBuy(msg.sender, tokenAmount, reserveIn);
    }

    /// @notice Sell `tokenAmount` curve tokens for at least `minReserveOut` reserve units.
    function sell(uint256 tokenAmount, uint256 minReserveOut)
        external
        nonReentrant
        returns (uint256 reserveOut)
    {
        if (tokenAmount == 0) revert ZeroAmount();
        (uint256 grossOut, uint256 netOut) = _sellQuote(tokenAmount);
        if (netOut < minReserveOut) revert SlippageExceeded();
        if (netOut > reserve.balanceOf(address(this))) revert InsufficientReserve();
        reserveOut = netOut;
        totalSunk += grossOut - netOut;
        _burn(msg.sender, tokenAmount);
        _safeTransfer(msg.sender, netOut);
        emit CurveSell(msg.sender, tokenAmount, netOut, grossOut - netOut);
    }

    /*////////////////////////////////////////////////////////////
                                  QUOTES
    ////////////////////////////////////////////////////////////*/

    /// @notice Reserve units required to buy `tokenAmount` now (rounds up).
    function quoteBuy(uint256 tokenAmount) public view returns (uint256) {
        uint256 s = totalSupply;
        uint256 costWad = _mulWad(multiplier(), _integral(s, s + tokenAmount));
        return _ceilDiv(costWad, reserveScale);
    }

    /// @notice Reserve units returned for selling `tokenAmount` now (net of sink).
    function quoteSell(uint256 tokenAmount) public view returns (uint256 netOut) {
        (, netOut) = _sellQuote(tokenAmount);
    }

    /// @dev gross = m(t) * integral over the top slice [s - amount, s];
    ///      net = gross * (1 - sinkRate). Sink is a flat fraction of value.
    function _sellQuote(uint256 tokenAmount) internal view returns (uint256 grossOut, uint256 netOut) {
        uint256 s = totalSupply;
        if (tokenAmount == 0 || tokenAmount > s) revert ZeroAmount();
        uint256 grossWad = _mulWad(multiplier(), _integral(s - tokenAmount, s));
        grossOut = grossWad / reserveScale;
        netOut = grossOut - (grossOut * sinkRate) / WAD;
        if (netOut > reserve.balanceOf(address(this))) revert InsufficientReserve();
    }

    /// @notice Current time multiplier m(t), WAD.
    function multiplier() public view returns (uint256) {
        int256 x = rate * int256(block.timestamp - deployTime); // rate <= 0 => x <= 0
        if (x < -41e18) x = -41e18; // floor above zero; a 0 multiplier would allow free mint
        return uint256(_wadExp(x));
    }

    /// @notice Instantaneous spot price at current supply and time, WAD.
    function spotPrice() external view returns (uint256) {
        return _mulWad(multiplier(), basePrice + _mulWad(slope, totalSupply));
    }

    /// @notice Reserve currently held by the curve, in reserve units.
    function reserveBalance() external view returns (uint256) {
        return reserve.balanceOf(address(this));
    }

    /*////////////////////////////////////////////////////////////
                                   MATH
    ////////////////////////////////////////////////////////////*/

    /// @dev Integral of (basePrice + slope*s) ds over [s1, s2], WAD in/out.
    function _integral(uint256 s1, uint256 s2) internal view returns (uint256) {
        uint256 linear = _mulWad(basePrice, s2 - s1);
        if (slope == 0) return linear;
        uint256 sq = _mulDiv(s2, s2, WAD) - _mulDiv(s1, s1, WAD);
        return linear + _mulWad(slope, sq) / 2;
    }

    function _mulWad(uint256 a, uint256 b) internal pure returns (uint256) {
        return _mulDiv(a, b, WAD);
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    /// @dev 512-bit multiply-then-divide (Remco Bloemen, MIT). Avoids overflow.
    function _mulDiv(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            uint256 prod0;
            uint256 prod1;
            assembly {
                let mm := mulmod(x, y, not(0))
                prod0 := mul(x, y)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) {
                require(denominator > 0, "DIV_ZERO");
                return prod0 / denominator;
            }
            require(denominator > prod1, "MULDIV_OVERFLOW");
            uint256 remainder;
            assembly {
                remainder := mulmod(x, y, denominator)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }
            uint256 twos = denominator & (~denominator + 1);
            assembly {
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;
            uint256 inverse = (3 * denominator) ^ 2;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            result = prod0 * inverse;
        }
    }

    /// @dev e^x for signed WAD x (Remco Bloemen, MIT). Valid for x in (-42e18, 135e18).
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

    /*////////////////////////////////////////////////////////////
                        SAFE ERC-20 (inlined, no lib)
    ////////////////////////////////////////////////////////////*/
    function _safeTransfer(address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            address(reserve).call(abi.encodeWithSelector(ICurveToken.transfer.selector, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            address(reserve).call(abi.encodeWithSelector(ICurveToken.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
