// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title SUWP — Suwappu Protocol Token
 * @dev ERC-20 on Base. Minted by the protocol for:
 *   (1) Points-to-SUWP conversions (1,000 pts = 1 SUWP)
 *   (2) Staking epoch bonus emissions (10,000 SUWP/week)
 *
 * No hard supply cap — emission is governed by the MINTER_ROLE (protocol multisig).
 * Minter can be revoked to freeze supply permanently.
 */
contract SUWP is ERC20, AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // Track lifetime minted for transparency
    uint256 public totalMinted;

    event Minted(address indexed to, uint256 amount, string reason);

    constructor(address admin) ERC20("Suwappu", "SUWP") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    /**
     * @notice Mint SUWP to a recipient (points conversion or staking emission).
     * @param to      Recipient wallet (user's Base address)
     * @param amount  Amount in wei (18 decimals)
     * @param reason  Human-readable reason ("points_claim" | "staking_emission")
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
     * @notice Batch mint for weekly distribution (gas-efficient).
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

    function _update(address from, address to, uint256 value)
        internal override whenNotPaused
    {
        super._update(from, to, value);
    }
}
