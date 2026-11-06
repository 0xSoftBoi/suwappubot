// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice Maker-written price oracle for PropAMMPool. Skeleton — see ./README.md.
/// @dev Design lifted from the Metric / FermiSwap reverse-engineering (docs/research):
///      - a whitelisted hot "pusher" key writes (price, block) just before the taker trade
///        (builder-sequenced, e.g. Titan ACE);
///      - the pool, not the oracle, enforces freshness (same-block by default);
///      - UNLIKE FermiSwap (no bound at all) every push is bounded vs the price at the START of
///        the current block, so repeated pushes in one block/tx cannot compound; and the bound is
///        NEVER waived — after downtime or for a new feed the OWNER must `seed` a price.
///      A compromised pusher can therefore move a feed at most `maxStepBps` per block.
///      TODO(perf): Metric packs 4 feeds/slot and writes via a selector-less fallback (~8k gas/feed).
///      TODO(keys): Metric delegates hot keys by EIP-191 consent signature with a monotonic deadline.
contract PropOracle is Ownable2Step {
    using SafeCast for uint256;

    struct Feed {
        uint128 price; // quote-per-base, 1e18-scaled (whole-token terms, decimals-agnostic)
        uint128 refPrice; // price at the start of `blockNumber` (last price from an earlier block)
        uint64 blockNumber; // block of last push
        uint48 timestamp; // timestamp of last push
    }

    /// @notice max |new/ref - 1| in bps, where ref = price at the start of the current block.
    uint16 public maxStepBps;

    mapping(address => bool) public isPusher;
    mapping(uint256 => Feed) private _feeds;

    event PusherSet(address indexed pusher, bool allowed);
    event StepParamsSet(uint16 maxStepBps);
    event PriceUpdated(uint256 indexed feedId, uint128 price, uint64 blockNumber);
    event PriceSeeded(uint256 indexed feedId, uint128 price);

    error NotPusher();
    error ZeroPrice();
    error NotSeeded(uint256 feedId);
    error StepTooLarge(uint256 feedId, uint128 refPrice, uint128 newPrice);
    error LengthMismatch();
    error BadParam();

    constructor(address owner_, uint16 maxStepBps_) Ownable(owner_) {
        _setStepParams(maxStepBps_);
    }

    // ---------------------------------------------------------------- admin (owner = multisig)
    function setPusher(address pusher, bool allowed) external onlyOwner {
        isPusher[pusher] = allowed;
        emit PusherSet(pusher, allowed);
    }

    function setStepParams(uint16 maxStepBps_) external onlyOwner {
        _setStepParams(maxStepBps_);
    }

    function _setStepParams(uint16 maxStepBps_) internal {
        if (maxStepBps_ == 0 || maxStepBps_ > 1000) revert BadParam(); // <= 10% / block
        maxStepBps = maxStepBps_;
        emit StepParamsSet(maxStepBps_);
    }

    /// @notice Owner (re)seeds a feed: initial price, or recovery after downtime / a large move.
    ///         Not bounded — this is the ONLY unbounded write and it is owner-only.
    function seed(uint256 feedId, uint128 price) external onlyOwner {
        if (price == 0) revert ZeroPrice();
        Feed storage f = _feeds[feedId];
        f.price = price;
        f.refPrice = price;
        f.blockNumber = block.number.toUint64();
        f.timestamp = block.timestamp.toUint48();
        emit PriceSeeded(feedId, price);
    }

    // ---------------------------------------------------------------- hot path
    function push(uint256 feedId, uint128 price) external {
        if (!isPusher[msg.sender]) revert NotPusher();
        _push(feedId, price);
    }

    function pushMany(uint256[] calldata feedIds, uint128[] calldata prices) external {
        if (!isPusher[msg.sender]) revert NotPusher();
        if (feedIds.length != prices.length) revert LengthMismatch();
        for (uint256 i; i < feedIds.length; ++i) _push(feedIds[i], prices[i]);
    }

    function _push(uint256 feedId, uint128 price) internal {
        if (price == 0) revert ZeroPrice();
        Feed storage f = _feeds[feedId];
        uint128 old = f.price;
        if (old == 0) revert NotSeeded(feedId);
        // reference = price at the START of this block (compounding within a block is impossible)
        if (f.blockNumber != block.number) f.refPrice = old;
        uint128 ref = f.refPrice;
        uint256 diff = price > ref ? price - ref : ref - price;
        if (diff * 10_000 > uint256(ref) * maxStepBps) revert StepTooLarge(feedId, ref, price);
        f.price = price;
        f.blockNumber = block.number.toUint64();
        f.timestamp = block.timestamp.toUint48();
        emit PriceUpdated(feedId, price, f.blockNumber);
    }

    // ---------------------------------------------------------------- read
    function getPrice(uint256 feedId)
        external
        view
        returns (uint128 price, uint64 blockNumber, uint48 timestamp)
    {
        Feed storage f = _feeds[feedId];
        return (f.price, f.blockNumber, f.timestamp);
    }
}
