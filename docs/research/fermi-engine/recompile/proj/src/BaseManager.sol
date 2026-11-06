// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.25;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

using SafeERC20 for IERC20;

abstract contract BaseManager is ReentrancyGuard {
    address payable private immutable manager;
    address payable private vault;

    modifier onlyManager() {
        require(msg.sender == manager, "NM"); // Not Manager
        _;
    }

    constructor(address payable vaultAddress, address payable managerAddress) {
        require(vaultAddress != address(0), "ZA");
        require(managerAddress != address(0), "ZA");

        manager = managerAddress;
        vault = vaultAddress;
    }

    function setVaultAddress(address payable newVault) external onlyManager {
        require(newVault != address(0), "ZA");
        vault = newVault;
    }

    // ========= Withdrawals =========
    function _sendTokenToVault(address token, uint256 amount) internal {
        if (amount == 0) return;
        require(vault != address(0), "V0");
        IERC20(token).safeTransfer(vault, amount);
    }

    function _sendEthToVault(uint256 amount) internal {
        if (amount == 0) return;
        require(vault != address(0), "V0");
        (bool ok, ) = vault.call{value: amount}("");
        require(ok, "ESF"); // ETH Send Fail
    }

    function transferToken(address token, uint256 amount) public onlyManager nonReentrant {
        _sendTokenToVault(token, amount);
    }

    function withdrawAllTokens(address[] calldata tokenAddresses) public onlyManager nonReentrant {
        for (uint256 i = 0; i < tokenAddresses.length; ++i) {
            uint256 bal = IERC20(tokenAddresses[i]).balanceOf(address(this));
            _sendTokenToVault(tokenAddresses[i], bal);
        }
    }

    function transferEth(uint256 amount) public onlyManager nonReentrant {
        uint256 ethBalance = address(this).balance;
        require(ethBalance >= amount, "NEHTW"); // Not Enough ETH
        _sendEthToVault(amount);
    }

    function withdrawAllEth() public onlyManager nonReentrant {
        uint256 ethBalance = address(this).balance;
        _sendEthToVault(ethBalance);
    }

    // ========= General Execution (manager) =========
    function executeGeneral(address target, bytes calldata callData)
    public
    onlyManager
    returns (bool, bytes memory)
    {
        return target.call(callData);
    }

    function executeGeneralMulti(
        address[] calldata target,
        bytes[] calldata callData
    ) public onlyManager returns (bytes[] memory results) {
        results = new bytes[](target.length);
        for (uint256 i = 0; i < target.length; i++) {
            (bool success, bytes memory result) = executeGeneral(target[i], callData[i]);
            if (!success) {
                if (result.length < 68) revert("MC_FWNR");
                assembly {
                    result := add(result, 0x04)
                }
                revert(abi.decode(result, (string)));
            }
            results[i] = result;
        }
    }
}
