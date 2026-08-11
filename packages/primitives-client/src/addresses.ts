import { baseSepolia } from "viem/chains";

export interface PrimitivesDeployment {
  chainId: number;
  timeCurve: `0x${string}`;
  amortizingVault: `0x${string}`;
  mutualCredit: `0x${string}`;
  /** Reserve / debt asset used by the deployment (test MockUSD on Sepolia). */
  reserveAsset: `0x${string}`;
  /** ERC-4626 collateral vault used by the AmortizingVault deployment. */
  collateralVault: `0x${string}`;
}

/**
 * Base Sepolia deployment (chain 84532), 2026-08-11.
 * Testnet only — unaudited immutable contracts. reserveAsset / collateralVault
 * are the MockUSD + MockYieldVault stand-ins deployed alongside for end-to-end
 * exercisability; point at real tokens + a vetted 4626 for anything beyond a demo.
 */
export const baseSepoliaDeployment: PrimitivesDeployment = {
  chainId: baseSepolia.id,
  timeCurve: "0x13189B1fae4f7CBCfF12bb57fBB6fEF83abe1B5C",
  amortizingVault: "0x07Bc798F3f6D9a5C672C209CaBe69289AF19d8DA",
  mutualCredit: "0x3938B15649129B21f53dB20D58F9084366a5570b",
  reserveAsset: "0x75b2D073101f79f4A2289EF8312D5c7eD2524BD8",
  collateralVault: "0xF459a90B2aEA6a8Dc8e98a2fd9c41CD7Fef678b4",
};

/** Deployments keyed by chain id. */
export const deployments: Record<number, PrimitivesDeployment> = {
  [baseSepolia.id]: baseSepoliaDeployment,
};
