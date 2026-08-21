// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/*//////////////////////////////////////////////////////////////////////////
                SuwappuMutualCredit — Mutual Credit Clearing Network

    An immutable, dependency-free graph of bilateral credit lines with
    multilateral netting and no central counterparty, collateral, or oracle.

    - Any two addresses open a mutual credit line in any ERC-20 unit of account,
      with credit limits, fee rate, and settlement grace period fixed at opening
      (propose → accept handshake).
    - pay() moves value as credit along a line, bounded by the limit the payee
      chose to extend.
    - netCycle() is permissionless multilateral netting: anyone submits a cycle
      A→B→…→A of obligations and reduces every leg by the cycle minimum, so only
      residual balances ever need settlement.
    - Settlement is by real token transfer (settle). A creditor may
      demandSettlement; once the grace period lapses unpaid the line can be
      marked defaulted — the enforcement is the on-chain default record, which
      reputation/insurance layers can build on. Defaults stay settleable so a
      debtor can cure.

    No owner, no upgrade path, no governance, no price feeds, no imports.
//////////////////////////////////////////////////////////////////////////*/

/// @dev Minimal external-token interface (named to avoid clashing with any ERC20 lib).
interface ICreditToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract SuwappuMutualCredit {
    /*////////////////////////////////////////////////////////////
                          REENTRANCY GUARD (inlined)
    ////////////////////////////////////////////////////////////*/
    // EIP-1153 transient reentrancy guard (~200 gas vs ~5k for an SSTORE pair).
    // Uses tstore/tload directly since the 0.8.27 `transient` keyword predates support.
    uint256 private constant _LOCK_SLOT = 0;

    modifier nonReentrant() {
        assembly {
            if tload(_LOCK_SLOT) { revert(0, 0) }
            tstore(_LOCK_SLOT, 1)
        }
        _;
        assembly {
            tstore(_LOCK_SLOT, 0)
        }
    }

    uint256 private constant WAD = 1e18;
    /// @dev Per-second fee-rate ceiling ~= 50%/yr *nominal*. Interest is folded into
    ///      the balance on each `_accrue`, so frequent pokes (via any state-changing
    ///      call on the line) compound it; the low ceiling bounds that drift. Debtors
    ///      can settle at any time, capping their exposure regardless.
    uint256 private constant MAX_FEE_RATE = 16e9; // ~0.5e18/yr per-second WAD rate

    enum Status {
        None,
        Proposed,
        Active,
        Closed,
        Defaulted
    }

    /// @dev The pair (a = lower address, b = higher) and `token` are NOT stored —
    ///      they are pure functions of the lineKey inputs, which every function
    ///      already receives, so recomputing them via `_pair` saves 3 storage slots
    ///      per line (a big cut to proposeLine's cold-SSTORE cost). `limitA`/`limitB`
    ///      stay bound to the lower/higher address respectively.
    struct Line {
        uint256 limitA;       // max debt `a` (lower) accepts from `b` (credit a extends)
        uint256 limitB;       // max debt `b` (higher) accepts from `a` (credit b extends)
        int256 balance;       // > 0: b owes a; < 0: a owes b
        uint256 feeRate;      // per-second interest on outstanding balance, WAD
        uint64 grace;         // settlement grace period in seconds
        uint64 lastAccrual;
        uint64 demandTs;      // 0 = no outstanding settlement demand
        Status status;        // packs with the three uint64s above (25 bytes/slot)
        address demandBy;
        address proposer;
    }

    /// @dev Sorted pair for a two-party line (a = lower, b = higher address).
    function _pair(address x, address y) private pure returns (address a, address b) {
        (a, b) = x < y ? (x, y) : (y, x);
    }

    mapping(bytes32 => Line) public lines;
    /// @notice Lifetime defaults recorded per address — raw material for reputation layers.
    mapping(address => uint256) public defaults;

    event LineProposed(bytes32 indexed key, address indexed proposer, address indexed counterparty, address token, uint256 proposerLimit, uint256 feeRate, uint64 grace);
    event LineOpened(bytes32 indexed key, address a, address b, address token);
    event Payment(bytes32 indexed key, address indexed from, address indexed to, uint256 amount);
    event CycleNetted(address indexed token, address[] cycle, uint256 amount);
    event Settled(bytes32 indexed key, address indexed debtor, uint256 amount);
    event SettlementDemanded(bytes32 indexed key, address indexed creditor, uint256 owed);
    event Defaulted(bytes32 indexed key, address indexed debtor, uint256 owed);
    event LineClosed(bytes32 indexed key);

    error BadParams();
    error BadStatus();
    error LimitExceeded();
    error NothingOwed();
    error GraceNotElapsed();
    error BadCycle();
    error TransferFailed();

    // ---------------------------------------------------------------- opening

    function lineKey(address x, address y, address token) public pure returns (bytes32) {
        (address lo, address hi) = x < y ? (x, y) : (y, x);
        return keccak256(abi.encodePacked(lo, hi, token));
    }

