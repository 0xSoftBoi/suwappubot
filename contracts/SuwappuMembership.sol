// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title SuwappuMembership — Suwappu subscriptions as soulbound NFTs on Robinhood Chain
 *
 * Chain 4663 (Arbitrum Orbit, native gas ETH). Testnet 46630.
 *
 * THE MODEL. The NFT IS the subscription. `mintFree()` gives every wallet a FREE
 * membership token (one per wallet, no expiry) — designed to be gas-sponsored via
 * Robinhood Chain's first-class ERC-4337 support (Alchemy Gas Manager / ZeroDev),
 * so claiming it costs the user nothing at all. `subscribe()` pays USDG — the
 * chain's anchor stable — to hold PRO / PREMIUM / ENTERPRISE for 30-day periods,
 * at prices that exactly match Suwappu's existing tiers (9.99 / 29.99 / 99.99).
 * The bot resolves a user's tier by calling `tierOf(address)`.
 *
 * SOULBOUND. One membership per wallet, non-transferable. A subscription is an
 * account attribute: transferable memberships create a resale market and a
 * shared-account vector, and would start to look like an instrument. Approvals
 * are disabled along with transfers.
 *
 * TIER SWITCHING. Remaining paid time converts by value, at the price it was
 * BOUGHT at. This conserves DOLLARS, not DAYS: upgrading 720 days of PRO to
 * ENTERPRISE buys ~72 days of ENTERPRISE, because that is what the money is
 * worth at the higher tier. Surfaces must say so before confirming an upgrade.
 * A same-tier renewal never converts — time already bought stays bought, even
 * across a price change.
 *
 * WHAT THIS IS NOT. The token pays nothing, yields nothing, cannot be sold, and
 * confers only access to Suwappu's own service — deliberately shaped so it cannot
 * read as an investment product. Modeled on ERC-5643 (renewable subscriptions):
 * expiry per token + `SubscriptionUpdate` events for indexers.
 */
