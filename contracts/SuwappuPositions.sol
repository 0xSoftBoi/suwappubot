// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title SuwappuPositions — 10,000 live position cards on Robinhood Chain
 *
 * Chain 4663 (Arbitrum Orbit / Nitro, native gas ETH). Testnet 46630.
 *
 * WHY THIS CHAIN. Robinhood Chain is the only place where ~96 real-world equities
 * trade as ordinary ERC-20s with an on-chain DEX price. That makes a position card
 * that is actually *bound to a live price* possible here and nowhere else.
 *
 * THE MECHANIC
 *   1. You CHOOSE your ticker. No random assignment, no rarity lottery — you mint a
 *      position on the name you actually believe in, up to that ticker's cap.
 *   2. Your ENTRY PRICE is read from the oracle at mint and stamped on-chain forever.
 *      Minting later in a rising market means a worse basis, permanently. That is the
 *      scarcity — it is earned by timing, not rolled.
 *   3. The card renders LIVE: return is computed on-chain from entry vs the current
 *      oracle price, so the art and grade change with the market instead of being a
 *      frozen jpeg.
 *   4. Grade (Underwater -> Moonshot) follows performance. Status is earned by being
 *      right, not by a lucky trait roll.
 *
 * NOT A FINANCIAL INSTRUMENT. A card records an observed price and displays a notional
 * return. It pays nothing, is redeemable for nothing, confers no equity, no shareholder
 * rights and no economic exposure to any issuer or to the referenced ERC-20. The only
 * utility is a discount on Suwappu's own swap fee. See the compliance note in
 * bot/config/tokens.py.
 */
/// @dev Minimal Chainlink aggregator view, for the ETH/USD feed that converts a
///      USD-cent mint price into wei at purchase time. Robinhood Chain publishes
///      ETH/USD at 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9 (8 decimals,
///      verified live).
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80);
}

interface IPositionOracle {
    /// @notice Price of `token` quoted in USD, scaled to 1e18. MUST return 0 when
    ///         it has no fresh price rather than reverting or guessing.
    /// @dev    USD, not USDG: Robinhood Chain's Chainlink equity feeds are all
    ///         <TICKER>/USD. A USDG/USD feed exists (0x61B7e5650328764B076A108EFF5fa7282a1B9aD2)
    ///         if a USDG-denominated variant is ever wanted.
    function priceOf(address token) external view returns (uint256);
    function multiplierOf(address token) external view returns (uint96);
}

