// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SuwappuMutualCredit — Mutual Credit Clearing Network
 * @notice An immutable graph of bilateral credit lines with multilateral netting
 *         and no central counterparty, collateral, or price oracle.
 *
 *         - Any two addresses open a mutual credit line in any ERC-20 unit of
 *           account, with credit limits, fee rate, and settlement grace period
 *           fixed at opening (propose → accept handshake).
 *         - `pay()` moves value as credit along a line: the payer's debt to the
 *           payee grows (or the payee's debt to the payer shrinks), bounded only
 *           by the limit the payee chose to extend.
 *         - `netCycle()` is permissionless multilateral netting: anyone may
 *           submit a cycle A→B→C→…→A of outstanding obligations and reduce every
 *           leg by the cycle's minimum, so only residual balances ever need
 *           settlement.
 *         - Settlement is by real token transfer (`settle`). A creditor may
 *           `demandSettlement`; once the line's grace period lapses unpaid, the
 *           line can be marked defaulted — the only enforcement is the on-chain
 *           default record, on which reputation/insurance layers can build.
 *
 *         No owner, no upgrade path, no governance, no external price feeds.
 */
contract SuwappuMutualCredit is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant WAD = 1e18;
    /// @dev Fee rates are capped at ~1000% APR-equivalent per second to keep accrual sane.
    uint256 private constant MAX_FEE_RATE = 317e9; // ~1000%/yr per-second WAD rate

    enum Status {
        None,
        Proposed,
        Active,
        Closed,
        Defaulted
    }

    struct Line {
        address a;            // lower address of the pair
        address b;            // higher address of the pair
        address token;        // unit of account
        uint256 limitA;       // max debt `a` accepts from `b` (credit a extends)
        uint256 limitB;       // max debt `b` accepts from `a` (credit b extends)
        int256 balance;       // > 0: b owes a; < 0: a owes b
        uint256 feeRate;      // per-second interest on outstanding balance, WAD
        uint64 grace;         // settlement grace period in seconds
        uint64 lastAccrual;
        uint64 demandTs;      // 0 = no outstanding settlement demand
        address demandBy;
        Status status;
        address proposer;
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
    error NotParty();
    error LimitExceeded();
    error NothingOwed();
    error GraceNotElapsed();
    error BadCycle();

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
        (address lo, address hi) = msg.sender < counterparty ? (msg.sender, counterparty) : (counterparty, msg.sender);
        lines[key] = Line({
            a: lo,
            b: hi,
            token: token,
            limitA: msg.sender == lo ? myLimit : 0,
            limitB: msg.sender == hi ? myLimit : 0,
            balance: 0,
            feeRate: feeRate,
            grace: grace,
            lastAccrual: uint64(block.timestamp),
            demandTs: 0,
            demandBy: address(0),
            status: Status.Proposed,
            proposer: msg.sender
        });
        emit LineProposed(key, msg.sender, counterparty, token, myLimit, feeRate, grace);
    }

    /// @notice Accept a proposed line, setting the credit you extend in return.
    function acceptLine(address proposer, address token, uint256 myLimit) external {
        bytes32 key = lineKey(msg.sender, proposer, token);
        Line storage l = lines[key];
        if (l.status != Status.Proposed || l.proposer != proposer || proposer == msg.sender) revert BadStatus();
        if (msg.sender != l.a && msg.sender != l.b) revert NotParty();
        if (msg.sender == l.a) l.limitA = myLimit;
        else l.limitB = myLimit;
        l.status = Status.Active;
        l.lastAccrual = uint64(block.timestamp);
        emit LineOpened(key, l.a, l.b, token);
    }

    // ---------------------------------------------------------------- credit

    /// @notice Pay `to` with mutual credit: increases msg.sender's debt on the
    ///         line (netting first against anything `to` already owed them).
    function pay(address to, address token, uint256 amount) external {
        bytes32 key = lineKey(msg.sender, to, token);
        Line storage l = lines[key];
        if (l.status != Status.Active) revert BadStatus();
        _accrue(l);
        // balance convention: > 0 means b owes a. Payer's debt grows.
        if (msg.sender == l.a) {
            int256 newBal = l.balance - int256(amount);
            if (newBal < 0 && uint256(-newBal) > l.limitB) revert LimitExceeded();
            l.balance = newBal;
        } else if (msg.sender == l.b) {
            int256 newBal = l.balance + int256(amount);
            if (newBal > 0 && uint256(newBal) > l.limitA) revert LimitExceeded();
            l.balance = newBal;
        } else {
            revert NotParty();
        }
        _clearDemandIfCovered(l);
        emit Payment(key, msg.sender, to, amount);
    }

    /// @notice Amount `debtor` currently owes `creditor` on their line (with accrual).
    function owedBy(address debtor, address creditor, address token) public view returns (uint256) {
        Line storage l = lines[lineKey(debtor, creditor, token)];
        if (l.status != Status.Active) return 0;
        int256 bal = _accruedBalance(l);
        if (debtor == l.b && bal > 0) return uint256(bal);
        if (debtor == l.a && bal < 0) return uint256(-bal);
        return 0;
    }

    // ---------------------------------------------------------------- netting

    /// @notice Permissionless multilateral netting: given a cycle of addresses
    ///         where each owes the next (and the last owes the first) in `token`,
    ///         reduce every obligation by the minimum owed along the cycle.
    function netCycle(address token, address[] calldata cycle) external {
        uint256 n = cycle.length;
        if (n < 3) revert BadCycle();
        uint256 minOwed = type(uint256).max;
        for (uint256 i = 0; i < n; i++) {
            uint256 owed = owedBy(cycle[i], cycle[(i + 1) % n], token);
            if (owed == 0) revert BadCycle();
            if (owed < minOwed) minOwed = owed;
        }
        for (uint256 i = 0; i < n; i++) {
            address debtor = cycle[i];
            address creditor = cycle[(i + 1) % n];
            Line storage l = lines[lineKey(debtor, creditor, token)];
            _accrue(l);
            if (debtor == l.b) l.balance -= int256(minOwed);
            else l.balance += int256(minOwed);
            _clearDemandIfCovered(l);
        }
        emit CycleNetted(token, cycle, minOwed);
    }

    // -------------------------------------------------------------- settlement

    /// @notice Settle outstanding debt with a real token transfer to the creditor.
    function settle(address creditor, address token, uint256 amount) external nonReentrant {
        bytes32 key = lineKey(msg.sender, creditor, token);
        Line storage l = lines[key];
        if (l.status != Status.Active) revert BadStatus();
        _accrue(l);
        uint256 owed = owedBy(msg.sender, creditor, token);
        if (owed == 0) revert NothingOwed();
        if (amount > owed) amount = owed;
        if (msg.sender == l.b) l.balance -= int256(amount);
        else l.balance += int256(amount);
        _clearDemandIfCovered(l);
        IERC20(token).safeTransferFrom(msg.sender, creditor, amount);
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
        if (msg.sender != l.a && msg.sender != l.b) revert NotParty();
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

    function _clearDemandIfCovered(Line storage l) internal {
        if (l.demandTs == 0) return;
        address demandant = l.demandBy;
        address debtor = demandant == l.a ? l.b : l.a;
        // Re-derive what the debtor still owes the demanding creditor.
        int256 bal = l.balance;
        bool stillOwed = (debtor == l.b && bal > 0) || (debtor == l.a && bal < 0);
        if (!stillOwed) {
            l.demandTs = 0;
            l.demandBy = address(0);
        }
    }
}
