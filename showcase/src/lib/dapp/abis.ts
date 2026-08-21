import { parseAbi } from 'viem';

/**
 * ABIs include the contracts' custom `error` definitions — that's what lets viem
 * decode a revert into `SlippageExceeded` / `LtvExceeded` / … instead of raw hex.
 */

export const curveAbi = parseAbi([
  // ERC-20 (the curve *is* its own token)
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  // immutable params
  'function reserve() view returns (address)',
  'function basePrice() view returns (uint256)',
  'function slope() view returns (uint256)',
  'function rate() view returns (int256)',
  'function sinkRate() view returns (uint256)',
  'function deployTime() view returns (uint256)',
  // live state
  'function totalSunk() view returns (uint256)',
  'function reserveBalance() view returns (uint256)',
  'function spotPrice() view returns (uint256)',
  'function multiplier() view returns (uint256)',
  'function quoteBuy(uint256 tokenAmount) view returns (uint256)',
  'function quoteSell(uint256 tokenAmount) view returns (uint256)',
  // writes
  'function buy(uint256 tokenAmount, uint256 maxReserveIn, uint256 deadline) returns (uint256 reserveIn)',
  'function sell(uint256 tokenAmount, uint256 minReserveOut, uint256 deadline) returns (uint256 reserveOut)',
  // events
  'event CurveBuy(address indexed buyer, uint256 tokensOut, uint256 reserveIn)',
  'event CurveSell(address indexed seller, uint256 tokensIn, uint256 reserveOut, uint256 sunk)',
  // custom errors
  'error ZeroAmount()',
  'error SlippageExceeded()',
  'error InsufficientReserve()',
  'error BadParams()',
  'error TransferFailed()',
  'error DeadlinePassed()',
  'error NonStandardToken()',
]);

export const vaultAbi = parseAbi([
  'function asset() view returns (address)',
  'function collateralVault() view returns (address)',
  'function borrowRate() view returns (uint256)',
  'function maxLtv() view returns (uint256)',
  'function liqLtv() view returns (uint256)',
  'function liqBonus() view returns (uint256)',
  'function startTime() view returns (uint256)',
  'function cash() view returns (uint256)',
  'function poolAssets() view returns (uint256)',
  'function totalDebtAssets() view returns (uint256)',
  'function totalLendShares() view returns (uint256)',
  'function lendShares(address) view returns (uint256)',
  'function nextPositionId() view returns (uint256)',
  'function positions(uint256) view returns (address owner, uint256 shares, uint256 baselineAssets, uint256 debtScaled)',
  'function debtOf(uint256 id) view returns (uint256)',
  'function pendingYield(uint256 id) view returns (uint256)',
  // lender
  'function supply(uint256 assets) returns (uint256 shares)',
  'function withdraw(uint256 shares) returns (uint256 assets)',
  // borrower
  'function openPosition(uint256 shares, uint256 borrowAssets, uint256 deadline) returns (uint256 id)',
  'function addCollateral(uint256 id, uint256 shares)',
  'function repay(uint256 id, uint256 assets)',
  'function withdrawCollateral(uint256 id, uint256 shares, uint256 deadline)',
  // keeper
  'function amortize(uint256 id) returns (uint256 applied)',
  'function liquidate(uint256 id, uint256 repayAssets, uint256 deadline)',
  // events
  'event Amortized(uint256 indexed id, uint256 yieldApplied, uint256 remainingDebt)',
  'event BadDebtWrittenOff(uint256 indexed id, uint256 assets)',
  // custom errors
  'error BadParams()',
  'error NotOwner()',
  'error ZeroAmount()',
  'error ZeroShares()',
  'error LtvExceeded()',
  'error InsufficientCash()',
  'error NotLiquidatable()',
  'error TransferFailed()',
  'error DeadlinePassed()',
  'error NonStandardToken()',
]);

export const creditAbi = parseAbi([
  'function lineKey(address x, address y, address token) view returns (bytes32)',
  'function lines(bytes32) view returns (uint256 limitA, uint256 limitB, int256 balance, uint256 feeRate, uint64 grace, uint64 lastAccrual, uint64 demandTs, uint8 status, address demandBy, address proposer)',
  'function defaults(address) view returns (uint256)',
  'function owedBy(address debtor, address creditor, address token) view returns (uint256)',
  'function proposeLine(address counterparty, address token, uint256 myLimit, uint256 feeRate, uint64 grace) returns (bytes32 key)',
  'function acceptLine(address proposer, address token, uint256 myLimit)',
  'function cancelProposal(address counterparty, address token)',
  'function rejectProposal(address proposer, address token)',
  'function pay(address to, address token, uint256 amount)',
  'function netCycle(address token, address[] cycle)',
  'function settle(address creditor, address token, uint256 amount)',
  'function demandSettlement(address debtor, address token)',
  'function markDefault(address debtor, address token)',
  'function closeLine(address counterparty, address token)',
  // custom errors
  'error BadParams()',
  'error BadStatus()',
  'error LimitExceeded()',
  'error NothingOwed()',
  'error GraceNotElapsed()',
  'error BadCycle()',
  'error TransferFailed()',
]);

export const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
]);

export const erc4626Abi = parseAbi([
  'function asset() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function convertToShares(uint256 assets) view returns (uint256)',
  'function maxWithdraw(address owner) view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256)',
]);

/** SuwappuMutualCredit.Status */
export enum LineStatus {
  None = 0,
  Proposed = 1,
  Active = 2,
  Closed = 3,
  Defaulted = 4,
}

export const LINE_STATUS_LABEL: Record<number, string> = {
  0: 'No line',
  1: 'Proposed',
  2: 'Active',
  3: 'Closed',
  4: 'Defaulted',
};
