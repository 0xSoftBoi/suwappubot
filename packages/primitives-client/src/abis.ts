import { parseAbi } from "viem";

/** SuwappuTimeCurve — the contract is itself the curve ERC-20. */
export const timeCurveAbi = parseAbi([
  // ERC-20 surface
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  // immutable params
  "function reserve() view returns (address)",
  "function reserveScale() view returns (uint256)",
  "function deployTime() view returns (uint256)",
  "function basePrice() view returns (uint256)",
  "function slope() view returns (uint256)",
  "function rate() view returns (int256)",
  "function sinkRate() view returns (uint256)",
  // state + quotes
  "function totalSunk() view returns (uint256)",
  "function reserveBalance() view returns (uint256)",
  "function spotPrice() view returns (uint256)",
  "function multiplier() view returns (uint256)",
  "function quoteBuy(uint256 tokenAmount) view returns (uint256)",
  "function quoteSell(uint256 tokenAmount) view returns (uint256)",
  // trading
  "function buy(uint256 tokenAmount, uint256 maxReserveIn, uint256 deadline) returns (uint256 reserveIn)",
  "function sell(uint256 tokenAmount, uint256 minReserveOut, uint256 deadline) returns (uint256 reserveOut)",
  "event CurveBuy(address indexed buyer, uint256 tokensOut, uint256 reserveIn)",
  "event CurveSell(address indexed seller, uint256 tokensIn, uint256 reserveOut, uint256 sunk)",
]);

/** SuwappuAmortizingVault. */
export const amortizingVaultAbi = parseAbi([
  // immutable params
  "function collateralVault() view returns (address)",
  "function asset() view returns (address)",
  "function borrowRate() view returns (uint256)",
  "function maxLtv() view returns (uint256)",
  "function liqLtv() view returns (uint256)",
  "function liqBonus() view returns (uint256)",
  "function startTime() view returns (uint256)",
  // pool accounting
  "function totalLendShares() view returns (uint256)",
  "function lendShares(address) view returns (uint256)",
  "function totalDebtScaled() view returns (uint256)",
  "function totalCash() view returns (uint256)",
  "function cash() view returns (uint256)",
  "function poolAssets() view returns (uint256)",
  "function totalDebtAssets() view returns (uint256)",
  // positions
  "function nextPositionId() view returns (uint256)",
  "function positions(uint256) view returns (address owner, uint256 shares, uint256 baselineAssets, uint256 debtScaled)",
  "function debtOf(uint256 id) view returns (uint256)",
  "function pendingYield(uint256 id) view returns (uint256)",
  // lender ops
  "function supply(uint256 assets) returns (uint256 shares)",
  "function withdraw(uint256 shares) returns (uint256 assets)",
  // position ops
  "function openPosition(uint256 shares, uint256 borrowAssets, uint256 deadline) returns (uint256 id)",
  "function addCollateral(uint256 id, uint256 shares)",
  "function amortize(uint256 id) returns (uint256 applied)",
  "function repay(uint256 id, uint256 assets)",
  "function withdrawCollateral(uint256 id, uint256 shares, uint256 deadline)",
  "function liquidate(uint256 id, uint256 repayAssets, uint256 deadline)",
]);

/** SuwappuMutualCredit. */
export const mutualCreditAbi = parseAbi([
  "function lineKey(address x, address y, address token) view returns (bytes32)",
  "function lines(bytes32) view returns (uint256 limitA, uint256 limitB, int256 balance, uint256 feeRate, uint64 grace, uint64 lastAccrual, uint64 demandTs, uint8 status, address demandBy, address proposer)",
  "function defaults(address) view returns (uint256)",
  "function owedBy(address debtor, address creditor, address token) view returns (uint256)",
  "function proposeLine(address counterparty, address token, uint256 myLimit, uint256 feeRate, uint64 grace) returns (bytes32 key)",
  "function acceptLine(address proposer, address token, uint256 myLimit)",
  "function cancelProposal(address counterparty, address token)",
  "function rejectProposal(address proposer, address token)",
  "function pay(address to, address token, uint256 amount)",
  "function netCycle(address token, address[] cycle)",
  "function settle(address creditor, address token, uint256 amount)",
  "function demandSettlement(address debtor, address token)",
  "function markDefault(address debtor, address token)",
  "function closeLine(address counterparty, address token)",
]);

/** Minimal ERC-20 for reserve/asset approvals + reads. */
export const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/** Line status enum, matching SuwappuMutualCredit.Status. */
export enum LineStatus {
  None = 0,
  Proposed = 1,
  Active = 2,
  Closed = 3,
  Defaulted = 4,
}
