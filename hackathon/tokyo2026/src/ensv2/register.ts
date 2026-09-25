/**
 * Agent subname issuance on ENSv2 Sepolia: `agent.<name>.suwappu.eth`.
 *
 * Flow per agent:
 *  1. Owner registers `<name>.suwappu.eth` via ETHRegistrar.
 *  2. Owner deploys a resolver instance via VerifiableFactory (typed
 *     records the agent's key may later read).
 *  3. Owner grants the agent key AGENT_DEFAULT_ROLES on the registry
 *     (METADATA_WRITER but NOT LIMIT_WRITER — see roles.ts).
 *  4. Owner writes the initial `suwappu.policy` record (JSON caps).
 *
 * ⚠️ ABIs below are the minimal surface we need; confirm exact function
 * names/signatures against the current ENSv2 tutorial before the demo —
 * interfaces were non-final at research time.
 */
import {
	createPublicClient,
	createWalletClient,
	http,
	namehash,
	type Address,
	type Hash,
	type PublicClient,
	type WalletClient,
} from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { ENSV2_SEPOLIA, agentSubname, TEXT_KEYS } from './addresses.ts'
import { AGENT_DEFAULT_ROLES, assertAgentGrantSafe, grantRoles, type RoleName } from './roles.ts'

export interface Ensv2Clients {
	public: PublicClient
	wallet: WalletClient
	account: Address
}

/** Minimal ABI fragments — extend as the final interfaces land. */
const REGISTRY_ABI = [
	{
		type: 'function',
		name: 'grantRoles',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'node', type: 'bytes32' },
			{ name: 'account', type: 'address' },
			{ name: 'roles', type: 'uint256' },
		],
		outputs: [],
	},
	{
		type: 'function',
		name: 'setResolver',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'node', type: 'bytes32' },
			{ name: 'resolver', type: 'address' },
		],
		outputs: [],
	},
] as const

const RESOLVER_ABI = [
	{
		type: 'function',
		name: 'setText',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'node', type: 'bytes32' },
			{ name: 'key', type: 'string' },
			{ name: 'value', type: 'string' },
		],
		outputs: [],
	},
] as const

export function loadEnsv2Clients(env: NodeJS.ProcessEnv = process.env): Ensv2Clients {
	const rpcUrl = env['SEPOLIA_RPC_URL']
	const pk = env['ENSV2_OWNER_PRIVATE_KEY']
	if (!rpcUrl || !pk) {
		throw new Error('ENSv2 not configured — set SEPOLIA_RPC_URL and ENSV2_OWNER_PRIVATE_KEY (testnet only)')
	}
	const account = privateKeyToAccount(pk as `0x${string}`)
	const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) })
	const wallet = createWalletClient({ chain: sepolia, transport: http(rpcUrl), account })
	return { public: publicClient, wallet, account: account.address }
}

export interface AgentPolicy {
	maxTxUsd: number
	requireApprovalAboveUsd: number
	allowedChains: string[]
	version: number
}

/**
 * Issue `agent.<name>.suwappu.eth` for an agent key. The resolver address is
 * supplied (deploy once via VerifiableFactory, reuse per agent) or set later.
 */
export async function registerAgentSubname(
	clients: Ensv2Clients,
	opts: {
		agentName: string
		agentKey: Address
		resolver: Address
		policy: AgentPolicy
		parentName?: string
		extraRoles?: RoleName[]
	},
): Promise<{ name: string; node: `0x${string}`; txs: Hash[] }> {
	const name = agentSubname(opts.agentName, opts.parentName)
	const node = namehash(name)
	const txs: Hash[] = []

	const grants = grantRoles(0n, ...AGENT_DEFAULT_ROLES, ...(opts.extraRoles ?? []))
	assertAgentGrantSafe(grants)

	// 1. Point the name at its resolver.
	const setResolverTx = await clients.wallet.writeContract({
		address: ENSV2_SEPOLIA.PermissionedRegistry,
		abi: REGISTRY_ABI,
		functionName: 'setResolver',
		args: [node, opts.resolver],
		account: clients.account,
		chain: sepolia,
	})
	txs.push(setResolverTx)

	// 2. Delegate narrow roles to the agent key.
	const grantTx = await clients.wallet.writeContract({
		address: ENSV2_SEPOLIA.PermissionedRegistry,
		abi: REGISTRY_ABI,
		functionName: 'grantRoles',
		args: [node, opts.agentKey, grants],
		account: clients.account,
		chain: sepolia,
	})
	txs.push(grantTx)

	// 3. Owner writes the initial policy record (agent key cannot).
	const policyTx = await clients.wallet.writeContract({
		address: opts.resolver,
		abi: RESOLVER_ABI,
		functionName: 'setText',
		args: [node, TEXT_KEYS.policy, JSON.stringify(opts.policy)],
		account: clients.account,
		chain: sepolia,
	})
	txs.push(policyTx)

	for (const h of txs) {
		await clients.public.waitForTransactionReceipt({ hash: h })
	}
	return { name, node, txs }
}
