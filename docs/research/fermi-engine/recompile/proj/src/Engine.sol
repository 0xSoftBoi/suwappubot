// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.25;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./BaseManager.sol";
import "./interfaces/IFermiEngine.sol";

interface IPrioRegistry {
    function getState(uint256 id, uint32 from, uint32 to) external view returns (uint32 ts, uint256[] memory values);
    function addUpdater(address updater) external;
    function removeUpdater(address updater) external;
}

interface IDecimals {
    function decimals() external view returns (uint8);
}

/// Reconstruction of the unverified FermiSwap engine 0x90f73feA1Ee2dC514D4dbac0bFf7fF04B933767f.
/// Names of several functions are UNKNOWN (selector brute force failed) and are placeholders.
contract FermiEngine is BaseManager {
    uint256 public constant VERSION = 20260720;

    address public immutable prioRegistry = 0xDa7AfeeD01fe625CF15d187a19f94B45f00b8C5F;
    uint32 public immutable maxParameterAge = 0;

    struct Seg { int128 x0; int128 x1; int128 c2; int128 c3; int128 c4; int128 c5; }
    struct PairParams {
        uint128 baseEdge;
        uint16 targetBps;
        uint128 lo;
        uint128 hi;
        Seg[] sizeCurve;
        Seg[] skewCurve;
    }
    struct Pair {
        bool active;
        uint128 baseEdge;
        uint16 targetBps;
        uint128 lo;
        uint128 hi;
        uint128 scaleBase;
        uint128 scaleQuote;
        address base;
        address quote;
        Seg[] sizeCurve;
        Seg[] skewCurve;
    }
    struct Acc { uint64 blockNumber; uint192 cum; }
    struct Ctx { address base; address quote; bool baseIn; uint256 cum; }

    address payable public traderVault;                         // slot 2
    address public swapper;                                      // slot 3
    uint64 public swapWindow;                                    // slot 3 (high)
    mapping(bytes32 => Pair) private pairs;                      // slot 4
    IFermiEngine.PairInfo[] private pairList;                    // slot 5
    mapping(bytes32 => uint256) private pairIndex;               // slot 6
    mapping(bytes32 => mapping(bool => Acc)) private acc;        // slot 7
    mapping(address => uint256) public maxInventory;             // slot 8

    constructor(address payable vaultAddress, address payable managerAddress, address payable traderVaultAddress)
        BaseManager(vaultAddress, managerAddress)
    {
        traderVault = traderVaultAddress;
        swapWindow = 1;
    }

    // ===================== admin =====================
    event SwapperSet(address indexed swapper);
    event PairRegistered(address indexed base, address indexed quote);
    event PairUnregistered(address indexed base, address indexed quote);
    event PairActiveSet(address indexed base, address indexed quote, bool active);
    event SwapWindowSet(uint64 window); // name INFERRED-UNVERIFIED: real topic daddf81a...523aa

    function setSwapper(address s) external onlyManager {
        require(s != address(0), "ZA");
        swapper = s;
        emit SwapperSet(s);
    }
    function setTraderVault(address payable v) external onlyManager { require(v != address(0), "ZA"); traderVault = v; }
    function addUpdater(address u) external onlyManager { IPrioRegistry(prioRegistry).addUpdater(u); }
    function removeUpdater(address u) external onlyManager { IPrioRegistry(prioRegistry).removeUpdater(u); }
    function setSwapWindow(uint64 w) external onlyManager { swapWindow = w; emit SwapWindowSet(w); }
    function setMaxInventory(address token, uint256 v) external onlyManager { maxInventory[token] = v; }

    function addPair(address base, address quote, PairParams calldata p) external onlyManager {
        _writePair(base, quote, p, true);
    }
    function updatePair(address base, address quote, PairParams calldata p) external onlyManager {
        _writePair(base, quote, p, false);
    }
    function setPairActive(address base, address quote, bool on) external onlyManager {
        pairs[_id(base, quote)].active = on;
        emit PairActiveSet(base, quote, on);
    }
    function unregisterPair(address base, address quote) external onlyManager {
        delete pairs[_id(base, quote)];
        emit PairUnregistered(base, quote);
    }

    function _writePair(address base, address quote, PairParams calldata p, bool isNew) internal {
        bytes32 id = _id(base, quote);
        Pair storage s = pairs[id];
        s.baseEdge = p.baseEdge;
        s.targetBps = p.targetBps;
        s.lo = p.lo;
        s.hi = p.hi;
        if (isNew) {
            s.active = true;
            s.scaleBase = uint128(10 ** IDecimals(base).decimals());
            s.scaleQuote = uint128(10 ** IDecimals(quote).decimals());
            s.base = base;
            s.quote = quote;
            pairList.push(IFermiEngine.PairInfo(base, quote, true));
            pairIndex[id] = pairList.length;
        }
        delete s.sizeCurve;
        for (uint256 i = 0; i < p.sizeCurve.length; i++) s.sizeCurve.push(p.sizeCurve[i]);
        delete s.skewCurve;
        for (uint256 i = 0; i < p.skewCurve.length; i++) s.skewCurve.push(p.skewCurve[i]);
    }

    // ===================== views =====================
    function getPairParams(address base, address quote) external view returns (PairParams memory r) {
        Pair storage s = pairs[_id(base, quote)];
        r.baseEdge = s.baseEdge;
        r.targetBps = s.targetBps;
        r.lo = s.lo;
        r.hi = s.hi;
        r.sizeCurve = s.sizeCurve;
        r.skewCurve = s.skewCurve;
    }

    function getPairs() external view returns (IFermiEngine.PairInfo[] memory) {
        IFermiEngine.PairInfo[] memory r = new IFermiEngine.PairInfo[](pairList.length);
        for (uint256 i = 0; i < r.length; i++) r[i] = pairList[i];
        return r;
    }

    function isActive(address a, address b) external view returns (bool) {
        return pairs[_id(a, b)].active || pairs[_id(b, a)].active;
    }

    function unlocked(address a, address b) external view returns (bool) {
        bytes32 id = pairs[_id(a, b)].lo != 0 ? _id(a, b) : _id(b, a);
        Acc storage x = acc[id][false];
        return block.number - x.blockNumber >= swapWindow;
    }

    function cumulative(address a, address b, bool dir) external view returns (uint256) {
        bytes32 id = pairs[_id(a, b)].lo != 0 ? _id(a, b) : _id(b, a);
        return _cum(id, dir);
    }

    // ===================== swap / quote =====================
    function quote(address tokenIn, address tokenOut, int256 amountSpecified, address)
        external view returns (uint256 amountIn, uint256 amountOut)
    {
        (Ctx memory c, bytes32 id) = _resolve(tokenIn, tokenOut);
        (amountIn, amountOut) = _price(pairs[id], id, c, amountSpecified);
    }

    function swap(address tokenIn, address tokenOut, int256 amountSpecified, address)
        external returns (uint256 amountIn, uint256 amountOut)
    {
        require(msg.sender == swapper, "NS");
        (Ctx memory c, bytes32 id) = _resolve(tokenIn, tokenOut);
        (amountIn, amountOut) = _price(pairs[id], id, c, amountSpecified);
        uint256 newCum = c.cum + (c.baseIn ? _toQuote(pairs[id], amountIn, _oracle(id)) : amountIn);
        require(newCum <= type(uint192).max, "CO");
        acc[id][!c.baseIn] = Acc(uint64(block.number), uint192(newCum));
    }

    function _id(address a, address b) internal pure returns (bytes32) {
        return keccak256(abi.encode(a, b));
    }

    function _cum(bytes32 id, bool dir) internal view returns (uint256) {
        Acc storage x = acc[id][dir];
        if (x.blockNumber == 0) return 0;
        if (block.number - x.blockNumber < swapWindow) return x.cum;
        return 0;
    }

    function _resolve(address tokenIn, address tokenOut) internal view returns (Ctx memory c, bytes32 id) {
        id = _id(tokenIn, tokenOut);
        bool baseIn = true;
        if (pairs[id].lo == 0) {
            id = _id(tokenOut, tokenIn);
            require(pairs[id].lo != 0, "UP");
            baseIn = false;
            c = Ctx(tokenOut, tokenIn, baseIn, 0);
        } else {
            c = Ctx(tokenIn, tokenOut, baseIn, 0);
        }
        c.cum = _cum(id, !baseIn);
    }

    function _oracle(bytes32 id) internal view returns (uint256 p) {
        (, uint256[] memory v) = IPrioRegistry(prioRegistry).getState(uint256(id), uint32(block.timestamp) - maxParameterAge, uint32(block.timestamp));
        require(v.length >= 1, "ZP");
        p = v[0];
        require(p != 0, "ZP");
    }

    function _toQuote(Pair storage s, uint256 amountBase, uint256 p) internal view returns (uint256) {
        return Math.mulDiv(amountBase * p, s.scaleQuote, uint256(s.scaleBase) * 1e8);
    }

    function _bal(address t) internal view returns (uint256) {
        return IERC20(t).balanceOf(traderVault);
    }

    function _price(Pair storage s, bytes32 id, Ctx memory c, int256 amountSpecified)
        internal view returns (uint256 amountIn, uint256 amountOut)
    {
        require(amountSpecified != 0, "ZA");
        require(s.active, "IA");
        uint256 p = _oracle(id);
        uint256 amt = amountSpecified > 0 ? uint256(amountSpecified) : uint256(-amountSpecified);
        if (amountSpecified < 0) return _priceExactOut(s, c, p, amt);
        uint256 qty = c.baseIn ? _toQuote(s, amt, p) : amt;
        if (s.hi != 0 && qty > s.hi) {
            amt = Math.mulDiv(amt, s.hi, qty);
            qty = s.hi;
        }
        uint256 p2 = _execPrice(s, c, p, qty);
        amountOut = _out(s, c.baseIn, amt, p2);
        uint256 vaultOut = _bal(c.baseIn ? c.quote : c.base);
        if (amountOut > vaultOut) amountOut = vaultOut;
        _checkCap(c, amt);
        amountIn = amountSpecified > 0 ? uint256(amountSpecified) : uint256(-amountSpecified);
    }

    /// exact-out: amt is denominated in tokenOut. INFERRED from live diff (see NOTES.md); rounding of amountIn is up.
    function _priceExactOut(Pair storage s, Ctx memory c, uint256 p, uint256 amt)
        internal view returns (uint256 amountIn, uint256 amountOut)
    {
        uint256 qty = c.baseIn ? amt : _toQuote(s, amt, p);
        if (s.hi != 0 && qty > s.hi) {
            amt = Math.mulDiv(amt, s.hi, qty);
            qty = s.hi;
        }
        uint256 p2 = _execPrice(s, c, p, qty);
        uint256 vaultOut = _bal(c.baseIn ? c.quote : c.base);
        if (amt > vaultOut) amt = vaultOut;
        amountOut = amt;
        if (c.baseIn) amountIn = Math.mulDiv(amt, uint256(s.scaleBase) * 1e8, p2 * uint256(s.scaleQuote), Math.Rounding.Ceil);
        else amountIn = Math.mulDiv(amt, p2 * uint256(s.scaleQuote), uint256(s.scaleBase) * 1e8, Math.Rounding.Ceil);
        _checkCap(c, amountIn);
    }

    function _execPrice(Pair storage s, Ctx memory c, uint256 p, uint256 qty) internal view returns (uint256 p2) {
        int256 skew = _skew(s, c, p);
        int256 edge = int256(uint256(s.baseEdge)) + _interp(s.sizeCurve, int256(Math.mulDiv(c.cum + qty, 1e18, s.lo)));
        uint256 BPS = 10_000e18;
        uint256 p1 = Math.mulDiv(p, uint256(int256(BPS) + skew), BPS);
        require(p1 != 0, "TW");
        p2 = Math.mulDiv(p1, uint256(c.baseIn ? int256(BPS) - edge : int256(BPS) + edge), BPS);
        require(p2 != 0, "TW");
    }

    function _out(Pair storage s, bool baseIn, uint256 amt, uint256 p2) internal view returns (uint256) {
        if (baseIn) return Math.mulDiv(amt * p2, s.scaleQuote, uint256(s.scaleBase) * 1e8);
        return Math.mulDiv(amt * uint256(s.scaleBase), 1e8, p2 * uint256(s.scaleQuote));
    }

    function _checkCap(Ctx memory c, uint256 amt) internal view {
        address tin = c.baseIn ? c.base : c.quote;
        uint256 capIn = maxInventory[tin];
        require(capIn == 0 || _bal(tin) + amt <= capIn, "IL");
    }

    function _skew(Pair storage s, Ctx memory c, uint256 p) internal view returns (int256) {
        uint256 vb = _bal(c.base);
        uint256 vq = _bal(c.quote);
        uint256 vBaseVal = Math.mulDiv(vb * p, s.scaleQuote, uint256(s.scaleBase) * 1e8);
        uint256 total = vBaseVal + vq;
        if (total == 0) return 0;
        uint256 target = Math.mulDiv(s.targetBps, total, 10_000);
        int256 s_ = (int256(vBaseVal) - int256(target)) * 1e18 / int256(total);
        return _interp(s.skewCurve, s_);
    }

    function _interp(Seg[] storage a, int256 v) internal view returns (int256) {
        uint256 n = a.length;
        require(n != 0, "EC");
        uint256 lo = 0;
        uint256 hi = n;
        while (lo < hi) {
            uint256 mid = Math.average(lo, hi);
            if (a[mid].x1 < v) lo = mid + 1; else hi = mid;
        }
        require(lo < n, "COR");
        Seg storage g = a[lo];
        require(v >= g.x0, "COR");
        int256 t = (v - g.x0) * 1e18 / (int256(g.x1) - int256(g.x0));
        int256 t2 = t * t / 1e18;
        int256 t3 = t * t2 / 1e18;
        return int256(g.c5) + t * g.c4 / 1e18 + t2 * g.c3 / 1e18 + t3 * g.c2 / 1e18;
    }

    receive() external payable {}
    fallback() external payable {}
}
