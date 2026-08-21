// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {SuwappuPropAMM} from "../src/SuwappuPropAMM.sol";

interface VmFuzz {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
}

contract FuzzToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract SuwappuPropAMMFuzzTest {
    VmFuzz internal constant vm = VmFuzz(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant SIGNER_KEY = 0xA11CE;
    uint256 internal constant Q96 = 1 << 96;
    uint96 internal constant MAX_FUZZ_AMOUNT = 1_000_000_000_000_000_000;

    FuzzToken internal base;
    FuzzToken internal quoteToken;
    SuwappuPropAMM internal pamm;

    function setUp() public {
        base = new FuzzToken();
        quoteToken = new FuzzToken();
        pamm = new SuwappuPropAMM(address(base), address(quoteToken), vm.addr(SIGNER_KEY));

        uint256 inventory = uint256(MAX_FUZZ_AMOUNT) * 4;
        base.mint(address(this), inventory);
        quoteToken.mint(address(this), inventory);
        base.mint(address(pamm), inventory);
        quoteToken.mint(address(pamm), inventory);
        base.approve(address(pamm), type(uint256).max);
        quoteToken.approve(address(pamm), type(uint256).max);
    }

    function testFuzzSellExactMathAndCapacity(uint96 rawAmount) public {
        uint96 amount = _amount(rawAmount);
        SuwappuPropAMM.Quote memory q = _quote(1, amount, amount);
        pamm.applyQuote(q, _sign(q));

        uint256 baseBefore = base.balanceOf(address(this));
        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        uint256 expectedOut = (uint256(amount) * uint256(q.bidRateX96)) >> 96;
        uint256 received = pamm.sellBaseExactIn(amount, expectedOut, pamm.currentQuoteHash(), address(this));

        require(received == expectedOut, "sell formula");
        require(base.balanceOf(address(this)) == baseBefore - amount, "base debit");
        require(quoteToken.balanceOf(address(this)) == quoteBefore + expectedOut, "quote credit");
        require(pamm.consumedBaseIn() == amount, "sell capacity accounting");
        require(pamm.remainingBaseInCapacity() == 0, "sell capacity exhausted");
    }

    function testFuzzBuyExactMathAndCapacity(uint96 rawAmount) public {
        uint96 amount = _amount(rawAmount);
        SuwappuPropAMM.Quote memory q = _quote(1, amount, amount);
        pamm.applyQuote(q, _sign(q));

        uint256 baseBefore = base.balanceOf(address(this));
        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        uint256 product = uint256(amount) * uint256(q.askRateX96);
        uint256 expectedIn = (product + Q96 - 1) >> 96;
        uint256 paid = pamm.buyBaseExactOut(amount, expectedIn, pamm.currentQuoteHash(), address(this));

        require(paid == expectedIn, "buy formula");
        require(base.balanceOf(address(this)) == baseBefore + amount, "base credit");
        require(quoteToken.balanceOf(address(this)) == quoteBefore - expectedIn, "quote debit");
        require(pamm.consumedBaseOut() == amount, "buy capacity accounting");
        require(pamm.remainingBaseOutCapacity() == 0, "buy capacity exhausted");
    }

    function testFuzzCapacityCannotBeExceeded(uint96 rawCapacity, uint96 rawFirstFill) public {
        uint96 capacity = _amount(rawCapacity);
        uint96 firstFill = uint96(1 + (uint256(rawFirstFill) % capacity));
        if (firstFill < 2) firstFill = 2;
        if (firstFill > capacity) firstFill = capacity;

        SuwappuPropAMM.Quote memory q = _quote(1, capacity, capacity);
        pamm.applyQuote(q, _sign(q));
        pamm.sellBaseExactIn(firstFill, 0, pamm.currentQuoteHash(), address(this));

        uint96 remaining = pamm.remainingBaseInCapacity();
        require(uint256(pamm.consumedBaseIn()) + remaining == capacity, "capacity conservation");
        if (remaining == 0) return;

        (bool ok,) = address(pamm)
            .call(
                abi.encodeCall(
                    SuwappuPropAMM.sellBaseExactIn,
                    (uint96(remaining + 1), uint256(0), pamm.currentQuoteHash(), address(this))
                )
            );
        require(!ok, "over-capacity fill accepted");
        require(uint256(pamm.consumedBaseIn()) + pamm.remainingBaseInCapacity() == capacity, "rollback");
    }

    function testFuzzInvalidatedEpochCannotReplay(uint64 rawEpoch) public {
        uint64 epoch = 1 + (rawEpoch % (type(uint64).max - 1));
        SuwappuPropAMM.Quote memory q = _quote(epoch, 1_000, 1_000);
        pamm.applyQuote(q, _sign(q));
        pamm.invalidateQuote();

        SuwappuPropAMM.Quote memory replay = _quote(epoch, 1_000, 1_000);
        (bool ok,) = address(pamm)
            .call(abi.encodeCall(SuwappuPropAMM.applyQuote, (replay, _sign(replay))));
        require(!ok, "invalidated epoch replayed");
    }

    function _amount(uint96 rawAmount) internal pure returns (uint96) {
        return uint96(2 + (uint256(rawAmount) % (uint256(MAX_FUZZ_AMOUNT) - 1)));
    }

    function _quote(uint64 epoch, uint96 maxIn, uint96 maxOut)
        internal
        view
        returns (SuwappuPropAMM.Quote memory q)
    {
        q = SuwappuPropAMM.Quote({
            epoch: epoch,
            sequence: 0,
            previousHash: bytes32(0),
            validBlockMin: uint64(block.number),
            validBlockMax: uint64(block.number),
            validUntil: uint64(block.timestamp + 100),
            bidRateX96: uint160((Q96 * 99) / 100),
            askRateX96: uint160((Q96 * 101) / 100),
            maxBaseIn: maxIn,
            maxBaseOut: maxOut
        });
    }

    function _sign(SuwappuPropAMM.Quote memory q) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, pamm.quoteDigest(q));
        return abi.encodePacked(r, s, v);
    }
}
