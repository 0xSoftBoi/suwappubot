// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {SuwappuPropAMM} from "../src/SuwappuPropAMM.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function roll(uint256 blockNumber) external;
}

contract MockToken {
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

contract SuwappuPropAMMTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant SIGNER_KEY = 0xA11CE;
    uint256 internal constant Q96 = 1 << 96;

    MockToken internal base;
    MockToken internal quoteToken;
    SuwappuPropAMM internal pamm;
    address internal signer;

    function setUp() public {
        signer = vm.addr(SIGNER_KEY);
        base = new MockToken();
        quoteToken = new MockToken();
        pamm = new SuwappuPropAMM(address(base), address(quoteToken), signer);

        base.mint(address(this), 1_000_000);
        quoteToken.mint(address(this), 1_000_000);
        base.mint(address(pamm), 1_000_000);
        quoteToken.mint(address(pamm), 1_000_000);
        base.approve(address(pamm), type(uint256).max);
        quoteToken.approve(address(pamm), type(uint256).max);
    }

    function testSignedQuoteSupportsBothMakerSides() public {
        uint96 baseAmount = 10_000;
        SuwappuPropAMM.Quote memory q = _quote(1, 0, bytes32(0), 20_000, 20_000);
        pamm.applyQuote(q, _sign(q, SIGNER_KEY));
        bytes32 hash = pamm.currentQuoteHash();

        uint256 expectedQuoteOut = (uint256(baseAmount) * uint256(q.bidRateX96)) >> 96;
        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        uint256 received =
            pamm.sellBaseExactIn(baseAmount, expectedQuoteOut, hash, address(this));
        require(received == expectedQuoteOut, "bid q96 math");
        require(
            quoteToken.balanceOf(address(this)) == quoteBefore + expectedQuoteOut,
            "quote received"
        );

        uint256 product = uint256(baseAmount) * uint256(q.askRateX96);
        uint256 expectedQuoteIn = (product + Q96 - 1) >> 96;
        uint256 baseBefore = base.balanceOf(address(this));
        uint256 paid = pamm.buyBaseExactOut(baseAmount, expectedQuoteIn, hash, address(this));
        require(paid == expectedQuoteIn, "ask q96 math");
        require(base.balanceOf(address(this)) == baseBefore + baseAmount, "base received");
    }

    function testSequenceAndParentHashChain() public {
        SuwappuPropAMM.Quote memory first = _quote(1, 0, bytes32(0), 100, 100);
        pamm.applyQuote(first, _sign(first, SIGNER_KEY));
        bytes32 parent = pamm.currentQuoteHash();

        SuwappuPropAMM.Quote memory second = _quote(1, 1, parent, 100, 100);
        pamm.applyQuote(second, _sign(second, SIGNER_KEY));
        require(pamm.currentSequence() == 1, "sequence");

        SuwappuPropAMM.Quote memory replay = _quote(1, 1, parent, 100, 100);
        (bool ok,) = address(pamm).call(
            abi.encodeCall(SuwappuPropAMM.applyQuote, (replay, _sign(replay, SIGNER_KEY)))
        );
        require(!ok, "replay must fail");
    }

    function testNewEpochResetsParentAndSequence() public {
        SuwappuPropAMM.Quote memory first = _quote(1, 0, bytes32(0), 100, 100);
        pamm.applyQuote(first, _sign(first, SIGNER_KEY));

        SuwappuPropAMM.Quote memory nextEpoch = _quote(2, 0, bytes32(0), 100, 100);
        pamm.applyQuote(nextEpoch, _sign(nextEpoch, SIGNER_KEY));
        require(pamm.currentEpoch() == 2, "epoch");
        require(pamm.currentSequence() == 0, "sequence reset");
    }

    function testWrongSignerFails() public {
        SuwappuPropAMM.Quote memory q = _quote(1, 0, bytes32(0), 100, 100);
        (bool ok,) =
            address(pamm).call(abi.encodeCall(SuwappuPropAMM.applyQuote, (q, _sign(q, 0xB0B))));
        require(!ok, "wrong signer must fail");
    }

    function testExpectedHashPreventsStaleFill() public {
        SuwappuPropAMM.Quote memory first = _quote(1, 0, bytes32(0), 100, 100);
        pamm.applyQuote(first, _sign(first, SIGNER_KEY));
        bytes32 staleHash = pamm.currentQuoteHash();

        SuwappuPropAMM.Quote memory second = _quote(1, 1, staleHash, 100, 100);
        pamm.applyQuote(second, _sign(second, SIGNER_KEY));

        (bool ok,) = address(pamm).call(
            abi.encodeCall(
                SuwappuPropAMM.sellBaseExactIn,
                (uint96(100), uint256(0), staleHash, address(this))
            )
        );
        require(!ok, "stale expected hash must fail");
    }

    function testCapacityIsPerQuoteAndEnforced() public {
        SuwappuPropAMM.Quote memory q = _quote(1, 0, bytes32(0), 100, 100);
        pamm.applyQuote(q, _sign(q, SIGNER_KEY));
        bytes32 hash = pamm.currentQuoteHash();
        pamm.sellBaseExactIn(60, 0, hash, address(this));
        (bool ok,) = address(pamm).call(
            abi.encodeCall(
                SuwappuPropAMM.sellBaseExactIn,
                (uint96(41), uint256(0), hash, address(this))
            )
        );
        require(!ok, "capacity must fail");
        require(pamm.remainingBaseInCapacity() == 40, "remaining capacity");
    }

    function testExpiredQuoteCannotTrade() public {
        SuwappuPropAMM.Quote memory q = _quote(1, 0, bytes32(0), 100, 100);
        pamm.applyQuote(q, _sign(q, SIGNER_KEY));
        bytes32 hash = pamm.currentQuoteHash();
        vm.warp(block.timestamp + 101);
        (bool ok,) = address(pamm).call(
            abi.encodeCall(
                SuwappuPropAMM.sellBaseExactIn,
                (uint96(100), uint256(0), hash, address(this))
            )
        );
        require(!ok, "expired quote must fail");
    }

    function testQuoteMustBeAppliedInsideItsExactExecutionBlock() public {
        uint64 targetBlock = uint64(block.number + 2);
        SuwappuPropAMM.Quote memory q = _quote(1, 0, bytes32(0), 100, 100);
        q.validBlockMin = targetBlock;
        q.validBlockMax = targetBlock;

        (bool early,) =
            address(pamm).call(abi.encodeCall(SuwappuPropAMM.applyQuote, (q, _sign(q, SIGNER_KEY))));
        require(!early, "early application must fail");

        vm.roll(targetBlock);
        pamm.applyQuote(q, _sign(q, SIGNER_KEY));
        uint256 received = pamm.sellBaseExactIn(100, 0, pamm.currentQuoteHash(), address(this));
        require(received > 0, "exact-block fill");
    }

    function testMultiBlockQuoteIsRejected() public {
        SuwappuPropAMM.Quote memory q = _quote(1, 0, bytes32(0), 100, 100);
        q.validBlockMax = uint64(block.number + 1);
        (bool ok,) =
            address(pamm).call(abi.encodeCall(SuwappuPropAMM.applyQuote, (q, _sign(q, SIGNER_KEY))));
        require(!ok, "multi-block quote must fail");
    }

    function testPauseStopsFillsButDoesNotDestroyQuote() public {
        SuwappuPropAMM.Quote memory q = _quote(1, 0, bytes32(0), 100, 100);
        pamm.applyQuote(q, _sign(q, SIGNER_KEY));
        bytes32 hash = pamm.currentQuoteHash();
        pamm.setPaused(true);
        (bool ok,) = address(pamm).call(
            abi.encodeCall(
                SuwappuPropAMM.sellBaseExactIn,
                (uint96(100), uint256(0), hash, address(this))
            )
        );
        require(!ok, "paused fill must fail");
        require(pamm.currentQuoteHash() == hash, "quote preserved");
    }

    function testSignerRotationInvalidatesQuoteAndRequiresNewEpoch() public {
        SuwappuPropAMM.Quote memory q = _quote(1, 0, bytes32(0), 100, 100);
        pamm.applyQuote(q, _sign(q, SIGNER_KEY));
        bytes32 oldHash = pamm.currentQuoteHash();

        uint256 newKey = 0xB0B;
        pamm.setQuoteSigner(vm.addr(newKey));
        require(pamm.currentQuoteHash() == bytes32(0), "quote invalidated");

        (bool oldFill,) = address(pamm).call(
            abi.encodeCall(
                SuwappuPropAMM.sellBaseExactIn,
                (uint96(100), uint256(0), oldHash, address(this))
            )
        );
        require(!oldFill, "old quote cannot fill");

        SuwappuPropAMM.Quote memory next = _quote(2, 0, bytes32(0), 100, 100);
        pamm.applyQuote(next, _sign(next, newKey));
        require(pamm.currentEpoch() == 2, "new epoch required");
    }

    function testInventoryWithdrawalRequiresPause() public {
        (bool live,) = address(pamm).call(
            abi.encodeCall(
                SuwappuPropAMM.withdrawInventory,
                (address(base), address(this), uint256(1))
            )
        );
        require(!live, "live inventory withdrawal must fail");

        uint256 before = base.balanceOf(address(this));
        pamm.setPaused(true);
        pamm.withdrawInventory(address(base), address(this), 10);
        require(base.balanceOf(address(this)) == before + 10, "withdrawal");
    }

    function _quote(uint64 epoch, uint64 sequence, bytes32 parent, uint96 maxIn, uint96 maxOut)
        internal
        view
        returns (SuwappuPropAMM.Quote memory q)
    {
        q = SuwappuPropAMM.Quote({
            epoch: epoch,
            sequence: sequence,
            previousHash: parent,
            validBlockMin: uint64(block.number),
            validBlockMax: uint64(block.number),
            validUntil: uint64(block.timestamp + 100),
            bidRateX96: uint160((Q96 * 99) / 100),
            askRateX96: uint160((Q96 * 101) / 100),
            maxBaseIn: maxIn,
            maxBaseOut: maxOut
        });
    }

    function _sign(SuwappuPropAMM.Quote memory q, uint256 key) internal returns (bytes memory) {
        bytes32 digest = pamm.quoteDigest(q);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
