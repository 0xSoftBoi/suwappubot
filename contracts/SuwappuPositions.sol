// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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
    /// @notice Price of `token` quoted in USDG, scaled to 1e18. MUST return 0 when
    ///         it has no fresh price rather than reverting or guessing.
    function priceOf(address token) external view returns (uint256);
}

contract SuwappuPositions is ERC721, Ownable, ReentrancyGuard {
    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant TICKER_COUNT = 96;
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
    uint16[96] public tickerCap;
    uint16[96] public tickerMinted;

    address[96] public tickerToken; // ERC-20 address per ticker index
    bool public registrySealed;

    IPositionOracle public oracle;

    mapping(uint256 => Position) private _positions;
    mapping(address => uint256) public minted;

    uint256 public totalSupply;
    uint256 public mintPrice;
    bool public mintOpen;

    string private _renderBaseURI;

    event Minted(uint256 indexed tokenId, address indexed to, uint8 tickerIndex, uint256 entryPrice);
    event OracleSet(address oracle);
    event RegistrySealed();
    event MintOpenSet(bool open);
    event MintPriceSet(uint256 price);
    event HoldDiscountSet(uint16 bps);
    event BaseURISet(string baseURI);

    error MintClosed();
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
        uint16[96] memory caps,
        address[96] memory tokens,
        string memory renderBaseURI,
        address initialOwner
    ) ERC721("Suwappu Positions", "POS") Ownable(initialOwner) {
        uint256 sum;
        for (uint256 i = 0; i < 96; i++) {
            sum += caps[i];
            tickerCap[i] = caps[i];
            tickerToken[i] = tokens[i];
        }
        if (sum != MAX_SUPPLY) revert BadCaps();
        _renderBaseURI = renderBaseURI;
    }

    // ─── Mint ─────────────────────────────────────────────────────────────────

    /// @notice Mint `quantity` positions on `tickerIndex`, stamping the current
    ///         oracle price as the entry basis.
    /// @dev    A zero oracle price is stamped as 0 rather than reverting, so an
    ///         oracle outage cannot brick the mint. Unpriced cards render as such
    ///         and are excluded from return calculations.
    function mint(uint8 tickerIndex, uint256 quantity) external payable nonReentrant {
        if (!mintOpen) revert MintClosed();
        if (!registrySealed) revert RegistryNotSealed();
        if (quantity == 0) revert ZeroQuantity();
        if (tickerIndex >= TICKER_COUNT) revert UnknownTicker();
        if (totalSupply + quantity > MAX_SUPPLY) revert SoldOut();
        if (tickerMinted[tickerIndex] + quantity > tickerCap[tickerIndex]) revert TickerSoldOut();
        if (minted[msg.sender] + quantity > MAX_PER_WALLET) revert WalletLimitExceeded();
        if (msg.value != mintPrice * quantity) revert WrongPayment();

        uint256 entry = _oraclePrice(tickerIndex);
        minted[msg.sender] += quantity;
        tickerMinted[tickerIndex] += uint16(quantity);

        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = totalSupply + 1;
            totalSupply = tokenId;
            _positions[tokenId] = Position({
                tickerIndex: tickerIndex,
                entryPrice: uint128(entry),
                mintedAt: uint40(block.timestamp),
                mintRank: uint16(tokenId)
            });
            _safeMint(msg.sender, tokenId);
            emit Minted(tokenId, msg.sender, tickerIndex, entry);
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

    function setMintOpen(bool open) external onlyOwner {
        mintOpen = open;
        emit MintOpenSet(open);
    }

    function setMintPrice(uint256 price) external onlyOwner {
        mintPrice = price;
        emit MintPriceSet(price);
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
