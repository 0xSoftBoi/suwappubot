// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { OFT } from "@layerzerolabs/oft-evm/contracts/OFT.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title SuwpOFT — Suwappu Protocol Token (Omnichain)
 * @dev OFT = ERC-20 + LayerZero cross-chain messaging.
 *      Deploys identically on every supported chain.
 *      On Base (canonical chain): MINTER_ROLE mints for points claims + staking emissions.
 *      On other chains: tokens arrive via OFT cross-chain transfer (burn/mint).
 *
 * SECURITY: ≥2 DVNs required in LayerZero config (enforced via setEnforcedOptions).
 *           Use LayerZero DVN + Google Cloud DVN minimum.
 */
contract SuwpOFT is OFT, AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 public constant MAX_BATCH = 500;

    /// True only on the canonical chain (Base). Minting is allowed only here so
    /// the omnichain supply invariant holds — other chains receive supply via OFT.
    bool public immutable isCanonicalChain;

    uint256 public totalMinted;

    event Minted(address indexed to, uint256 amount, string reason);

    constructor(
        address _lzEndpoint,  // LayerZero endpoint for this chain
        address _delegate,    // Initial owner / DVN config controller
        address _admin,       // AccessControl admin
        bool _isCanonicalChain
    )
        OFT("Suwappu", "SUWP", _lzEndpoint, _delegate)
    {
        isCanonicalChain = _isCanonicalChain;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MINTER_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
    }

    /**
     * @notice Mint SUWP — points conversion / staking emission. Canonical chain only.
     */
    function mint(address to, uint256 amount, string calldata reason)
        external
        onlyRole(MINTER_ROLE)
        whenNotPaused
    {
        require(isCanonicalChain, "Mint only on canonical chain");
        totalMinted += amount;
        _mint(to, amount);
        emit Minted(to, amount, reason);
    }

    /**
     * @notice Gas-efficient batch mint for weekly distributions. Canonical chain only.
     */
    function batchMint(
        address[] calldata recipients,
        uint256[] calldata amounts,
        string calldata reason
    ) external onlyRole(MINTER_ROLE) whenNotPaused {
        require(isCanonicalChain, "Mint only on canonical chain");
        require(recipients.length == amounts.length, "Length mismatch");
        require(recipients.length <= MAX_BATCH, "Batch too large");
        for (uint256 i = 0; i < recipients.length; i++) {
            totalMinted += amounts[i];
            _mint(recipients[i], amounts[i]);
            emit Minted(recipients[i], amounts[i], reason);
        }
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // NOTE: pause() gates minting only — it deliberately does NOT block _update/
    // transfers. Pausing _update would brick inbound LayerZero bridge credits
    // (OFT _credit -> _mint -> _update) and could strand funds in transit. For an
    // emergency bridge halt, use LayerZero setPeer(0)/enforced options instead.
}
