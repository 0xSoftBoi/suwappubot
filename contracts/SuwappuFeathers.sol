// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title SuwappuFeathers — 10,000 generative feathers on Robinhood Chain
 *
 * Target: Robinhood Chain mainnet (chain id 4663, Arbitrum Orbit, native gas ETH).
 *         Testnet: chain id 46630.
 *
 * Collection art + metadata are generated deterministically by
 * nft/robinhood-10k/generate.py (seed committed in traits.json). The BAYC-style
 * provenance hash — sha256(concat(sha256(image_i)) for i in 1..10000) — is fixed
 * at deploy time, before any mint, so the token→art assignment is provably
 * committed in advance.
 *
 * Token ids are 1..10000. tokenURI = baseURI + tokenId (metadata files carry no
 * extension, matching the generator's output layout).
 */
contract SuwappuFeathers is ERC721, Ownable, ReentrancyGuard {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant MAX_PER_WALLET = 20;

    /// @notice sha256 provenance hash of the full 10k image set, fixed at deploy.
    bytes32 public immutable provenanceHash;

    uint256 public totalSupply;
    uint256 public mintPrice; // in wei; 0 = free mint
    bool public mintOpen;
    bool public metadataFrozen;

    string private _baseTokenURI;
    mapping(address => uint256) public minted;

    event MintOpenSet(bool open);
    event MintPriceSet(uint256 price);
    event BaseURISet(string baseURI);
    event MetadataFrozen();

    error MintClosed();
    error SoldOut();
    error WalletLimitExceeded();
    error WrongPayment();
    error MetadataIsFrozen();
    error ZeroQuantity();

    constructor(string memory baseURI, bytes32 provenance, address initialOwner)
        ERC721("Suwappu Feathers", "FTHR")
        Ownable(initialOwner)
    {
        _baseTokenURI = baseURI;
        provenanceHash = provenance;
    }

    // ─── Mint ─────────────────────────────────────────────────────────────────

    function mint(uint256 quantity) external payable nonReentrant {
        if (!mintOpen) revert MintClosed();
        if (quantity == 0) revert ZeroQuantity();
        if (totalSupply + quantity > MAX_SUPPLY) revert SoldOut();
        if (minted[msg.sender] + quantity > MAX_PER_WALLET) revert WalletLimitExceeded();
        if (msg.value != mintPrice * quantity) revert WrongPayment();

        minted[msg.sender] += quantity;
        uint256 first = totalSupply + 1;
        totalSupply += quantity;
        for (uint256 i = 0; i < quantity; i++) {
            _safeMint(msg.sender, first + i);
        }
    }

    /// @notice Owner airdrop/treasury mint (team reserve, promos). Same supply cap,
    ///         exempt from the per-wallet limit.
    function ownerMint(address to, uint256 quantity) external onlyOwner {
        if (quantity == 0) revert ZeroQuantity();
        if (totalSupply + quantity > MAX_SUPPLY) revert SoldOut();
        uint256 first = totalSupply + 1;
        totalSupply += quantity;
        for (uint256 i = 0; i < quantity; i++) {
            _safeMint(to, first + i);
        }
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setMintOpen(bool open) external onlyOwner {
        mintOpen = open;
        emit MintOpenSet(open);
    }

    function setMintPrice(uint256 price) external onlyOwner {
        mintPrice = price;
        emit MintPriceSet(price);
    }

    /// @notice Point at the final IPFS CID after upload; freeze makes it permanent.
    function setBaseURI(string calldata baseURI) external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        _baseTokenURI = baseURI;
        emit BaseURISet(baseURI);
    }

    function freezeMetadata() external onlyOwner {
        metadataFrozen = true;
        emit MetadataFrozen();
    }

    function withdraw(address payable to) external onlyOwner nonReentrant {
        (bool ok,) = to.call{ value: address(this).balance }("");
        require(ok, "withdraw failed");
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
