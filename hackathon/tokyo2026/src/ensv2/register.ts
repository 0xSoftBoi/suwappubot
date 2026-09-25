/**
 * Agent subname issuance on ENSv2 Sepolia: `<agent>.suwappu.eth`.
 *
 * All ABIs verified 2026-09-25 against contracts-v2 @ sepolia-deployment-2026-09-15
 * (primary sources: contracts/src + auto-generated deployments/sepolia docs).
 *
 * Setup ceremony (see ENSV2_SETUP.md for the ordered runbook). Gas-optimized:
 * per-agent setup is 3 transactions total —
 *  1. `deployProxy` (resolver + initial policy records atomically via initialize calls),
 *  2. `register` on suwappu.eth's registry (resolver set inline, no separate setResolver),
 *  3. ONE `multicall` batching all `grantSetterRoles` grants (not one tx per key,
 *     and not in initialize calls — those run with msg.sender = the factory).
 * Read path (resolver.ts) is pure eth_call: zero gas.
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
 * PermissionedResolver (verified ABI @ sepolia-deployment-2026-09-15):
 * - initialize(Grant[] grants, bytes[] calls) — Grant = {account, roleBitmap}
 * - setText(bytes name, string key, string value) — name is DNS-encoded
 * - grantSetterRoles(bytes setter, address account) → bool — setter is the
 *   encoded setText(name, key, "") call; the contract decodes it to find the
 *   key-scoped resource. (authorizeTextRoles is GONE at this deployment.)
 * - multicall(bytes[] calls) → bytes[]
 */
const RESOLVER_ADMIN_ABI = [
	{
		type: 'function',
		name: 'initialize',
		stateMutability: 'nonpayable',
		inputs: [
			{
				name: 'grants',
				type: 'tuple[]',
				components: [
					{ name: 'account', type: 'address' },
					{ name: 'roleBitmap', type: 'uint256' },
				],
			},
			{ name: 'calls', type: 'bytes[]' },
		],
		outputs: [],
	},
	{
		type: 'function',
		name: 'setText',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'name', type: 'bytes' },
			{ name: 'key', type: 'string' },
			{ name: 'value', type: 'string' },
		],
		outputs: [],
	},
	{
		type: 'function',
		name: 'grantSetterRoles',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'setter', type: 'bytes' },
			{ name: 'account', type: 'address' },
		],
		outputs: [{ name: '', type: 'bool' }],
	},
	{
		type: 'function',
		name: 'multicall',
		stateMutability: 'nonpayable',
		inputs: [{ name: 'calls', type: 'bytes[]' }],
		outputs: [{ name: 'results', type: 'bytes[]' }],
	},
] as const

/** One EAC grant: account ← roleBitmap. */
export interface ResolverGrant {
	account: Address
	roleBitmap: bigint
}

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

/** Encode initialize(grants, calls) for VerifiableFactory.deployProxy. */
export function encodeResolverInit(
	grants: ResolverGrant[],
	calls: `0x${string}`[],
): `0x${string}` {
	return encodeFunctionData({
		abi: RESOLVER_ADMIN_ABI,
		functionName: 'initialize',
		args: [grants, calls],
	})
}

/** Encode a setText(name, key, value) setter for initialize() calls or multicall(). */
export function encodeSetText(name: string, key: string, value: string): `0x${string}` {
	return encodeFunctionData({
		abi: RESOLVER_ADMIN_ABI,
		functionName: 'setText',
		args: [dnsEncode(name), key, value],
	})
}

/**
 * Encode a grantSetterRoles(setter, account) call (for multicall batching).
 * The setter is the encoded setText(name, key, "") — the contract decodes it
 * to the key-scoped resource; the value is irrelevant to the grant.
 */
export function encodeGrantSetterRoles(
	name: string,
	key: string,
	account: Address,
): `0x${string}` {
	return encodeFunctionData({
		abi: RESOLVER_ADMIN_ABI,
		functionName: 'grantSetterRoles',
		args: [encodeSetText(name, key, ''), account],
	})
}

/** Encode a multicall(calls) batch. */
export function encodeMulticall(calls: `0x${string}`[]): `0x${string}` {
	return encodeFunctionData({
		abi: RESOLVER_ADMIN_ABI,
		functionName: 'multicall',
		args: [calls],
	})
}

/**
 * Step 1: deploy the agent's PermissionedResolver proxy via the VerifiableFactory.
 * The initial policy record is written atomically inside initialize() via calls.
 * The owner receives the admin grant; per-key agent grants come later (Step 3)
 * because grantSetterRoles checks the caller's roles and initialize runs with
 * msg.sender = the factory.
 */
