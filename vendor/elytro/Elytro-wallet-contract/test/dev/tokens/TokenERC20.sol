// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TokenERC20 is ERC20 {
    uint8 private immutable __decimals;

    constructor(uint8 _decimals) ERC20("ERC20", "ERC20") {
        _mint(msg.sender, 1000000000000000000000000);
        __decimals = _decimals;
    }

    function decimals() public view override returns (uint8) {
        return __decimals;
    }

    function sudoMint(address _to, uint256 _amount) external {
        _mint(_to, _amount);
    }

    function sudoTransfer(address _from, address _to) external {
        _transfer(_from, _to, balanceOf(_from));
    }

    function sudoApprove(address _from, address _to, uint256 _amount) external {
        _approve(_from, _to, _amount);
    }

    function increaseAllowance(address spender, uint256 addedValue) public virtual returns (bool) {
        address owner = _msgSender();
        _approve(owner, spender, allowance(owner, spender) + addedValue);
        return true;
    }

    function decreaseAllowance(address spender, uint256 subtractedValue) public virtual returns (bool) {
        address owner = _msgSender();
        uint256 currentAllowance = allowance(owner, spender);
        require(currentAllowance >= subtractedValue, "ERC20: decreased allowance below zero");
        unchecked {
            _approve(owner, spender, currentAllowance - subtractedValue);
        }

        return true;
    }
}