contract SuwappuMembership is ERC721, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    enum Tier {
        Free,
        Pro,
        Premium,
        Enterprise
    }

    uint64 public constant PERIOD = 30 days;
    /// @dev Cap on periods PER CALL — a fat-finger guard only. Purchases stack
    ///      across calls by design (extending a subscription is legitimate); the
    ///      economic bound is that every period is paid at the snapshot price.
    uint256 public constant MAX_PERIODS_PER_PURCHASE = 24;
    /// @dev Cap on ops-comped time per call (grantTime), so a compromised owner
    ///      key cannot mint decades of ENTERPRISE in one transaction.
    uint64 public constant MAX_GRANT = 365 days;
    /// @dev Absolute ceiling on how far an expiry can ever be pushed. Without it
    ///      a single mispriced block (setPrice(PRO, 1)) lets a holder convert
    ///      existing time at a ~1e8 ratio into effectively infinite term, and the
    ///      contract has no burn or claw-back to undo it.
    uint64 public constant MAX_TERM = 3650 days;
    /// @dev Price bounds for setPrice. The floor is what makes MAX_TERM hard to
    ///      reach at all; the ceiling stops a fat-finger from pricing a tier out
    ///      of existence and mangling conversion ratios.
    uint256 public constant MIN_PRICE = 100_000; // 0.10 USDG
    uint256 public constant MAX_PRICE = 100_000_000_000; // 100,000 USDG

    /// @notice USDG (6 decimals) — canonical on chain 4663, pinned from
    ///         bot/config/tokens.py (0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168).
    IERC20 public immutable usdg;
    /// @notice Where subscription revenue lands. Multisig recommended.
    address public treasury;

    /// @notice USDG (6dp) per 30-day period, by tier. Matches the app's pricing.
    ///         [Free, Pro, Premium, Enterprise]
    uint256[4] public pricePerPeriod = [uint256(0), 9_990_000, 29_990_000, 99_990_000];

    struct Membership {
        Tier tier;
        uint64 expiresAt; // 0 == no expiry (FREE never expires)
        /// @dev USDG price per period the CURRENT paid time was bought at. Tier
        ///      conversions value remaining time at this snapshot, not the live
        ///      price, so setPrice() can never revalue outstanding time — no
        ///      front-running a reprice, no confiscation on a price cut.
        uint256 pricePaidPerPeriod;
    }

    uint256 public totalSupply;
    mapping(uint256 => Membership) private _memberships;
    mapping(address => uint256) public tokenOf; // 0 == no membership yet

    string private _baseTokenURI;

    /// @dev ERC-5643-style signal for indexers/marketplaces.
    event SubscriptionUpdate(uint256 indexed tokenId, uint64 expiration);
    event MembershipMinted(uint256 indexed tokenId, address indexed to);
    event Subscribed(
        uint256 indexed tokenId, address indexed payer, Tier tier, uint256 periods, uint256 paid
    );
    event TimeGranted(uint256 indexed tokenId, Tier tier, uint64 duration);
    event TreasurySet(address treasury);
    event PriceSet(Tier tier, uint256 pricePerPeriod);
    event BaseURISet(string baseURI);

    error AlreadyMember();
    error Soulbound();
    error BadTier();
    error BadPeriods();
    error ZeroAddress();
    error GrantTooLong();
    error GrantWouldShrinkTerm();
    error PriceOutOfRange();
    error TermCapReached();
    error PriceMoved();

    constructor(address usdg_, address treasury_, address initialOwner)
        ERC721("Suwappu Membership", "SUWA")
        Ownable(initialOwner)
    {
        if (usdg_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        usdg = IERC20(usdg_);
        treasury = treasury_;
    }

    // ─── Mint & subscribe ─────────────────────────────────────────────────────

    /// @notice Claim the free Suwappu membership. One per wallet, never expires.
    ///         This is the function the ERC-4337 gas-sponsorship policy targets,
    ///         so calling it costs the user nothing.
    function mintFree() external nonReentrant returns (uint256 tokenId) {
        return _mintTo(msg.sender);
    }

    /// @notice Hold `tier` for `periods` × 30 days, paying USDG at the on-chain
    ///         price. Mints the membership first if the wallet has none. Extends
    ///         an existing subscription of the same tier; switching tiers converts
    ///         remaining time by price ratio so no value is burned.
    /// @param maxPricePerPeriod Caller's price bound. `subscribe` pulls USDG at
    ///        whatever `pricePerPeriod` says at execution time, and subscription
    ///        flows use unlimited approvals, so without this a reprice landing
    ///        first (compromised key, or an honest change in the same block)
    ///        could pull MAX_PRICE * periods instead of the quoted amount.
    ///        Every other owner power is already bounded; this one was not.
    function subscribe(Tier tier, uint256 periods, uint256 maxPricePerPeriod)
        external
        nonReentrant
    {
        if (tier == Tier.Free) revert BadTier(); // FREE is minted, not bought
        if (periods == 0 || periods > MAX_PERIODS_PER_PURCHASE) revert BadPeriods();

        uint256 price = pricePerPeriod[uint256(tier)];
        if (price > maxPricePerPeriod) revert PriceMoved();
        uint256 cost = price * periods;
        // Checks-effects-interactions: the USDG pull happens before ANY state is
        // written (including the auto-mint), so a failed or reentrant payment can
        // never leave a granted subscription or a minted token behind.
        usdg.safeTransferFrom(msg.sender, treasury, cost);

        uint256 tokenId = tokenOf[msg.sender];
        if (tokenId == 0) tokenId = _mintTo(msg.sender);

        // allowClamp = false: a purchase that would be truncated at MAX_TERM
        // must revert rather than take payment for days it cannot deliver.
        uint64 expiry = _creditTime(tokenId, tier, uint64(periods) * PERIOD, price, false);
        emit Subscribed(tokenId, msg.sender, tier, periods, cost);
        emit SubscriptionUpdate(tokenId, expiry);
    }

    /// @dev Credit `duration` of `tier`, preserving the VALUE of unexpired time.
    ///
    ///      Two rules, and they must both hold or one of them opens a hole:
    ///
    ///      1. SAME TIER: time is time. Already-bought PRO days stay PRO days
    ///         even if PRO is repriced — a price rise must never shorten a
    ///         subscription somebody already paid for.
    ///      2. TIER CHANGE: remaining time converts by the ratio of the price it
    ///         was BOUGHT at (`pricePaidPerPeriod`) to the new tier's price.
    ///
    ///      `pricePaidPerPeriod` is then re-set to the VALUE-WEIGHTED AVERAGE of
    ///      retained and newly-bought time. Overwriting it with `newPrice`
    ///      instead would let a holder launder cheap time through a same-tier
    ///      renewal at the new price and then convert it 1:1 — which is exactly
    ///      the reprice front-run this snapshot exists to stop.
    /// @param allowClamp When false, a term that would exceed MAX_TERM reverts
    ///        instead of being silently truncated. Truncation preserves value
    ///        arithmetically but that value is UNREALIZABLE — every later
    ///        conversion is capped too — so a paid `subscribe` that clamps would
    ///        take money for days it can never deliver.
    function _creditTime(
        uint256 tokenId,
        Tier tier,
        uint64 duration,
        uint256 newPrice,
        bool allowClamp
    ) internal returns (uint64 expiry) {
        Membership storage m = _memberships[tokenId];
        uint64 nowTs = uint64(block.timestamp);

        uint256 retainedSeconds;
        uint256 retainedValue;
        if (m.tier != Tier.Free && m.expiresAt > nowTs) {
            uint256 remaining = m.expiresAt - nowTs;
            // oldPrice is 0 only for time that predates any snapshot; value it at
            // the new price rather than confiscating it.
            uint256 oldPrice = m.pricePaidPerPeriod == 0 ? newPrice : m.pricePaidPerPeriod;
            if (m.tier == tier) {
                retainedSeconds = remaining;
                retainedValue = remaining * oldPrice;
            } else {
                retainedSeconds = (remaining * oldPrice) / newPrice;
                retainedValue = retainedSeconds * newPrice;
            }
        }

        uint256 totalSeconds = retainedSeconds + duration;
        uint256 totalValue = retainedValue + uint256(duration) * newPrice;
        if (totalSeconds > MAX_TERM) {
            if (!allowClamp) revert TermCapReached();
            // Scale value with seconds. Keeping the full value over fewer seconds
            // inflates pricePaidPerPeriod above MAX_PRICE, encoding value that no
            // conversion can ever realise because conversions clamp too.
            totalValue = (totalValue * MAX_TERM) / totalSeconds;
            totalSeconds = MAX_TERM;
        }
        m.tier = tier;
        m.expiresAt = (uint256(nowTs) + totalSeconds).toUint64();
        m.pricePaidPerPeriod = totalValue / totalSeconds;
        return m.expiresAt;
    }

    function _mintTo(address to) internal returns (uint256 tokenId) {
        if (tokenOf[to] != 0) revert AlreadyMember();
        tokenId = ++totalSupply;
        tokenOf[to] = tokenId;
        _memberships[tokenId] = Membership(Tier.Free, 0, 0);
        // _mint, not _safeMint: the buyer is an ERC-4337 smart account and one
        // that omits onERC721Received would otherwise be unable to subscribe at
        // all — the USDG would transfer and the mint would revert the whole tx.
        // The token is soulbound, so there is no "stuck in a contract" risk.
        _mint(to, tokenId);
        emit MembershipMinted(tokenId, to);
        emit SubscriptionUpdate(tokenId, 0);
    }

    // ─── The view the bot consumes ────────────────────────────────────────────

    /// @notice Current tier of `who`, already expiry-collapsed: an expired paid
    ///         subscription reads as FREE. `expiresAt` is 0 for FREE.
    function tierOf(address who) external view returns (Tier tier, uint64 expiry) {
        uint256 tokenId = tokenOf[who];
        if (tokenId == 0) return (Tier.Free, 0);
        Membership memory m = _memberships[tokenId];
        if (m.tier == Tier.Free || m.expiresAt <= block.timestamp) return (Tier.Free, 0);
        return (m.tier, m.expiresAt);
    }

    function membershipOf(uint256 tokenId) external view returns (Membership memory) {
        _requireOwned(tokenId);
        return _memberships[tokenId];
    }

    /// @notice ERC-5643-style expiry accessor.
    function expiresAt(uint256 tokenId) external view returns (uint64) {
        _requireOwned(tokenId);
        return _memberships[tokenId].expiresAt;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Comp time (support remediation, promos). Bounded per call, and it
    ///         uses the SAME conversion as subscribe(), so comping a lower tier to
    ///         someone holding paid higher-tier time converts that time instead of
    ///         destroying it. Granted time is valued at the current list price.
    function grantTime(address to, Tier tier, uint64 duration) external onlyOwner nonReentrant {
        if (tier == Tier.Free) revert BadTier();
        if (duration == 0 || duration > MAX_GRANT) revert GrantTooLong();
        uint256 tokenId = tokenOf[to];
        if (tokenId == 0) tokenId = _mintTo(to);
        uint64 oldExpiry = _memberships[tokenId].expiresAt;
        // allowClamp = true: a goodwill grant may bump into the cap; it must not
        // revert on the operator, and no user funds are involved.
        uint64 expiry =
            _creditTime(tokenId, tier, duration, pricePerPeriod[uint256(tier)], true);
        // A goodwill grant of a DIFFERENT tier converts by value, which conserves
        // dollars but can shorten the calendar term — comping 7 days of ENTERPRISE
        // onto 720 days of PRO would cut the member back to ~79 days. The member
        // never consented to that, so refuse it: grant the same tier instead.
        if (expiry < oldExpiry) revert GrantWouldShrinkTerm();
        emit TimeGranted(tokenId, tier, duration);
        emit SubscriptionUpdate(tokenId, expiry);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// @notice Reprice a paid tier. Genuinely prospective: outstanding time is
    ///         valued at each token's purchase-time snapshot (pricePaidPerPeriod),
    ///         so a reprice cannot be front-run into cheap higher-tier time and a
    ///         price cut cannot confiscate existing holders' value. FREE stays 0.
    function setPrice(Tier tier, uint256 price) external onlyOwner {
        if (tier == Tier.Free) revert BadTier();
        if (price < MIN_PRICE || price > MAX_PRICE) revert PriceOutOfRange();
        pricePerPeriod[uint256(tier)] = price;
        emit PriceSet(tier, price);
    }

    /// @notice Disabled: renouncing would permanently freeze setTreasury — the
    ///         only recovery if the treasury is ever compromised — while
    ///         subscribe() keeps routing USDG to it.
    function renounceOwnership() public pure override {
        revert Soulbound();
    }

    function setBaseURI(string calldata baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
        emit BaseURISet(baseURI);
    }

    // ─── Soulbound enforcement ────────────────────────────────────────────────

    /// @dev Mint and burn only; transfers revert. Approvals are blocked too so the
    ///      token can never be listed anywhere.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