    /// @notice Propose a credit line. `myLimit` is the credit msg.sender extends
    ///         (the max the counterparty may owe them). Terms are fixed forever.
    function proposeLine(
        address counterparty,
        address token,
        uint256 myLimit,
        uint256 feeRate,
        uint64 grace
    ) external returns (bytes32 key) {
        if (counterparty == msg.sender || counterparty == address(0) || token == address(0)) revert BadParams();
        if (feeRate > MAX_FEE_RATE) revert BadParams();
        key = lineKey(msg.sender, counterparty, token);
        Line storage l = lines[key];
        if (l.status != Status.None && l.status != Status.Closed) revert BadStatus();
        (address lo,) = _pair(msg.sender, counterparty);
        lines[key] = Line({
            limitA: msg.sender == lo ? myLimit : 0,
            limitB: msg.sender == lo ? 0 : myLimit,
            balance: 0,
            feeRate: feeRate,
            grace: grace,
            lastAccrual: uint64(block.timestamp),
            demandTs: 0,
            status: Status.Proposed,
            demandBy: address(0),
            proposer: msg.sender
        });
        emit LineProposed(key, msg.sender, counterparty, token, myLimit, feeRate, grace);
    }

    /// @notice Accept a proposed line, setting the credit you extend in return.
    function acceptLine(address proposer, address token, uint256 myLimit) external {
        bytes32 key = lineKey(msg.sender, proposer, token);
        Line storage l = lines[key];
        if (l.status != Status.Proposed || l.proposer != proposer || proposer == msg.sender) revert BadStatus();
        (address lo, address hi) = _pair(msg.sender, proposer);
        if (msg.sender == lo) l.limitA = myLimit;
        else l.limitB = myLimit;
        l.status = Status.Active;
        l.lastAccrual = uint64(block.timestamp);
        emit LineOpened(key, lo, hi, token);
    }

    /// @notice Proposer withdraws an unaccepted proposal, freeing the (pair, token)
    ///         key so a fresh line can be proposed. Prevents a griefer permanently
    ///         trapping a key in `Proposed`.
    function cancelProposal(address counterparty, address token) external {
        bytes32 key = lineKey(msg.sender, counterparty, token);
        Line storage l = lines[key];
        if (l.status != Status.Proposed || l.proposer != msg.sender) revert BadStatus();
        l.status = Status.Closed;
        emit LineClosed(key);
    }

    /// @notice Counterparty rejects a proposal aimed at them, freeing the key.
    function rejectProposal(address proposer, address token) external {
        bytes32 key = lineKey(msg.sender, proposer, token);
        Line storage l = lines[key];
        if (l.status != Status.Proposed || l.proposer != proposer || proposer == msg.sender) revert BadStatus();
        l.status = Status.Closed;
        emit LineClosed(key);
    }

    // ---------------------------------------------------------------- credit

    /// @notice Pay `to` with mutual credit: increases msg.sender's debt on the
    ///         line (netting first against anything `to` already owed them).
    function pay(address to, address token, uint256 amount) external {
        bytes32 key = lineKey(msg.sender, to, token);
        Line storage l = lines[key];
        if (l.status != Status.Active) revert BadStatus();
        if (amount > uint256(type(int256).max)) revert BadParams();
        _accrue(l);
        (address lo, address hi) = _pair(msg.sender, to);
        // balance convention: > 0 means b (hi) owes a (lo). Payer's debt grows.
        if (msg.sender == lo) {
            int256 newBal = l.balance - int256(amount);
            if (newBal < 0 && uint256(-newBal) > l.limitB) revert LimitExceeded();
            l.balance = newBal;
        } else {
            int256 newBal = l.balance + int256(amount);
            if (newBal > 0 && uint256(newBal) > l.limitA) revert LimitExceeded();
            l.balance = newBal;
        }
        _clearDemandIfCovered(l, lo, hi);
        emit Payment(key, msg.sender, to, amount);
    }

    /// @notice Amount `debtor` currently owes `creditor` on their line (with accrual).
    function owedBy(address debtor, address creditor, address token) public view returns (uint256) {
        Line storage l = lines[lineKey(debtor, creditor, token)];
        // Defaulted lines keep reporting their outstanding balance so reputation
        // layers (and a debtor who wants to cure) can still read the amount owed.
        if (l.status != Status.Active && l.status != Status.Defaulted) return 0;
        int256 bal = _accruedBalance(l);
        (address lo, address hi) = _pair(debtor, creditor);
        if (debtor == hi && bal > 0) return uint256(bal);
        if (debtor == lo && bal < 0) return uint256(-bal);
        return 0;
    }

    // ---------------------------------------------------------------- netting

