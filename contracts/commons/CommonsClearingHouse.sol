// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/*//////////////////////////////////////////////////////////////////////////
                CommonsClearingHouse — Commons v2, Layer 1

    An immutable, ownerless credit-clearing network. Successor to
    SuwappuMutualCredit (v1). Design: docs/plans/commons-v2.md §2.

    - Bilateral credit lines in any ERC-20 unit of account. Terms (fee rate,
      grace, proposer limit, flags) are bound by a hash the acceptor must
      echo — re-proposing invalidates every outstanding accept (fixes the v1
      cancel-and-repropose terms swap).
    - Each party may move the credit it extends at any time (setMyLimit).
      Lowering below current exposure only blocks NEW debt.
    - pay() along a direct line; payPath() ripples atomically across lines
      through intermediaries that opted in (with a fee) via setRoutingPolicy
      AND set a per-counterparty routeCap: routing can only grow a node's debt
      to a given counterparty up to the cap that node chose for that line
      (so a counterparty raising its own limit can't push you into its terms).
    - Settlement is pull-based: tokens move payer -> this contract and are
      credited to the creditor's claimable balance, so a creditor can never
      block repayment (hooks, blacklists) and then claim default.
    - clear(): permissionless multilateral clearing. An untrusted solver
      submits any circulation (set of debt edges); the contract verifies
      per-edge owed amounts and per-node conservation in O(E) and reduces
      every edge. No participant's net position changes. Only lines both
      parties accepted as CLEARABLE can be cleared.
    - EIP-712 signed intents for every user action (ERC-1271 for smart
      accounts), so relayers / chat bots / agents can drive it without custody.
    - Default handling: demand → grace (>= MIN_GRACE) → default; a defaulted
      line stays settleable, and a full cure closes it. Public standing
      counters (settled / cleared volume, defaults, cures) are the substrate
      for reputation and backing layers — no score, no token.

    Interest is simple between accruals and folded into the balance on every
    touch, so frequent pokes compound it slightly (bounded by MAX_FEE_RATE:
    at most ~10% more than nominal per year at the 50% ceiling). Debtors can
    settle at any time.

    Invariant: every principal-increasing operation leaves the debtor's
    accrued debt on that line <= the limit its creditor extends. Accrued
    interest may exceed the limit (debt is debt); new principal is then
    blocked until it is back under.

    No owner, no upgrade path, no governance, no oracle, no fees to anyone
    but routing intermediaries the payer accepts. Requires EIP-1153 (Cancun).
//////////////////////////////////////////////////////////////////////////*/

interface IClearingToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

contract CommonsClearingHouse {
    /*////////////////////////////////////////////////////////////
                               CONSTANTS
    ////////////////////////////////////////////////////////////*/

    uint256 private constant WAD = 1e18;
    /// @dev Per-second fee ceiling ≈ 50%/yr nominal (same bound as v1).
    uint256 public constant MAX_FEE_RATE = 16e9;
    uint64 public constant MIN_GRACE = 1 days;
    uint64 public constant MAX_GRACE = 365 days;
    uint16 public constant MAX_ROUTING_FEE_BPS = 1000; // 10%
    uint256 public constant MAX_PATH = 8; // nodes, incl. payer and payee
    uint256 public constant MAX_EDGES = 256;
    /// @dev Per-operation amount cap (2^127-1) so balances stay far from int256 overflow.
    uint256 public constant MAX_AMOUNT = (1 << 127) - 1;

    /// @notice Line flag: both parties consent to multilateral clearing.
    uint8 public constant FLAG_CLEARABLE = 1;
    uint8 private constant KNOWN_FLAGS = FLAG_CLEARABLE;

    // Transient-storage namespaces (EIP-1153).
    uint256 private constant _LOCK_SLOT = 0;
    bytes32 private constant _NET_NS = keccak256("commons.clear.net");
    bytes32 private constant _SEEN_NS = keccak256("commons.clear.seen");

    // EIP-712
    bytes32 private constant _DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "Intent(address signer,uint8 action,bytes32 paramsHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant _NAME_HASH = keccak256("CommonsClearingHouse");
    bytes32 private constant _VERSION_HASH = keccak256("1");
    uint256 private immutable _CACHED_CHAIN_ID;
    bytes32 private immutable _CACHED_DOMAIN_SEPARATOR;

    /*////////////////////////////////////////////////////////////
                                 TYPES
    ////////////////////////////////////////////////////////////*/

    enum Status {
        None,
        Proposed,
        Active,
        Closed,
        Defaulted
    }

    /// @dev lo/hi = sorted pair; token is part of the key. Balance > 0: hi owes lo.
    struct Line {
        uint128 limitLo; // credit lo extends = max hi may owe lo
        uint128 limitHi; // credit hi extends = max lo may owe hi
        int256 balance;
        uint64 feeRate; // per-second simple interest on |balance|, WAD
        uint64 grace; // seconds between demand and default
        uint64 lastAccrual;
        uint64 demandTs; // 0 = no open demand
        address demandBy;
        Status status;
        uint8 flags;
        uint32 nonce; // proposal counter for this key (survives close/re-propose)
        address proposer;
        bytes32 termsHash;
    }

    struct RoutingPolicy {
        bool enabled;
        uint16 feeBps;
    }

    /// @dev Per (address, token). Self-dealable: volume among sybils costs only
    ///      gas, so readers should weight it by counterparties they trust.
    struct Standing {
        uint256 settledVolume; // debt this address repaid in tokens
        uint256 clearedVolume; // debt cleared on lines this address is party to
        uint32 defaults;
        uint32 cures;
        uint32 linesOpened;
        uint32 writeOffs; // debts a creditor forgave on this address
    }

    struct Edge {
        address debtor;
        address creditor;
        uint256 amount;
    }

    enum Action {
        Propose, // (counterparty, token, myLimit, feeRate, grace, flags)
        Accept, // (proposer, token, myLimit, termsHash)
        Cancel, // (counterparty, token)
        Reject, // (proposer, token)
        SetLimit, // (counterparty, token, newLimit)
        SetRouting, // (token, enabled, feeBps)
        Pay, // (to, token, amount)
        PayPath, // (token, path[], amount, maxTotalFee)
        Settle, // (creditor, token, amount)
        Demand, // (debtor, token)
        MarkDefault, // (debtor, token)
        Close, // (counterparty, token)
        SetRouteCap, // (to, token, cap)
        Withdraw, // (token, to)
        WriteOff // (debtor, token)
    }

    struct Intent {
        address signer;
        Action action;
        bytes params;
        uint256 nonce;
        uint256 deadline;
    }

    /*////////////////////////////////////////////////////////////
                                 STATE
    ////////////////////////////////////////////////////////////*/

    mapping(bytes32 => Line) internal _lines;
    mapping(address => mapping(address => RoutingPolicy)) public routing; // node => token
    mapping(address => mapping(address => Standing)) public standing; // addr => token
    /// @notice Max debt `node` will carry to `to` in `token` as a result of being
    ///         routed through. Default 0: routing needs per-counterparty consent.
    mapping(address => mapping(address => mapping(address => uint256))) public routeCap;
    /// @notice Settled tokens awaiting withdrawal by the creditor (pull payments).
    mapping(address => mapping(address => uint256)) public claimable; // creditor => token
    /// @dev Unordered nonces (Permit2-style bitmap): signer => word => bits.
    mapping(address => mapping(uint256 => uint256)) public nonceBitmap;

    /*////////////////////////////////////////////////////////////
                                 EVENTS
    ////////////////////////////////////////////////////////////*/

    event LineProposed(
        bytes32 indexed key,
        address indexed proposer,
        address indexed counterparty,
        address token,
        uint256 proposerLimit,
        uint256 feeRate,
        uint64 grace,
        uint8 flags,
        uint32 nonce,
        bytes32 termsHash
    );
    event LineOpened(bytes32 indexed key, address lo, address hi, address token);
    event LimitSet(bytes32 indexed key, address indexed party, uint256 newLimit);
    event RoutingPolicySet(address indexed node, address indexed token, bool enabled, uint16 feeBps);
    event Payment(bytes32 indexed key, address indexed from, address indexed to, uint256 amount);
    event PathPayment(address indexed token, address[] path, uint256 amount, uint256 totalFee);
    event Cleared(address indexed token, address indexed solver, uint256 edges, uint256 volume);
    event Settled(bytes32 indexed key, address indexed debtor, address indexed payer, uint256 amount);
    event SettlementDemanded(bytes32 indexed key, address indexed creditor, uint256 owed);
    event Defaulted(bytes32 indexed key, address indexed debtor, uint256 owed);
    event Cured(bytes32 indexed key, address indexed debtor);
    event LineClosed(bytes32 indexed key);
    event NonceInvalidated(address indexed signer, uint256 nonce);
    event RouteCapSet(address indexed node, address indexed to, address indexed token, uint256 cap);
    event Withdrawn(address indexed creditor, address indexed token, address to, uint256 amount);
    event WrittenOff(bytes32 indexed key, address indexed debtor, address indexed creditor, uint256 amount);

    /*////////////////////////////////////////////////////////////
                                 ERRORS
    ////////////////////////////////////////////////////////////*/

    error BadParams();
    error BadStatus();
    error TermsMismatch();
    error LimitExceeded();
    error NothingOwed();
    error GraceNotElapsed();
    error DemandOpen();
    error NotClearable();
    error Unbalanced();
    error BadPath();
    error RoutingDisabled();
    error RouteCapExceeded();
    error FeeExceeded();
    error TransferFailed();
    error NonStandardToken();
    error Reentrancy();
    error Expired();
    error NonceUsed();
    error BadSignature();

    constructor() {
        _CACHED_CHAIN_ID = block.chainid;
        _CACHED_DOMAIN_SEPARATOR = _buildDomainSeparator();
    }

    /*////////////////////////////////////////////////////////////
                         DIRECT (msg.sender) ENTRYPOINTS
    ////////////////////////////////////////////////////////////*/

    function proposeLine(
        address counterparty,
        address token,
        uint256 myLimit,
        uint256 feeRate,
        uint64 grace,
        uint8 flags
    ) external returns (bytes32) {
        return _propose(msg.sender, counterparty, token, myLimit, feeRate, grace, flags);
    }

    function acceptLine(address proposer, address token, uint256 myLimit, bytes32 termsHash) external {
        _accept(msg.sender, proposer, token, myLimit, termsHash);
    }

    function cancelProposal(address counterparty, address token) external {
        _cancel(msg.sender, counterparty, token);
    }

    function rejectProposal(address proposer, address token) external {
        _reject(msg.sender, proposer, token);
    }

    function setMyLimit(address counterparty, address token, uint256 newLimit) external {
        _setLimit(msg.sender, counterparty, token, newLimit);
    }

    function setRoutingPolicy(address token, bool enabled, uint16 feeBps) external {
        _setRouting(msg.sender, token, enabled, feeBps);
    }

    function setRouteCap(address to, address token, uint256 cap) external {
        _setRouteCap(msg.sender, to, token, cap);
    }

    /// @notice Withdraw settled tokens credited to you, to any address.
    function withdraw(address token, address to) external returns (uint256) {
        return _withdraw(msg.sender, token, to);
    }

    /// @notice Creditor forgives what `debtor` owes on their line. Closes a
    ///         Defaulted line (stops interest, frees the key); recorded publicly.
    function writeOff(address debtor, address token) external returns (uint256) {
        return _writeOff(msg.sender, debtor, token);
    }

    function pay(address to, address token, uint256 amount) external {
        _pay(msg.sender, to, token, amount);
    }

    function payPath(address token, address[] calldata path, uint256 amount, uint256 maxTotalFee)
        external
        returns (uint256 totalFee)
    {
        return _payPath(msg.sender, token, path, amount, maxTotalFee);
    }

    function settle(address creditor, address token, uint256 amount) external returns (uint256) {
        return _settle(msg.sender, msg.sender, creditor, token, amount);
    }

    /// @notice Pay down someone else's debt with your own tokens. Benign by
    ///         construction (only reduces debt); used by backing layers.
    function settleFor(address debtor, address creditor, address token, uint256 amount)
        external
        returns (uint256)
    {
        return _settle(msg.sender, debtor, creditor, token, amount);
    }

    function demandSettlement(address debtor, address token) external {
        _demand(msg.sender, debtor, token);
    }

    function markDefault(address debtor, address token) external {
        _markDefault(msg.sender, debtor, token);
    }

    function closeLine(address counterparty, address token) external {
        _close(msg.sender, counterparty, token);
    }

    /*////////////////////////////////////////////////////////////
                                CLEARING
    ////////////////////////////////////////////////////////////*/

    /// @notice Permissionless multilateral clearing of a circulation.
    /// @dev Edges apply sequentially against live state, so a repeated edge can
    ///      never net past what is actually owed. Conservation (Σin == Σout per
    ///      node) is checked over all edges with a transient net map.
    function clear(address token, Edge[] calldata edges) external returns (uint256 volume) {
        uint256 n = edges.length;
        if (n < 3 || n > MAX_EDGES) revert BadParams();
        address[] memory touched = new address[](2 * n);
        uint256 t;

        for (uint256 i; i < n; ++i) {
            Edge calldata e = edges[i];
            if (e.amount == 0 || e.debtor == e.creditor || e.amount > MAX_AMOUNT) {
                revert BadParams();
            }
            bytes32 key = lineKey(e.debtor, e.creditor, token);
            Line storage l = _lines[key];
            if (l.status != Status.Active) revert BadStatus();
            if (l.flags & FLAG_CLEARABLE == 0) revert NotClearable();
            _accrue(l);
            (address lo, address hi) = _pair(e.debtor, e.creditor);
            if (_owedOf(l.balance, e.debtor, lo) < e.amount) revert NothingOwed();
            _reduceDebt(l, e.debtor, lo, e.amount);
            _clearDemandIfCovered(l, lo, hi);

            t = _touch(e.debtor, touched, t);
            t = _touch(e.creditor, touched, t);
            _addNet(e.debtor, -int256(e.amount));
            _addNet(e.creditor, int256(e.amount));

            standing[e.debtor][token].clearedVolume += e.amount;
            standing[e.creditor][token].clearedVolume += e.amount;
            volume += e.amount;
        }

        for (uint256 j; j < t; ++j) {
            address node = touched[j];
            if (_getNet(node) != 0) revert Unbalanced();
            _resetNode(node);
        }
        emit Cleared(token, msg.sender, n, volume);
    }

    /*////////////////////////////////////////////////////////////
                              SIGNED INTENTS
    ////////////////////////////////////////////////////////////*/

    /// @notice Execute an EIP-712 signed intent on behalf of `it.signer`.
    ///         Anyone may relay; params are bound by the signature.
    function execute(Intent calldata it, bytes calldata signature) external returns (bytes memory) {
        if (block.timestamp > it.deadline) revert Expired();
        _useNonce(it.signer, it.nonce);
        bytes32 digest = intentDigest(it);
        if (!_isValidSignature(it.signer, digest, signature)) revert BadSignature();
        return _dispatch(it.signer, it.action, it.params);
    }

    /// @notice Burn an unused nonce (cancel a signed-but-unrelayed intent).
    function invalidateNonce(uint256 nonce) external {
        _useNonce(msg.sender, nonce);
        emit NonceInvalidated(msg.sender, nonce);
    }

    function intentDigest(Intent calldata it) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(INTENT_TYPEHASH, it.signer, uint8(it.action), keccak256(it.params), it.nonce, it.deadline)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function domainSeparator() public view returns (bytes32) {
        return block.chainid == _CACHED_CHAIN_ID ? _CACHED_DOMAIN_SEPARATOR : _buildDomainSeparator();
    }

    function nonceUsed(address signer, uint256 nonce) external view returns (bool) {
        return nonceBitmap[signer][nonce >> 8] & (1 << (nonce & 0xff)) != 0;
    }

    function _dispatch(address s, Action a, bytes calldata p) internal returns (bytes memory) {
        if (a == Action.Propose) {
            (address cp, address token, uint256 lim, uint256 fee, uint64 grace, uint8 flags) =
                abi.decode(p, (address, address, uint256, uint256, uint64, uint8));
            return abi.encode(_propose(s, cp, token, lim, fee, grace, flags));
        } else if (a == Action.Accept) {
            (address proposer, address token, uint256 lim, bytes32 th) =
                abi.decode(p, (address, address, uint256, bytes32));
            _accept(s, proposer, token, lim, th);
        } else if (a == Action.Cancel) {
            (address cp, address token) = abi.decode(p, (address, address));
            _cancel(s, cp, token);
        } else if (a == Action.Reject) {
            (address proposer, address token) = abi.decode(p, (address, address));
            _reject(s, proposer, token);
        } else if (a == Action.SetLimit) {
            (address cp, address token, uint256 lim) = abi.decode(p, (address, address, uint256));
            _setLimit(s, cp, token, lim);
        } else if (a == Action.SetRouting) {
            (address token, bool enabled, uint16 feeBps) = abi.decode(p, (address, bool, uint16));
            _setRouting(s, token, enabled, feeBps);
        } else if (a == Action.Pay) {
            (address to, address token, uint256 amount) = abi.decode(p, (address, address, uint256));
            _pay(s, to, token, amount);
        } else if (a == Action.PayPath) {
            (address token, address[] memory path, uint256 amount, uint256 maxFee) =
                abi.decode(p, (address, address[], uint256, uint256));
            return abi.encode(_payPath(s, token, path, amount, maxFee));
        } else if (a == Action.Settle) {
            (address creditor, address token, uint256 amount) = abi.decode(p, (address, address, uint256));
            return abi.encode(_settle(s, s, creditor, token, amount));
        } else if (a == Action.Demand) {
            (address debtor, address token) = abi.decode(p, (address, address));
            _demand(s, debtor, token);
        } else if (a == Action.MarkDefault) {
            (address debtor, address token) = abi.decode(p, (address, address));
            _markDefault(s, debtor, token);
        } else if (a == Action.Close) {
            (address cp, address token) = abi.decode(p, (address, address));
            _close(s, cp, token);
        } else if (a == Action.SetRouteCap) {
            (address to, address token, uint256 cap) = abi.decode(p, (address, address, uint256));
            _setRouteCap(s, to, token, cap);
        } else if (a == Action.Withdraw) {
            (address token, address to) = abi.decode(p, (address, address));
            return abi.encode(_withdraw(s, token, to));
        } else {
            (address debtor, address token) = abi.decode(p, (address, address));
            return abi.encode(_writeOff(s, debtor, token));
        }
        return "";
    }

    /*////////////////////////////////////////////////////////////
                                  VIEWS
    ////////////////////////////////////////////////////////////*/

    function lineKey(address x, address y, address token) public pure returns (bytes32) {
        (address lo, address hi) = _pair(x, y);
        return keccak256(abi.encodePacked(lo, hi, token));
    }

    function getLine(address x, address y, address token) external view returns (Line memory) {
        return _lines[lineKey(x, y, token)];
    }

    /// @notice Debt `debtor` owes `creditor` on their line, including accrued interest.
    function owedBy(address debtor, address creditor, address token) public view returns (uint256) {
        Line storage l = _lines[lineKey(debtor, creditor, token)];
        if (l.status != Status.Active && l.status != Status.Defaulted) return 0;
        (address lo,) = _pair(debtor, creditor);
        return _owedOf(_accruedBalance(l), debtor, lo);
    }

    /// @notice Hash the acceptor must echo. Pure, so UIs can show and verify terms.
    function computeTermsHash(
        bytes32 key,
        uint32 nonce,
        address proposer,
        address counterparty,
        uint256 proposerLimit,
        uint256 feeRate,
        uint64 grace,
        uint8 flags
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(key, nonce, proposer, counterparty, proposerLimit, feeRate, grace, flags));
    }

    /// @notice Per-edge amounts and total fee for a path payment delivering `amount`.
    function quotePath(address token, address[] calldata path, uint256 amount)
        external
        view
        returns (uint256[] memory amounts, uint256 totalFee)
    {
        amounts = _pathAmounts(token, path, amount);
        totalFee = amounts[0] - amount;
    }

    /*////////////////////////////////////////////////////////////
                              LINE LIFECYCLE
    ////////////////////////////////////////////////////////////*/

    function _propose(
        address self,
        address cp,
        address token,
        uint256 myLimit,
        uint256 feeRate,
        uint64 grace,
        uint8 flags
    ) internal returns (bytes32 key) {
        if (cp == self || cp == address(0) || token == address(0)) revert BadParams();
        if (feeRate > MAX_FEE_RATE || grace < MIN_GRACE || grace > MAX_GRACE) revert BadParams();
        if (myLimit > type(uint128).max || flags & ~KNOWN_FLAGS != 0) revert BadParams();
        key = lineKey(self, cp, token);
        Line storage l = _lines[key];
        if (l.status != Status.None && l.status != Status.Closed) revert BadStatus();

        (address lo,) = _pair(self, cp);
        uint32 nonce = l.nonce + 1;
        bytes32 th = computeTermsHash(key, nonce, self, cp, myLimit, feeRate, grace, flags);
        _lines[key] = Line({
            limitLo: self == lo ? uint128(myLimit) : 0,
            limitHi: self == lo ? 0 : uint128(myLimit),
            balance: 0,
            feeRate: uint64(feeRate),
            grace: grace,
            lastAccrual: uint64(block.timestamp),
            demandTs: 0,
            demandBy: address(0),
            status: Status.Proposed,
            flags: flags,
            nonce: nonce,
            proposer: self,
            termsHash: th
        });
        emit LineProposed(key, self, cp, token, myLimit, feeRate, grace, flags, nonce, th);
    }

    function _accept(address self, address proposer, address token, uint256 myLimit, bytes32 th) internal {
        if (myLimit > type(uint128).max) revert BadParams();
        bytes32 key = lineKey(self, proposer, token);
        Line storage l = _lines[key];
        if (l.status != Status.Proposed || l.proposer != proposer || proposer == self) revert BadStatus();
        if (l.termsHash != th) revert TermsMismatch();
        (address lo, address hi) = _pair(self, proposer);
        if (self == lo) l.limitLo = uint128(myLimit);
        else l.limitHi = uint128(myLimit);
        l.status = Status.Active;
        l.lastAccrual = uint64(block.timestamp);
        standing[lo][token].linesOpened += 1;
        standing[hi][token].linesOpened += 1;
        emit LineOpened(key, lo, hi, token);
    }

    function _cancel(address self, address cp, address token) internal {
        bytes32 key = lineKey(self, cp, token);
        Line storage l = _lines[key];
        if (l.status != Status.Proposed || l.proposer != self) revert BadStatus();
        l.status = Status.Closed;
        emit LineClosed(key);
    }

    function _reject(address self, address proposer, address token) internal {
        bytes32 key = lineKey(self, proposer, token);
        Line storage l = _lines[key];
        if (l.status != Status.Proposed || l.proposer != proposer || proposer == self) revert BadStatus();
        l.status = Status.Closed;
        emit LineClosed(key);
    }

    function _setLimit(address self, address cp, address token, uint256 newLimit) internal {
        if (newLimit > type(uint128).max) revert BadParams();
        bytes32 key = lineKey(self, cp, token);
        Line storage l = _lines[key];
        if (l.status != Status.Active) revert BadStatus();
        (address lo,) = _pair(self, cp);
        if (self == lo) l.limitLo = uint128(newLimit);
        else l.limitHi = uint128(newLimit);
        emit LimitSet(key, self, newLimit);
    }

    function _setRouting(address self, address token, bool enabled, uint16 feeBps) internal {
        if (feeBps > MAX_ROUTING_FEE_BPS) revert BadParams();
        routing[self][token] = RoutingPolicy(enabled, feeBps);
        emit RoutingPolicySet(self, token, enabled, feeBps);
    }

    function _setRouteCap(address self, address to, address token, uint256 cap) internal {
        if (to == self || to == address(0)) revert BadParams();
        routeCap[self][to][token] = cap;
        emit RouteCapSet(self, to, token, cap);
    }

    function _writeOff(address creditor, address debtor, address token) internal returns (uint256 owed) {
        bytes32 key = lineKey(creditor, debtor, token);
        Line storage l = _lines[key];
        if (l.status != Status.Active && l.status != Status.Defaulted) revert BadStatus();
        _accrue(l);
        (address lo, address hi) = _pair(creditor, debtor);
        owed = _owedOf(l.balance, debtor, lo);
        if (owed == 0) revert NothingOwed();
        _reduceDebt(l, debtor, lo, owed);
        _clearDemandIfCovered(l, lo, hi);
        standing[debtor][token].writeOffs += 1;
        if (l.status == Status.Defaulted) {
            l.status = Status.Closed;
            emit LineClosed(key);
        }
        emit WrittenOff(key, debtor, creditor, owed);
    }

    function _withdraw(address creditor, address token, address to) internal returns (uint256 amount) {
        _lock();
        if (to == address(0)) revert BadParams();
        amount = claimable[creditor][token];
        if (amount == 0) revert NothingOwed();
        claimable[creditor][token] = 0;
        _safeTransfer(token, to, amount);
        emit Withdrawn(creditor, token, to, amount);
        _unlock();
    }

    function _close(address self, address cp, address token) internal {
        bytes32 key = lineKey(self, cp, token);
        Line storage l = _lines[key];
        if (l.status != Status.Active) revert BadStatus();
        _accrue(l);
        if (l.balance != 0) revert NothingOwed();
        l.status = Status.Closed;
        l.demandTs = 0;
        l.demandBy = address(0);
        emit LineClosed(key);
    }

    /*////////////////////////////////////////////////////////////
                                 PAYMENTS
    ////////////////////////////////////////////////////////////*/

    function _pay(address from, address to, address token, uint256 amount) internal {
        if (amount == 0 || amount > MAX_AMOUNT) revert BadParams();
        bytes32 key = _increaseDebt(from, to, token, amount);
        emit Payment(key, from, to, amount);
    }

    function _payPath(address self, address token, address[] memory path, uint256 amount, uint256 maxFee)
        internal
        returns (uint256 totalFee)
    {
        if (path.length == 0 || path[0] != self) revert BadPath();
        uint256[] memory amounts = _pathAmounts(token, path, amount);
        totalFee = amounts[0] - amount;
        if (totalFee > maxFee) revert FeeExceeded();
        for (uint256 i; i + 1 < path.length; ++i) {
            bytes32 key = _increaseDebt(path[i], path[i + 1], token, amounts[i]);
            // Intermediaries consent per outbound counterparty: routing may only
            // grow their debt to path[i+1] up to the cap they set for that line.
            if (i > 0) {
                (address lo,) = _pair(path[i], path[i + 1]);
                if (_owedOf(_lines[key].balance, path[i], lo) > routeCap[path[i]][path[i + 1]][token]) {
                    revert RouteCapExceeded();
                }
            }
            emit Payment(key, path[i], path[i + 1], amounts[i]);
        }
        emit PathPayment(token, path, amount, totalFee);
    }

    /// @dev amounts[i] = value moved on edge path[i] -> path[i+1]. Each
    ///      intermediary path[i] (0 < i < n-1) forwards amounts[i] and is owed
    ///      amounts[i-1] = amounts[i] + ceil(amounts[i] * feeBps / 1e4).
    function _pathAmounts(address token, address[] memory path, uint256 amount)
        internal
        view
        returns (uint256[] memory amounts)
    {
        uint256 n = path.length;
        if (n < 2 || n > MAX_PATH) revert BadPath();
        if (amount == 0 || amount > MAX_AMOUNT) revert BadParams();
        amounts = new uint256[](n - 1);
        amounts[n - 2] = amount;
        for (uint256 i = n - 2; i > 0; --i) {
            RoutingPolicy memory rp = routing[path[i]][token];
            if (!rp.enabled) revert RoutingDisabled();
            uint256 fwd = amounts[i];
            amounts[i - 1] = fwd + (fwd * rp.feeBps + 9_999) / 10_000;
        }
        if (amounts[0] > MAX_AMOUNT) revert BadParams();
    }

    /// @dev `debtor` comes to owe `creditor` `amount` more on their Active line.
    ///      If the creditor currently owes the debtor, that is reduced first —
    ///      always allowed. Any resulting debt must fit the creditor's limit.
    function _increaseDebt(address debtor, address creditor, address token, uint256 amount)
        internal
        returns (bytes32 key)
    {
        if (debtor == creditor) revert BadPath();
        key = lineKey(debtor, creditor, token);
        Line storage l = _lines[key];
        if (l.status != Status.Active) revert BadStatus();
        _accrue(l);
        (address lo, address hi) = _pair(debtor, creditor);
        int256 bal = l.balance;
        if (debtor == hi) {
            int256 nb = bal + int256(amount);
            if (nb > 0 && uint256(nb) > l.limitLo) revert LimitExceeded();
            l.balance = nb;
        } else {
            int256 nb = bal - int256(amount);
            if (nb < 0 && uint256(-nb) > l.limitHi) revert LimitExceeded();
            l.balance = nb;
        }
        // Paying down your own creditor can satisfy an open demand on you.
        _clearDemandIfCovered(l, lo, hi);
    }

    /*////////////////////////////////////////////////////////////
                         SETTLEMENT & DEFAULT
    ////////////////////////////////////////////////////////////*/

    function _settle(address payer, address debtor, address creditor, address token, uint256 amount)
        internal
        returns (uint256)
    {
        _lock();
        // payer == creditor would be a free round-trip (farm volume / cures).
        if (amount == 0 || debtor == creditor || payer == creditor) revert BadParams();
        bytes32 key = lineKey(debtor, creditor, token);
        Line storage l = _lines[key];
        if (l.status != Status.Active && l.status != Status.Defaulted) revert BadStatus();
        _accrue(l);
        (address lo, address hi) = _pair(debtor, creditor);
        uint256 owed = _owedOf(l.balance, debtor, lo);
        if (owed == 0) revert NothingOwed();
        if (amount > owed) amount = owed;

        // Effects before the external call.
        _reduceDebt(l, debtor, lo, amount);
        _clearDemandIfCovered(l, lo, hi);
        standing[debtor][token].settledVolume += amount;
        claimable[creditor][token] += amount;
        if (l.status == Status.Defaulted && l.balance == 0) {
            l.status = Status.Closed;
            standing[debtor][token].cures += 1;
            emit Cured(key, debtor);
            emit LineClosed(key);
        }

        // Pull model: tokens land here, never pushed to the creditor, so the
        // creditor cannot make repayment revert and then claim default.
        uint256 before = IClearingToken(token).balanceOf(address(this));
        _safeTransferFrom(token, payer, address(this), amount);
        if (IClearingToken(token).balanceOf(address(this)) - before != amount) revert NonStandardToken();
        emit Settled(key, debtor, payer, amount);
        _unlock();
        return amount;
    }

    function _demand(address creditor, address debtor, address token) internal {
        bytes32 key = lineKey(creditor, debtor, token);
        Line storage l = _lines[key];
        if (l.status != Status.Active) revert BadStatus();
        if (l.demandTs != 0) revert DemandOpen();
        _accrue(l);
        (address lo,) = _pair(creditor, debtor);
        uint256 owed = _owedOf(l.balance, debtor, lo);
        if (owed == 0) revert NothingOwed();
        l.demandTs = uint64(block.timestamp);
        l.demandBy = creditor;
        emit SettlementDemanded(key, creditor, owed);
    }

    function _markDefault(address creditor, address debtor, address token) internal {
        bytes32 key = lineKey(creditor, debtor, token);
        Line storage l = _lines[key];
        if (l.status != Status.Active || l.demandTs == 0 || l.demandBy != creditor) revert BadStatus();
        if (block.timestamp < uint256(l.demandTs) + l.grace) revert GraceNotElapsed();
        _accrue(l);
        (address lo,) = _pair(creditor, debtor);
        uint256 owed = _owedOf(l.balance, debtor, lo);
        if (owed == 0) revert NothingOwed();
        l.status = Status.Defaulted;
        standing[debtor][token].defaults += 1;
        emit Defaulted(key, debtor, owed);
    }

    /*////////////////////////////////////////////////////////////
                                INTERNALS
    ////////////////////////////////////////////////////////////*/

    function _pair(address x, address y) private pure returns (address lo, address hi) {
        (lo, hi) = x < y ? (x, y) : (y, x);
    }

    function _owedOf(int256 bal, address debtor, address lo) private pure returns (uint256) {
        if (debtor == lo) return bal < 0 ? uint256(-bal) : 0;
        return bal > 0 ? uint256(bal) : 0;
    }

    /// @dev Caller guarantees amount <= current owed by `debtor`.
    function _reduceDebt(Line storage l, address debtor, address lo, uint256 amount) private {
        if (debtor == lo) l.balance += int256(amount);
        else l.balance -= int256(amount);
    }

    function _accruedBalance(Line storage l) internal view returns (int256) {
        int256 bal = l.balance;
        if (bal == 0 || l.feeRate == 0) return bal;
        uint256 dt = block.timestamp - l.lastAccrual;
        if (dt == 0) return bal;
        uint256 mag = bal > 0 ? uint256(bal) : uint256(-bal);
        uint256 interest = (mag * l.feeRate * dt) / WAD;
        return bal > 0 ? bal + int256(interest) : bal - int256(interest);
    }

    function _accrue(Line storage l) internal {
        l.balance = _accruedBalance(l);
        l.lastAccrual = uint64(block.timestamp);
    }

    function _clearDemandIfCovered(Line storage l, address lo, address hi) private {
        if (l.demandTs == 0) return;
        address debtor = l.demandBy == lo ? hi : lo;
        if (_owedOf(l.balance, debtor, lo) == 0) {
            l.demandTs = 0;
            l.demandBy = address(0);
        }
    }

    // ---- transient net map for clear()

    function _netSlot(address node) private pure returns (bytes32) {
        return keccak256(abi.encode(_NET_NS, node));
    }

    function _seenSlot(address node) private pure returns (bytes32) {
        return keccak256(abi.encode(_SEEN_NS, node));
    }

    function _touch(address node, address[] memory touched, uint256 t) private returns (uint256) {
        bytes32 s = _seenSlot(node);
        uint256 seen;
        assembly {
            seen := tload(s)
        }
        if (seen == 0) {
            assembly {
                tstore(s, 1)
            }
            touched[t] = node;
            return t + 1;
        }
        return t;
    }

    function _addNet(address node, int256 delta) private {
        bytes32 s = _netSlot(node);
        int256 cur;
        assembly {
            cur := tload(s)
        }
        cur += delta;
        assembly {
            tstore(s, cur)
        }
    }

    function _getNet(address node) private view returns (int256 v) {
        bytes32 s = _netSlot(node);
        assembly {
            v := tload(s)
        }
    }

    function _resetNode(address node) private {
        bytes32 a = _netSlot(node);
        bytes32 b = _seenSlot(node);
        assembly {
            tstore(a, 0)
            tstore(b, 0)
        }
    }

    // ---- reentrancy

    function _lock() private {
        uint256 locked;
        assembly {
            locked := tload(_LOCK_SLOT)
        }
        if (locked != 0) revert Reentrancy();
        assembly {
            tstore(_LOCK_SLOT, 1)
        }
    }

    function _unlock() private {
        assembly {
            tstore(_LOCK_SLOT, 0)
        }
    }

    // ---- signatures & nonces

    function _useNonce(address signer, uint256 nonce) private {
        uint256 word = nonce >> 8;
        uint256 bit = 1 << (nonce & 0xff);
        uint256 cur = nonceBitmap[signer][word];
        if (cur & bit != 0) revert NonceUsed();
        nonceBitmap[signer][word] = cur | bit;
    }

    function _isValidSignature(address signer, bytes32 digest, bytes calldata sig) private view returns (bool) {
        if (signer == address(0)) return false;
        // ECDSA first: covers plain EOAs and EIP-7702-delegated EOAs (which have
        // code but may not implement ERC-1271).
        if (sig.length == 65) {
            bytes32 r = bytes32(sig[0:32]);
            bytes32 s = bytes32(sig[32:64]);
            uint8 v = uint8(sig[64]);
            // Reject malleable high-s signatures (EIP-2).
            if (
                uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0
                    && (v == 27 || v == 28)
            ) {
                address rec = ecrecover(digest, v, r, s);
                if (rec != address(0) && rec == signer) return true;
            }
        }
        if (signer.code.length == 0) return false;
        (bool ok, bytes memory ret) =
            signer.staticcall(abi.encodeWithSelector(IERC1271.isValidSignature.selector, digest, sig));
        return ok && ret.length >= 32 && abi.decode(ret, (bytes4)) == IERC1271.isValidSignature.selector;
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(_DOMAIN_TYPEHASH, _NAME_HASH, _VERSION_HASH, block.chainid, address(this)));
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        if (token.code.length == 0) revert TransferFailed();
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IClearingToken.transfer.selector, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        if (token.code.length == 0) revert TransferFailed();
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IClearingToken.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
