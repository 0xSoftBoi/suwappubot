// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

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
interface IPositionOracle {
    /// @notice Price of `token` quoted in USD, scaled to 1e18. MUST return 0 when
    ///         it has no fresh price rather than reverting or guessing.
    /// @dev    USD, not USDG: Robinhood Chain's Chainlink equity feeds are all
    ///         <TICKER>/USD. A USDG/USD feed exists (0x61B7e5650328764B076A108EFF5fa7282a1B9aD2)
    ///         if a USDG-denominated variant is ever wanted.
    function priceOf(address token) external view returns (uint256);
}

contract SuwappuPositions is ERC721, Ownable, ReentrancyGuard {
    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant TICKER_COUNT = 35;
    uint256 public constant MAX_PER_WALLET = 50;

    /// @notice Swap-fee discount in bps granted by holding any Position.
    ///         Deliberately material — mirrors economics.hold_discount_bps in
    ///         nft/position-cards/config.json. Bounded by MAX_HOLD_DISCOUNT_BPS so a
    ///         future owner cannot turn this into an unbounded fee giveaway.
    uint16 public holdDiscountBps = 40;
    uint16 public constant MAX_HOLD_DISCOUNT_BPS = 100;

    struct Position {
        uint8 tickerIndex; // index into the sorted ROBINHOOD_EQUITIES registry
        uint128 entryPrice; // USDG per unit, 1e18. 0 == minted while unpriced
        uint40 mintedAt; // block timestamp
        uint16 mintRank; // 1-based order of mint across the whole collection
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

    /// @notice Mint phases. Earned access first, open market last.
    ///         Founder   — the Suwappu snapshot (XP, volume, referrals)
    ///         Allowlist — active traders and partners
    ///         Public    — anyone
    enum Phase { Closed, Founder, Allowlist, Public }

    struct PhaseConfig {
        bytes32 merkleRoot; // 0 == open phase, no proof required
        uint96 price;       // wei per card
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
    event PhaseConfigured(Phase indexed phase, bytes32 merkleRoot, uint96 price, uint16 walletCap, uint16 allocation, uint64 startsAt, uint64 endsAt);
    event HoldDiscountSet(uint16 bps);
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
        bytes32[] calldata proof
    ) external payable nonReentrant {
        if (phase == Phase.Closed) revert BadPhase();
        if (!registrySealed) revert RegistryNotSealed();
        if (quantity == 0) revert ZeroQuantity();
        if (tickerIndex >= TICKER_COUNT) revert UnknownTicker();

        PhaseConfig memory cfg = phaseConfig[phase];
        if (cfg.startsAt == 0 || block.timestamp < cfg.startsAt) revert PhaseNotOpen();
        if (cfg.endsAt != 0 && block.timestamp > cfg.endsAt) revert PhaseNotOpen();
        if (msg.value != uint256(cfg.price) * quantity) revert WrongPayment();

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
        if (cfg.allocation != 0 && phaseMinted[phase] + quantity > cfg.allocation) {
            revert PhaseAllocationExhausted();
        }
        if (totalSupply + quantity > MAX_SUPPLY) revert SoldOut();
        if (tickerMinted[tickerIndex] + quantity > tickerCap[tickerIndex]) revert TickerSoldOut();

        mintedInPhase[phase][msg.sender] += quantity;
        phaseMinted[phase] += quantity;
        _mintRun(msg.sender, tickerIndex, quantity);
    }

    /// @notice Treasury / airdrop mint, bounded by RESERVE_MAX.
    function ownerMint(address to, uint8 tickerIndex, uint256 quantity) external onlyOwner {
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
        uint40 mintedAt = uint40(block.timestamp);
        uint128 entryPrice = uint128(entry);
        for (uint256 i = 0; i < quantity;) {
            uint256 tokenId = supply + i + 1;
            _positions[tokenId] = Position({
                tickerIndex: tickerIndex,
                entryPrice: entryPrice,
                mintedAt: mintedAt,
                mintRank: uint16(tokenId)
            });
            _safeMint(to, tokenId);
            emit Minted(tokenId, to, tickerIndex, entry);
            // GAS: the bound is `quantity`, checked against MAX_SUPPLY by every
            // caller, so this cannot overflow.
            unchecked {
                ++i;
            }
        }
        totalSupply = supply + quantity;
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

    function phaseIsLive(Phase phase) public view returns (bool) {
        PhaseConfig memory cfg = phaseConfig[phase];
        if (cfg.startsAt == 0 || block.timestamp < cfg.startsAt) return false;
        if (cfg.endsAt != 0 && block.timestamp > cfg.endsAt) return false;
        if (cfg.allocation != 0 && phaseMinted[phase] >= cfg.allocation) return false;
        return totalSupply < MAX_SUPPLY;
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

    /// @notice Live return in basis points vs the stamped entry. Positive = in profit.
    /// @return bps Return in basis points, or 0 when `priced` is false.
    /// @return priced False when either entry or current price is unavailable, in
    ///         which case `bps` is 0 and must not be read as a flat return.
    function returnBps(uint256 tokenId) public view returns (int256 bps, bool priced) {
        Position memory p = positionOf(tokenId);
        if (p.entryPrice == 0) return (0, false);
        uint256 cur = _oraclePrice(p.tickerIndex);
        if (cur == 0) return (0, false);
        // (cur - entry) / entry, in bps. Values fit comfortably in int256.
        int256 diff = int256(cur) - int256(uint256(p.entryPrice));
        return ((diff * 10_000) / int256(uint256(p.entryPrice)), true);
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

    /// @notice Discount in bps for an address, given candidate token ids.
    ///         Ownership is re-checked here, so ids sourced from an indexer can
    ///         only ever be ignored — never inflate the discount. Flat per holder
    ///         (not per card) so stacking cards cannot compound the giveaway.
    function discountBpsFor(address owner, uint256[] calldata tokenIds)
        external
        view
        returns (uint16)
    {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (_ownerOf(tokenIds[i]) == owner && owner != address(0)) {
                return holdDiscountBps;
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

    function setOracle(address o) external onlyOwner {
        oracle = IPositionOracle(o);
        emit OracleSet(o);
    }

    function setHoldDiscountBps(uint16 bps) external onlyOwner {
        if (bps > MAX_HOLD_DISCOUNT_BPS) revert DiscountTooHigh();
        holdDiscountBps = bps;
        emit HoldDiscountSet(bps);
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
        phaseConfig[phase] = PhaseConfig(
            merkleRoot, price, walletCap, allocation, startsAt, endsAt
        );
        emit PhaseConfigured(phase, merkleRoot, price, walletCap, allocation, startsAt, endsAt);
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
}
