/**
 * Recurring crypto billing executor (Base Spend Permissions).
 *
 * Operator-side counterpart to lib/spendPermission.ts: registers a user-signed
 * SpendPermission on-chain (approveWithSignature) and pulls the periodic fee
 * (spend). Runs as our `spender` via a server-controlled operator key.
 *
 * Gated by RECURRING_BILLING_ENABLED + SPEND_OPERATOR_PK — OFF by default.
 *
 * NOTE: code-complete but NOT live-tested. Submitting real spend() txs needs a
 * funded operator wallet (ETH for gas on Base), a real user grant, and a Base
 * Sepolia dry-run first. Keep gated until proven end-to-end on testnet.
 */

import { type Address, type Hex, createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import { getRpcUrl } from '../config/chains'
import {
	SPEND_PERMISSION_MANAGER_ABI,
	SPEND_PERMISSION_MANAGER_BASE,
	type SpendPermission,
} from '../lib/spendPermission'

type RecurringEnv = {
	RECURRING_BILLING_ENABLED?: string
	SPEND_OPERATOR_PK?: string
	SPEND_PERMISSION_MANAGER_ADDRESS?: string
}

export type OnchainResult = { ok: true; txHash: string } | { ok: false; error: string }

/** Recurring billing is usable only when enabled AND an operator key is set. */
export function isRecurringEnabled(env: RecurringEnv): boolean {
	return env.RECURRING_BILLING_ENABLED === 'true' && !!env.SPEND_OPERATOR_PK
}

/** Operator address derived from the configured key, or null if unset/invalid. */
export function operatorAddress(env: RecurringEnv): Address | null {
	if (!env.SPEND_OPERATOR_PK) return null
	try {
		return privateKeyToAccount(env.SPEND_OPERATOR_PK as Hex).address
	} catch {
		return null
	}
}

function clients(env: RecurringEnv) {
	const account = privateKeyToAccount(env.SPEND_OPERATOR_PK as Hex)
	const rpcUrl = getRpcUrl(8453)
	if (!rpcUrl) throw new Error('No Base RPC configured')
	const transport = http(rpcUrl)
	return {
		account,
		manager: (env.SPEND_PERMISSION_MANAGER_ADDRESS as Address) || SPEND_PERMISSION_MANAGER_BASE,
		wallet: createWalletClient({ account, chain: base, transport }),
		publicClient: createPublicClient({ chain: base, transport }),
	}
}

/**
 * Register a user-signed SpendPermission on-chain so the operator can later pull
 * funds. Idempotent at the contract level (re-approving an approved permission
 * is a no-op / revert we treat as already-registered).
 */
export async function approveSpendPermission(
	env: RecurringEnv,
	permission: SpendPermission,
	signature: Hex,
): Promise<OnchainResult> {
	if (!isRecurringEnabled(env)) return { ok: false, error: 'recurring_disabled' }
	try {
		const { wallet, publicClient, manager } = clients(env)
		const txHash = await wallet.writeContract({
			address: manager,
			abi: SPEND_PERMISSION_MANAGER_ABI,
			functionName: 'approveWithSignature',
			args: [permission, signature],
		})
		await publicClient.waitForTransactionReceipt({ hash: txHash })
		return { ok: true, txHash }
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}

/**
 * Pull `value` (atomic token units) for one period via the registered
 * permission. Only callable by the operator (the permission's `spender`).
 */
export async function chargeSpendPermission(
	env: RecurringEnv,
	permission: SpendPermission,
	value: bigint,
): Promise<OnchainResult> {
	if (!isRecurringEnabled(env)) return { ok: false, error: 'recurring_disabled' }
	if (value <= 0n) return { ok: false, error: 'invalid_value' }
	if (value > permission.allowance) return { ok: false, error: 'value_exceeds_allowance' }
	try {
		const { wallet, publicClient, manager } = clients(env)
		const txHash = await wallet.writeContract({
			address: manager,
			abi: SPEND_PERMISSION_MANAGER_ABI,
			functionName: 'spend',
			args: [permission, value],
		})
		await publicClient.waitForTransactionReceipt({ hash: txHash })
		return { ok: true, txHash }
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}
