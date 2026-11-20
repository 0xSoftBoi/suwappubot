// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * PassportResolver — minimal owned ENS resolver for the Suwappu "Agent Swap
 * Passport" identity anchor (ETHGlobal Tokyo 2026).
 *
 * HACKATHON SCOPE ONLY. The "correct" ENS resolver for this deployment would
 * be PublicResolverV2 (0xd7e590ad0e92a6ac1d81f4483a9b951d3585a50f), but its
 * setAddr() authorization path checks the ENSv1 NameWrapper for
 * ownership/operator approval. Names minted here are ENSv2
 * PermissionedRegistry subnames (`<label>.suwappu-agents.eth`) — the
 * NameWrapper has never heard of them, so PublicResolverV2.setAddr() can
 * never be authorized for them, and no addr record could ever be set. This
 * contract sidesteps that by using simple `onlyOwner` authorization instead
 * of NameWrapper-based ownership checks. It is intentionally NOT a general
 * ENS resolver (no text records, no multicall, no name-level ownership
 * delegation) — just enough to make `addr(node)` resolve for our own minted
 * subnames.
 */
contract PassportResolver {
    address public immutable owner;

    mapping(bytes32 => address) public addrs;

    event AddrChanged(bytes32 indexed node, address a);

    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner) {
        owner = _owner;
    }

    function setAddr(bytes32 node, address a) external onlyOwner {
        addrs[node] = a;
        emit AddrChanged(node, a);
    }

    /// ENSIP-1 addr(bytes32) — legacy single-coin (ETH) address record.
    function addr(bytes32 node) external view returns (address) {
        return addrs[node];
    }

    /// ENSIP-9 / ENSIP-11 addr(bytes32,uint256) — multicoin address record.
    /// Only coinType 60 (ETH/EVM) is supported; everything else returns empty.
    function addr(bytes32 node, uint256 coinType) external view returns (bytes memory) {
        if (coinType != 60) return bytes("");
        address a = addrs[node];
        if (a == address(0)) return bytes("");
        return abi.encodePacked(a);
    }

    /// ERC-165: 0x3b3b57de = addr(bytes32), 0xf1cb7e06 = addr(bytes32,uint256),
    /// 0x01ffc9a7 = supportsInterface(bytes4) itself.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x3b3b57de || interfaceId == 0xf1cb7e06 || interfaceId == 0x01ffc9a7;
    }
}
