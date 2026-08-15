// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test-only attacker. SuwappuPositions.mint() refunds overpayment with a
///      raw call AFTER _safeMint has already handed control to the receiver, so
///      there are two reentrancy windows: onERC721Received and receive(). This
///      contract hammers both, trying to exceed the wallet cap or take more ETH
///      back than it paid. Never deployed.
interface IPositions {
    function mint(
        uint8 phase,
        uint8 tickerIndex,
        uint256 quantity,
        uint256 maxQty,
        bytes32[] calldata proof,
        bool allowUnpriced
    ) external payable;
    function quote(uint8 phase, uint256 quantity) external view returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
}

contract MaliciousMinter {
    IPositions public immutable target;
    uint8 public phase;
    uint8 public ticker;
    bool public reenterOnReceive;
    bool public reenterOnERC721;
    uint256 public reentryAttempts;
    uint256 public reentrySuccesses;

    constructor(address target_) {
        target = IPositions(target_);
    }

    function arm(uint8 phase_, uint8 ticker_, bool onReceive, bool onErc721) external {
        phase = phase_;
        ticker = ticker_;
        reenterOnReceive = onReceive;
        reenterOnERC721 = onErc721;
    }

    function attack(uint256 quantity) external payable {
        target.mint{ value: msg.value }(phase, ticker, quantity, 0, new bytes32[](0), true);
    }

    function _tryReenter() internal {
        reentryAttempts++;
        uint256 cost = target.quote(phase, 1);
        if (address(this).balance < cost) return;
        try target.mint{ value: cost }(phase, ticker, 1, 0, new bytes32[](0), true) {
            reentrySuccesses++;
        } catch {}
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        returns (bytes4)
    {
        if (reenterOnERC721) _tryReenter();
        return this.onERC721Received.selector;
    }

    receive() external payable {
        if (reenterOnReceive) _tryReenter();
    }
}
