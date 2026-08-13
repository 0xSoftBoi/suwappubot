// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RobinhoodChainlinkOracle — DISPLAY oracle for Robinhood Stock Tokens
 *
 * Implements IPositionOracle for SuwappuPositions by reading the official
 * Chainlink feeds that Robinhood Chain publishes for its Stock Tokens.
 *
 * Verified live against chain 4663 on 2026-08-11 (see nft/position-cards/feeds.json):
 *   - 35 of the ~96 tokenized equities have a Chainlink feed. The rest have none,
 *     which is why the collection only covers the priced set.
 *   - Every feed uses the standard Chainlink V3 aggregator and reports 8 decimals;
 *     `decimals()` is still read per feed rather than hardcoded, per Robinhood's docs.
 *   - Heartbeat is 86400s on all of them.
 *   - Stock Tokens expose `oraclePaused()` and `uiMultiplier()`; both were called
 *     successfully (NVDA returned false and 1e18).
 *
 * The feed answer is the token's TOTAL RETURN VALUE: the underlying share price
 * multiplied by the token's corporate-action multiplier (dividends, splits). It is
 * already multiplier-adjusted, so it must NOT be scaled by `uiMultiplier()` again.
 * That also means a card's return is a total-return figure, not a bare share-price move.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS A DISPLAY ORACLE. DO NOT USE IT TO VALUE COLLATERAL.
 * `maxAge` is deliberately generous because these are 24/5 equity feeds that go
 * quiet over weekends and holidays; blanking every card each weekend would be
 * worse than showing a Friday price. A lending or liquidation system needs a much
 * tighter bound plus its own circuit breakers. The only consumer here is a
 * collectible card's displayed P&L and its stamped entry price.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `priceOf` NEVER reverts. Every failure path — unknown token, stale round, paused
 * oracle, sequencer down, non-positive answer — returns 0, which SuwappuPositions
 * treats as "unpriced". A reverting oracle would brick minting.
 */
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IStockToken {
    /// @notice True while a corporate action is being applied. Advisory per Robinhood's docs.
    function oraclePaused() external view returns (bool);
    /// @dev Corporate-action multiplier, 1e18 == unadjusted. Robinhood Chain is
    ///      the only chain that publishes this on-chain for licensed equities.
    function uiMultiplier() external view returns (uint256);
}