export async function deployAgentResolver(
	clients: Ensv2Clients,
	opts: { name: string; policy: AgentPolicy; adminRoleBitmap: bigint; salt?: bigint },
): Promise<{ proxy: Address; tx: Hash }> {
	const calls = [
		encodeSetText(opts.name, TEXT_KEYS.policy, JSON.stringify(opts.policy)),
		encodeSetText(opts.name, TEXT_KEYS.version, String(opts.policy.version)),
	]
	const data = encodeResolverInit([{ account: clients.account, roleBitmap: opts.adminRoleBitmap }], calls)
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
 * Step 3: authorize the agent key for metadata keys ONLY — batched into a
 * SINGLE transaction via the resolver's multicall(). One tx instead of one
 * per key: saves ~21k base gas per key and the round-trips. Cannot be folded
 * into initialize(): grantSetterRoles checks the caller's admin roles and
 * initialize runs with msg.sender = the factory, which holds none.
 *
 * The policy key is never authorized → setText(name, "suwappu.policy") from
 * the agent key reverts onchain (onlyRoles check).
 */
export async function authorizeAgentKeys(
	clients: Ensv2Clients,
	opts: { name: string; resolver: Address; agentKey: Address; keys?: readonly string[] },
): Promise<Hash> {
	const keys = opts.keys ?? AGENT_WRITABLE_KEYS
	assertAgentKeysSafe(keys, TEXT_KEYS.policy)
	const calls = keys.map((key) => encodeGrantSetterRoles(opts.name, key, opts.agentKey))
	const tx = await clients.wallet.writeContract({
		address: opts.resolver,
		abi: RESOLVER_ADMIN_ABI,
		functionName: 'multicall',
		args: [calls],
		account: clients.account,
		chain: sepolia,
	})
	await clients.public.waitForTransactionReceipt({ hash: tx })
	return tx
}

/**
 * Estimate the gas for the full per-agent setup (deploy + register +
 * authorize-multicall) so the owner can fund precisely. Read-only.
 */
export async function estimateAgentSetupGas(
	clients: Ensv2Clients,
	opts: {
		name: string
		policy: AgentPolicy
		adminRoleBitmap: bigint
		agentLabel: string
		parentRegistry: Address
		agentKey: Address
		salt?: bigint
	},
): Promise<{ deploy: bigint; register: bigint; authorize: bigint; total: bigint }> {
	const calls = [
		encodeSetText(opts.name, TEXT_KEYS.policy, JSON.stringify(opts.policy)),
		encodeSetText(opts.name, TEXT_KEYS.version, String(opts.policy.version)),
	]
	const initData = encodeResolverInit(
		[{ account: clients.account, roleBitmap: opts.adminRoleBitmap }],
		calls,
	)
	// Predict the proxy address to estimate the later steps against it.
	const { result: proxy } = await clients.public.simulateContract({
		address: ENSV2_SEPOLIA.verifiableFactory,
		abi: FACTORY_ABI,
		functionName: 'deployProxy',
		args: [ENSV2_SEPOLIA.permissionedResolverImpl, opts.salt ?? 0n, initData],
		account: clients.account,
	})
	const expiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 86400)
	const grantCalls = AGENT_WRITABLE_KEYS.map((key) =>
		encodeGrantSetterRoles(opts.name, key, opts.agentKey),
	)
	const [deploy, register, authorize] = await Promise.all([
		clients.public.estimateContractGas({
			address: ENSV2_SEPOLIA.verifiableFactory,
			abi: FACTORY_ABI,
			functionName: 'deployProxy',
			args: [ENSV2_SEPOLIA.permissionedResolverImpl, opts.salt ?? 0n, initData],
			account: clients.account,
		}),
		clients.public.estimateContractGas({
			address: opts.parentRegistry,
			abi: PARENT_REGISTRY_ABI,
			functionName: 'register',
			args: [
				opts.agentLabel,
				clients.account,
				'0x0000000000000000000000000000000000000000',
				proxy,
				0n,
				expiry,
			],
			account: clients.account,
		}),
		clients.public.estimateContractGas({
			address: proxy,
			abi: RESOLVER_ADMIN_ABI,
			functionName: 'multicall',
			args: [grantCalls],
			account: clients.account,
		}),
	])
	return { deploy, register, authorize, total: deploy + register + authorize }
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
