/**
 * Agent subname issuance on ENSv2 Sepolia: `<agent>.suwappu.eth`.
 *
 * All ABIs verified 2026-09-25 against contracts-v2 @ 97a57293f3b4279d94b571e678edb53ce62638f4
 * (primary sources: contracts/src + auto-generated deployments/sepolia docs).
 *
 * Setup ceremony (see ENSV2_SETUP.md for the ordered runbook):
 *  1. Owner registers `suwappu.eth` via ETHRegistrar (commit → wait → register,
 *     paying MockUSDC). Registration auto-grants the owner
 *     ROLE_SET_SUBREGISTRY/ROLE_SET_RESOLVER (+admins) on the .eth registry.
 *  2. Owner deploys the agent's resolver proxy via
 *     VerifiableFactory.deployProxy(permissionedResolverImpl, salt,
 *     initialize(admin, roleBitmap, setters)) — setters atomically write the
 *     initial `suwappu.policy` record at deploy time.
 *  3. Owner creates `<agent>.suwappu.eth` on suwappu.eth's registry via
 *     register(label, owner, subregistry, resolver, roleBitmap, expiry).
 *  4. Owner calls authorizeTextRoles(dnsName, key, agentKey, true) ONLY for
 *     metadata keys (avatar, description, suwappu.agent-version). The agent
 *     key can never obtain ROLE_SET_TEXT for `suwappu.policy` → onchain
 *     revert if it tries (EACUnauthorizedAccountRoles).
 */
import {
	createPublicClient,
	createWalletClient,
	encodeFunctionData,
	http,
	namehash,
	type Address,
	type Hash,
	type PublicClient,
	type WalletClient,
} from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { AGENT_WRITABLE_KEYS, ENSV2_SEPOLIA, TEXT_KEYS, agentSubname } from './addresses.ts'
import { assertAgentKeysSafe } from './roles.ts'
import { dnsEncode } from './resolver.ts'

export interface Ensv2Clients {
	public: PublicClient
	wallet: WalletClient
	account: Address
}

/** VerifiableFactory.deployProxy(address implementation, uint256 salt, bytes data) → address */
const FACTORY_ABI = [
	{
		type: 'function',
		name: 'deployProxy',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'implementation', type: 'address' },
			{ name: 'salt', type: 'uint256' },
			{ name: 'data', type: 'bytes' },
		],
		outputs: [{ name: 'proxy', type: 'address' }],
	},
] as const

/**
 * PermissionedResolver (verified ABI):
 * - initialize(address admin, uint256 roleBitmap, bytes[] setters)
 * - setText(bytes32 node, string key, string value)
 * - authorizeTextRoles(bytes toName, string key, address account, bool grant) → bool
 */
const RESOLVER_ADMIN_ABI = [
	{
		type: 'function',
		name: 'initialize',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'admin', type: 'address' },
			{ name: 'roleBitmap', type: 'uint256' },
			{ name: 'setters', type: 'bytes[]' },
		],
		outputs: [],
	},
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
	{
		type: 'function',
		name: 'authorizeTextRoles',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'toName', type: 'bytes' },
			{ name: 'key', type: 'string' },
			{ name: 'account', type: 'address' },
			{ name: 'grant', type: 'bool' },
		],
		outputs: [{ name: '', type: 'bool' }],
	},
] as const

/**
 * ETHRegistrar (verified ABI):
 * - makeCommitment(label, owner, secret, subregistry, resolver, duration, referrer) → bytes32 (pure)
 * - commit(bytes32)
 * - register(label, owner, secret, subregistry, resolver, duration, paymentToken, referrer) → uint256
 * - getRegisterPrice(label, duration, paymentToken) → (uint256 base, uint256 premium)
 * - isAvailable(label) → bool
 */
