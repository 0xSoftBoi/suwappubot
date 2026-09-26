/**
 * Live policy resolution: before executing, the backend resolves the agent's
 * ENSv2 name and reads its onchain policy + World ID binding.
 *
 * Read path (verified 2026-09-25 from contracts-v2 @ sepolia-deployment-2026-09-15):
 *  - PRIMARY: UniversalResolverV2.resolve(dnsEncodedName, data) where data =
 *    encodeFunctionData(text, [namehash(name), key]). Returns (bytes result,
 *    address resolver); result is the ABI-encoded return of the inner call.
 *    This proves the full name → registry → resolver chain.
 *  - FALLBACK: text(namehash, key) directly on the agent's resolver proxy
 *    (address recorded at setup). Same record, no registry walk.
 * Either path failing falls through; both failing = fail closed.
 *
 * Records are keyed by namehash(node) on PermissionedResolver
 * (mapping(bytes32 node => mapping(uint64 version => Record))).
 */
import {
	createPublicClient,
	http,
	namehash,
	decodeFunctionResult,
	encodeFunctionData,
	type Address,
	type PublicClient,
} from 'viem'
import { sepolia } from 'viem/chains'
import { ENSV2_SEPOLIA, TEXT_KEYS } from './addresses.ts'
import type { AgentPolicy } from './register.ts'

/** resolve(bytes name, bytes data) → (bytes result, address resolver). */
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
			{ name: 'result', type: 'bytes' },
			{ name: 'resolver', type: 'address' },
		],
	},
] as const

const TEXT_READ_ABI = [
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
] as const

const ADDR_READ_ABI = [
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
	resolver: Address | null
	viaUniversalResolver: boolean
	policy: AgentPolicy
	worldIdBound: boolean
	riskNote: string | null
}

/** DNS wire-format encoding for UniversalResolver.resolve. */
export function dnsEncode(name: string): `0x${string}` {
	const parts = name.split('.')
	const bytes: number[] = []
	for (const p of parts) {
		const enc = new TextEncoder().encode(p)
		if (enc.length === 0 || enc.length > 63) throw new Error(`invalid label: ${p}`)
		bytes.push(enc.length, ...enc)
	}
	bytes.push(0)
	return ('0x' + Buffer.from(bytes).toString('hex')) as `0x${string}`
}

function textCalldata(node: `0x${string}`, key: string): `0x${string}` {
	return encodeFunctionData({ abi: TEXT_READ_ABI, functionName: 'text', args: [node, key] })
}

function decodeTextResult(result: `0x${string}`): string {
	return decodeFunctionResult({ abi: TEXT_READ_ABI, functionName: 'text', data: result }) as string
}

/**
 * Read one text record for a name. Primary: UniversalResolverV2.resolve();
 * fallback: direct text() on the configured resolver proxy.
 */
export async function resolveTextRecord(
	client: PublicClient,
	name: string,
	key: string,
	fallbackResolver?: Address,
): Promise<{ value: string; resolver: Address | null; viaUniversalResolver: boolean }> {
	const node = namehash(name)
	const data = textCalldata(node, key)

	try {
		const [result, resolver] = await client.readContract({
			address: ENSV2_SEPOLIA.universalResolverV2,
			abi: UNIVERSAL_RESOLVER_ABI,
			functionName: 'resolve',
			args: [dnsEncode(name), data],
		})
		return { value: decodeTextResult(result), resolver, viaUniversalResolver: true }
	} catch {
		// fall through to direct read
	}
	if (fallbackResolver) {
		try {
			const value = await client.readContract({
				address: fallbackResolver,
				abi: TEXT_READ_ABI,
				functionName: 'text',
				args: [node, key],
			})
			return { value, resolver: fallbackResolver, viaUniversalResolver: false }
		} catch {
			// fall through to empty
		}
	}
	return { value: '', resolver: null, viaUniversalResolver: false }
}

export function createEnsv2PublicClient(rpcUrl: string): PublicClient {
	return createPublicClient({ chain: sepolia, transport: http(rpcUrl) })
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
	opts: { fallbackResolver?: Address } = {},
): Promise<{ resolved: ResolvedAgentPolicy; blockReason: string | null }> {
	const publicClient = createEnsv2PublicClient(rpcUrl)
	const node = namehash(agentName)

	const [policyRec, worldIdRec, riskRec, agentAddress] = await Promise.all([
		resolveTextRecord(publicClient, agentName, TEXT_KEYS.policy, opts.fallbackResolver),
		resolveTextRecord(publicClient, agentName, TEXT_KEYS.worldId, opts.fallbackResolver),
		resolveTextRecord(publicClient, agentName, TEXT_KEYS.risk, opts.fallbackResolver),
		publicClient
			.readContract({
				address: ENSV2_SEPOLIA.universalResolverV2,
				abi: UNIVERSAL_RESOLVER_ABI,
				functionName: 'resolve',
				args: [dnsEncode(agentName), encodeFunctionData({ abi: ADDR_READ_ABI, functionName: 'addr', args: [node] })],
			})
			.then(
				([result]) =>
					decodeFunctionResult({ abi: ADDR_READ_ABI, functionName: 'addr', data: result }) as Address,
			)
			.catch(() => '0x0000000000000000000000000000000000000000' as Address),
	])

	const empty = (blockReason: string): { resolved: ResolvedAgentPolicy; blockReason: string } => ({
		resolved: {
			name: agentName,
			agentAddress,
			resolver: policyRec.resolver,
			viaUniversalResolver: policyRec.viaUniversalResolver,
			policy: { maxTxUsd: 0, requireApprovalAboveUsd: 0, allowedChains: [], version: 0 },
			worldIdBound: false,
			riskNote: null,
		},
		blockReason,
	})

	if (!policyRec.value) {
		return empty(`no ${TEXT_KEYS.policy} record on ${agentName} — fail closed`)
	}

	let policy: AgentPolicy
	try {
		const raw = JSON.parse(policyRec.value) as Partial<AgentPolicy>
		if (
			typeof raw.maxTxUsd !== 'number' ||
			!Number.isFinite(raw.maxTxUsd) ||
			raw.maxTxUsd < 0 ||
			typeof raw.requireApprovalAboveUsd !== 'number' ||
			!Number.isFinite(raw.requireApprovalAboveUsd) ||
			!Array.isArray(raw.allowedChains) ||
			typeof raw.version !== 'number'
		) {
			throw new Error('invalid policy shape')
		}
		policy = raw as AgentPolicy
	} catch {
		return empty(`unparseable ${TEXT_KEYS.policy} record on ${agentName} — fail closed`)
	}

	const resolved: ResolvedAgentPolicy = {
		name: agentName,
		agentAddress,
		resolver: policyRec.resolver,
		viaUniversalResolver: policyRec.viaUniversalResolver,
		policy,
		worldIdBound: worldIdRec.value.length > 0,
		riskNote: riskRec.value || null,
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
