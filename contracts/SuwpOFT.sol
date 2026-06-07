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

    uint256 public totalMinted;

    event Minted(address indexed to, uint256 amount, string reason);

    constructor(
        address _lzEndpoint,  // LayerZero endpoint for this chain
        address _delegate,    // Initial owner / DVN config controller
        address _admin        // AccessControl admin
    )
        OFT("Suwappu", "SUWP", _lzEndpoint, _delegate)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MINTER_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
    }

    /**
     * @notice Mint SUWP — for points conversion or staking emission (canonical chain only).
     */
    function mint(address to, uint256 amount, string calldata reason)
        external
        onlyRole(MINTER_ROLE)
        whenNotPaused
    {
        totalMinted += amount;
        _mint(to, amount);
        emit Minted(to, amount, reason);
    }

    /**
     * @notice Gas-efficient batch mint for weekly distributions.
     */
    function batchMint(
        address[] calldata recipients,
        uint256[] calldata amounts,
        string calldata reason
    ) external onlyRole(MINTER_ROLE) whenNotPaused {
        require(recipients.length == amounts.length, "Length mismatch");
        for (uint256 i = 0; i < recipients.length; i++) {
            totalMinted += amounts[i];
            _mint(recipients[i], amounts[i]);
            emit Minted(recipients[i], amounts[i], reason);
        }
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // Override _update to enforce pause on all transfers (stake, bridge, trade)
    function _update(address from, address to, uint256 value)
        internal override whenNotPaused
    {
        super._update(from, to, value);
    }

    // Required override: OFT uses _debit/_credit for cross-chain, both call _burn/_mint
    // No additional logic needed — inheritance handles it
}
