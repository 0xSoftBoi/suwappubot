/**
 * Live policy resolution: before executing, the backend resolves the agent's
 * ENSv2 name and reads its onchain policy + World ID binding.
 *
 * Reads go through the UniversalResolver so the caller never needs to know
 * which resolver proxy a given agent uses.
 */
import { createPublicClient, http, namehash, type Address } from 'viem'
import { sepolia } from 'viem/chains'
import { ENSV2_SEPOLIA, TEXT_KEYS } from './addresses.ts'
import type { AgentPolicy } from './register.ts'

const UNIVERSAL_RESOLVER_ABI = [
	{
		type: 'function',
		name: 'resolve',
		stateMutability: 'view',
		inputs: [
			{ name: 'name', type: 'bytes' },
			{ name: 'data', type: 'bytes' },
		],
		outputs: [
			{ name: '', type: 'bytes' },
			{ name: '', type: 'address' },
		],
	},
] as const

const RESOLVER_READ_ABI = [
	{
		type: 'function',
		name: 'text',
		stateMutability: 'view',
		inputs: [
			{ name: 'node', type: 'bytes32' },
			{ name: 'key', type: 'string' },
		],
		outputs: [{ name: '', type: 'string' }],
	},
	{
		type: 'function',
		name: 'addr',
		stateMutability: 'view',
		inputs: [{ name: 'node', type: 'bytes32' }],
		outputs: [{ name: '', type: 'address' }],
	},
] as const

export interface ResolvedAgentPolicy {
	name: string
	agentAddress: Address
	policy: AgentPolicy
	worldIdBound: boolean
	riskNote: string | null
}

function dnsEncode(name: string): `0x${string}` {
	// Minimal DNS wire-format encoding for UniversalResolver.resolve.
	const parts = name.split('.')
	const bytes: number[] = []
	for (const p of parts) {
		const enc = new TextEncoder().encode(p)
		bytes.push(enc.length, ...enc)
	}
	bytes.push(0)
	return ('0x' + Buffer.from(bytes).toString('hex')) as `0x${string}`
}

/**
 * Resolve an agent subname and enforce its policy against a proposed trade.
 * Returns a block reason when the trade violates the onchain caps, or null
 * when it passes. This is the L4 gate the demo shows.
 */
export async function resolveAndCheckPolicy(
	rpcUrl: string,
	agentName: string,
	intent: { valueUsd: number; chain: string },
): Promise<{ resolved: ResolvedAgentPolicy; blockReason: string | null }> {
	const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) })
	const node = namehash(agentName)

	const [policyRaw, worldIdRaw, riskRaw, agentAddress] = await Promise.all([
		publicClient.readContract({
			address: ENSV2_SEPOLIA.UniversalResolver,
			abi: RESOLVER_READ_ABI,
			functionName: 'text',
			args: [node, TEXT_KEYS.policy],
		}).catch(() => ''),
		publicClient.readContract({
			address: ENSV2_SEPOLIA.UniversalResolver,
			abi: RESOLVER_READ_ABI,
			functionName: 'text',
			args: [node, TEXT_KEYS.worldId],
		}).catch(() => ''),
		publicClient.readContract({
			address: ENSV2_SEPOLIA.UniversalResolver,
			abi: RESOLVER_READ_ABI,
			functionName: 'text',
			args: [node, TEXT_KEYS.risk],
		}).catch(() => ''),
		publicClient.readContract({
			address: ENSV2_SEPOLIA.UniversalResolver,
			abi: RESOLVER_READ_ABI,
			functionName: 'addr',
			args: [node],
		}).catch(() => '0x0000000000000000000000000000000000000000' as Address),
	])

	if (!policyRaw) {
		return {
			resolved: {
				name: agentName,
				agentAddress,
				policy: { maxTxUsd: 0, requireApprovalAboveUsd: 0, allowedChains: [], version: 0 },
				worldIdBound: false,
				riskNote: null,
			},
			blockReason: `no ${TEXT_KEYS.policy} record on ${agentName} — fail closed`,
		}
	}

	let policy: AgentPolicy
	try {
		policy = JSON.parse(policyRaw) as AgentPolicy
	} catch {
		return {
			resolved: {
				name: agentName,
				agentAddress,
				policy: { maxTxUsd: 0, requireApprovalAboveUsd: 0, allowedChains: [], version: 0 },
				worldIdBound: false,
				riskNote: null,
			},
			blockReason: `unparseable ${TEXT_KEYS.policy} record on ${agentName} — fail closed`,
		}
	}

	const resolved: ResolvedAgentPolicy = {
		name: agentName,
		agentAddress,
		policy,
		worldIdBound: worldIdRaw.length > 0,
		riskNote: riskRaw || null,
	}

	if (intent.valueUsd > policy.maxTxUsd) {
		return {
			resolved,
			blockReason:
				`ENSv2 policy blocked this trade: $${intent.valueUsd.toFixed(2)} exceeds ` +
				`onchain cap $${policy.maxTxUsd} on ${agentName}`,
		}
	}
	if (policy.allowedChains.length > 0 && !policy.allowedChains.includes(intent.chain.toLowerCase())) {
		return { resolved, blockReason: `ENSv2 policy blocked this trade: chain ${intent.chain} not allowed on ${agentName}` }
	}
	return { resolved, blockReason: null }
}

export { dnsEncode }