const ETH_REGISTRAR_ABI = [
	{
		type: 'function',
		name: 'makeCommitment',
		stateMutability: 'pure',
		inputs: [
			{ name: 'label', type: 'string' },
			{ name: 'owner', type: 'address' },
			{ name: 'secret', type: 'bytes32' },
			{ name: 'subregistry', type: 'address' },
			{ name: 'resolver', type: 'address' },
			{ name: 'duration', type: 'uint64' },
			{ name: 'referrer', type: 'bytes32' },
		],
		outputs: [{ name: '', type: 'bytes32' }],
	},
	{
		type: 'function',
		name: 'commit',
		stateMutability: 'nonpayable',
		inputs: [{ name: 'commitment', type: 'bytes32' }],
		outputs: [],
	},
	{
		type: 'function',
		name: 'register',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'label', type: 'string' },
			{ name: 'owner', type: 'address' },
			{ name: 'secret', type: 'bytes32' },
			{ name: 'subregistry', type: 'address' },
			{ name: 'resolver', type: 'address' },
			{ name: 'duration', type: 'uint64' },
			{ name: 'paymentToken', type: 'address' },
			{ name: 'referrer', type: 'bytes32' },
		],
		outputs: [{ name: 'tokenId', type: 'uint256' }],
	},
	{
		type: 'function',
		name: 'getRegisterPrice',
		stateMutability: 'view',
		inputs: [
			{ name: 'label', type: 'string' },
			{ name: 'duration', type: 'uint64' },
			{ name: 'paymentToken', type: 'address' },
		],
		outputs: [
			{ name: 'base', type: 'uint256' },
			{ name: 'premium', type: 'uint256' },
		],
	},
	{
		type: 'function',
		name: 'isAvailable',
		stateMutability: 'view',
		inputs: [{ name: 'label', type: 'string' }],
		outputs: [{ name: '', type: 'bool' }],
	},
] as const

/** IRegistry: getSubregistry(string) → address, getResolver(string) → address */
const REGISTRY_READ_ABI = [
	{
		type: 'function',
		name: 'getSubregistry',
		stateMutability: 'view',
		inputs: [{ name: 'label', type: 'string' }],
		outputs: [{ name: '', type: 'address' }],
	},
	{
		type: 'function',
		name: 'getResolver',
		stateMutability: 'view',
		inputs: [{ name: 'label', type: 'string' }],
		outputs: [{ name: '', type: 'address' }],
	},
] as const

/**
 * IStandardRegistry.register(string label, address owner, address registry,
 * address resolver, uint256 roleBitmap, uint64 expiry) → uint256.
 * Called on the PARENT registry (suwappu.eth's registry) to create the agent subname.
 */
const PARENT_REGISTRY_ABI = [
	{
		type: 'function',
		name: 'register',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'label', type: 'string' },
			{ name: 'owner', type: 'address' },
			{ name: 'registry', type: 'address' },
			{ name: 'resolver', type: 'address' },
			{ name: 'roleBitmap', type: 'uint256' },
			{ name: 'expiry', type: 'uint64' },
		],
		outputs: [{ name: 'tokenId', type: 'uint256' }],
	},
] as const

