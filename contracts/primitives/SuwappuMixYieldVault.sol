// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ISuwappuYieldStrategy} from "./interfaces/ISuwappuYieldStrategy.sol";

interface IMixAsset {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// @title SuwappuMixYieldVault
/// @notice ERC-4626-compatible portfolio share token with risk-capped strategy allocation.
/// @dev Design goals:
///      - diversified MYT-style strategy portfolio without trusting strategy NAV spikes;
///      - losses recognized immediately, upward NAV changes rate-limited;
///      - Conservative / Moderate / Aggressive exposure caps enforced on allocation;
///      - governance onboards strategies through a delay, allocator only moves funds;
///      - emergency kill halts new allocation but never blocks withdrawal/deallocation;
///      - no generic arbitrary-call or permissionless reward-swap surface.
contract SuwappuMixYieldVault {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant VIRTUAL = 1;
    uint256 public constant MODERATE_INDIVIDUAL_CAP_BPS = 2_500;
    uint256 public constant MODERATE_AGGREGATE_CAP_BPS = 4_000;
    uint256 public constant AGGRESSIVE_INDIVIDUAL_CAP_BPS = 1_000;
    uint256 public constant AGGRESSIVE_AGGREGATE_CAP_BPS = 1_000;

    enum RiskClass {
        Conservative,
        Moderate,
        Aggressive
    }

    struct StrategyConfig {
        bool enabled;
        bool killed;
        RiskClass riskClass;
        uint16 maxAllocationBps;
        uint64 lastSync;
        uint256 accountedAssets;
    }

    struct PendingStrategyConfig {
        bool exists;
        bool enabled;
        RiskClass riskClass;
        uint16 maxAllocationBps;
        uint64 eta;
    }

    string public name;
    string public symbol;
    uint8 public immutable decimals;
    IMixAsset public immutable underlying;
    address public owner;
    address public allocator;
    uint256 public immutable governanceDelay;
    uint256 public immutable maxGainBpsPerDay;
    bool public depositsPaused;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address[] public strategies;
    mapping(address => bool) public knownStrategy;
    mapping(address => StrategyConfig) public strategyConfig;
    mapping(address => PendingStrategyConfig) public pendingStrategyConfig;

    uint256 public idleAssets;
    uint256 public accountedStrategyAssets;
    address public pendingAllocator;
    uint64 public pendingAllocatorEta;

    uint256 private constant _LOCK_SLOT = 1;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(
        address indexed sender,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );
    event StrategyConfigSubmitted(
        address indexed strategy,
        bool enabled,
        RiskClass riskClass,
        uint256 maxAllocationBps,
        uint256 eta
    );
    event StrategyConfigured(
        address indexed strategy, bool enabled, RiskClass riskClass, uint256 maxAllocationBps
    );
    event StrategyKilled(address indexed strategy, bool killed);
    event StrategySynced(address indexed strategy, uint256 reported, uint256 accounted, int256 delta);
    event Allocated(address indexed strategy, uint256 assets);
    event Deallocated(address indexed strategy, uint256 requested, uint256 returnedAssets);
    event EmergencyExited(address indexed strategy, uint256 returnedAssets);
    event AllocatorSubmitted(address indexed allocator, uint256 eta);
    event AllocatorUpdated(address indexed allocator);
    event DepositsPaused(bool paused);

    error Unauthorized();
    error BadParams();
    error ZeroAmount();
    error TransferFailed();
    error NonStandardToken();
    error InsufficientLiquidity();
    error StrategyDisabled();
    error StrategyKilledError();
    error StrategyAssetMismatch();
    error StrategyVaultMismatch();
    error RiskCapExceeded();
    error TimelockPending();
    error TimelockNotReady();
    error SlippageExceeded();
    error DepositsArePaused();
    error AccountingMismatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyAllocator() {
        if (msg.sender != allocator) revert Unauthorized();
        _;
    }

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

    constructor(
        address asset_,
        string memory name_,
        string memory symbol_,
        address owner_,
        address allocator_,
        uint256 governanceDelay_,
        uint256 maxGainBpsPerDay_
    ) {
        if (asset_ == address(0) || owner_ == address(0) || allocator_ == address(0)) revert BadParams();
        if (governanceDelay_ < 1 hours || governanceDelay_ > 30 days) revert BadParams();
        if (maxGainBpsPerDay_ == 0 || maxGainBpsPerDay_ > 2_000) revert BadParams();
        uint8 d = IMixAsset(asset_).decimals();
        if (d > 18) revert BadParams();
        underlying = IMixAsset(asset_);
        decimals = d;
        name = name_;
        symbol = symbol_;
        owner = owner_;
        allocator = allocator_;
        governanceDelay = governanceDelay_;
        maxGainBpsPerDay = maxGainBpsPerDay_;
    }

    /*//////////////////////////////////////////////////////////////
                              ERC-20 SHARES
    //////////////////////////////////////////////////////////////*/

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert BadParams();
        uint256 bal = balanceOf[from];
        if (amount > bal) revert ZeroAmount();
        unchecked {
            balanceOf[from] = bal - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        if (to == address(0)) revert BadParams();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        uint256 bal = balanceOf[from];
        if (amount > bal) revert ZeroAmount();
        unchecked {
            balanceOf[from] = bal - amount;
            totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    function _spendAllowance(address from, address spender, uint256 amount) internal {
        if (from == spender) return;
        uint256 allowed = allowance[from][spender];
        if (allowed != type(uint256).max) {
            if (amount > allowed) revert Unauthorized();
            allowance[from][spender] = allowed - amount;
        }
    }

    /*//////////////////////////////////////////////////////////////
                              ERC-4626 SURFACE
    //////////////////////////////////////////////////////////////*/

    function asset() external view returns (address) {
        return address(underlying);
    }

    /// @notice Conservative accounting value used for share issuance/redemption.
    /// @dev This is deliberately NOT a raw sum of external strategy reports.
    function totalAssets() public view returns (uint256) {
        return idleAssets + accountedStrategyAssets;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return _mulDiv(assets, totalSupply + VIRTUAL, totalAssets() + VIRTUAL);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return _mulDiv(shares, totalAssets() + VIRTUAL, totalSupply + VIRTUAL);
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }

    function previewMint(uint256 shares) public view returns (uint256) {
        return _mulDivUp(shares, totalAssets() + VIRTUAL, totalSupply + VIRTUAL);
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return _mulDivUp(assets, totalSupply + VIRTUAL, totalAssets() + VIRTUAL);
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    function maxDeposit(address) external view returns (uint256) {
        return depositsPaused ? 0 : type(uint256).max;
    }

    function maxMint(address) external view returns (uint256) {
        return depositsPaused ? 0 : type(uint256).max;
    }

    /// @notice Immediately realizable vault liquidity, based on adapter-reported liquid assets.
    function liquidAssets() public view returns (uint256 liquid) {
        liquid = idleAssets;
        uint256 len = strategies.length;
        for (uint256 i; i < len; ++i) {
            StrategyConfig storage cfg = strategyConfig[strategies[i]];
            if (!cfg.enabled || cfg.accountedAssets == 0) continue;
            uint256 available = ISuwappuYieldStrategy(strategies[i]).liquidAssets();
            liquid += available < cfg.accountedAssets ? available : cfg.accountedAssets;
        }
    }

    function maxWithdraw(address account) public view returns (uint256) {
        uint256 claim = convertToAssets(balanceOf[account]);
        uint256 liquid = liquidAssets();
        return claim < liquid ? claim : liquid;
    }

    function maxRedeem(address account) public view returns (uint256) {
        uint256 liquid = liquidAssets();
        uint256 liquidShares = previewWithdraw(liquid);
        uint256 bal = balanceOf[account];
        return bal < liquidShares ? bal : liquidShares;
    }

    function deposit(uint256 assets, address receiver) external nonReentrant returns (uint256 shares) {
        if (depositsPaused) revert DepositsArePaused();
        if (assets == 0) revert ZeroAmount();
        _syncAll();
        uint256 preAssets = totalAssets();
        shares = _mulDiv(assets, totalSupply + VIRTUAL, preAssets + VIRTUAL);
        if (shares == 0) revert ZeroAmount();
        _pullExact(msg.sender, assets);
        idleAssets += assets;
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) external nonReentrant returns (uint256 assets) {
        if (depositsPaused) revert DepositsArePaused();
        if (shares == 0) revert ZeroAmount();
        _syncAll();
        assets = _mulDivUp(shares, totalAssets() + VIRTUAL, totalSupply + VIRTUAL);
        _pullExact(msg.sender, assets);
        idleAssets += assets;
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address account)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (assets == 0) revert ZeroAmount();
        _syncAll();
        shares = _mulDivUp(assets, totalSupply + VIRTUAL, totalAssets() + VIRTUAL);
        _spendAllowance(account, msg.sender, shares);
        if (assets > maxWithdraw(account)) revert InsufficientLiquidity();
        _burn(account, shares);
        _sourceLiquidity(assets);
        idleAssets -= assets;
        _safeTransfer(address(underlying), receiver, assets);
        emit Withdraw(msg.sender, receiver, account, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address account)
        external
        nonReentrant
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();
        _syncAll();
        _spendAllowance(account, msg.sender, shares);
        assets = _mulDiv(shares, totalAssets() + VIRTUAL, totalSupply + VIRTUAL);
        if (assets == 0 || assets > maxWithdraw(account)) revert InsufficientLiquidity();
        _burn(account, shares);
        _sourceLiquidity(assets);
        idleAssets -= assets;
        _safeTransfer(address(underlying), receiver, assets);
        emit Withdraw(msg.sender, receiver, account, assets, shares);
    }

    /*//////////////////////////////////////////////////////////////
                         GOVERNANCE + RISK CONFIG
    //////////////////////////////////////////////////////////////*/

    function submitStrategyConfig(
        address strategy,
        bool enabled,
        RiskClass riskClass,
        uint16 maxAllocationBps
    ) external onlyOwner {
        if (strategy == address(0)) revert BadParams();
        if (ISuwappuYieldStrategy(strategy).asset() != address(underlying)) revert StrategyAssetMismatch();
        if (ISuwappuYieldStrategy(strategy).vault() != address(this)) revert StrategyVaultMismatch();
        _validateTierCap(riskClass, maxAllocationBps);
        uint64 eta = uint64(block.timestamp + governanceDelay);
        pendingStrategyConfig[strategy] = PendingStrategyConfig({
            exists: true,
            enabled: enabled,
            riskClass: riskClass,
            maxAllocationBps: maxAllocationBps,
            eta: eta
        });
        emit StrategyConfigSubmitted(strategy, enabled, riskClass, maxAllocationBps, eta);
    }

    function executeStrategyConfig(address strategy) external {
        PendingStrategyConfig memory p = pendingStrategyConfig[strategy];
        if (!p.exists) revert TimelockPending();
        if (block.timestamp < p.eta) revert TimelockNotReady();
        StrategyConfig storage cfg = strategyConfig[strategy];
        if (!knownStrategy[strategy]) {
            knownStrategy[strategy] = true;
            strategies.push(strategy);
            cfg.lastSync = uint64(block.timestamp);
        } else {
            _syncStrategy(strategy);
        }
        cfg.enabled = p.enabled;
        cfg.riskClass = p.riskClass;
        cfg.maxAllocationBps = p.maxAllocationBps;
        if (p.enabled) cfg.killed = false;
        delete pendingStrategyConfig[strategy];
        if (p.enabled) _checkRiskCaps();
        emit StrategyConfigured(strategy, p.enabled, p.riskClass, p.maxAllocationBps);
    }

    /// @notice Emergency action is immediate in the safe direction: stop allocations.
    function killStrategy(address strategy) external onlyOwner {
        if (!knownStrategy[strategy]) revert StrategyDisabled();
        strategyConfig[strategy].killed = true;
        emit StrategyKilled(strategy, true);
    }

    function pauseDeposits(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit DepositsPaused(paused);
    }

    function submitAllocator(address newAllocator) external onlyOwner {
        if (newAllocator == address(0)) revert BadParams();
        pendingAllocator = newAllocator;
        pendingAllocatorEta = uint64(block.timestamp + governanceDelay);
        emit AllocatorSubmitted(newAllocator, pendingAllocatorEta);
    }

    function executeAllocator() external {
        if (pendingAllocator == address(0)) revert TimelockPending();
        if (block.timestamp < pendingAllocatorEta) revert TimelockNotReady();
        allocator = pendingAllocator;
        pendingAllocator = address(0);
        pendingAllocatorEta = 0;
        emit AllocatorUpdated(allocator);
    }

    /*//////////////////////////////////////////////////////////////
                              ALLOCATION
    //////////////////////////////////////////////////////////////*/

    function allocate(address strategy, uint256 assets, bytes calldata data)
        external
        onlyAllocator
        nonReentrant
        returns (uint256 deployed)
    {
        if (assets == 0 || assets > idleAssets) revert ZeroAmount();
        StrategyConfig storage cfg = strategyConfig[strategy];
        if (!cfg.enabled) revert StrategyDisabled();
        if (cfg.killed) revert StrategyKilledError();
        _syncAll();
        idleAssets -= assets;
        cfg.accountedAssets += assets;
        accountedStrategyAssets += assets;
        cfg.lastSync = uint64(block.timestamp);
        _safeTransfer(address(underlying), strategy, assets);
        deployed = ISuwappuYieldStrategy(strategy).deposit(assets, data);
        if (deployed > assets) revert AccountingMismatch();
        _syncStrategy(strategy);
        _checkRiskCaps();
        emit Allocated(strategy, assets);
    }

    function deallocate(address strategy, uint256 assets, uint256 minAssetsOut, bytes calldata data)
        external
        onlyAllocator
        nonReentrant
        returns (uint256 assetsOut)
    {
        StrategyConfig storage cfg = strategyConfig[strategy];
        if (!cfg.enabled) revert StrategyDisabled();
        if (assets == 0 || assets > cfg.accountedAssets) revert ZeroAmount();
        _syncStrategy(strategy);
        assetsOut = _withdrawFromStrategy(strategy, assets, minAssetsOut, data);
        emit Deallocated(strategy, assets, assetsOut);
    }

    function emergencyExit(address strategy, uint256 minAssetsOut, bytes calldata data)
        external
        onlyOwner
        nonReentrant
        returns (uint256 assetsOut)
    {
        StrategyConfig storage cfg = strategyConfig[strategy];
        if (!cfg.enabled || !cfg.killed) revert StrategyKilledError();
        uint256 beforeBal = underlying.balanceOf(address(this));
        ISuwappuYieldStrategy(strategy).emergencyExit(minAssetsOut, data);
        assetsOut = underlying.balanceOf(address(this)) - beforeBal;
        if (assetsOut < minAssetsOut) revert SlippageExceeded();
        idleAssets += assetsOut;
        uint256 old = cfg.accountedAssets;
        if (old > accountedStrategyAssets) revert AccountingMismatch();
        accountedStrategyAssets -= old;
        cfg.accountedAssets = 0;
        cfg.lastSync = uint64(block.timestamp);
        emit EmergencyExited(strategy, assetsOut);
    }

    /*//////////////////////////////////////////////////////////////
                           CONSERVATIVE NAV SYNC
    //////////////////////////////////////////////////////////////*/

    function syncStrategy(address strategy) external nonReentrant returns (uint256 accounted) {
        if (!knownStrategy[strategy]) revert StrategyDisabled();
        accounted = _syncStrategy(strategy);
    }

    function syncAll() external nonReentrant {
        _syncAll();
    }

    function _syncAll() internal {
        uint256 len = strategies.length;
        for (uint256 i; i < len; ++i) {
            if (strategyConfig[strategies[i]].enabled) _syncStrategy(strategies[i]);
        }
    }

    /// @dev Strategy losses hit NAV immediately. Gains are admitted only at the immutable
    ///      maxGainBpsPerDay rate, preventing one-block share-price inflation from a bad oracle.
    function _syncStrategy(address strategy) internal returns (uint256 accounted) {
        StrategyConfig storage cfg = strategyConfig[strategy];
        uint256 old = cfg.accountedAssets;
        uint256 reported = ISuwappuYieldStrategy(strategy).totalAssets();
        uint256 next;
        if (reported <= old) {
            next = reported;
        } else if (old == 0) {
            next = 0;
        } else {
            uint256 elapsed = block.timestamp - uint256(cfg.lastSync);
            uint256 maxGain = _mulDiv(old, maxGainBpsPerDay * elapsed, BPS * 1 days);
            uint256 upper = old + maxGain;
            next = reported < upper ? reported : upper;
        }
        if (next != old) {
            if (next > old) accountedStrategyAssets += next - old;
            else accountedStrategyAssets -= old - next;
            cfg.accountedAssets = next;
        }
        cfg.lastSync = uint64(block.timestamp);
        int256 delta = next >= old ? int256(next - old) : -int256(old - next);
        emit StrategySynced(strategy, reported, next, delta);
        return next;
    }

    /*//////////////////////////////////////////////////////////////
                               RISK VIEWS
    //////////////////////////////////////////////////////////////*/

    function strategyCount() external view returns (uint256) {
        return strategies.length;
    }

    function strategyAllocationBps(address strategy) public view returns (uint256) {
        uint256 total = totalAssets();
        if (total == 0) return 0;
        return _mulDiv(strategyConfig[strategy].accountedAssets, BPS, total);
    }

    function tierAllocationBps(RiskClass riskClass) public view returns (uint256 bps) {
        uint256 total = totalAssets();
        if (total == 0) return 0;
        uint256 tier;
        uint256 len = strategies.length;
        for (uint256 i; i < len; ++i) {
            StrategyConfig storage cfg = strategyConfig[strategies[i]];
            if (cfg.enabled && cfg.riskClass == riskClass) tier += cfg.accountedAssets;
        }
        bps = _mulDiv(tier, BPS, total);
    }

    function riskCapsHealthy() public view returns (bool) {
        uint256 total = totalAssets();
        if (total == 0) return true;
        uint256 moderate;
        uint256 aggressive;
        uint256 len = strategies.length;
        for (uint256 i; i < len; ++i) {
            StrategyConfig storage cfg = strategyConfig[strategies[i]];
            if (!cfg.enabled || cfg.accountedAssets == 0) continue;
            uint256 bps = _mulDiv(cfg.accountedAssets, BPS, total);
            if (bps > cfg.maxAllocationBps) return false;
            if (cfg.riskClass == RiskClass.Moderate) {
                if (bps > MODERATE_INDIVIDUAL_CAP_BPS) return false;
                moderate += cfg.accountedAssets;
            } else if (cfg.riskClass == RiskClass.Aggressive) {
                if (bps > AGGRESSIVE_INDIVIDUAL_CAP_BPS) return false;
                aggressive += cfg.accountedAssets;
            }
        }
        if (_mulDiv(moderate, BPS, total) > MODERATE_AGGREGATE_CAP_BPS) return false;
        if (_mulDiv(aggressive, BPS, total) > AGGRESSIVE_AGGREGATE_CAP_BPS) return false;
        return true;
    }

    function _checkRiskCaps() internal view {
        if (!riskCapsHealthy()) revert RiskCapExceeded();
    }

    function _validateTierCap(RiskClass riskClass, uint256 maxBps) internal pure {
        if (maxBps == 0 || maxBps > BPS) revert BadParams();
        if (riskClass == RiskClass.Moderate && maxBps > MODERATE_INDIVIDUAL_CAP_BPS) revert BadParams();
        if (riskClass == RiskClass.Aggressive && maxBps > AGGRESSIVE_INDIVIDUAL_CAP_BPS) revert BadParams();
    }

    /*//////////////////////////////////////////////////////////////
                              INTERNAL LIQUIDITY
    //////////////////////////////////////////////////////////////*/

    function _sourceLiquidity(uint256 assets) internal {
        if (idleAssets >= assets) return;
        uint256 need = assets - idleAssets;
        uint256 len = strategies.length;
        for (uint256 i; i < len && need > 0; ++i) {
            address strategy = strategies[i];
            StrategyConfig storage cfg = strategyConfig[strategy];
            if (!cfg.enabled || cfg.accountedAssets == 0) continue;
            uint256 available = ISuwappuYieldStrategy(strategy).liquidAssets();
            uint256 ask = available < need ? available : need;
            if (ask > cfg.accountedAssets) ask = cfg.accountedAssets;
            if (ask == 0) continue;
            uint256 out = _withdrawFromStrategy(strategy, ask, 0, "");
            if (out >= need) need = 0;
            else need -= out;
        }
        if (idleAssets < assets) revert InsufficientLiquidity();
    }

    function _withdrawFromStrategy(address strategy, uint256 assets, uint256 minAssetsOut, bytes memory data)
        internal
        returns (uint256 assetsOut)
    {
        StrategyConfig storage cfg = strategyConfig[strategy];
        uint256 beforeBal = underlying.balanceOf(address(this));
        ISuwappuYieldStrategy(strategy).withdraw(assets, minAssetsOut, data);
        assetsOut = underlying.balanceOf(address(this)) - beforeBal;
        if (assetsOut < minAssetsOut) revert SlippageExceeded();
        idleAssets += assetsOut;

        uint256 reduction = assetsOut < cfg.accountedAssets ? assetsOut : cfg.accountedAssets;
        cfg.accountedAssets -= reduction;
        accountedStrategyAssets -= reduction;
        cfg.lastSync = uint64(block.timestamp);
        _syncStrategy(strategy);
        return assetsOut;
    }

    /*//////////////////////////////////////////////////////////////
                                TOKEN SAFETY
    //////////////////////////////////////////////////////////////*/

    function _pullExact(address from, uint256 amount) internal {
        uint256 beforeBal = underlying.balanceOf(address(this));
        _safeCall(
            address(underlying),
            abi.encodeWithSelector(IMixAsset.transferFrom.selector, from, address(this), amount)
        );
        if (underlying.balanceOf(address(this)) - beforeBal != amount) revert NonStandardToken();
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        _safeCall(token, abi.encodeWithSelector(IMixAsset.transfer.selector, to, amount));
    }

    function _safeCall(address token, bytes memory payload) internal {
        (bool ok, bytes memory ret) = token.call(payload);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function _mulDiv(uint256 x, uint256 y, uint256 d) internal pure returns (uint256) {
        if (d == 0) revert BadParams();
        return x * y / d;
    }

    function _mulDivUp(uint256 x, uint256 y, uint256 d) internal pure returns (uint256) {
        if (d == 0) revert BadParams();
        uint256 z = x * y;
        return z == 0 ? 0 : (z - 1) / d + 1;
    }
}
