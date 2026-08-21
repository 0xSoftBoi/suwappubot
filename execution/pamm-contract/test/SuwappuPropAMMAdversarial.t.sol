// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {SuwappuPropAMM} from "../src/SuwappuPropAMM.sol";

interface VmAdv {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function chainId(uint256 newChainId) external;
}

contract StrictToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        virtual
        returns (bool)
    {
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

contract FeeOnTransferToken is StrictToken {
    function transfer(address to, uint256 amount) external override returns (bool) {
        _moveWithFee(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        override
        returns (bool)
    {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _moveWithFee(from, to, amount);
        return true;
    }

    function _moveWithFee(address from, address to, uint256 amount) internal {
        uint256 fee = amount / 100;
        uint256 received = amount - fee;
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += received;
    }
}

contract ReentrantToken is StrictToken {
    SuwappuPropAMM public target;
    bytes32 public quoteHash;
    bool public attempted;
    bool public reentrySucceeded;

    function arm(SuwappuPropAMM target_, bytes32 quoteHash_) external {
        target = target_;
        quoteHash = quoteHash_;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        override
        returns (bool)
    {
        if (!attempted && address(target) != address(0)) {
            attempted = true;
            (reentrySucceeded,) = address(target).call(
                abi.encodeCall(
                    SuwappuPropAMM.sellBaseExactIn,
                    (uint96(1), uint256(0), quoteHash, address(this))
                )
            );
        }
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }
}

contract SuwappuPropAMMAdversarialTest {
    VmAdv internal constant vm = VmAdv(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant SIGNER_KEY = 0xA11CE;
    uint256 internal constant Q96 = 1 << 96;
    uint256 internal constant SECP256K1N =
        0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;

    function testFeeOnTransferInputFailsClosed() public {
        FeeOnTransferToken base = new FeeOnTransferToken();
        StrictToken quoteToken = new StrictToken();
        SuwappuPropAMM pamm =
            new SuwappuPropAMM(address(base), address(quoteToken), vm.addr(SIGNER_KEY));
        base.mint(address(this), 1_000);
        quoteToken.mint(address(pamm), 1_000);
        base.approve(address(pamm), type(uint256).max);

        SuwappuPropAMM.Quote memory q = _quote(1, 0, bytes32(0), 500, 500);
        pamm.applyQuote(q, _sign(pamm, q, SIGNER_KEY));
        (bool ok,) = address(pamm).call(
            abi.encodeCall(
                SuwappuPropAMM.sellBaseExactIn,
                (uint96(100), uint256(0), pamm.currentQuoteHash(), address(this))
            )
        );
        require(!ok, "fee-on-transfer input must fail");
        require(pamm.consumedBaseIn() == 0, "revert restores capacity");
    }

    function testFeeOnTransferOutputFailsClosed() public {
        StrictToken base = new StrictToken();
        FeeOnTransferToken quoteToken = new FeeOnTransferToken();
        SuwappuPropAMM pamm =
            new SuwappuPropAMM(address(base), address(quoteToken), vm.addr(SIGNER_KEY));
        base.mint(address(this), 1_000);
        quoteToken.mint(address(pamm), 1_000);
        base.approve(address(pamm), type(uint256).max);

        SuwappuPropAMM.Quote memory q = _quote(1, 0, bytes32(0), 500, 500);
        pamm.applyQuote(q, _sign(pamm, q, SIGNER_KEY));
        uint256 beforeBalance = quoteToken.balanceOf(address(this));
        (bool ok,) = address(pamm).call(
            abi.encodeCall(
                SuwappuPropAMM.sellBaseExactIn,
                (uint96(500), uint256(0), pamm.currentQuoteHash(), address(this))
            )
        );
        require(!ok, "fee-on-transfer output must fail");
        require(quoteToken.balanceOf(address(this)) == beforeBalance, "output rollback");
        require(pamm.consumedBaseIn() == 0, "capacity rollback");
    }

    function testReentrantTransferFromCannotEnterSecondFill() public {
        ReentrantToken base = new ReentrantToken();
        StrictToken quoteToken = new StrictToken();
        SuwappuPropAMM pamm =
            new SuwappuPropAMM(address(base), address(quoteToken), vm.addr(SIGNER_KEY));
        base.mint(address(this), 1_000);
        quoteToken.mint(address(pamm), 1_000);
        base.approve(address(pamm), type(uint256).max);

        SuwappuPropAMM.Quote memory q = _quote(1, 0, bytes32(0), 500, 500);
        pamm.applyQuote(q, _sign(pamm, q, SIGNER_KEY));
        base.arm(pamm, pamm.currentQuoteHash());
        pamm.sellBaseExactIn(100, 0, pamm.currentQuoteHash(), address(this));

        require(base.attempted(), "reentry attempted");
        require(!base.reentrySucceeded(), "reentry blocked");
        require(pamm.consumedBaseIn() == 100, "only outer fill counted");
    }

    function testHighSMalleableSignatureIsRejected() public {
        StrictToken base = new StrictToken();
        StrictToken quoteToken = new StrictToken();
        SuwappuPropAMM pamm =
            new SuwappuPropAMM(address(base), address(quoteToken), vm.addr(SIGNER_KEY));
        SuwappuPropAMM.Quote memory q = _quote(1, 0, bytes32(0), 100, 100);
        bytes32 digest = pamm.quoteDigest(q);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        bytes32 highS = bytes32(SECP256K1N - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        bytes memory malleable = abi.encodePacked(r, highS, flippedV);

        (bool ok,) =
            address(pamm).call(abi.encodeCall(SuwappuPropAMM.applyQuote, (q, malleable)));
        require(!ok, "high-s signature must fail");
    }

    function testDomainSeparatorTracksChainIdChange() public {
        StrictToken base = new StrictToken();
        StrictToken quoteToken = new StrictToken();
        SuwappuPropAMM pamm =
            new SuwappuPropAMM(address(base), address(quoteToken), vm.addr(SIGNER_KEY));
        SuwappuPropAMM.Quote memory q = _quote(1, 0, bytes32(0), 100, 100);
        bytes32 beforeDigest = pamm.quoteDigest(q);
        vm.chainId(block.chainid + 1);
        bytes32 afterDigest = pamm.quoteDigest(q);
        require(afterDigest != beforeDigest, "domain must change");
        pamm.applyQuote(q, _sign(pamm, q, SIGNER_KEY));
    }

    function testWrongParentFailsClosed() public {
        StrictToken base = new StrictToken();
        StrictToken quoteToken = new StrictToken();
        SuwappuPropAMM pamm =
            new SuwappuPropAMM(address(base), address(quoteToken), vm.addr(SIGNER_KEY));
        SuwappuPropAMM.Quote memory first = _quote(1, 0, bytes32(0), 100, 100);
        pamm.applyQuote(first, _sign(pamm, first, SIGNER_KEY));

        SuwappuPropAMM.Quote memory bad = _quote(1, 1, bytes32(uint256(1)), 100, 100);
        (bool ok,) = address(pamm)
            .call(abi.encodeCall(SuwappuPropAMM.applyQuote, (bad, _sign(pamm, bad, SIGNER_KEY))));
        require(!ok, "wrong parent must fail");
    }

    function testInvalidatedEpochCannotBeReopened() public {
        StrictToken base = new StrictToken();
        StrictToken quoteToken = new StrictToken();
        SuwappuPropAMM pamm =
            new SuwappuPropAMM(address(base), address(quoteToken), vm.addr(SIGNER_KEY));
        SuwappuPropAMM.Quote memory first = _quote(7, 0, bytes32(0), 100, 100);
        pamm.applyQuote(first, _sign(pamm, first, SIGNER_KEY));
        pamm.invalidateQuote();

        SuwappuPropAMM.Quote memory sameEpoch = _quote(7, 0, bytes32(0), 100, 100);
        (bool ok,) = address(pamm).call(
            abi.encodeCall(
                SuwappuPropAMM.applyQuote,
                (sameEpoch, _sign(pamm, sameEpoch, SIGNER_KEY))
            )
        );
        require(!ok, "invalidated epoch must remain dead");
    }

    function testConstructorRejectsEOAToken() public {
        StrictToken quoteToken = new StrictToken();
        address signer = vm.addr(SIGNER_KEY);
        (bool ok,) = address(this).call(
            abi.encodeCall(this.deployWithTokens, (address(0xBEEF), address(quoteToken), signer))
        );
        require(!ok, "EOA token must fail");
    }

    function deployWithTokens(address base, address quoteToken, address signer)
        external
        returns (SuwappuPropAMM)
    {
        return new SuwappuPropAMM(base, quoteToken, signer);
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

    function _sign(SuwappuPropAMM pamm, SuwappuPropAMM.Quote memory q, uint256 key)
        internal
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, pamm.quoteDigest(q));
        return abi.encodePacked(r, s, v);
    }
}
