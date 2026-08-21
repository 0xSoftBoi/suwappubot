import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  encodePacked,
  keccak256,
  maxUint256,
} from "viem";
import { amortizingVaultAbi, erc20Abi, mutualCreditAbi, timeCurveAbi } from "./abis.js";
import type { PrimitivesDeployment } from "./addresses.js";

export interface SuwappuClientOptions {
  publicClient: PublicClient<Transport, Chain | undefined>;
  /** Required only for state-changing calls. */
  walletClient?: WalletClient<Transport, Chain | undefined, Account>;
  addresses: PrimitivesDeployment;
}

/**
 * Compute a mutual-credit line key off-chain — mirrors SuwappuMutualCredit.lineKey
 * (sorted lower/higher address, then keccak256(abi.encodePacked(lo, hi, token))).
 */
export function computeLineKey(x: Address, y: Address, token: Address): Hex {
  const [lo, hi] = BigInt(x) < BigInt(y) ? [x, y] : [y, x];
  return keccak256(encodePacked(["address", "address", "address"], [lo, hi, token]));
}

export type CurvePosition = {
  owner: Address;
  shares: bigint;
  baselineAssets: bigint;
  debtScaled: bigint;
};

export function createSuwappuClient(opts: SuwappuClientOptions) {
  const { publicClient, walletClient, addresses } = opts;

  function account(): Account {
    const a = walletClient?.account;
    if (!a) throw new Error("createSuwappuClient: walletClient with an account is required for writes");
    return a;
  }

  // Generic helpers ---------------------------------------------------------
  const read = <T>(address: Address, abi: unknown, functionName: string, args: unknown[] = []) =>
    publicClient.readContract({ address, abi: abi as never, functionName, args } as never) as Promise<T>;

  const write = (address: Address, abi: unknown, functionName: string, args: unknown[] = []) =>
    walletClient!.writeContract({
      address,
      abi: abi as never,
      functionName,
      args,
      account: account(),
      chain: walletClient!.chain,
    } as never);

  const noDeadline = maxUint256;

  // TimeCurve ---------------------------------------------------------------
  const curveAddr = addresses.timeCurve;
  const curve = {
    address: curveAddr,
    name: () => read<string>(curveAddr, timeCurveAbi, "name"),
    symbol: () => read<string>(curveAddr, timeCurveAbi, "symbol"),
    decimals: () => read<number>(curveAddr, timeCurveAbi, "decimals"),
    totalSupply: () => read<bigint>(curveAddr, timeCurveAbi, "totalSupply"),
    balanceOf: (a: Address) => read<bigint>(curveAddr, timeCurveAbi, "balanceOf", [a]),
    reserve: () => read<Address>(curveAddr, timeCurveAbi, "reserve"),
    basePrice: () => read<bigint>(curveAddr, timeCurveAbi, "basePrice"),
    slope: () => read<bigint>(curveAddr, timeCurveAbi, "slope"),
    rate: () => read<bigint>(curveAddr, timeCurveAbi, "rate"),
    sinkRate: () => read<bigint>(curveAddr, timeCurveAbi, "sinkRate"),
    totalSunk: () => read<bigint>(curveAddr, timeCurveAbi, "totalSunk"),
    reserveBalance: () => read<bigint>(curveAddr, timeCurveAbi, "reserveBalance"),
    spotPrice: () => read<bigint>(curveAddr, timeCurveAbi, "spotPrice"),
    multiplier: () => read<bigint>(curveAddr, timeCurveAbi, "multiplier"),
    quoteBuy: (tokenAmount: bigint) => read<bigint>(curveAddr, timeCurveAbi, "quoteBuy", [tokenAmount]),
    quoteSell: (tokenAmount: bigint) => read<bigint>(curveAddr, timeCurveAbi, "quoteSell", [tokenAmount]),
    // writes
    buy: (tokenAmount: bigint, maxReserveIn: bigint, deadline: bigint = noDeadline) =>
      write(curveAddr, timeCurveAbi, "buy", [tokenAmount, maxReserveIn, deadline]),
    sell: (tokenAmount: bigint, minReserveOut: bigint, deadline: bigint = noDeadline) =>
      write(curveAddr, timeCurveAbi, "sell", [tokenAmount, minReserveOut, deadline]),
  };

  // AmortizingVault ---------------------------------------------------------
  const vaultAddr = addresses.amortizingVault;
  const vault = {
    address: vaultAddr,
    asset: () => read<Address>(vaultAddr, amortizingVaultAbi, "asset"),
    collateralVault: () => read<Address>(vaultAddr, amortizingVaultAbi, "collateralVault"),
    borrowRate: () => read<bigint>(vaultAddr, amortizingVaultAbi, "borrowRate"),
    maxLtv: () => read<bigint>(vaultAddr, amortizingVaultAbi, "maxLtv"),
    liqLtv: () => read<bigint>(vaultAddr, amortizingVaultAbi, "liqLtv"),
    liqBonus: () => read<bigint>(vaultAddr, amortizingVaultAbi, "liqBonus"),
    cash: () => read<bigint>(vaultAddr, amortizingVaultAbi, "cash"),
    poolAssets: () => read<bigint>(vaultAddr, amortizingVaultAbi, "poolAssets"),
    totalDebtAssets: () => read<bigint>(vaultAddr, amortizingVaultAbi, "totalDebtAssets"),
    lendShares: (a: Address) => read<bigint>(vaultAddr, amortizingVaultAbi, "lendShares", [a]),
    nextPositionId: () => read<bigint>(vaultAddr, amortizingVaultAbi, "nextPositionId"),
    debtOf: (id: bigint) => read<bigint>(vaultAddr, amortizingVaultAbi, "debtOf", [id]),
    pendingYield: (id: bigint) => read<bigint>(vaultAddr, amortizingVaultAbi, "pendingYield", [id]),
    position: async (id: bigint): Promise<CurvePosition> => {
      const [owner, shares, baselineAssets, debtScaled] = await read<
        [Address, bigint, bigint, bigint]
      >(vaultAddr, amortizingVaultAbi, "positions", [id]);
      return { owner, shares, baselineAssets, debtScaled };
    },
    // writes
    supply: (assets: bigint) => write(vaultAddr, amortizingVaultAbi, "supply", [assets]),
    withdraw: (shares: bigint) => write(vaultAddr, amortizingVaultAbi, "withdraw", [shares]),
    openPosition: (shares: bigint, borrowAssets: bigint, deadline: bigint = noDeadline) =>
      write(vaultAddr, amortizingVaultAbi, "openPosition", [shares, borrowAssets, deadline]),
    addCollateral: (id: bigint, shares: bigint) =>
      write(vaultAddr, amortizingVaultAbi, "addCollateral", [id, shares]),
    amortize: (id: bigint) => write(vaultAddr, amortizingVaultAbi, "amortize", [id]),
    repay: (id: bigint, assets: bigint) => write(vaultAddr, amortizingVaultAbi, "repay", [id, assets]),
    withdrawCollateral: (id: bigint, shares: bigint, deadline: bigint = noDeadline) =>
      write(vaultAddr, amortizingVaultAbi, "withdrawCollateral", [id, shares, deadline]),
    liquidate: (id: bigint, repayAssets: bigint, deadline: bigint = noDeadline) =>
      write(vaultAddr, amortizingVaultAbi, "liquidate", [id, repayAssets, deadline]),
  };

  // MutualCredit ------------------------------------------------------------
  const mcAddr = addresses.mutualCredit;
  const credit = {
    address: mcAddr,
    lineKey: (x: Address, y: Address, token: Address) =>
      read<Hex>(mcAddr, mutualCreditAbi, "lineKey", [x, y, token]),
    computeLineKey,
    defaults: (a: Address) => read<bigint>(mcAddr, mutualCreditAbi, "defaults", [a]),
    owedBy: (debtor: Address, creditor: Address, token: Address) =>
      read<bigint>(mcAddr, mutualCreditAbi, "owedBy", [debtor, creditor, token]),
    line: (key: Hex) => read(mcAddr, mutualCreditAbi, "lines", [key]),
    // writes
    proposeLine: (counterparty: Address, token: Address, myLimit: bigint, feeRate: bigint, grace: bigint) =>
      write(mcAddr, mutualCreditAbi, "proposeLine", [counterparty, token, myLimit, feeRate, grace]),
    acceptLine: (proposer: Address, token: Address, myLimit: bigint) =>
      write(mcAddr, mutualCreditAbi, "acceptLine", [proposer, token, myLimit]),
    cancelProposal: (counterparty: Address, token: Address) =>
      write(mcAddr, mutualCreditAbi, "cancelProposal", [counterparty, token]),
    rejectProposal: (proposer: Address, token: Address) =>
      write(mcAddr, mutualCreditAbi, "rejectProposal", [proposer, token]),
    pay: (to: Address, token: Address, amount: bigint) =>
      write(mcAddr, mutualCreditAbi, "pay", [to, token, amount]),
    netCycle: (token: Address, cycle: Address[]) =>
      write(mcAddr, mutualCreditAbi, "netCycle", [token, cycle]),
    settle: (creditor: Address, token: Address, amount: bigint) =>
      write(mcAddr, mutualCreditAbi, "settle", [creditor, token, amount]),
    demandSettlement: (debtor: Address, token: Address) =>
      write(mcAddr, mutualCreditAbi, "demandSettlement", [debtor, token]),
    markDefault: (debtor: Address, token: Address) =>
      write(mcAddr, mutualCreditAbi, "markDefault", [debtor, token]),
    closeLine: (counterparty: Address, token: Address) =>
      write(mcAddr, mutualCreditAbi, "closeLine", [counterparty, token]),
  };

  // ERC-20 helper for approving the reserve/asset before trading/supplying ---
  const token = {
    balanceOf: (tokenAddr: Address, a: Address) => read<bigint>(tokenAddr, erc20Abi, "balanceOf", [a]),
    allowance: (tokenAddr: Address, owner: Address, spender: Address) =>
      read<bigint>(tokenAddr, erc20Abi, "allowance", [owner, spender]),
    approve: (tokenAddr: Address, spender: Address, amount: bigint = maxUint256) =>
      write(tokenAddr, erc20Abi, "approve", [spender, amount]),
  };

  return { curve, vault, credit, token, addresses };
}

export type SuwappuClient = ReturnType<typeof createSuwappuClient>;