contract RobinhoodChainlinkOracle is Ownable {
    struct Feed {
        address aggregator;
        uint8 decimals;
        uint32 maxAge; // seconds before a round is considered stale
    }

    /// @dev 3 days. Covers a normal weekend gap on a 24/5 feed with a 24h heartbeat.
    uint32 public constant DEFAULT_MAX_AGE = 3 days;
    /// @dev Chainlink's recommended wait after the sequencer comes back up.
    uint256 public constant SEQUENCER_GRACE_PERIOD = 3600;

    mapping(address => Feed) public feedOf;
    bool public feedsSealed;

    /// @notice Chainlink L2 Sequencer Uptime Feed. Robinhood Chain is an Arbitrum
    ///         Orbit L2 and Robinhood's docs say to check the sequencer before
    ///         trusting a price — but as of 2026-08-11 Chainlink's Robinhood Chain
    ///         feed directory publishes NO sequencer uptime feed (checked: zero
    ///         entries matching sequencer/uptime). So this stays unset and the
    ///         check is skipped; a guessed address would silently zero every card.
    ///         Set it the moment one is published and the check enforces itself.
    address public sequencerUptimeFeed;

    event FeedSet(address indexed token, address aggregator, uint8 decimals, uint32 maxAge);
    event FeedsSealed(uint256 count);
    event SequencerUptimeFeedSet(address feed);

    error FeedsAlreadySealed();
    error LengthMismatch();
    error ZeroAddress();

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Register token -> aggregator pairs. `decimals()` is read from each
    ///         aggregator at registration so a feed that reports something other
    ///         than 8 still scales correctly.
    function setFeeds(address[] calldata tokens, address[] calldata aggregators)
        external
        onlyOwner
    {
        if (feedsSealed) revert FeedsAlreadySealed();
        if (tokens.length != aggregators.length) revert LengthMismatch();
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == address(0) || aggregators[i] == address(0)) revert ZeroAddress();
            uint8 dec = AggregatorV3Interface(aggregators[i]).decimals();
            feedOf[tokens[i]] = Feed(aggregators[i], dec, DEFAULT_MAX_AGE);
            emit FeedSet(tokens[i], aggregators[i], dec, DEFAULT_MAX_AGE);
        }
    }

    function setMaxAge(address token, uint32 maxAge) external onlyOwner {
        if (feedsSealed) revert FeedsAlreadySealed();
        feedOf[token].maxAge = maxAge;
        emit FeedSet(token, feedOf[token].aggregator, feedOf[token].decimals, maxAge);
    }

    function setSequencerUptimeFeed(address feed) external onlyOwner {
        sequencerUptimeFeed = feed;
        emit SequencerUptimeFeedSet(feed);
    }

    function sealFeeds(uint256 count) external onlyOwner {
        if (feedsSealed) revert FeedsAlreadySealed();
        feedsSealed = true;
        emit FeedsSealed(count);
    }

    // ─── Reads ────────────────────────────────────────────────────────────────

    /// @notice True when the L2 sequencer is up and past its grace period, or when
    ///         no uptime feed is configured.
    function sequencerOk() public view returns (bool) {
        address f = sequencerUptimeFeed;
        if (f == address(0)) return true;
        try AggregatorV3Interface(f).latestRoundData() returns (
            uint80, int256 answer, uint256 startedAt, uint256, uint80
        ) {
            // 0 == up. Also require the grace period to have elapsed since restart.
            if (answer != 0) return false;
            if (startedAt == 0) return false;
            return block.timestamp - startedAt > SEQUENCER_GRACE_PERIOD;
        } catch {
            return false;
        }
    }

    /// @notice Price of `token` in USD, scaled to 1e18. Returns 0 when unavailable.
    /// @dev    Never reverts — SuwappuPositions relies on 0 meaning "unpriced".
    uint256 internal constant ONE = 1e18;
    /// @dev A 1000:1 split either way is far outside anything a listed equity
    ///      does; beyond this band the token is malfunctioning, not adjusting.
    uint256 internal constant MIN_MULTIPLIER = 1e15;
    uint256 internal constant MAX_MULTIPLIER = 1e21;

    function priceOf(address token) external view returns (uint256) {
        Feed memory f = feedOf[token];
        if (f.aggregator == address(0)) return 0;
        if (!sequencerOk()) return 0;

        // Advisory: Robinhood pauses the oracle during corporate actions. Staleness
        // is still the primary defence, so a token that does not implement this is
        // treated as not paused rather than rejected.
        try IStockToken(token).oraclePaused() returns (bool paused) {
            if (paused) return 0;
        } catch {}

        try AggregatorV3Interface(f.aggregator).latestRoundData() returns (
            uint80, int256 answer, uint256, uint256 updatedAt, uint80
        ) {
            if (answer <= 0 || updatedAt == 0) return 0;
            if (block.timestamp > updatedAt && block.timestamp - updatedAt > f.maxAge) return 0;
            uint256 price = uint256(answer);
            // Normalise to 1e18 regardless of what the feed reports.
            if (f.decimals < 18) return price * (10 ** (18 - f.decimals));
            if (f.decimals > 18) return price / (10 ** (f.decimals - 18));
            return price;
        } catch {
            return 0;
        }
    }

    /// @notice The corporate-action multiplier for `token`, 1e18 == unadjusted.
    ///
    /// @dev    This is the hook that makes Robinhood Chain different. These are
    ///         LICENSED equities, so they undergo real corporate actions —
    ///         splits, consolidations — and the chain publishes the resulting
    ///         multiplier on-chain rather than leaving it to an off-chain
    ///         indexer. `priceOf` already returns 0 while `oraclePaused()` is
    ///         true, which is precisely the window in which an action lands, so
    ///         a consumer that reads the price without also reading THIS is
    ///         comparing two numbers taken on different bases.
    ///
    ///         Never reverts, and never returns 0: an unknown multiplier is
    ///         reported as 1e18 (unadjusted), which makes every downstream
    ///         ratio a no-op rather than a division by zero. Clamped to a sane
    ///         band so a malfunctioning token cannot rebase a stored basis into
    ///         nonsense.
    function multiplierOf(address token) public view returns (uint64) {
        try IStockToken(token).uiMultiplier() returns (uint256 m) {
            if (m < MIN_MULTIPLIER || m > MAX_MULTIPLIER) return uint64(ONE);
            return uint64(m);
        } catch {
            return uint64(ONE);
        }
    }

    /// @notice Diagnostics for operators — why is a token unpriced right now?
    function debugPrice(address token)
        external
        view
        returns (uint256 price1e18, bool hasFeed, bool sequencerUp, bool paused, uint256 updatedAt)
    {
        Feed memory f = feedOf[token];
        hasFeed = f.aggregator != address(0);
        sequencerUp = sequencerOk();
        try IStockToken(token).oraclePaused() returns (bool p) {
            paused = p;
        } catch {}
        if (hasFeed) {
            try AggregatorV3Interface(f.aggregator).latestRoundData() returns (
                uint80, int256 answer, uint256, uint256 u, uint80
            ) {
                updatedAt = u;
                if (answer > 0) {
                    price1e18 = f.decimals < 18
                        ? uint256(answer) * (10 ** (18 - f.decimals))
                        : uint256(answer);
                }
            } catch {}
        }
    }
}