    /// @notice Permissionless multilateral netting: given a cycle of addresses
    ///         where each owes the next (and the last owes the first) in `token`,
    ///         reduce every obligation by the minimum owed along the cycle.
    function netCycle(address token, address[] calldata cycle) external {
        uint256 n = cycle.length;
        if (n < 3) revert BadCycle();
        // Reject duplicate nodes: a repeated address would let the apply loop
        // hit the same line more than once, netting it past its true balance
        // and blowing through the agreed credit limits.
        for (uint256 i = 0; i < n;) {
            address node = cycle[i];
            if (node == address(0)) revert BadCycle();
            for (uint256 j = i + 1; j < n;) {
                if (node == cycle[j]) revert BadCycle();
                unchecked { ++j; }
            }
            unchecked { ++i; }
        }
        uint256 minOwed = type(uint256).max;
        for (uint256 i = 0; i < n;) {
            uint256 owed = owedBy(cycle[i], cycle[(i + 1) % n], token);
            if (owed == 0) revert BadCycle();
            if (owed < minOwed) minOwed = owed;
            unchecked { ++i; }
        }
        int256 signedMin = int256(minOwed);
        for (uint256 i = 0; i < n;) {
            address debtor = cycle[i];
            address creditor = cycle[(i + 1) % n];
            Line storage l = lines[lineKey(debtor, creditor, token)];
            if (l.status != Status.Active) revert BadCycle();
            _accrue(l);
            (address lo, address hi) = _pair(debtor, creditor);
            // Re-derive the leg's live obligation post-accrual and require it
            // still covers the netting amount, so no leg is ever driven past 0.
            uint256 legOwed = (debtor == hi && l.balance > 0)
                ? uint256(l.balance)
                : (debtor == lo && l.balance < 0) ? uint256(-l.balance) : 0;
            if (legOwed < minOwed) revert BadCycle();
            if (debtor == hi) l.balance -= signedMin;
            else l.balance += signedMin;
            _clearDemandIfCovered(l, lo, hi);
            unchecked { ++i; }
        }
        emit CycleNetted(token, cycle, minOwed);
    }

    // -------------------------------------------------------------- settlement

    /// @notice Settle outstanding debt with a real token transfer to the creditor.
    /// @dev The transfer is peer-to-peer (debtor → creditor), so a fee-on-transfer
    ///      or rebasing token would deliver less than `amount` while the ledger is
    ///      credited in full. The line's unit-of-account token is chosen by the two
    ///      parties at `proposeLine`, so standard-ERC-20 behaviour is their explicit
    ///      assumption — pick a normal token for the line.
    function settle(address creditor, address token, uint256 amount) external nonReentrant {
        bytes32 key = lineKey(msg.sender, creditor, token);
        Line storage l = lines[key];
        // A defaulted line is still settleable so the debtor can cure the debt.
        if (l.status != Status.Active && l.status != Status.Defaulted) revert BadStatus();
        _accrue(l);
        uint256 owed = owedBy(msg.sender, creditor, token);
        if (owed == 0) revert NothingOwed();
        if (amount > owed) amount = owed;
        (address lo, address hi) = _pair(msg.sender, creditor);
        if (msg.sender == hi) l.balance -= int256(amount);
        else l.balance += int256(amount);
        _clearDemandIfCovered(l, lo, hi);
        _safeTransferFrom(token, msg.sender, creditor, amount);
        emit Settled(key, msg.sender, amount);
    }

    /// @notice Creditor starts the settlement clock on the current debt.
    function demandSettlement(address debtor, address token) external {
        bytes32 key = lineKey(msg.sender, debtor, token);
        Line storage l = lines[key];
        if (l.status != Status.Active) revert BadStatus();
        _accrue(l);
        uint256 owed = owedBy(debtor, msg.sender, token);
        if (owed == 0) revert NothingOwed();
        l.demandTs = uint64(block.timestamp);
        l.demandBy = msg.sender;
        emit SettlementDemanded(key, msg.sender, owed);
    }

    /// @notice After the grace period lapses unpaid, record the default and
    ///         freeze the line. The debt and default stay on-chain permanently.
    function markDefault(address debtor, address token) external {
        bytes32 key = lineKey(msg.sender, debtor, token);
        Line storage l = lines[key];
        if (l.status != Status.Active || l.demandBy != msg.sender || l.demandTs == 0) revert BadStatus();
        if (block.timestamp < uint256(l.demandTs) + l.grace) revert GraceNotElapsed();
        _accrue(l);
        uint256 owed = owedBy(debtor, msg.sender, token);
        if (owed == 0) revert NothingOwed();
        l.status = Status.Defaulted;
        defaults[debtor] += 1;
        emit Defaulted(key, debtor, owed);
    }

    /// @notice Either party may close a fully-settled line.
    function closeLine(address counterparty, address token) external {
        bytes32 key = lineKey(msg.sender, counterparty, token);
        Line storage l = lines[key];
        if (l.status != Status.Active) revert BadStatus();
        _accrue(l);
        if (l.balance != 0) revert NothingOwed();
        l.status = Status.Closed;
        emit LineClosed(key);
    }

    // -------------------------------------------------------------- internals

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

    function _clearDemandIfCovered(Line storage l, address lo, address hi) internal {
        if (l.demandTs == 0) return;
        // The demandant is the creditor; the debtor is the other party.
        address debtor = l.demandBy == lo ? hi : lo;
        int256 bal = l.balance;
        bool stillOwed = (debtor == hi && bal > 0) || (debtor == lo && bal < 0);
        if (!stillOwed) {
            l.demandTs = 0;
            l.demandBy = address(0);
        }
    }

    /// @dev Safe transferFrom for arbitrary ERC-20s (handles no-return-value tokens).
    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(ICreditToken.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
