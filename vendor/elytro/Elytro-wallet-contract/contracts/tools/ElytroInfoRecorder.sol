// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ElytroInfoRecorder
 * @notice A general purpose event recorder for wallet-related information
 * Key Features:
 * - Event-based information recording
 * - Gas-efficient design
 * - Support for multiple data categories
 * - Indexed parameters for efficient querying
 * - Flexible data encoding support
 * Common Categories:
 * ```solidity
 * bytes32 constant GUARDIAN_INFO = keccak256("GUARDIAN_INFO");
 * ```
 *
 * Usage Example:
 * ```solidity
 * // Recording Guardian information
 * bytes32 category = keccak256("GUARDIAN_INFO");
 * address[] memory guardians = // guardian addresses
 * uint256 threshold = // threshold value
 * bytes memory guardianData = abi.encode(guardians, threshold);
 * elytroInfoRecorder.recordData(category, guardianData);
 * ```
 * Security Considerations:
 * 1. All recorded data is publicly visible on-chain
 * 2. Only the wallet itself can record its data (msg.sender)
 */
contract ElytroInfoRecorder {
    /**
     * @notice record wallet info via event
     * @param wallet The wallet address
     * @param category The category of the info (e.g., "keccak256("GUARDIAN_INFO");", etc)
     * @param data ABI encoded info
     */
    event DataRecorded(address indexed wallet, bytes32 indexed category, bytes data);

    /**
     * @notice mapping of the last record blocknumber
     *
     */
    mapping(bytes32 => uint256) internal records;

    /**
     * @notice Generate a unique key for storing record information
     * @dev Combines wallet address and category using keccak256 hash
     * @param addr The wallet address
     * @param category The category of the info
     * @return key The unique hash key for the records mapping
     */
    function recordKey(address addr, bytes32 category) private pure returns (bytes32 key) {
        key = keccak256(abi.encodePacked(addr, category));
    }

    /**
     * @notice Record info for a wallet
     * @param category The category of info being recorded
     * @param data ABI encoded data
     */
    function recordData(bytes32 category, bytes calldata data) external {
        bytes32 key = recordKey(msg.sender, category);
        records[key] = block.number;
        emit DataRecorded(msg.sender, category, data);
    }

    /**
     * @notice Get the block number of the latest record for a specific wallet and category
     * @param addr The wallet address to query
     * @param category The category of info to query
     * @return blockNumber The block number when the latest record was made (0 if no record exists)
     */
    function latestRecordAt(address addr, bytes32 category) external view returns (uint256 blockNumber) {
        bytes32 key = recordKey(addr, category);
        blockNumber = records[key];
    }
}