contract SuwappuPositions is ERC721, ERC2981, Ownable2Step, ReentrancyGuard {
    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant TICKER_COUNT = 35;
    uint256 public constant MAX_PER_WALLET = 50;

    /// @notice Swap-fee discount granted by holding any Position, expressed in
    ///         basis points OF THE TIER RATE the holder is already on (10000 =
    ///         100% off), NOT basis points of the swap itself. e.g. 4000 means
    ///         "40% off whatever rate you're on" — a FREE-tier holder (100 bps)
    ///         pays 60 bps, an ENTERPRISE holder (10 bps) pays 6 bps. Deliberately
    ///         material — mirrors economics.hold_discount_fraction in
    ///         nft/position-cards/config.json. Bounded by
    ///         MAX_HOLD_DISCOUNT_FRACTION_BPS so a future owner cannot turn this
    ///         into an unbounded fee giveaway.
    uint16 public holdDiscountFractionBps = 4000;
    uint16 public constant MAX_HOLD_DISCOUNT_FRACTION_BPS = 6000;

    struct Position {
        uint8 tickerIndex; // index into the sorted ROBINHOOD_EQUITIES registry
        uint96 entryPrice; // USDG per unit, 1e18. 0 == minted while unpriced
        uint40 mintedAt; // block timestamp
        uint16 mintRank; // 1-based order of mint across the whole collection
        // Corporate-action multiplier observed at mint, 1e18 == unadjusted.
        //
        // uint96, NOT uint64. The oracle clamps the multiplier to 1e21, but
        // uint64 tops out at ~1.845e19 — so the top 54x of the permitted band
        // was unrepresentable and `uint64(m)` truncated it SILENTLY. A single
        // 20:1 split (20e18) wrapped to 1.553e18, restating the basis by 12.9x
        // in the wrong direction, and the wrapped value was stamped into this
        // immutable field with no restamp path. uint96 holds ~7.9e28, four
        // orders of magnitude above the clamp.
        //
        // Slot still packs exactly: 8 + 96 + 40 + 16 + 96 = 256 bits.
        uint96 entryMultiplier;
    }

    /// @notice Immutable per-ticker supply caps, sealed at construction.
    uint16[35] public tickerCap;
    uint16[35] public tickerMinted;

    address[35] public tickerToken; // ERC-20 address per ticker index
    bool public registrySealed;

    IPositionOracle public oracle;

    mapping(uint256 => Position) private _positions;
    mapping(address => uint256) public minted;

    uint256 public totalSupply;

    // ─── Pricing ──────────────────────────────────────────────────────────────
    // Phases carry a price in USD CENTS, not wei. A wei price silently reprices
    // the whole mint whenever ETH moves — a 20% ETH rally makes a "$20 card"
    // cost $24 without anyone touching the contract. The card is quoted in
    // dollars, so it should be charged in dollars.
    AggregatorV3Interface public ethUsdFeed;
    /// @dev `decimals()` cached at set time. Reading it inside `ethUsd()` put an
    ///      external call in the SUCCESS BODY of the try, not in the tried call,
    ///      so a feed whose `decimals()` reverted propagated straight out —
    ///      bricking `mint()`, `quote()` and `mintState()`, which is exactly what
    ///      the bounded fallback exists to prevent. Now a feed that cannot
    ///      answer `decimals()` is rejected at `setEthUsdFeed` instead.
    uint8 public ethUsdFeedDecimals;
    /// @dev Sanity band on the feed. A compromised or misconfigured aggregator
    ///      reporting $0.01 or $1e9 must not let the mint be bought for dust or
    ///      become unbuyable — outside the band we fall back to a fixed wei price.
    uint256 public constant MIN_ETH_USD_8DP = 100e8; // $100
    uint256 public constant MAX_ETH_USD_8DP = 100_000e8; // $100k
    uint256 public constant MAX_FEED_AGE = 3 hours;
    /// @notice Used when the feed is stale or out of band. Bounded so a fallback
    ///         can never be set to an extractive number.
    uint256 public fallbackWeiPerUsdCent;

    /// @notice Last ETH/USD (8dp) the feed reported in-band, and when. Written on
    ///         every mint, so an outage prices against the last price the market
    ///         actually printed rather than a constant the owner set months ago.
    /// @dev    Packed into one slot. The flat `fallbackWeiPerUsdCent` is only
    ///         correct at the ETH price it was configured for, yet it engaged
    ///         precisely when ETH had MOVED: set for $3,000, an ETH drop to $99
    ///         put the feed out of band and sold $20 cards for $0.66 — the
    ///         remaining supply sweeping for 3% of intended. This cache bounds
    ///         that to however far ETH moves inside MAX_LAST_GOOD_AGE.
    uint192 public lastGoodEthUsd8dp;
    uint64 public lastGoodAt;
    /// @notice How long a cached price may be used once the feed goes bad.
    uint256 public constant MAX_LAST_GOOD_AGE = 7 days;
    uint256 public constant MAX_FALLBACK_WEI_PER_CENT = 1e15; // $1 <= 0.1 ETH

    // ─── Credible end ─────────────────────────────────────────────────────────
    /// @notice Once announced the mint cannot be extended, and once closed no
    ///         token can ever be minted again — including the team reserve.
    uint64 public mintEndTime;
    bool public mintingClosedForever;
    bool public paused;

    /// @notice Mint phases. Earned access first, open market last.
    ///         Founder   — the Suwappu snapshot (XP, volume, referrals)
    ///         Allowlist — active traders and partners
    ///         Public    — anyone
    enum Phase { Closed, Founder, Allowlist, Public }

    struct PhaseConfig {
        bytes32 merkleRoot; // 0 == open phase, no proof required
        uint96 price;       // USD CENTS per card (not wei — see Pricing)
        uint16 walletCap;   // hard per-wallet cap inside this phase
        uint16 allocation;  // max cards mintable in this phase (0 == up to MAX_SUPPLY)
        uint64 startsAt;    // unix seconds, 0 == not scheduled
        uint64 endsAt;      // unix seconds, 0 == no end
    }

    mapping(Phase => PhaseConfig) public phaseConfig;
    mapping(Phase => uint256) public phaseMinted;
    mapping(Phase => mapping(address => uint256)) public mintedInPhase;

    /// @notice Team/treasury reserve. BOUNDED at construction — an unbounded
    ///         owner mint is a rug vector and was a recurring 2021-22 complaint.
    uint256 public constant RESERVE_MAX = 200;
    uint256 public reserveMinted;

    string private _renderBaseURI;

    event Minted(uint256 indexed tokenId, address indexed to, uint8 tickerIndex, uint256 entryPrice);
    event OracleSet(address oracle);
    event RegistrySealed();
    event EthUsdFeedSet(address feed);
    event FallbackPriceSet(uint256 weiPerUsdCent);
    event EndAnnounced(uint64 endTime);
    event MintingClosedForever(uint256 finalSupply);
    event PausedSet(bool paused);
    event PhaseConfigured(Phase indexed phase, bytes32 merkleRoot, uint96 price, uint16 walletCap, uint16 allocation, uint64 startsAt, uint64 endsAt);
    event HoldDiscountSet(uint16 fractionBps);
    event BaseURISet(string baseURI);

    error PhaseNotOpen();
    error NotAllowlisted();
    error PhaseAllocationExhausted();
    error ReserveExhausted();
    error BadPhase();
    error ZeroQuantity();
    error SoldOut();
    error TickerSoldOut();
    error UnknownTicker();
    error WalletLimitExceeded();
    error WrongPayment();
    error RegistryAlreadySealed();
    error RegistryNotSealed();
    error UnknownToken();
    error DiscountTooHigh();
    error BadCaps();
    error PriceNotConfigured();
    error MintPaused();
    error MintEnded();
    error MintingIsClosed();
    error EndAlreadyAnnounced();
    error InvalidEndTime();
    error FallbackOutOfBand();
    error RefundFailed();
    error BadFeed();
    error PriceZero();
    error UnpricedAtMint();
    error FreePhaseUnbounded();
    error RenounceDisabled();

    constructor(
        uint16[35] memory caps,
        address[35] memory tokens,
        string memory renderBaseURI,
        address initialOwner
    ) ERC721("Suwappu Positions", "POS") Ownable(initialOwner) {
        uint256 sum;
        for (uint256 i = 0; i < TICKER_COUNT; i++) {
            sum += caps[i];
            tickerCap[i] = caps[i];
            tickerToken[i] = tokens[i];
        }
        if (sum != MAX_SUPPLY) revert BadCaps();
        _renderBaseURI = renderBaseURI;
    }

    // ─── Mint ─────────────────────────────────────────────────────────────────

    /// @notice Mint `quantity` positions on `tickerIndex` in `phase`, stamping the
    ///         current oracle price as the entry basis.
    ///
    /// @param proof Merkle proof for an allowlisted phase. The leaf is rebuilt from
    ///        `msg.sender` INSIDE this function, so a proof issued to one wallet is
    ///        useless to any other — the single most important rule for allowlists.
    ///        `maxQty` is bound into the leaf too, so a tiered list needs one root.
    ///
    /// @dev   Notably absent: a `tx.origin == msg.sender` bot gate. It does not stop
    ///        a determined bot (which can mint from an EOA anyway) and it DOES break
    ///        Safe and every account-abstraction wallet — a well-documented way to
    ///        lock real users out. Access is controlled by the allowlist and the
    ///        per-wallet caps instead.
    ///
    /// @dev   A zero oracle price is stamped as 0 rather than reverting, so an
    ///        oracle outage cannot brick the mint.
    function mint(
        Phase phase,
        uint8 tickerIndex,
        uint256 quantity,
        uint256 maxQty,
        bytes32[] calldata proof,
        bool allowUnpriced
    ) external payable nonReentrant {
        if (phase == Phase.Closed) revert BadPhase();
        if (!registrySealed) revert RegistryNotSealed();
        if (quantity == 0) revert ZeroQuantity();
        if (tickerIndex >= TICKER_COUNT) revert UnknownTicker();

        if (paused) revert MintPaused();
        if (mintingClosedForever) revert MintingIsClosed();
        if (mintEndTime != 0 && block.timestamp > mintEndTime) revert MintEnded();

        PhaseConfig memory cfg = phaseConfig[phase];
        if (cfg.startsAt == 0 || block.timestamp < cfg.startsAt) revert PhaseNotOpen();
        if (cfg.endsAt != 0 && block.timestamp > cfg.endsAt) revert PhaseNotOpen();

        // USD-denominated: convert at purchase time and REFUND the remainder.
        // Requiring an exact wei amount against a moving feed would make most
        // transactions revert on a price tick between quoting and mining.
        _cacheEthUsd();
        uint256 cost = _weiForCents(uint256(cfg.price) * quantity);
        if (msg.value < cost) revert WrongPayment();

        // A card whose entry price stamps as 0 is permanently defective: the
        // basis is written once, there is no restamp, and returnBps() reports
        // (0,false) forever. `priceOf` returns 0 whenever the sequencer is
        // down, the token's oracle is paused, or the round is older than
        // maxAge — and maxAge is 3 days against a 24/5 equity feed, so a long
        // weekend plus a market holiday is ~89h and clears it for all 35
        // tickers at once.
        //
        // Not bricking the mint during an outage is the right goal, but selling
        // a defective card at full price is the wrong way to reach it. A PAID
        // mint now reverts unless the buyer explicitly opts in; a free phase is
        // unaffected, and `allowUnpriced` keeps the escape hatch open for
        // anyone who genuinely wants the token regardless.
        if (cfg.price != 0 && !allowUnpriced && _oraclePrice(tickerIndex) == 0) {
            revert UnpricedAtMint();
        }

        // Allowlisted phase: prove membership and respect the per-address grant.
        if (cfg.merkleRoot != bytes32(0)) {
            bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, maxQty))));
            if (!MerkleProof.verify(proof, cfg.merkleRoot, leaf)) revert NotAllowlisted();
            if (mintedInPhase[phase][msg.sender] + quantity > maxQty) {
                revert WalletLimitExceeded();
            }
        }

        if (cfg.walletCap != 0 && mintedInPhase[phase][msg.sender] + quantity > cfg.walletCap) {
            revert WalletLimitExceeded();
        }
        // Hard backstop across every phase. MAX_PER_WALLET was declared and then
        // never read by mint(), so it documented a limit the contract did not
        // have — and `walletCap == 0` means "no cap", so a misconfigured phase
        // was unbounded per wallet. Now the constant is the floor under any
        // configuration mistake.
        if (minted[msg.sender] + quantity > MAX_PER_WALLET) revert WalletLimitExceeded();
        if (cfg.allocation != 0 && phaseMinted[phase] + quantity > cfg.allocation) {
            revert PhaseAllocationExhausted();
        }
        if (totalSupply + quantity > MAX_SUPPLY) revert SoldOut();
        if (tickerMinted[tickerIndex] + quantity > tickerCap[tickerIndex]) revert TickerSoldOut();

        mintedInPhase[phase][msg.sender] += quantity;
        phaseMinted[phase] += quantity;
        _mintRun(msg.sender, tickerIndex, quantity);

        // Refund last, after all state is written (CEI).
        uint256 refund = msg.value - cost;
        if (refund > 0) {
            (bool ok,) = msg.sender.call{ value: refund }("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @notice Treasury / airdrop mint, bounded by RESERVE_MAX.
    /// @dev Honours `mintEndTime` and `paused` exactly as `mint()` does.
    ///      `announceEnd` is described as a promise the contract keeps rather
    ///      than a tweet; an owner who can still airdrop 200 reserve cards after
    ///      the announced end is not keeping it.
    function ownerMint(address to, uint8 tickerIndex, uint256 quantity)
        external
        onlyOwner
        nonReentrant
    {
        if (mintingClosedForever) revert MintingIsClosed();
        if (paused) revert MintPaused();
        if (mintEndTime != 0 && block.timestamp > mintEndTime) revert MintEnded();
        if (quantity == 0) revert ZeroQuantity();
        if (tickerIndex >= TICKER_COUNT) revert UnknownTicker();
        if (reserveMinted + quantity > RESERVE_MAX) revert ReserveExhausted();
        if (totalSupply + quantity > MAX_SUPPLY) revert SoldOut();
        if (tickerMinted[tickerIndex] + quantity > tickerCap[tickerIndex]) revert TickerSoldOut();
        reserveMinted += quantity;
        _mintRun(to, tickerIndex, quantity);
    }

    function _mintRun(address to, uint8 tickerIndex, uint256 quantity) internal {
        uint256 entry = _oraclePrice(tickerIndex);
        minted[to] += quantity;
        tickerMinted[tickerIndex] += uint16(quantity);
        // GAS: hold the counter in memory and write it once. Reading and writing
        // `totalSupply` inside the loop cost an SLOAD + SSTORE per token, so a
        // 5-card mint paid for five counter updates to reach the same value.
        uint256 supply = totalSupply;
        // Written BEFORE the loop: _safeMint hands control to the recipient's
        // onERC721Received, and a reentrant caller must not observe a stale
        // supply. (Both entry points are nonReentrant too — this is the belt
        // behind the braces.)
        totalSupply = supply + quantity;
        uint40 mintedAt = uint40(block.timestamp);
        // Entry price is stamped once and immutable by design, and `oracle` is
        // owner-settable at any time, so narrow it with a checked cast rather
        // than silently recording a wrapped value forever.
        uint96 entryPrice = SafeCast.toUint96(entry);
        // Stamped alongside the price, because the two are only comparable on
        // the same basis. See entryBasis().
        uint96 entryMul = _oracleMultiplier(tickerIndex);
        for (uint256 i = 0; i < quantity;) {
            uint256 tokenId = supply + i + 1;
            _positions[tokenId] = Position({
                tickerIndex: tickerIndex,
                entryPrice: entryPrice,
                mintedAt: mintedAt,
                mintRank: uint16(tokenId),
                entryMultiplier: entryMul
            });
            _safeMint(to, tokenId);
            emit Minted(tokenId, to, tickerIndex, entry);
            // GAS: the bound is `quantity`, checked against MAX_SUPPLY by every
            // caller, so this cannot overflow.
            unchecked {
                ++i;
            }
        }
    }

    /// @notice How many cards `who` can still mint in `phase`, given their grant.
    function remainingFor(Phase phase, address who, uint256 maxQty)
        external
        view
        returns (uint256)
    {
        PhaseConfig memory cfg = phaseConfig[phase];
        uint256 used = mintedInPhase[phase][who];
        uint256 limit = cfg.merkleRoot != bytes32(0) ? maxQty : type(uint256).max;
        if (cfg.walletCap != 0 && cfg.walletCap < limit) limit = cfg.walletCap;
        return used >= limit ? 0 : limit - used;
    }

    /// @notice Everything a mint page needs, in ONE call.
    ///
    ///         Assembling this client-side takes six or seven separate reads
    ///         (phase config, wallet usage, ticker remaining, quote, live flags,
    ///         supply). On a cold wallet over mobile that is the difference
    ///         between a page that appears instantly and one that pops in field
    ///         by field. Pure view — no money-path surface.
    ///
    /// @param who        Wallet being quoted; pass address(0) for a logged-out view.
    /// @param phase      Phase to describe.
    /// @param tickerIndex Ticker the user is looking at.
    /// @param maxQty     The allowlist grant `who` claims to hold (0 for open phases);
    ///                   this is only used to compute their remaining allowance and is
    ///                   NOT trusted for minting, which still verifies the proof.
    struct MintState {
        // phase
        bool live;
        bool requiresProof;
        uint96 priceUsdCents;
        uint256 priceWei; // for `quantity` = 1
        bool pricedByFeed; // false == bounded fallback in force
        uint64 startsAt;
        uint64 endsAt;
        uint16 walletCap;
        uint16 allocation;
        uint256 phaseMintedSoFar;
        // wallet
        uint256 walletMinted;
        uint256 walletRemaining;
        // supply
        uint256 tickerRemaining;
        uint256 minted;
        uint256 supplyRemaining;
        // lifecycle
        bool isPaused;
        bool ended;
        bool closedForever;
    }

    function mintState(address who, Phase phase, uint8 tickerIndex, uint256 maxQty)
        external
        view
        returns (MintState memory st)
    {
        PhaseConfig memory cfg = phaseConfig[phase];
        st.requiresProof = cfg.merkleRoot != bytes32(0);
        st.priceUsdCents = cfg.price;
        st.startsAt = cfg.startsAt;
        st.endsAt = cfg.endsAt;
        st.walletCap = cfg.walletCap;
        st.allocation = cfg.allocation;
        st.phaseMintedSoFar = phaseMinted[phase];

        (, uint8 priceSource) = effectiveEthUsd();
        // `pricedByFeed` stays strictly "the live feed answered" so a UI can
        // still flag degraded pricing; source 1 (cached last-good) is degraded.
        st.pricedByFeed = priceSource == 0;
        if (priceSource != 2 || fallbackWeiPerUsdCent != 0) {
            st.priceWei = _weiForCents(uint256(cfg.price));
        }

        st.isPaused = paused;
        st.closedForever = mintingClosedForever;
        st.ended = mintEndTime != 0 && block.timestamp > mintEndTime;
        st.live = phaseIsLive(phase) && !st.isPaused && !st.ended && !st.closedForever;

        if (who != address(0)) {
            st.walletMinted = mintedInPhase[phase][who];
            uint256 limit = st.requiresProof ? maxQty : type(uint256).max;
            if (cfg.walletCap != 0 && cfg.walletCap < limit) limit = cfg.walletCap;
            st.walletRemaining = st.walletMinted >= limit ? 0 : limit - st.walletMinted;
        }

        if (tickerIndex < TICKER_COUNT) {
            st.tickerRemaining = tickerCap[tickerIndex] - tickerMinted[tickerIndex];
        }
        st.minted = totalSupply;
        st.supplyRemaining = MAX_SUPPLY - totalSupply;
    }

    function phaseIsLive(Phase phase) public view returns (bool) {
        PhaseConfig memory cfg = phaseConfig[phase];
        if (cfg.startsAt == 0 || block.timestamp < cfg.startsAt) return false;
        if (cfg.endsAt != 0 && block.timestamp > cfg.endsAt) return false;
        if (cfg.allocation != 0 && phaseMinted[phase] >= cfg.allocation) return false;
        return totalSupply < MAX_SUPPLY;
    }

    /// @notice Wei cost of `quantity` cards in `phase`, at the current ETH/USD.
    ///         Public so a UI shows the exact number the transaction will charge
    ///         instead of guessing.
    function quote(Phase phase, uint256 quantity) public view returns (uint256) {
        return _weiForCents(uint256(phaseConfig[phase].price) * quantity);
    }

    /// @notice Live ETH/USD used for pricing, 8dp, and whether it came from the
    ///         feed (false == the bounded fallback is in force).
    function ethUsd() public view returns (uint256 price8dp, bool fromFeed) {
        AggregatorV3Interface feed = ethUsdFeed;
        if (address(feed) == address(0)) return (0, false);
        try feed.latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (answer <= 0) return (0, false);
            uint256 p = uint256(answer);
            uint8 dec = ethUsdFeedDecimals;
            if (dec < 8) p *= 10 ** (8 - dec);
            if (dec > 8) p /= 10 ** (dec - 8);
            if (p < MIN_ETH_USD_8DP || p > MAX_ETH_USD_8DP) return (0, false);
            // A round that never happened, or one stamped in the future, is not
            // fresh — it is broken. Skipping the staleness check whenever
            // `updatedAt > block.timestamp` let such a feed read fresh forever.
            if (updatedAt == 0 || updatedAt > block.timestamp) return (0, false);
            if (block.timestamp - updatedAt > MAX_FEED_AGE) return (0, false);
            return (p, true);
        } catch {
            return (0, false);
        }
    }

    /// @notice The ETH/USD (8dp) pricing will actually use, and where it came
    ///         from. `source`: 0 = live feed, 1 = cached last-good, 2 = none.
    function effectiveEthUsd() public view returns (uint256 price8dp, uint8 source) {
        (uint256 p, bool ok) = ethUsd();
        if (ok) return (p, 0);
        uint256 cached = lastGoodEthUsd8dp;
        if (cached != 0 && block.timestamp - lastGoodAt <= MAX_LAST_GOOD_AGE) {
            return (cached, 1);
        }
        return (0, 2);
    }

    function _weiForCents(uint256 cents) internal view returns (uint256) {
        if (cents == 0) return 0;
        // Ladder, most trustworthy first: live feed, then the last price the feed
        // actually printed in-band, and only then the owner's flat constant.
        (uint256 price8dp, uint8 source) = effectiveEthUsd();
        if (source != 2) {
            // cents -> wei: (cents / 100) USD * 1e18 / (price8dp / 1e8)
            return (cents * 1e18 * 1e8) / (price8dp * 100);
        }
        uint256 fb = fallbackWeiPerUsdCent;
        if (fb == 0) revert PriceNotConfigured();
        return cents * fb;
    }

    /// @dev Called from the non-view mint paths. Cheap when the feed is healthy
    ///      and the slot is already warm; the point is that an outage inherits a
    ///      real market price instead of a stale constant.
    function _cacheEthUsd() internal {
        (uint256 p, bool ok) = ethUsd();
        if (ok && p != lastGoodEthUsd8dp) {
            lastGoodEthUsd8dp = uint192(p); // < MAX_ETH_USD_8DP, cannot truncate
            lastGoodAt = uint64(block.timestamp);
        } else if (ok) {
            lastGoodAt = uint64(block.timestamp);
        }
    }

    /// @dev The multiplier in force for `tickerIndex` right now. 1e18 when the
    ///      oracle is unset or the token does not publish one, so every ratio
    ///      built on it degrades to a no-op rather than to a divide-by-zero.
    function _oracleMultiplier(uint8 tickerIndex) internal view returns (uint96) {
        if (address(oracle) == address(0)) return uint96(1e18);
        address token = tickerToken[tickerIndex];
        if (token == address(0)) return uint96(1e18);
        try oracle.multiplierOf(token) returns (uint96 m) {
            return m == 0 ? uint96(1e18) : m;
        } catch {
            return uint96(1e18);
        }
    }

    function _oraclePrice(uint8 tickerIndex) internal view returns (uint256) {
        if (address(oracle) == address(0)) return 0;
        address token = tickerToken[tickerIndex];
        if (token == address(0)) return 0;
        try oracle.priceOf(token) returns (uint256 p) {
            return p;
        } catch {
            return 0;
        }
    }

    // ─── Live state ───────────────────────────────────────────────────────────

    function positionOf(uint256 tokenId) public view returns (Position memory) {
        if (_ownerOf(tokenId) == address(0)) revert UnknownToken();
        return _positions[tokenId];
    }

    /// @notice Current oracle price for a token's ticker (1e18), or 0 if unpriced.
    function currentPrice(uint256 tokenId) public view returns (uint256) {
        return _oraclePrice(positionOf(tokenId).tickerIndex);
    }

    /// @notice The stamped entry price restated on TODAY's basis.
    ///
    /// @dev    These are licensed equities, so they split. When one does, the
    ///         chain moves `uiMultiplier()` and every price after that point is
    ///         quoted on a new basis — while the entry price stamped at mint is
    ///         still on the old one. Comparing them directly would print a
    ///         fabricated ±90% on a card whose holder did nothing but hold
    ///         through a 10:1 split, and the position would look destroyed.
    ///
    ///         So the basis travels with the price: entry x (then / now). A
    ///         ticker that has never had a corporate action has a ratio of
    ///         exactly 1 and is unaffected.
    ///
    /// @dev    NO ADJUSTMENT IS APPLIED, and that is the correct behaviour —
    ///         this function returns the stamped entry unchanged. Robinhood's
    ///         integration guide is explicit: "The Chainlink price already
    ///         includes the corporate-action multiplier (dividends, splits), so
    ///         the value you read is the token's full price — don't apply the
    ///         multiplier yourself."
    ///
    ///         Both sides of the comparison come from that same feed, so both
    ///         are TOKEN prices and both are already multiplier-adjusted. They
    ///         are directly comparable and a corporate action does not move
    ///         them relative to each other: a 4:1 split takes shares-per-token
    ///         to 4 while the per-share price quarters, leaving the token price
    ///         continuous.
    ///
    ///         An earlier version of this scaled the basis by then/now, which
    ///         double-applied the multiplier and fabricated a return out of a
    ///         corporate action. Against CRWD — live at exactly 4e18 after a
    ///         4:1 split — it would have reported +300% on a position that had
    ///         not moved. Six of this collection's own 35 tickers already carry
    ///         a multiplier above 1e18 today (SGOV, ORCL, AAPL, ASML, MU,
    ///         DELL), so the error was live from the first mint, not theoretical.
    ///
    ///         `entryMultiplier` is still stamped, and is still worth stamping:
    ///         it is what makes `corporateAction()` and `sharesPerToken()`
    ///         expressible. It just has no place in a price comparison.
    ///
    ///         Direction, now confirmed rather than assumed: the multiplier only
    ///         ever RISES, for both splits and reinvested dividends, because
    ///         underlying shares = raw amount * uiMultiplier / 1e18 (ERC-8056).
    function entryBasis(uint256 tokenId) public view returns (uint256) {
        return uint256(positionOf(tokenId).entryPrice);
    }

    /// @notice How many shares one token represents now, versus at mint.
    ///
    /// @dev    18-dp fixed point: 4e18 means one token backs four times the
    ///         shares it did at mint. THIS is what the stamped multiplier is
    ///         for — a quantity change, never a price adjustment. Returns 1e18
    ///         when the oracle has no multiplier, so callers degrade to "no
    ///         change" rather than to zero.
    function sharesPerToken(uint256 tokenId) external view returns (uint256) {
        Position memory p = positionOf(tokenId);
        uint96 then_ = p.entryMultiplier == 0 ? uint96(1e18) : p.entryMultiplier;
        uint96 nowMul = _oracleMultiplier(p.tickerIndex);
        if (nowMul == 0 || then_ == 0) return 1e18;
        return (uint256(nowMul) * 1e18) / uint256(then_);
    }

    /// @notice Has this position lived through a corporate action?
    ///
    /// @dev    The one piece of status in this collection that cannot be bought,
    ///         rolled, or minted for — you had to have been holding when a real
    ///         licensed equity split. It is only expressible here because
    ///         Robinhood Chain is the only chain that publishes the multiplier
    ///         on-chain for licensed instruments.
    function corporateAction(uint256 tokenId)
        external
        view
        returns (bool survived, uint96 atMint, uint96 current)
    {
        Position memory p = positionOf(tokenId);
        atMint = p.entryMultiplier == 0 ? uint96(1e18) : p.entryMultiplier;
        current = _oracleMultiplier(p.tickerIndex);
        survived = p.entryPrice != 0 && current != atMint;
    }

    /// @notice Live return in basis points vs the stamped entry. Positive = in profit.
    /// @return bps Return in basis points, or 0 when `priced` is false.
    /// @return priced False when either entry or current price is unavailable, in
    ///         which case `bps` is 0 and must not be read as a flat return.
    function returnBps(uint256 tokenId) public view returns (int256 bps, bool priced) {
        Position memory p = positionOf(tokenId);
        if (p.entryPrice == 0) return (0, false);
        uint256 cur = _oraclePrice(p.tickerIndex);
        if (cur == 0) return (0, false);
        // Both sides come from the same multiplier-adjusted Chainlink feed, so
        // the stamped entry is used as-is. Scaling it by the multiplier here was
        // the bug — see entryBasis().
        uint256 basis = entryBasis(tokenId);
        if (basis == 0) return (0, false);
        int256 diff = int256(cur) - int256(basis);
        return ((diff * 10_000) / int256(basis), true);
    }

    /// @notice 0=Underwater 1=Flat 2=In Profit 3=Runner 4=Multiple 5=Moonshot.
    ///         Unpriced cards report Flat.
    function grade(uint256 tokenId) external view returns (uint8) {
        (int256 bps, bool priced) = returnBps(tokenId);
        if (!priced) return 1;
        if (bps >= 50_000) return 5;
        if (bps >= 10_000) return 4;
        if (bps >= 2_500) return 3;
        if (bps >= 200) return 2;
        if (bps >= -200) return 1;
        return 0;
    }

    // ─── Fee perk ─────────────────────────────────────────────────────────────

    /// @notice Discount in basis points OF THE TIER RATE (10000 = 100% off) for
    ///         an address, given candidate token ids. Ownership is re-checked
    ///         here, so ids sourced from an indexer can only ever be ignored —
    ///         never inflate the discount. Flat per holder (not per card) so
    ///         stacking cards cannot compound the giveaway.
    function discountFractionBpsFor(address owner, uint256[] calldata tokenIds)
        external
        view
        returns (uint16)
    {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (_ownerOf(tokenIds[i]) == owner && owner != address(0)) {
                return holdDiscountFractionBps;
            }
        }
        return 0;
    }

    /// @notice Whether `owner` holds a position on `tickerIndex`.
    function holdsTicker(address owner, uint256[] calldata tokenIds, uint8 tickerIndex)
        external
        view
        returns (bool)
    {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 id = tokenIds[i];
            if (_ownerOf(id) != owner || owner == address(0)) continue;
            if (_positions[id].tickerIndex == tickerIndex) return true;
        }
        return false;
    }

    function remaining(uint8 tickerIndex) external view returns (uint256) {
        if (tickerIndex >= TICKER_COUNT) revert UnknownTicker();
        return tickerCap[tickerIndex] - tickerMinted[tickerIndex];
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Lock the ticker->ERC20 registry before minting can start.
    function sealRegistry() external onlyOwner {
        if (registrySealed) revert RegistryAlreadySealed();
        registrySealed = true;
        emit RegistrySealed();
    }

    /// @dev Rejects a feed that cannot answer `decimals()`, and caches the
    ///      answer so `ethUsd()` never makes an untried external call.
    function setEthUsdFeed(address feed) external onlyOwner {
        if (feed != address(0)) {
            try AggregatorV3Interface(feed).decimals() returns (uint8 dec) {
                if (dec > 36) revert BadFeed();
                ethUsdFeedDecimals = dec;
            } catch {
                revert BadFeed();
            }
        } else {
            ethUsdFeedDecimals = 0;
        }
        ethUsdFeed = AggregatorV3Interface(feed);
        emit EthUsdFeedSet(feed);
    }

    /// @notice Wei charged per USD cent when the feed is unusable. Bounded, so a
    ///         fallback can never be set to an extractive number.
    function setFallbackWeiPerUsdCent(uint256 weiPerCent) external onlyOwner {
        if (weiPerCent > MAX_FALLBACK_WEI_PER_CENT) revert FallbackOutOfBand();
        fallbackWeiPerUsdCent = weiPerCent;
        emit FallbackPriceSet(weiPerCent);
    }

    /// @notice Disabled. This contract custodies every wei of mint revenue
    ///         (`withdraw` is onlyOwner) and owns the only levers that can pause
    ///         a live mint or repoint a broken price feed. A single unguarded
    ///         call inherited from Ownable would strand the funds and freeze the
    ///         mint open with a feed nobody can fix.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    /// @notice Announce a hard end for the mint. Callable once and never
    ///         extendable, so "minting ends on X" is a promise the contract keeps
    ///         rather than a tweet.
    function announceEnd(uint64 endTime) external onlyOwner {
        if (mintEndTime != 0) revert EndAlreadyAnnounced();
        if (endTime <= block.timestamp) revert InvalidEndTime();
        mintEndTime = endTime;
        emit EndAnnounced(endTime);
    }

    /// @notice One-way door: after this NO token can ever be minted again, not by
    ///         the public and not by the owner. Supply becomes provably final,
    ///         which is the difference between "10,000 max" and "10,000, and here
    ///         is the transaction proving no more can exist".
    function closeMintingForever() external onlyOwner {
        mintingClosedForever = true;
        emit MintingClosedForever(totalSupply);
    }

    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    function setOracle(address o) external onlyOwner {
        oracle = IPositionOracle(o);
        emit OracleSet(o);
    }

    /// @param fractionBps Basis points OF THE TIER RATE (10000 = 100% off), NOT
    ///        basis points of the swap. 4000 means "40% off whatever rate the
    ///        holder is already on". Named for the unit on purpose: the previous
    ///        `bps` spelling read as basis-points-of-the-swap, and an owner acting
    ///        on that reading would set a discount two orders of magnitude from
    ///        the one they intended. Bounded by MAX_HOLD_DISCOUNT_FRACTION_BPS.
    function setHoldDiscountFractionBps(uint16 fractionBps) external onlyOwner {
        if (fractionBps > MAX_HOLD_DISCOUNT_FRACTION_BPS) revert DiscountTooHigh();
        holdDiscountFractionBps = fractionBps;
        emit HoldDiscountSet(fractionBps);
    }

    /// @notice Configure a phase. Set `merkleRoot` to 0 for an open phase.
    /// @dev    `allocation` is what stops the classic failure of an allowlist that
    ///         is larger than the supply reserved for it: the phase simply cannot
    ///         oversell, so latecomers get a clean revert rather than a gas war.
    function configurePhase(
        Phase phase,
        bytes32 merkleRoot,
        uint96 price,
        uint16 walletCap,
        uint16 allocation,
        uint64 startsAt,
        uint64 endsAt
    ) external onlyOwner {
        if (phase == Phase.Closed) revert BadPhase();
        // A phase priced at 0 mints its whole allocation for free, with no burn
        // and no claw-back, and `mintState.priceWei` reads 0 so the UI shows
        // nothing wrong. Free mints are a deliberate act, not a missing
        // argument — so `configurePhase` still refuses a 0, and an intentional
        // free phase goes through `configureFreePhase` where the word "free"
        // appears in the call the owner signs.
        if (price == 0) revert PriceZero();
        phaseConfig[phase] = PhaseConfig(
            merkleRoot, price, walletCap, allocation, startsAt, endsAt
        );
        emit PhaseConfigured(phase, merkleRoot, price, walletCap, allocation, startsAt, endsAt);
    }

    /// @notice Configure a phase that mints for FREE.
    ///
    /// @dev    The Founder phase is free by design — it is the reward for users
    ///         who already built the product's volume. That intent needs its own
    ///         door: `configurePhase` rejects a 0 price so a dropped argument
    ///         cannot silently give away an allocation, and this function makes
    ///         the giveaway explicit in the transaction the owner signs.
    function configureFreePhase(
        Phase phase,
        bytes32 merkleRoot,
        uint16 walletCap,
        uint16 allocation,
        uint64 startsAt,
        uint64 endsAt
    ) external onlyOwner {
        if (phase == Phase.Closed) revert BadPhase();
        // A free phase with no allowlist and no wallet cap is an open faucet for
        // the whole allocation; require at least one of the two.
        // An open free phase must be bounded by ALLOCATION, not just a wallet
        // cap: allocation == 0 means "up to MAX_SUPPLY", so `walletCap = 1` with
        // no allowlist still hands the entire 10,000 to 10,000 fresh addresses
        // for gas. MAX_PER_WALLET is per-address and does nothing here.
        // An open (unallowlisted) free phase needs BOTH bounds. A wallet cap
        // alone is not a bound: allocation == 0 means "up to MAX_SUPPLY", so
        // walletCap = 1 with no allowlist still hands the whole 10,000 to
        // 10,000 fresh addresses for gas, and MAX_PER_WALLET is per-address so
        // it does nothing here. An allocation alone is not a bound either —
        // one address takes the lot.
        if (merkleRoot == bytes32(0) && (walletCap == 0 || allocation == 0)) {
            revert FreePhaseUnbounded();
        }
        phaseConfig[phase] = PhaseConfig(merkleRoot, 0, walletCap, allocation, startsAt, endsAt);
        emit PhaseConfigured(phase, merkleRoot, 0, walletCap, allocation, startsAt, endsAt);
    }

    /// @notice Renderer base. Cards are live, so metadata is intentionally dynamic
    ///         and this stays mutable — freezing it would freeze the P&L.
    function setBaseURI(string calldata baseURI) external onlyOwner {
        _renderBaseURI = baseURI;
        emit BaseURISet(baseURI);
    }

    function withdraw(address payable to) external onlyOwner nonReentrant {
        (bool ok,) = to.call{ value: address(this).balance }("");
        require(ok, "withdraw failed");
    }

    function _baseURI() internal view override returns (string memory) {
        return _renderBaseURI;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
