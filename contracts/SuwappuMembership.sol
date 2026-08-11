// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

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
 * TIER SWITCHING. Remaining paid time converts by price ratio (remaining ×
 * oldPrice ÷ newPrice). An upgrade never burns value; a downgrade stretches time
 * value-neutrally, so gaming tier switches is pointless by construction.
 *
 * WHAT THIS IS NOT. The token pays nothing, yields nothing, cannot be sold, and
 * confers only access to Suwappu's own service — deliberately shaped so it cannot
 * read as an investment product. Modeled on ERC-5643 (renewable subscriptions):
 * expiry per token + `SubscriptionUpdate` events for indexers.
 */
contract SuwappuMembership is ERC721, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    enum Tier {
        Free,
        Pro,
        Premium,
        Enterprise
    }

    uint64 public constant PERIOD = 30 days;
    /// @dev Cap on periods per purchase — bounds treasury exposure to a fat-finger
    ///      and keeps expiry arithmetic far from overflow.
    uint256 public constant MAX_PERIODS_PER_PURCHASE = 24;
    /// @dev Cap on ops-comped time per call (grantTime), so a compromised owner
    ///      key cannot mint decades of ENTERPRISE in one transaction.
    uint64 public constant MAX_GRANT = 365 days;

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
    error NotMember();
    error Soulbound();
    error BadTier();
    error BadPeriods();
    error ZeroAddress();
    error GrantTooLong();

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
    function subscribe(Tier tier, uint256 periods) external nonReentrant {
        if (tier == Tier.Free) revert BadTier(); // FREE is minted, not bought
        if (periods == 0 || periods > MAX_PERIODS_PER_PURCHASE) revert BadPeriods();

        uint256 tokenId = tokenOf[msg.sender];
        if (tokenId == 0) tokenId = _mintTo(msg.sender);

        uint256 cost = pricePerPeriod[uint256(tier)] * periods;
        // CHECKS-EFFECTS-INTERACTIONS note: USDG is a known, non-reentrant Paxos
        // token and nonReentrant guards the whole function; the pull happens before
        // state so a failed payment can never leave a granted subscription behind.
        usdg.safeTransferFrom(msg.sender, treasury, cost);

        Membership storage m = _memberships[tokenId];
        uint64 nowTs = uint64(block.timestamp);
        uint64 base = nowTs;

        if (m.tier != Tier.Free && m.expiresAt > nowTs) {
            uint64 remaining = m.expiresAt - nowTs;
            if (m.tier == tier) {
                base = m.expiresAt;
            } else {
                // Convert remaining time across tiers by price ratio (floor).
                uint256 converted = (uint256(remaining) * pricePerPeriod[uint256(m.tier)])
                    / pricePerPeriod[uint256(tier)];
                base = nowTs + uint64(converted);
            }
        }

        m.tier = tier;
        m.expiresAt = base + uint64(periods) * PERIOD;

        emit Subscribed(tokenId, msg.sender, tier, periods, cost);
        emit SubscriptionUpdate(tokenId, m.expiresAt);
    }

    function _mintTo(address to) internal returns (uint256 tokenId) {
        if (tokenOf[to] != 0) revert AlreadyMember();
        tokenId = ++totalSupply;
        tokenOf[to] = tokenId;
        _memberships[tokenId] = Membership(Tier.Free, 0);
        _safeMint(to, tokenId);
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

    /// @notice Comp time (support remediation, promos). Bounded per call.
    function grantTime(address to, Tier tier, uint64 duration) external onlyOwner {
        if (tier == Tier.Free) revert BadTier();
        if (duration == 0 || duration > MAX_GRANT) revert GrantTooLong();
        uint256 tokenId = tokenOf[to];
        if (tokenId == 0) tokenId = _mintTo(to);
        Membership storage m = _memberships[tokenId];
        uint64 nowTs = uint64(block.timestamp);
        uint64 base = (m.tier == tier && m.expiresAt > nowTs) ? m.expiresAt : nowTs;
        m.tier = tier;
        m.expiresAt = base + duration;
        emit TimeGranted(tokenId, tier, duration);
        emit SubscriptionUpdate(tokenId, m.expiresAt);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// @notice Reprice a paid tier (new purchases/renewals only — existing time is
    ///         untouched). FREE stays 0 forever: repricing it would break both the
    ///         free mint and the tier-conversion math.
    function setPrice(Tier tier, uint256 price) external onlyOwner {
        if (tier == Tier.Free) revert BadTier();
        if (price == 0) revert BadPeriods();
        pricePerPeriod[uint256(tier)] = price;
        emit PriceSet(tier, price);
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
