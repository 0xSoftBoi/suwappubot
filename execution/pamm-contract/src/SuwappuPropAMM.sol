// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @notice Builder-facing proprietary AMM reference for Suwappu research.
/// @dev Prices are raw quote-token units per raw base-token unit in Q96.
contract SuwappuPropAMM {
    error Unauthorized();
    error InvalidTokenPair();
    error InvalidQuote();
    error InvalidSignature();
    error InvalidSequence();
    error InvalidParent();
    error QuoteNotLive();
    error QuoteHashMismatch();
    error CapacityExceeded();
    error Slippage();
    error ZeroAmount();
    error InvalidRecipient();
    error UnsupportedTransferSemantics();

    event QuoteApplied(
        uint64 indexed epoch,
        uint64 indexed sequence,
        bytes32 indexed quoteHash,
        bytes32 previousHash,
        uint160 bidRateX96,
        uint160 askRateX96,
        uint96 maxBaseIn,
        uint96 maxBaseOut,
        uint64 validBlockMin,
        uint64 validBlockMax,
        uint64 validUntil
    );
    event QuoteInvalidated(uint64 indexed epoch, uint64 indexed sequence, bytes32 indexed quoteHash);
    event BaseSold(address indexed taker, address indexed recipient, uint96 baseIn, uint256 quoteOut);
    event BaseBought(address indexed taker, address indexed recipient, uint96 baseOut, uint256 quoteIn);
    event InventoryWithdrawn(address indexed token, address indexed recipient, uint256 amount);
    event QuoteSignerUpdated(address indexed signer);
    event PauseUpdated(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    uint256 internal constant Q96 = 1 << 96;
    uint256 internal constant SECP256K1N_HALF =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    bytes32 internal constant QUOTE_TYPEHASH = keccak256(
        "Quote(uint64 epoch,uint64 sequence,bytes32 previousHash,uint64 validBlockMin,uint64 validBlockMax,uint64 validUntil,uint160 bidRateX96,uint160 askRateX96,uint96 maxBaseIn,uint96 maxBaseOut)"
    );
    bytes32 internal constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 internal constant NAME_HASH = keccak256("SuwappuPropAMM");
    bytes32 internal constant VERSION_HASH = keccak256("1");

    address public immutable baseToken;
    address public immutable quoteToken;
    bytes32 public immutable DOMAIN_SEPARATOR;

    address public owner;
    address public quoteSigner;
    bool public paused;

    uint64 public currentEpoch;
    uint64 public currentSequence;
    bytes32 public currentQuoteHash;

    uint64 public validBlockMin;
    uint64 public validBlockMax;
    uint64 public validUntil;
    uint160 public bidRateX96;
    uint160 public askRateX96;
    uint96 public maxBaseIn;
    uint96 public maxBaseOut;
    uint96 public consumedBaseIn;
    uint96 public consumedBaseOut;

    struct Quote {
        uint64 epoch;
        uint64 sequence;
        bytes32 previousHash;
        uint64 validBlockMin;
        uint64 validBlockMax;
        uint64 validUntil;
        uint160 bidRateX96;
        uint160 askRateX96;
        uint96 maxBaseIn;
        uint96 maxBaseOut;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        assembly ("memory-safe") {
            let slot := 0x5375776170707550726f70414d4d000000000000000000000000000000000001
            if tload(slot) { revert(0, 0) }
            tstore(slot, 1)
        }
        _;
        assembly ("memory-safe") {
            tstore(0x5375776170707550726f70414d4d000000000000000000000000000000000001, 0)
        }
    }

    constructor(address baseToken_, address quoteToken_, address quoteSigner_) {
        if (
            baseToken_ == address(0) || quoteToken_ == address(0) || quoteSigner_ == address(0)
                || baseToken_ == quoteToken_ || baseToken_.code.length == 0
                || quoteToken_.code.length == 0
        ) revert InvalidTokenPair();
        baseToken = baseToken_;
        quoteToken = quoteToken_;
        quoteSigner = quoteSigner_;
        owner = msg.sender;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
        emit OwnershipTransferred(address(0), msg.sender);
        emit QuoteSignerUpdated(quoteSigner_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert Unauthorized();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setQuoteSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert InvalidSignature();
        _invalidateActiveQuote();
        quoteSigner = newSigner;
        emit QuoteSignerUpdated(newSigner);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PauseUpdated(paused_);
    }

    function invalidateQuote() external onlyOwner {
        _invalidateActiveQuote();
    }

    /// @notice Inventory may only leave while paused, preventing governance from silently
    ///         underfunding a live quote inside its execution block.
    function withdrawInventory(address token, address recipient, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        if (!paused) revert QuoteNotLive();
        if (token != baseToken && token != quoteToken) revert InvalidTokenPair();
        if (recipient == address(0)) revert InvalidRecipient();
        _safeTransfer(token, recipient, amount);
        emit InventoryWithdrawn(token, recipient, amount);
    }

    function quoteStructHash(Quote calldata quote) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                QUOTE_TYPEHASH,
                quote.epoch,
                quote.sequence,
                quote.previousHash,
                quote.validBlockMin,
                quote.validBlockMax,
                quote.validUntil,
                quote.bidRateX96,
                quote.askRateX96,
                quote.maxBaseIn,
                quote.maxBaseOut
            )
        );
    }

    function quoteDigest(Quote calldata quote) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, quoteStructHash(quote)));
    }

    /// @notice Anyone may relay a valid maker-signed quote. A builder can therefore include
    ///         the exact state update it simulated. Quotes are intentionally single-block.
    function applyQuote(Quote calldata quote, bytes calldata signature) external {
        if (
            quote.epoch == 0 || quote.bidRateX96 == 0 || quote.askRateX96 == 0
                || quote.bidRateX96 > quote.askRateX96 || quote.maxBaseIn == 0
                || quote.maxBaseOut == 0 || quote.validBlockMin != block.number
                || quote.validBlockMax != block.number || quote.validUntil < block.timestamp
        ) revert InvalidQuote();

        bytes32 parent = currentQuoteHash;
        if (parent == bytes32(0)) {
            if (
                quote.epoch <= currentEpoch || quote.sequence != 0
                    || quote.previousHash != bytes32(0)
            ) revert InvalidSequence();
        } else if (quote.epoch == currentEpoch) {
            if (quote.sequence != currentSequence + 1) revert InvalidSequence();
            if (quote.previousHash != parent) revert InvalidParent();
        } else {
            if (
                quote.epoch <= currentEpoch || quote.sequence != 0
                    || quote.previousHash != bytes32(0)
            ) revert InvalidSequence();
        }

        bytes32 digest = quoteDigest(quote);
        if (_recover(digest, signature) != quoteSigner) revert InvalidSignature();

        bytes32 structHash = quoteStructHash(quote);
        currentEpoch = quote.epoch;
        currentSequence = quote.sequence;
        currentQuoteHash = structHash;
        validBlockMin = quote.validBlockMin;
        validBlockMax = quote.validBlockMax;
        validUntil = quote.validUntil;
        bidRateX96 = quote.bidRateX96;
        askRateX96 = quote.askRateX96;
        maxBaseIn = quote.maxBaseIn;
        maxBaseOut = quote.maxBaseOut;
        consumedBaseIn = 0;
        consumedBaseOut = 0;

        emit QuoteApplied(
            quote.epoch,
            quote.sequence,
            structHash,
            quote.previousHash,
            quote.bidRateX96,
            quote.askRateX96,
            quote.maxBaseIn,
            quote.maxBaseOut,
            quote.validBlockMin,
            quote.validBlockMax,
            quote.validUntil
        );
    }

    /// @notice Taker sells exact raw base units to the pAMM at the active bid.
    function sellBaseExactIn(
        uint96 baseIn,
        uint256 minQuoteOut,
        bytes32 expectedQuoteHash,
        address recipient
    ) external nonReentrant returns (uint256 quoteOut) {
        if (baseIn == 0) revert ZeroAmount();
        if (recipient == address(0)) revert InvalidRecipient();
        _requireLive(expectedQuoteHash);

        uint256 nextConsumed = uint256(consumedBaseIn) + baseIn;
        if (nextConsumed > maxBaseIn) revert CapacityExceeded();

        quoteOut = (uint256(baseIn) * uint256(bidRateX96)) >> 96;
        if (quoteOut < minQuoteOut || quoteOut == 0) revert Slippage();

        consumedBaseIn = uint96(nextConsumed);
        _pullExact(baseToken, msg.sender, baseIn);
        _safeTransfer(quoteToken, recipient, quoteOut);
        emit BaseSold(msg.sender, recipient, baseIn, quoteOut);
    }

    /// @notice Taker buys exact raw base units from the pAMM at the active ask.
    function buyBaseExactOut(
        uint96 baseOut,
        uint256 maxQuoteIn,
        bytes32 expectedQuoteHash,
        address recipient
    ) external nonReentrant returns (uint256 quoteIn) {
        if (baseOut == 0) revert ZeroAmount();
        if (recipient == address(0)) revert InvalidRecipient();
        _requireLive(expectedQuoteHash);

        uint256 nextConsumed = uint256(consumedBaseOut) + baseOut;
        if (nextConsumed > maxBaseOut) revert CapacityExceeded();

        uint256 product = uint256(baseOut) * uint256(askRateX96);
        quoteIn = (product + Q96 - 1) >> 96;
        if (quoteIn > maxQuoteIn || quoteIn == 0) revert Slippage();

        consumedBaseOut = uint96(nextConsumed);
        _pullExact(quoteToken, msg.sender, quoteIn);
        _safeTransfer(baseToken, recipient, baseOut);
        emit BaseBought(msg.sender, recipient, baseOut, quoteIn);
    }

    function remainingBaseInCapacity() external view returns (uint96) {
        return maxBaseIn - consumedBaseIn;
    }

    function remainingBaseOutCapacity() external view returns (uint96) {
        return maxBaseOut - consumedBaseOut;
    }

    function _requireLive(bytes32 expectedQuoteHash) internal view {
        if (paused) revert QuoteNotLive();
        if (currentQuoteHash == bytes32(0) || expectedQuoteHash != currentQuoteHash) {
            revert QuoteHashMismatch();
        }
        if (block.number != validBlockMin || block.number != validBlockMax || block.timestamp > validUntil) {
            revert QuoteNotLive();
        }
    }

    function _invalidateActiveQuote() internal {
        bytes32 hash = currentQuoteHash;
        if (hash == bytes32(0)) return;
        emit QuoteInvalidated(currentEpoch, currentSequence, hash);
        currentQuoteHash = bytes32(0);
        validBlockMin = 0;
        validBlockMax = 0;
        validUntil = 0;
        bidRateX96 = 0;
        askRateX96 = 0;
        maxBaseIn = 0;
        maxBaseOut = 0;
        consumedBaseIn = 0;
        consumedBaseOut = 0;
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > SECP256K1N_HALF || (v != 27 && v != 28)) revert InvalidSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }

    function _pullExact(address token, address from, uint256 amount) internal {
        uint256 beforeBalance = _balanceOf(token, address(this));
        _safeTransferFrom(token, from, address(this), amount);
        uint256 afterBalance = _balanceOf(token, address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) {
            revert UnsupportedTransferSemantics();
        }
    }

    function _balanceOf(address token, address account) internal view returns (uint256 balance) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, 0x70a08231))
            mstore(add(ptr, 4), account)
            if iszero(staticcall(gas(), token, ptr, 36, ptr, 32)) { revert(0, 0) }
            if lt(returndatasize(), 32) { revert(0, 0) }
            balance := mload(ptr)
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, 0xa9059cbb))
            mstore(add(ptr, 4), to)
            mstore(add(ptr, 36), amount)
            let ok := call(gas(), token, 0, ptr, 68, 0, 32)
            if iszero(and(ok, or(iszero(returndatasize()), and(gt(returndatasize(), 31), eq(mload(0), 1))))) {
                revert(0, 0)
            }
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, 0x23b872dd))
            mstore(add(ptr, 4), from)
            mstore(add(ptr, 36), to)
            mstore(add(ptr, 68), amount)
            let ok := call(gas(), token, 0, ptr, 100, 0, 32)
            if iszero(and(ok, or(iszero(returndatasize()), and(gt(returndatasize(), 31), eq(mload(0), 1))))) {
                revert(0, 0)
            }
        }
    }
}