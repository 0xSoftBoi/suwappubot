pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ClaimInterest
 * @dev This contract allows users to claim their interest.
 * The interest claim is authenticated by a signature from a trusted signer.
 * The owner of the contract can change the signer.
 */
contract ClaimInterest is Ownable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    event SignerChanged(address indexed signer, bool isSigner);
    event Withdrawn(address indexed to, uint256 amount);
    event Deposited(address indexed addr, uint256 amount);

    mapping(address => bool) public signers;
    IERC20 public token;
    mapping(address => uint256) public nonces;

    constructor(address _owner, address _signer, address _token) Ownable(_owner) {
        signers[_signer] = true;
        token = IERC20(_token);
    }

    /**
     * @notice Claim the interest amount.
     * @dev The claim is authenticated by a signature from the trusted signer.
     * @param interestAmount The amount of interest to claim.
     * @param signature The signature from the signer.
     */
    function claimInterest(uint256 interestAmount, uint256 nonce, uint256 expiryTime, bytes memory signature) public {
        require(nonce == nonces[msg.sender], "Invalid nonce");
        require(block.timestamp <= expiryTime, "Signature expired");
        require(token.balanceOf(address(this)) >= interestAmount, "Insufficient balance");
        bytes32 message =
            keccak256(abi.encodePacked(msg.sender, interestAmount, nonce, expiryTime, address(this), getChainId()));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(message);
        require(signers[ethSignedMessageHash.recover(signature)], "Invalid signature");
        nonces[msg.sender] += 1; // Increment nonce for the user
        token.safeTransfer(msg.sender, interestAmount);
    }

    function getChainId() public view returns (uint256) {
        uint256 id;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            id := chainid()
        }
        return id;
    }

    function changeSigner(address newSigner, bool isSigner) public onlyOwner {
        require(newSigner != address(0), "Invalid address");
        signers[newSigner] = isSigner;
        emit SignerChanged(newSigner, isSigner);
    }

    function withdraw(address to, uint256 amount) public onlyOwner {
        require(token.balanceOf(address(this)) >= amount, "Insufficient balance");
        token.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    function deposit(uint256 amount) public {
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /**
     * @notice Admin function to force increment a user's nonce
     * @dev signer can increment a user's nonce to invalidate previous signatures
     * @param user The address of the user nonce to change.
     */
    function incrementNonce(address user) public {
        require(signers[msg.sender], "Only signer can change user nonce");
        nonces[user] += 1;
    }
}
