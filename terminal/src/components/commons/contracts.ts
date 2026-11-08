import { formatUnits, parseAbi, parseUnits, type Address } from 'viem'
import { baseSepolia } from 'wagmi/chains'

/**
 * The Suwappu Commons: three immutable, ownerless, dependency-free primitives
 * (contracts/primitives/*). No admin key, no upgrade path, no fee switch — once
 * deployed they belong to nobody. This module mirrors
 * packages/primitives-client (ABIs + the Base Sepolia deployment) so the
 * terminal bundle doesn't reach outside its Vite root.
 */

export const COMMONS_CHAIN = baseSepolia
export const EXPLORER = 'https://sepolia.basescan.org'

export const COMMONS = {
  timeCurve: '0x13189B1fae4f7CBCfF12bb57fBB6fEF83abe1B5C',
  amortizingVault: '0x07Bc798F3f6D9a5C672C209CaBe69289AF19d8DA',
  mutualCredit: '0x3938B15649129B21f53dB20D58F9084366a5570b',
  /** Test MockUSD (mUSD, 18 dp) — public mint, so it doubles as a faucet. */
  reserveAsset: '0x75b2D073101f79f4A2289EF8312D5c7eD2524BD8',
  /** MockYieldVault (ymUSD) — plain ERC-4626 over mUSD, the vault's collateral. */
  collateralVault: '0xF459a90B2aEA6a8Dc8e98a2fd9c41CD7Fef678b4',
} as const satisfies Record<string, Address>

/** Custom errors shared by the primitives — in the ABI so viem decodes revert names. */
const ERRORS = [
  'error BadCycle()',
  'error BadParams()',
  'error BadStatus()',
  'error DeadlinePassed()',
  'error GraceNotElapsed()',
  'error InsufficientCash()',
  'error InsufficientReserve()',
  'error LimitExceeded()',
  'error LtvExceeded()',
  'error NonStandardToken()',
  'error NothingOwed()',
  'error NotLiquidatable()',
  'error NotOwner()',
  'error SlippageExceeded()',
  'error TransferFailed()',
  'error ZeroAmount()',
  'error ZeroShares()',
] as const

export const timeCurveAbi = parseAbi([
  ...ERRORS,
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function deployTime() view returns (uint256)',
  'function basePrice() view returns (uint256)',
  'function slope() view returns (uint256)',
  'function rate() view returns (int256)',
  'function sinkRate() view returns (uint256)',
  'function totalSunk() view returns (uint256)',
  'function reserveBalance() view returns (uint256)',
  'function spotPrice() view returns (uint256)',
  'function multiplier() view returns (uint256)',
  'function quoteBuy(uint256 tokenAmount) view returns (uint256)',
  'function quoteSell(uint256 tokenAmount) view returns (uint256)',
  'function buy(uint256 tokenAmount, uint256 maxReserveIn, uint256 deadline) returns (uint256 reserveIn)',
  'function sell(uint256 tokenAmount, uint256 minReserveOut, uint256 deadline) returns (uint256 reserveOut)',
])

export const amortizingVaultAbi = parseAbi([
  ...ERRORS,
  'function borrowRate() view returns (uint256)',
  'function maxLtv() view returns (uint256)',
  'function liqLtv() view returns (uint256)',
  'function liqBonus() view returns (uint256)',
  'function totalLendShares() view returns (uint256)',
  'function lendShares(address) view returns (uint256)',
  'function cash() view returns (uint256)',
  'function poolAssets() view returns (uint256)',
  'function totalDebtAssets() view returns (uint256)',
  'function nextPositionId() view returns (uint256)',
  'function positions(uint256) view returns (address owner, uint256 shares, uint256 baselineAssets, uint256 debtScaled)',
  'function debtOf(uint256 id) view returns (uint256)',
  'function pendingYield(uint256 id) view returns (uint256)',
  'function supply(uint256 assets) returns (uint256 shares)',
  'function withdraw(uint256 shares) returns (uint256 assets)',
  'function openPosition(uint256 shares, uint256 borrowAssets, uint256 deadline) returns (uint256 id)',
  'function addCollateral(uint256 id, uint256 shares)',
  'function amortize(uint256 id) returns (uint256 applied)',
  'function repay(uint256 id, uint256 assets)',
  'function withdrawCollateral(uint256 id, uint256 shares, uint256 deadline)',
  'function liquidate(uint256 id, uint256 repayAssets, uint256 deadline)',
])

export const mutualCreditAbi = parseAbi([
  ...ERRORS,
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
])

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
])

export const erc4626Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)',
])

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
}

// ---------------------------------------------------------------- numbers

export const WAD = 10n ** 18n
const SECONDS_PER_YEAR = 31_536_000

/** All Commons amounts on this deployment are 18-dp (mUSD, ymUSD, curve token). */
export function fmt(value: bigint | undefined, digits = 4): string {
  if (value === undefined) return '—'
  const n = Number(formatUnits(value, 18))
  if (n !== 0 && Math.abs(n) < 10 ** -digits) return `<${10 ** -digits}`
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

export function toNum(value: bigint | undefined): number {
  return value === undefined ? 0 : Number(formatUnits(value, 18))
}

/** Parse user input to 18-dp units; undefined on empty / invalid / zero. */
export function parseAmount(input: string): bigint | undefined {
  const s = input.trim()
  if (!s || !/^\d*\.?\d*$/.test(s)) return undefined
  try {
    const v = parseUnits(s, 18)
    return v > 0n ? v : undefined
  } catch {
    return undefined
  }
}

export function pct(wad: bigint | undefined, digits = 2): string {
  if (wad === undefined) return '—'
  return `${(Number(formatUnits(wad, 18)) * 100).toFixed(digits)}%`
}

/** Per-second WAD simple rate → APR string. */
export function aprFromPerSecond(perSecondWad: bigint | undefined): string {
  if (perSecondWad === undefined) return '—'
  return `${(Number(formatUnits(perSecondWad, 18)) * SECONDS_PER_YEAR * 100).toFixed(2)}%`
}

/** APR percent (e.g. "5") → per-second WAD rate, rounded down. */
export function perSecondFromApr(aprPercent: number): bigint {
  if (!Number.isFinite(aprPercent) || aprPercent <= 0) return 0n
  return BigInt(Math.floor(((aprPercent / 100) / SECONDS_PER_YEAR) * 1e18))
}

export function short(addr: string | undefined): string {
  if (!addr) return '—'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function addressUrl(addr: string): string {
  return `${EXPLORER}/address/${addr}`
}

export function txUrl(hash: string): string {
  return `${EXPLORER}/tx/${hash}`
}

export function isAddress(s: string): s is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(s.trim())
}

/** Deadline for MEV-guarded entrypoints: now + 10 minutes. */
export function deadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 600)
}

/** Apply slippage in basis points: up=true for max-in, false for min-out. */
export function withSlippage(value: bigint, bps: number, up: boolean): bigint {
  const b = BigInt(Math.round(bps))
  return up ? (value * (10_000n + b)) / 10_000n : (value * (10_000n - b)) / 10_000n
}
