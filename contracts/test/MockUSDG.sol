// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only stand-in for USDG: 6 decimals plus a minimal EIP-3009
///      EIP-3009 `transferWithAuthorization` + `receiveWithAuthorization`
///      (including the `to == msg.sender` payee check that the live token
///      enforces), so tests/test_membership_evm.py exercises
///      the real signature path rather than a stub. The EIP-712 domain mirrors
///      the production asset — name "Global Dollar", version "1" — which was
///      recovered from USDG's on-chain DOMAIN_SEPARATOR (its `version()`
///      reverts). Never deployed.
contract MockUSDG is ERC20 {
    // keccak256("TransferWithAuthorization(address from,address to,uint256 value,
    //   uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;

    // keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,
    //   uint256 validAfter,uint256 validBefore,bytes32 nonce)") — read off the
    // live USDG at 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 on chain 4663.
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;

    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    error AuthorizationUsed();
    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error InvalidSignature();
    /// @dev Selector 0x5454b17d — the exact error the live USDG returns when
    ///      `receiveWithAuthorization` is called with `to != msg.sender`.
    error CallerMustBePayee();

    constructor() ERC20("Global Dollar", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("Global Dollar")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _settle(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
    }

    /// @dev Same as above but the caller MUST be the payee. This is what makes a
    ///      subscription authorization settleable only by the membership
    ///      contract, so payment and credit are atomic.
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (to != msg.sender) revert CallerMustBePayee();
        _settle(
            RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
    }

    function _settle(
        bytes32 typeHash,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal {
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        // Shared nonce space across both entry points, as in the real token.
        if (authorizationState[from][nonce]) revert AuthorizationUsed();

        bytes32 structHash =
            keccak256(abi.encode(typeHash, from, to, value, validAfter, validBefore, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        if (ecrecover(digest, v, r, s) != from) revert InvalidSignature();

        authorizationState[from][nonce] = true;
        _transfer(from, to, value);
    }
}
