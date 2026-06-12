// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

interface ISocialRecovery {
    struct SocialRecoveryInfo {
        bytes32 guardianHash;
        uint256 nonce;
        // id to operation valid time
        mapping(bytes32 id => uint256) operationValidAt;
        uint256 delayPeriod;
    }

    function walletNonce(address wallet) external view returns (uint256 _nonce);

    /**
     * @notice  .
     * @dev     .
     * @param   wallet to recovery
     * @param   newOwners bytes32[] owners
     * @param   rawGuardian abi.encode(GuardianData)
     *  struct GuardianData {
     *     address[] guardians;
     *     uint256 threshold;
     *     uint256 salt;
     * }
     * @param   guardianSignature  .
     * @return  recoveryId  .
     */
    function scheduleRecovery(
        address wallet,
        bytes32[] calldata newOwners,
        bytes calldata rawGuardian,
        bytes calldata guardianSignature
    ) external returns (bytes32 recoveryId);

    function executeRecovery(address wallet, bytes32[] calldata newOwners) external;

    function setGuardian(bytes32 newGuardianHash) external;
    function setDelayPeriod(uint256 newDelay) external;

    enum OperationState {
        Unset,
        Waiting,
        Ready,
        Done
    }

    struct GuardianData {
        address[] guardians;
        uint256 threshold;
        uint256 salt;
    }
}
