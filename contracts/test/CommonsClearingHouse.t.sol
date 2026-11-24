// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../commons/CommonsClearingHouse.sol";

contract CHToken is ERC20 {
    constructor() ERC20("Clearing USD", "cUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Skims 1% on every transfer — must be rejected on settlement.
contract CHFeeToken is ERC20 {
    constructor() ERC20("Fee USD", "fUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xdead), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

/// @dev A token whose blocked receivers revert on inbound transfers (blacklist /
///      hook-style griefing by a creditor).
contract CHBlockingToken is ERC20 {
    mapping(address => bool) public blocked;

    constructor() ERC20("Blocking USD", "bUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function blockReceiver(address who) external {
        blocked[who] = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[to], "receiver blocked");
        super._update(from, to, value);
    }
}

/// @dev Minimal ERC-1271 smart account controlled by one EOA key.
contract CHSmartAccount {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        (bytes32 r, bytes32 s) = abi.decode(sig[0:64], (bytes32, bytes32));
        uint8 v = uint8(sig[64]);
        return ecrecover(hash, v, r, s) == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

contract CommonsClearingHouseTest is Test {
    CommonsClearingHouse ch;
    CHToken token;
    address t;

    uint256 aPk = 0xA11CE;
    uint256 bPk = 0xB0B;
    address a;
    address b;
    address c = address(0xC0FFEE);
    address d = address(0xD00D);

    uint256 constant FEE_5PCT = 1585489599; // ≈ 5%/yr per-second WAD
    uint64 constant GRACE = 1 days;
    uint8 constant CLR = 1;

    function setUp() public {
        ch = new CommonsClearingHouse();
        token = new CHToken();
        t = address(token);
        a = vm.addr(aPk);
        b = vm.addr(bPk);
        vm.warp(1_700_000_000);
    }

    // ------------------------------------------------------------ helpers

    /// @dev Opens x<->y with x extending `limX`, y extending `limY`.
    function _open(address x, address y, uint256 limX, uint256 limY, uint256 fee, uint8 flags) internal {
        vm.prank(x);
        ch.proposeLine(y, t, limX, fee, GRACE, flags);
        CommonsClearingHouse.Line memory l = ch.getLine(x, y, t);
        vm.prank(y);
        ch.acceptLine(x, t, limY, l.termsHash);
    }

    function _edge(address debtor, address creditor, uint256 amt)
        internal
        pure
        returns (CommonsClearingHouse.Edge memory)
    {
        return CommonsClearingHouse.Edge(debtor, creditor, amt);
    }

    function _sign(uint256 pk, CommonsClearingHouse.Intent memory it) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ch.intentDigest(it));
        return abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------ terms

    function testProposeAcceptOpensLine() public {
        _open(a, b, 100e18, 50e18, 0, CLR);
        CommonsClearingHouse.Line memory l = ch.getLine(a, b, t);
        assertEq(uint8(l.status), uint8(CommonsClearingHouse.Status.Active));
        (address lo,) = a < b ? (a, b) : (b, a);
        assertEq(lo == a ? l.limitLo : l.limitHi, 100e18);
        assertEq(lo == a ? l.limitHi : l.limitLo, 50e18);
        (,,,, uint32 opened,) = ch.standing(a, t);
        assertEq(opened, 1);
    }

    /// The v1 bug: proposer swaps to worse terms before the accept lands.
    function testTermsSwapAttackIsBlocked() public {
        vm.prank(a);
        ch.proposeLine(b, t, 100e18, 0, 7 days, CLR);
        bytes32 seenHash = ch.getLine(a, b, t).termsHash; // what B reviewed

        vm.startPrank(a);
        ch.cancelProposal(b, t);
        ch.proposeLine(b, t, 100e18, ch.MAX_FEE_RATE(), GRACE, CLR); // predatory re-propose
        vm.stopPrank();

        vm.prank(b);
        vm.expectRevert(CommonsClearingHouse.TermsMismatch.selector);
        ch.acceptLine(a, t, 50e18, seenHash);
    }

    function testRejectsBadTerms() public {
        vm.startPrank(a);
        vm.expectRevert(CommonsClearingHouse.BadParams.selector);
        ch.proposeLine(b, t, 1, 0, 1 hours, CLR); // grace < MIN_GRACE
        vm.expectRevert(CommonsClearingHouse.BadParams.selector);
        ch.proposeLine(b, t, 1, 16e9 + 1, GRACE, CLR); // fee over cap
        vm.expectRevert(CommonsClearingHouse.BadParams.selector);
        ch.proposeLine(b, t, 1, 0, GRACE, 2); // unknown flag
        vm.stopPrank();
    }

    // ------------------------------------------------------------ pay & limits

    function testPayWithinAndOverLimit() public {
        _open(a, b, 100e18, 50e18, 0, CLR);
        vm.prank(a);
        ch.pay(b, t, 50e18); // a owes b up to b's limit (50)
        assertEq(ch.owedBy(a, b, t), 50e18);
        vm.prank(a);
        vm.expectRevert(CommonsClearingHouse.LimitExceeded.selector);
        ch.pay(b, t, 1);
        // b paying a nets a's debt down first, then b's debt up to a's limit
        vm.prank(b);
        ch.pay(a, t, 120e18);
        assertEq(ch.owedBy(a, b, t), 0);
        assertEq(ch.owedBy(b, a, t), 70e18);
    }

    function testLoweringLimitBlocksNewDebtOnly() public {
        _open(a, b, 100e18, 50e18, 0, CLR);
        vm.prank(a);
        ch.pay(b, t, 40e18);
        vm.prank(b);
        ch.setMyLimit(a, t, 10e18); // below current exposure
        assertEq(ch.owedBy(a, b, t), 40e18, "existing debt untouched");
        vm.prank(a);
        vm.expectRevert(CommonsClearingHouse.LimitExceeded.selector);
        ch.pay(b, t, 1);
    }

    function testInterestCanExceedLimitButBlocksPrincipal() public {
        _open(a, b, 100e18, 100e18, ch.MAX_FEE_RATE(), CLR);
        vm.prank(a);
        ch.pay(b, t, 100e18);
        vm.warp(block.timestamp + 365 days);
        assertGt(ch.owedBy(a, b, t), 100e18, "interest accrued past limit");
        vm.prank(a);
        vm.expectRevert(CommonsClearingHouse.LimitExceeded.selector);
        ch.pay(b, t, 1);
    }

    // ------------------------------------------------------------ routing

    function testPayPathChargesIntermediaryFee() public {
        _open(a, b, 0, 1000e18, 0, CLR); // b extends a credit
        _open(b, c, 0, 1000e18, 0, CLR); // c extends b credit
        vm.startPrank(b);
        ch.setRoutingPolicy(t, true, 100); // 1%
        ch.setRouteCap(c, t, 1000e18); // b consents to owe c via routing
        vm.stopPrank();

        address[] memory path = new address[](3);
        (path[0], path[1], path[2]) = (a, b, c);
        (uint256[] memory amts, uint256 fee) = ch.quotePath(t, path, 100e18);
        assertEq(amts[1], 100e18);
        assertEq(amts[0], 101e18);
        assertEq(fee, 1e18);

        vm.prank(a);
        ch.payPath(t, path, 100e18, 1e18);
        assertEq(ch.owedBy(a, b, t), 101e18);
        assertEq(ch.owedBy(b, c, t), 100e18);
    }

    function testPayPathRequiresOptInAndFeeBound() public {
        _open(a, b, 0, 1000e18, 0, CLR);
        _open(b, c, 0, 1000e18, 0, CLR);
        address[] memory path = new address[](3);
        (path[0], path[1], path[2]) = (a, b, c);

        vm.prank(a);
        vm.expectRevert(CommonsClearingHouse.RoutingDisabled.selector);
        ch.payPath(t, path, 10e18, 0);

        vm.prank(b);
        ch.setRoutingPolicy(t, true, 500);
        vm.prank(a);
        vm.expectRevert(CommonsClearingHouse.FeeExceeded.selector);
        ch.payPath(t, path, 10e18, 0.1e18);

        vm.prank(c); // payer must be path[0]
        vm.expectRevert(CommonsClearingHouse.BadPath.selector);
        ch.payPath(t, path, 10e18, 1e18);
    }

    function testPayPathRevertsAtomicallyOnLimit() public {
        _open(a, b, 0, 1000e18, 0, CLR);
        _open(b, c, 0, 5e18, 0, CLR); // tight second hop
        vm.startPrank(b);
        ch.setRoutingPolicy(t, true, 0);
        ch.setRouteCap(c, t, 1000e18);
        vm.stopPrank();
        address[] memory path = new address[](3);
        (path[0], path[1], path[2]) = (a, b, c);
        vm.prank(a);
        vm.expectRevert(CommonsClearingHouse.LimitExceeded.selector);
        ch.payPath(t, path, 10e18, 0);
        assertEq(ch.owedBy(a, b, t), 0, "first hop rolled back");
    }

    // ------------------------------------------------------------ clearing

    function _triangle(uint256 ab, uint256 bc, uint256 ca, uint8 flags) internal {
        _open(a, b, 0, 1000e18, 0, flags);
        _open(b, c, 0, 1000e18, 0, flags);
        _open(c, a, 0, 1000e18, 0, flags);
        vm.prank(a);
        ch.pay(b, t, ab);
        vm.prank(b);
        ch.pay(c, t, bc);
        vm.prank(c);
        ch.pay(a, t, ca);
    }

    function testClearCycleReducesGrossNotNet() public {
        _triangle(30e18, 50e18, 20e18, CLR);
        CommonsClearingHouse.Edge[] memory e = new CommonsClearingHouse.Edge[](3);
        e[0] = _edge(a, b, 20e18);
        e[1] = _edge(b, c, 20e18);
        e[2] = _edge(c, a, 20e18);
        vm.prank(d); // anyone can clear
        uint256 vol = ch.clear(t, e);
        assertEq(vol, 60e18);
        assertEq(ch.owedBy(a, b, t), 10e18);
        assertEq(ch.owedBy(b, c, t), 30e18);
        assertEq(ch.owedBy(c, a, t), 0);
        (, uint256 cleared,,,,) = ch.standing(b, t);
        assertEq(cleared, 40e18); // debtor on one edge, creditor on another
    }

    function testClearRejectsUnbalanced() public {
        _triangle(30e18, 50e18, 20e18, CLR);
        CommonsClearingHouse.Edge[] memory e = new CommonsClearingHouse.Edge[](3);
        e[0] = _edge(a, b, 20e18);
        e[1] = _edge(b, c, 10e18);
        e[2] = _edge(c, a, 20e18);
        vm.expectRevert(CommonsClearingHouse.Unbalanced.selector);
        ch.clear(t, e);
    }

    function testClearRejectsOverNetAndRepeatedEdge() public {
        _triangle(30e18, 50e18, 20e18, CLR);
        CommonsClearingHouse.Edge[] memory e = new CommonsClearingHouse.Edge[](3);
        e[0] = _edge(a, b, 25e18);
        e[1] = _edge(b, c, 25e18);
        e[2] = _edge(c, a, 25e18); // c only owes 20
        vm.expectRevert(CommonsClearingHouse.NothingOwed.selector);
        ch.clear(t, e);

        // Repeat c->a twice (15+15 > 20 owed): sequential application must catch it.
        CommonsClearingHouse.Edge[] memory e2 = new CommonsClearingHouse.Edge[](6);
        e2[0] = _edge(a, b, 15e18);
        e2[1] = _edge(b, c, 15e18);
        e2[2] = _edge(c, a, 15e18);
        e2[3] = _edge(a, b, 15e18);
        e2[4] = _edge(b, c, 15e18);
        e2[5] = _edge(c, a, 15e18);
        vm.expectRevert(CommonsClearingHouse.NothingOwed.selector);
        ch.clear(t, e2);
    }

    function testClearRequiresConsent() public {
        _triangle(30e18, 50e18, 20e18, 0); // not CLEARABLE
        CommonsClearingHouse.Edge[] memory e = new CommonsClearingHouse.Edge[](3);
        e[0] = _edge(a, b, 10e18);
        e[1] = _edge(b, c, 10e18);
        e[2] = _edge(c, a, 10e18);
        vm.expectRevert(CommonsClearingHouse.NotClearable.selector);
        ch.clear(t, e);
    }

    function testClearTwoCyclesInOneCall() public {
        _triangle(30e18, 50e18, 20e18, CLR);
        _open(a, d, 0, 1000e18, 0, CLR);
        _open(d, b, 0, 1000e18, 0, CLR);
        vm.prank(a);
        ch.pay(d, t, 5e18);
        vm.prank(d);
        ch.pay(b, t, 5e18);
        // cycle 1: a->b->c->a (20); cycle 2: b->c->a->d->b (5) — shares legs
        CommonsClearingHouse.Edge[] memory e = new CommonsClearingHouse.Edge[](7);
        e[0] = _edge(a, b, 20e18);
        e[1] = _edge(b, c, 20e18);
        e[2] = _edge(c, a, 20e18);
        e[3] = _edge(b, c, 5e18);
        e[4] = _edge(c, a, 0.0001e18);
        e[5] = _edge(a, d, 0.0001e18);
        e[6] = _edge(d, b, 0.0001e18);
        vm.expectRevert(CommonsClearingHouse.NothingOwed.selector); // c->a exhausted by cycle 1
        ch.clear(t, e);
    }

    function testClearIdempotentTransientState() public {
        _triangle(30e18, 50e18, 20e18, CLR);
        CommonsClearingHouse.Edge[] memory e = new CommonsClearingHouse.Edge[](3);
        e[0] = _edge(a, b, 10e18);
        e[1] = _edge(b, c, 10e18);
        e[2] = _edge(c, a, 10e18);
        ch.clear(t, e);
        ch.clear(t, e); // same tx-context reuse must not see stale nets
        assertEq(ch.owedBy(c, a, t), 0);
    }

    // ------------------------------------------------------------ default & settle

    function testDemandDefaultCure() public {
        _open(a, b, 0, 100e18, 0, CLR);
        vm.prank(a);
        ch.pay(b, t, 40e18);

        vm.prank(b);
        ch.demandSettlement(a, t);
        vm.prank(b);
        vm.expectRevert(CommonsClearingHouse.DemandOpen.selector);
        ch.demandSettlement(a, t); // no clock reset
        vm.prank(b);
        vm.expectRevert(CommonsClearingHouse.GraceNotElapsed.selector);
        ch.markDefault(a, t);

        vm.warp(block.timestamp + GRACE);
        vm.prank(b);
        ch.markDefault(a, t);
        (,, uint32 defaults,,,) = ch.standing(a, t);
        assertEq(defaults, 1);

        token.mint(a, 40e18);
        vm.startPrank(a);
        token.approve(address(ch), 40e18);
        ch.settle(b, t, 100e18); // capped at owed
        vm.stopPrank();
        assertEq(ch.claimable(b, t), 40e18);
        assertEq(token.balanceOf(address(ch)), 40e18);
        vm.prank(b);
        ch.withdraw(t, b);
        assertEq(token.balanceOf(b), 40e18);
        assertEq(ch.claimable(b, t), 0);
        assertEq(uint8(ch.getLine(a, b, t).status), uint8(CommonsClearingHouse.Status.Closed));
        (uint256 settled,,, uint32 cures,,) = ch.standing(a, t);
        assertEq(settled, 40e18);
        assertEq(cures, 1);
    }

    function testSettleForThirdParty() public {
        _open(a, b, 0, 100e18, 0, CLR);
        vm.prank(a);
        ch.pay(b, t, 30e18);
        token.mint(d, 30e18);
        vm.startPrank(d);
        token.approve(address(ch), 30e18);
        ch.settleFor(a, b, t, 30e18);
        vm.stopPrank();
        assertEq(ch.owedBy(a, b, t), 0);
        assertEq(ch.claimable(b, t), 30e18);
    }

    function testFeeOnTransferRejected() public {
        CHFeeToken f = new CHFeeToken();
        vm.prank(a);
        ch.proposeLine(b, address(f), 0, 0, GRACE, CLR);
        bytes32 th = ch.getLine(a, b, address(f)).termsHash;
        vm.prank(b);
        ch.acceptLine(a, address(f), 100e18, th);
        vm.prank(a);
        ch.pay(b, address(f), 10e18);
        f.mint(a, 10e18);
        vm.startPrank(a);
        f.approve(address(ch), 10e18);
        vm.expectRevert(CommonsClearingHouse.NonStandardToken.selector);
        ch.settle(b, address(f), 10e18);
        vm.stopPrank();
    }

    function testCustodyEqualsClaimable() public {
        testDemandDefaultCure(); // settles then withdraws
        assertEq(token.balanceOf(address(ch)), 0, "nothing held once withdrawn");
    }

    // ------------------------------------------------------------ intents

    function _payIntent(address signer, uint256 nonce, uint256 amount)
        internal
        view
        returns (CommonsClearingHouse.Intent memory)
    {
        return CommonsClearingHouse.Intent({
            signer: signer,
            action: CommonsClearingHouse.Action.Pay,
            params: abi.encode(b, t, amount),
            nonce: nonce,
            deadline: block.timestamp + 1 hours
        });
    }

    function testSignedPayRelayedByAnyone() public {
        _open(a, b, 0, 100e18, 0, CLR);
        CommonsClearingHouse.Intent memory it = _payIntent(a, 7, 25e18);
        bytes memory sig = _sign(aPk, it);
        vm.prank(d); // relayer (e.g. the chat bot) holds no keys of a
        ch.execute(it, sig);
        assertEq(ch.owedBy(a, b, t), 25e18);
        assertTrue(ch.nonceUsed(a, 7));

        vm.expectRevert(CommonsClearingHouse.NonceUsed.selector);
        ch.execute(it, sig); // replay
    }

    function testIntentRejectsTamperExpiryWrongSigner() public {
        _open(a, b, 0, 100e18, 0, CLR);
        CommonsClearingHouse.Intent memory it = _payIntent(a, 1, 25e18);
        bytes memory sig = _sign(aPk, it);

        CommonsClearingHouse.Intent memory tampered = it;
        tampered.params = abi.encode(b, t, 99e18);
        vm.expectRevert(CommonsClearingHouse.BadSignature.selector);
        ch.execute(tampered, sig);

        bytes memory bSig = _sign(bPk, it);
        vm.expectRevert(CommonsClearingHouse.BadSignature.selector);
        ch.execute(it, bSig);

        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(CommonsClearingHouse.Expired.selector);
        ch.execute(it, sig);
    }

    function testInvalidateNonce() public {
        _open(a, b, 0, 100e18, 0, CLR);
        CommonsClearingHouse.Intent memory it = _payIntent(a, 3, 1e18);
        bytes memory sig = _sign(aPk, it);
        vm.prank(a);
        ch.invalidateNonce(3);
        vm.expectRevert(CommonsClearingHouse.NonceUsed.selector);
        ch.execute(it, sig);
    }

    function testSignedAcceptBindsTerms() public {
        vm.prank(a);
        ch.proposeLine(b, t, 0, 0, GRACE, CLR);
        bytes32 th = ch.getLine(a, b, t).termsHash;
        CommonsClearingHouse.Intent memory it = CommonsClearingHouse.Intent({
            signer: b,
            action: CommonsClearingHouse.Action.Accept,
            params: abi.encode(a, t, uint256(100e18), th),
            nonce: 1,
            deadline: block.timestamp + 1 hours
        });
        bytes memory sig = _sign(bPk, it);
        // proposer swaps terms while b's signed accept is in flight
        vm.startPrank(a);
        ch.cancelProposal(b, t);
        ch.proposeLine(b, t, 0, ch.MAX_FEE_RATE(), GRACE, CLR);
        vm.stopPrank();
        vm.expectRevert(CommonsClearingHouse.TermsMismatch.selector);
        ch.execute(it, sig);
    }

    function testERC1271SmartAccountSigns() public {
        CHSmartAccount acct = new CHSmartAccount(a);
        _open(address(acct), b, 0, 100e18, 0, CLR);
        CommonsClearingHouse.Intent memory it = _payIntent(address(acct), 1, 10e18);
        bytes memory sig = _sign(aPk, it);
        ch.execute(it, sig);
        assertEq(ch.owedBy(address(acct), b, t), 10e18);
    }

    function testSignedSettlePullsFromSigner() public {
        _open(a, b, 0, 100e18, 0, CLR);
        vm.prank(a);
        ch.pay(b, t, 10e18);
        token.mint(a, 10e18);
        vm.prank(a);
        token.approve(address(ch), 10e18);
        CommonsClearingHouse.Intent memory it = CommonsClearingHouse.Intent({
            signer: a,
            action: CommonsClearingHouse.Action.Settle,
            params: abi.encode(b, t, uint256(10e18)),
            nonce: 9,
            deadline: block.timestamp + 1 hours
        });
        vm.prank(d);
        ch.execute(it, _sign(aPk, it));
        assertEq(ch.claimable(b, t), 10e18);
        assertEq(token.balanceOf(d), 0);
    }

    // ------------------------------------------------------------ review regressions

    /// HIGH-1: a counterparty raises its own limit and routes debt onto an
    /// intermediary who never chose to owe it. Blocked without a route cap.
    function testRoutingCannotPushIntermediaryIntoDebt() public {
        // V (=b) earns routing fees; S (=a) is V's debtor; B (=c) is V's counterparty
        // on a line where c never meant to lend to b.
        _open(a, b, 0, 1000e18, 0, CLR); // b extends a credit
        _open(b, c, 0, 0, ch.MAX_FEE_RATE(), CLR); // c extends nothing to b (yet)
        vm.prank(b);
        ch.setRoutingPolicy(t, true, 50);
        vm.prank(c);
        ch.setMyLimit(b, t, 1_000_000e18); // colluder raises its own limit
        address[] memory path = new address[](3);
        (path[0], path[1], path[2]) = (a, b, c);
        vm.prank(a);
        vm.expectRevert(CommonsClearingHouse.RouteCapExceeded.selector);
        ch.payPath(t, path, 500e18, type(uint256).max);
        assertEq(ch.owedBy(b, c, t), 0, "b owes c nothing");

        // b opts in for a bounded amount on that specific line only
        vm.prank(b);
        ch.setRouteCap(c, t, 100e18);
        vm.prank(a);
        ch.payPath(t, path, 100e18, type(uint256).max);
        assertEq(ch.owedBy(b, c, t), 100e18);
        vm.prank(a);
        vm.expectRevert(CommonsClearingHouse.RouteCapExceeded.selector);
        ch.payPath(t, path, 1e18, type(uint256).max);
    }

    /// MEDIUM-1: a creditor whose inbound transfers revert can no longer block
    /// repayment and then default the debtor — settlement goes to escrow.
    function testCreditorCannotBlockRepayment() public {
        CHBlockingToken bt = new CHBlockingToken();
        vm.prank(a);
        ch.proposeLine(b, address(bt), 0, 0, GRACE, CLR);
        bytes32 th = ch.getLine(a, b, address(bt)).termsHash;
        vm.prank(b);
        ch.acceptLine(a, address(bt), 100e18, th);
        vm.prank(a);
        ch.pay(b, address(bt), 50e18);
        vm.prank(b);
        ch.demandSettlement(a, address(bt));
        bt.blockReceiver(b); // creditor makes itself un-payable

        bt.mint(a, 50e18);
        vm.startPrank(a);
        bt.approve(address(ch), 50e18);
        ch.settle(b, address(bt), 50e18); // succeeds: tokens go to escrow
        vm.stopPrank();
        assertEq(ch.owedBy(a, b, address(bt)), 0);

        vm.warp(block.timestamp + GRACE);
        vm.prank(b);
        vm.expectRevert(CommonsClearingHouse.BadStatus.selector); // demand cleared by repayment
        ch.markDefault(a, address(bt));

        vm.prank(b);
        ch.withdraw(address(bt), d); // creditor redirects to a receivable address
        assertEq(bt.balanceOf(d), 50e18);
    }

    function testCreditorCannotSelfSettleToFarmStanding() public {
        _open(a, b, 0, 100e18, 0, CLR);
        vm.prank(a);
        ch.pay(b, t, 10e18);
        token.mint(b, 10e18);
        vm.startPrank(b);
        token.approve(address(ch), 10e18);
        vm.expectRevert(CommonsClearingHouse.BadParams.selector);
        ch.settleFor(a, b, t, 10e18);
        vm.stopPrank();
    }

    /// LOW-2: a defaulted line can be written off, freeing the key and stopping interest.
    function testWriteOffClosesDefaultedLine() public {
        _open(a, b, 0, 100e18, FEE_5PCT, CLR);
        vm.prank(a);
        ch.pay(b, t, 40e18);
        vm.prank(b);
        ch.demandSettlement(a, t);
        vm.warp(block.timestamp + GRACE);
        vm.prank(b);
        ch.markDefault(a, t);

        vm.prank(a); // only the creditor may write off
        vm.expectRevert(CommonsClearingHouse.NothingOwed.selector);
        ch.writeOff(b, t);

        vm.prank(b);
        uint256 forgiven = ch.writeOff(a, t);
        assertGt(forgiven, 40e18, "includes accrued interest");
        assertEq(uint8(ch.getLine(a, b, t).status), uint8(CommonsClearingHouse.Status.Closed));
        (,, uint32 defaults,,, uint32 writeOffs) = ch.standing(a, t);
        assertEq(defaults, 1, "default history kept");
        assertEq(writeOffs, 1);
        vm.prank(a); // key is free again
        ch.proposeLine(b, t, 0, 0, GRACE, CLR);
    }

    function testStandingIsPerToken() public {
        _open(a, b, 0, 100e18, 0, CLR);
        CHToken other = new CHToken();
        (,,,, uint32 openedOther,) = ch.standing(a, address(other));
        assertEq(openedOther, 0);
        (,,,, uint32 opened,) = ch.standing(a, t);
        assertEq(opened, 1);
    }

    // ------------------------------------------------------------ gas

    function _ring(uint256 n) internal returns (CommonsClearingHouse.Edge[] memory e) {
        address[] memory nodes = new address[](n);
        for (uint256 i; i < n; ++i) nodes[i] = address(uint160(0x10000 + i));
        for (uint256 i; i < n; ++i) {
            address x = nodes[i];
            address y = nodes[(i + 1) % n];
            vm.prank(x);
            ch.proposeLine(y, t, 0, FEE_5PCT, GRACE, CLR);
            bytes32 th = ch.getLine(x, y, t).termsHash;
            vm.prank(y);
            ch.acceptLine(x, t, 1000e18, th);
            vm.prank(x);
            ch.pay(y, t, 20e18);
        }
        vm.warp(block.timestamp + 1 days); // realistic: interest accrual on every leg
        e = new CommonsClearingHouse.Edge[](n);
        for (uint256 i; i < n; ++i) e[i] = _edge(nodes[i], nodes[(i + 1) % n], 10e18);
    }

    function _halve(CommonsClearingHouse.Edge[] memory e) internal pure returns (CommonsClearingHouse.Edge[] memory) {
        for (uint256 i; i < e.length; ++i) e[i].amount = 1e18;
        return e;
    }

    function testGasClearRing10_50_100() public {
        uint256[3] memory sizes = [uint256(10), 50, 100];
        for (uint256 k; k < 3; ++k) {
            CommonsClearingHouse.Edge[] memory e = _ring(sizes[k]);
            vm.cool(address(ch)); // a real clearing tx reads every line cold
            uint256 g = gasleft();
            ch.clear(t, e);
            uint256 used = g - gasleft();
            console.log("clear() edges:", sizes[k], "gas:", used);
            // Cold-storage budget: ~40k gas/edge. E=100 must fit well inside a Base block.
            // Second clear on the same ring: standing slots now non-zero (steady state).
            e = _halve(e);
            vm.cool(address(ch));
            uint256 g2 = gasleft();
            ch.clear(t, e);
            uint256 steady = g2 - gasleft();
            console.log("  steady-state (standing already set) gas:", steady);
            // Measured ~24.5k/edge cold-line steady state; fail on regression past 27k.
            assertLt(steady, sizes[k] * 27_000, "clear() steady-state gas regression");
            t = address(new CHToken()); // fresh token => fresh lines next round
        }
    }
}
