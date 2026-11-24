import {
	encodeAbiParameters,
	encodePacked,
	keccak256,
	type Address,
	type Hex,
	type LocalAccount,
	type WalletClient,
} from "viem";
import { baseSepolia } from "viem/chains";

/**
 * CommonsClearingHouse (Commons v2, layer 1) — deployment + EIP-712 intent
 * helpers shared by the terminal, the Telegram bot relayer and agents.
 * Spec: docs/plans/commons-v2.md §2. Source: contracts/commons/CommonsClearingHouse.sol.
 */

export const clearingHouseDeployments: Record<number, { address: Address; block: bigint; deployTx: Hex }> = {
	[baseSepolia.id]: {
		address: "0x489b93a02a5ad429b444c0e5370f6d39089677dd",
		block: 55_164_962n,
		deployTx: "0xdafffa8ec28a1fe0c89b25ee85bcd51c86af6bb650d79d5274f86c457f234cb2",
	},
};

/** Mirrors `CommonsClearingHouse.Action` — order is ABI-significant. */
export enum ClearingAction {
	Propose = 0,
	Accept = 1,
	Cancel = 2,
	Reject = 3,
	SetLimit = 4,
	SetRouting = 5,
	Pay = 6,
	PayPath = 7,
	Settle = 8,
	Demand = 9,
	MarkDefault = 10,
	Close = 11,
	SetRouteCap = 12,
	Withdraw = 13,
	WriteOff = 14,
}

/** Mirrors `CommonsClearingHouse.Status`. */
export enum LineStatusV2 {
	None = 0,
	Proposed = 1,
	Active = 2,
	Closed = 3,
	Defaulted = 4,
}

export const FLAG_CLEARABLE = 1;
export const MIN_GRACE_SECONDS = 86_400n;

/**
 * Public-RPC gas estimates for this contract were measured to UNDERSHOOT actual
 * usage on Base Sepolia (one accept: est 121,413 vs used 123,153; an earlier run
 * OOG'd). Always send with this multiplier applied to the estimate.
 */
export const CLEARING_GAS_BUFFER_BPS = 15_000n; // 1.5x
export const withGasBuffer = (estimate: bigint) => (estimate * CLEARING_GAS_BUFFER_BPS) / 10_000n;

const PARAM_TYPES: Record<ClearingAction, readonly { type: string }[]> = {
	[ClearingAction.Propose]: [
		{ type: "address" }, // counterparty
		{ type: "address" }, // token
		{ type: "uint256" }, // myLimit
		{ type: "uint256" }, // feeRate (per-second WAD)
		{ type: "uint64" }, // grace seconds
		{ type: "uint8" }, // flags
	],
	[ClearingAction.Accept]: [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }],
	[ClearingAction.Cancel]: [{ type: "address" }, { type: "address" }],
	[ClearingAction.Reject]: [{ type: "address" }, { type: "address" }],
	[ClearingAction.SetLimit]: [{ type: "address" }, { type: "address" }, { type: "uint256" }],
	[ClearingAction.SetRouting]: [{ type: "address" }, { type: "bool" }, { type: "uint16" }],
	[ClearingAction.Pay]: [{ type: "address" }, { type: "address" }, { type: "uint256" }],
	[ClearingAction.PayPath]: [{ type: "address" }, { type: "address[]" }, { type: "uint256" }, { type: "uint256" }],
	[ClearingAction.Settle]: [{ type: "address" }, { type: "address" }, { type: "uint256" }],
	[ClearingAction.Demand]: [{ type: "address" }, { type: "address" }],
	[ClearingAction.MarkDefault]: [{ type: "address" }, { type: "address" }],
	[ClearingAction.Close]: [{ type: "address" }, { type: "address" }],
	[ClearingAction.SetRouteCap]: [{ type: "address" }, { type: "address" }, { type: "uint256" }],
	[ClearingAction.Withdraw]: [{ type: "address" }, { type: "address" }],
	[ClearingAction.WriteOff]: [{ type: "address" }, { type: "address" }],
};

export interface ClearingIntent {
	signer: Address;
	action: ClearingAction;
	params: Hex;
	nonce: bigint;
	deadline: bigint;
}

/** ABI-encode an action's params in the exact order the contract decodes them. */
export function encodeIntentParams(action: ClearingAction, values: readonly unknown[]): Hex {
	return encodeAbiParameters(PARAM_TYPES[action] as never, values as never);
}

export function clearingDomain(chainId: number, verifyingContract: Address) {
	return { name: "CommonsClearingHouse", version: "1", chainId, verifyingContract } as const;
}

export const clearingIntentTypes = {
	Intent: [
		{ name: "signer", type: "address" },
		{ name: "action", type: "uint8" },
		{ name: "paramsHash", type: "bytes32" },
		{ name: "nonce", type: "uint256" },
		{ name: "deadline", type: "uint256" },
	],
} as const;

/** Random 256-bit nonce (the contract uses unordered bitmap nonces). */
export function randomIntentNonce(): bigint {
	const b = crypto.getRandomValues(new Uint8Array(32));
	return BigInt(`0x${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`);
}

export function buildIntent(
	signer: Address,
	action: ClearingAction,
	values: readonly unknown[],
	opts: { nonce?: bigint; ttlSeconds?: number } = {},
): ClearingIntent {
	return {
		signer,
		action,
		params: encodeIntentParams(action, values),
		nonce: opts.nonce ?? randomIntentNonce(),
		deadline: BigInt(Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? 3600)),
	};
}

/** Typed-data payload for eth_signTypedData_v4 / viem signTypedData. */
export function intentTypedData(it: ClearingIntent, chainId: number, verifyingContract: Address) {
	return {
		domain: clearingDomain(chainId, verifyingContract),
		types: clearingIntentTypes,
		primaryType: "Intent" as const,
		message: {
			signer: it.signer,
			action: it.action,
			paramsHash: keccak256(it.params),
			nonce: it.nonce,
			deadline: it.deadline,
		},
	};
}

/** Sign with a local account or a wallet client (browser wallet, Turnkey, …). */
export async function signIntent(
	it: ClearingIntent,
	chainId: number,
	verifyingContract: Address,
	signer: LocalAccount | WalletClient,
): Promise<Hex> {
	const td = intentTypedData(it, chainId, verifyingContract);
	if ("signTypedData" in signer && "type" in signer && signer.type === "local") {
		return (signer as LocalAccount).signTypedData(td);
	}
	const wc = signer as WalletClient;
	return wc.signTypedData({ ...td, account: wc.account ?? it.signer });
}

/** Same key the contract computes: keccak(lo, hi, token) over the sorted pair. */
export function clearingLineKey(x: Address, y: Address, token: Address): Hex {
	const [lo, hi] = x.toLowerCase() < y.toLowerCase() ? [x, y] : [y, x];
	return keccak256(encodePacked(["address", "address", "address"], [lo, hi, token]));
}

/** APR % → per-second WAD fee rate (floored), as proposeLine expects. */
export function feeRateFromApr(aprPercent: number): bigint {
	if (!Number.isFinite(aprPercent) || aprPercent <= 0) return 0n;
	return BigInt(Math.floor((aprPercent / 100 / 31_536_000) * 1e18));
}