/** Minimal ERC20 approve for the registrar payment. */
const ERC20_ABI = [
	{
		type: 'function',
		name: 'approve',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		outputs: [{ name: '', type: 'bool' }],
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

/** Encode initialize(admin, roleBitmap, setters) for VerifiableFactory.deployProxy. */
export function encodeResolverInit(
	admin: Address,
	roleBitmap: bigint,
	setters: `0x${string}`[],
): `0x${string}` {
	return encodeFunctionData({
		abi: RESOLVER_ADMIN_ABI,
		functionName: 'initialize',
		args: [admin, roleBitmap, setters],
	})
}

/** Encode a setText(node, key, value) setter for initialize() or multicall(). */
export function encodeSetText(node: `0x${string}`, key: string, value: string): `0x${string}` {
	return encodeFunctionData({
		abi: RESOLVER_ADMIN_ABI,
		functionName: 'setText',
		args: [node, key, value],
	})
}

/**
 * Step 1: deploy the agent's PermissionedResolver proxy via the VerifiableFactory.
 * The initial policy record is written atomically inside initialize() via setters.
 */
export async function deployAgentResolver(
	clients: Ensv2Clients,
	opts: { name: string; policy: AgentPolicy; adminRoleBitmap: bigint; salt?: bigint },
): Promise<{ proxy: Address; tx: Hash }> {
	const node = namehash(opts.name)
	const setters = [
		encodeSetText(node, TEXT_KEYS.policy, JSON.stringify(opts.policy)),
		encodeSetText(node, TEXT_KEYS.version, String(opts.policy.version)),
	]
	const data = encodeResolverInit(clients.account, opts.adminRoleBitmap, setters)
	// Predict the proxy address via eth_call (does not persist state).
	const { result: proxy } = await clients.public.simulateContract({
		address: ENSV2_SEPOLIA.verifiableFactory,
		abi: FACTORY_ABI,
		functionName: 'deployProxy',
		args: [ENSV2_SEPOLIA.permissionedResolverImpl, opts.salt ?? 0n, data],
		account: clients.account,
	})
	const tx = await clients.wallet.writeContract({
		address: ENSV2_SEPOLIA.verifiableFactory,
		abi: FACTORY_ABI,
		functionName: 'deployProxy',
		args: [ENSV2_SEPOLIA.permissionedResolverImpl, opts.salt ?? 0n, data],
		account: clients.account,
		chain: sepolia,
	})
	await clients.public.waitForTransactionReceipt({ hash: tx })
	return { proxy, tx }
}

/**
 * Step 2: create `<agent>.suwappu.eth` on suwappu.eth's registry.
 * The agent name is a leaf: subregistry is address(0) (verify live).
 */
export async function registerAgentSubname(
	clients: Ensv2Clients,
	opts: {
		agentLabel: string
		parentRegistry: Address
		resolver: Address
		ownerRoleBitmap?: bigint
		expiry?: bigint
	},
): Promise<{ name: string; node: `0x${string}`; tx: Hash }> {
	const name = agentSubname(opts.agentLabel)
	const node = namehash(name)
	const tx = await clients.wallet.writeContract({
		address: opts.parentRegistry,
		abi: PARENT_REGISTRY_ABI,
		functionName: 'register',
		args: [
			opts.agentLabel,
			clients.account,
			'0x0000000000000000000000000000000000000000',
			opts.resolver,
			opts.ownerRoleBitmap ?? 0n,
			opts.expiry ?? BigInt(Math.floor(Date.now() / 1000) + 365 * 86400),
		],
		account: clients.account,
		chain: sepolia,
	})
	await clients.public.waitForTransactionReceipt({ hash: tx })
	return { name, node, tx }
}

/**
 * Step 3: authorize the agent key for metadata keys ONLY.
 * The policy key is never authorized → setText(node, "suwappu.policy") from
 * the agent key reverts onchain (EACUnauthorizedAccountRoles).
 */
export async function authorizeAgentKeys(
	clients: Ensv2Clients,
	opts: { name: string; resolver: Address; agentKey: Address; keys?: readonly string[] },
): Promise<Hash[]> {
	const keys = opts.keys ?? AGENT_WRITABLE_KEYS
	assertAgentKeysSafe(keys, TEXT_KEYS.policy)
	const txs: Hash[] = []
	for (const key of keys) {
		const tx = await clients.wallet.writeContract({
			address: opts.resolver,
			abi: RESOLVER_ADMIN_ABI,
			functionName: 'authorizeTextRoles',
			args: [dnsEncode(opts.name), key, opts.agentKey, true],
			account: clients.account,
			chain: sepolia,
		})
		txs.push(tx)
	}
	for (const h of txs) await clients.public.waitForTransactionReceipt({ hash: h })
	return txs
}

/**
 * Step 0: register `suwappu.eth` itself (commit → wait → register).
 * The caller must have approved MockUSDC for base+premium first.
 */
export async function registerParentName(
	clients: Ensv2Clients,
	opts: {
		label?: string
		subregistry: Address
		resolver?: Address
		durationSecs?: number
		secret?: `0x${string}`
		referrer?: `0x${string}`
	},
): Promise<{ commitment: `0x${string}`; registerTx: Hash }> {
	const label = opts.label ?? 'suwappu'
	const secret =
		opts.secret ??
		('0x' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex') as `0x${string}`)
	const referrer = opts.referrer ?? ('0x' + '00'.repeat(32) as `0x${string}`)
	const duration = BigInt(opts.durationSecs ?? 365 * 86400)
	const resolver = opts.resolver ?? '0x0000000000000000000000000000000000000000'

	const commitment = await clients.public.readContract({
		address: ENSV2_SEPOLIA.ethRegistrar,
		abi: ETH_REGISTRAR_ABI,
		functionName: 'makeCommitment',
		args: [label, clients.account, secret, opts.subregistry, resolver, duration, referrer],
	})
	const [base, premium] = await clients.public.readContract({
		address: ENSV2_SEPOLIA.ethRegistrar,
		abi: ETH_REGISTRAR_ABI,
		functionName: 'getRegisterPrice',
		args: [label, duration, ENSV2_SEPOLIA.mockUSDC],
	})
	// approve(base+premium) then commit; the caller waits out MIN_COMMITMENT_AGE offchain.
	const approveTx = await clients.wallet.writeContract({
		address: ENSV2_SEPOLIA.mockUSDC,
		abi: ERC20_ABI,
		functionName: 'approve',
		args: [ENSV2_SEPOLIA.ethRegistrar, base + premium],
		account: clients.account,
		chain: sepolia,
	})
	await clients.public.waitForTransactionReceipt({ hash: approveTx })
	const commitTx = await clients.wallet.writeContract({
		address: ENSV2_SEPOLIA.ethRegistrar,
		abi: ETH_REGISTRAR_ABI,
		functionName: 'commit',
		args: [commitment],
		account: clients.account,
		chain: sepolia,
	})
	await clients.public.waitForTransactionReceipt({ hash: commitTx })
	return { commitment, registerTx: commitTx }
}

/** Finish step 0 after the commitment ages: the actual registration. */
export async function finishParentRegistration(
	clients: Ensv2Clients,
	opts: {
		label?: string
		secret: `0x${string}`
		subregistry: Address
		resolver?: Address
		durationSecs?: number
		referrer?: `0x${string}`
	},
): Promise<Hash> {
	const label = opts.label ?? 'suwappu'
	const tx = await clients.wallet.writeContract({
		address: ENSV2_SEPOLIA.ethRegistrar,
		abi: ETH_REGISTRAR_ABI,
		functionName: 'register',
		args: [
			label,
			clients.account,
			opts.secret,
			opts.subregistry,
			opts.resolver ?? '0x0000000000000000000000000000000000000000',
			BigInt(opts.durationSecs ?? 365 * 86400),
			ENSV2_SEPOLIA.mockUSDC,
			opts.referrer ?? ('0x' + '00'.repeat(32) as `0x${string}`),
		],
		account: clients.account,
		chain: sepolia,
	})
	await clients.public.waitForTransactionReceipt({ hash: tx })
	return tx
}

/** Walk the registry hierarchy: ethRegistry → getSubregistry("suwappu") → getResolver(agentLabel). */
export async function findAgentResolver(
	publicClient: PublicClient,
	parentLabel = 'suwappu',
	agentLabel: string,
): Promise<Address | null> {
	const parentRegistry = await publicClient.readContract({
		address: ENSV2_SEPOLIA.ethRegistry,
		abi: REGISTRY_READ_ABI,
		functionName: 'getSubregistry',
		args: [parentLabel],
	})
	if (parentRegistry === '0x0000000000000000000000000000000000000000') return null
	const resolver = await publicClient.readContract({
		address: parentRegistry,
		abi: REGISTRY_READ_ABI,
		functionName: 'getResolver',
		args: [agentLabel],
	})
	return resolver === '0x0000000000000000000000000000000000000000' ? null : resolver
}
