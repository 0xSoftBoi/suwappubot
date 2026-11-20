/**
 * ENSv2 subname minting for the Suwappu "Agent Swap Passport" identity anchor
 * (ETHGlobal Tokyo 2026, see docs/plans/ethglobal-tokyo2026-agent-passport.md
 * Phase 3).
 *
 * Mints `<label>.suwappu-agents.eth` on Sepolia via `PermissionedRegistry.register()`:
 *
 *   register(string label, address owner, IRegistry registry, address resolver,
 *            uint256 roleBitmap, uint64 expiry)
 *
 * Two important, easy-to-get-wrong facts confirmed against the live Sepolia
 * deployment (not re-derived from docs — see Phase 0/3 of the plan doc):
 *
 * 1. `expiry` is an ABSOLUTE unix timestamp, not a relative duration (differs
 *    from the ETHRegistrar's commit-reveal `register()`).
 * 2. `register()` must be called on the SUBREGISTRY of `suwappu-agents.eth`
 *    (a dedicated PermissionedRegistry instance), not on the root `.eth`
 *    registry (`0x657eA849311d3D5823348ddEd7C2AaAFb3EDE09E`). Calling it on
 *    the root registry would mint `<label>.eth` as a sibling of
 *    `suwappu-agents.eth`, not a child of it. Confirmed empirically on Sepolia:
 *    `getSubregistry("suwappu-agents")` on the root registry currently returns
 *    the zero address, so the subregistry must be deployed and wired via
 *    `setSubregistry(tokenId, subregistryAddr)` on the root registry BEFORE
 *    this client can mint anything — see
 *    `ENS_SUWAPPU_AGENTS_SUBREGISTRY` in EnvService. Until that env var is
 *    set, `mintAgentSubname` fails closed (returns `{ minted: false }`)
 *    rather than minting against the wrong registry.
 *
 * Fails closed everywhere: missing config, missing subregistry, or any RPC/tx
 * error returns `{ minted: false, error }` — this is a nice-to-have identity
 * anchor, never a gate on the agent claim flow.
 */

import { createPublicClient, createWalletClient, http, isAddress, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

export interface EnsSubnameConfig {
	rpcUrl: string
	minterPrivateKey?: string
	subregistryAddress?: string
	resolverAddress: string
	/** Parent name subnames are minted under, for display/logging only. */
	parentName?: string
}

export interface EnsSubnameResult {
	minted: boolean
	ensName?: string
	txHash?: string
	error?: string
}

// PermissionedRegistry role bits, confirmed against the live Sepolia contract
// (Phase 0 of the plan doc). Granting all four to the label owner keeps the
// mint self-contained — the agent doesn't need to come back to the minter
// wallet later to adjust its own subname's resolver/subregistry.
const ROLE_REGISTRAR = 1n << 0n
const ROLE_SET_SUBREGISTRY = 1n << 20n
const ROLE_SET_RESOLVER = 1n << 24n
const ROLE_SET_PARENT = 1n << 8n
const DEFAULT_ROLE_BITMAP = ROLE_REGISTRAR | ROLE_SET_SUBREGISTRY | ROLE_SET_RESOLVER | ROLE_SET_PARENT

// One year from mint time, as an absolute unix timestamp (register()'s
// `expiry` is absolute — NOT a duration, unlike the ETHRegistrar's register()).
const DEFAULT_EXPIRY_SECONDS = 365 * 24 * 60 * 60

const registryAbi = [
	{
		name: 'register',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'label', type: 'string' },
			{ name: 'owner', type: 'address' },
			{ name: 'registry', type: 'address' },
			{ name: 'resolver', type: 'address' },
			{ name: 'roleBitmap', type: 'uint256' },
			{ name: 'expiry', type: 'uint64' },
		],
		outputs: [{ type: 'uint256' }],
	},
] as const

/**
 * Mint `<label>.suwappu-agents.eth` for `ownerAddress`. `label` should
 * already be sanitized (e.g. an agent UUID prefix) — this function does not
 * further slugify it, but does reject anything that isn't
 * lowercase-alnum/hyphen to avoid ENS-normalization mismatches.
 */
export async function mintAgentSubname(
	config: EnsSubnameConfig,
	label: string,
	ownerAddress: string,
): Promise<EnsSubnameResult> {
	if (!/^[a-z0-9-]{1,63}$/.test(label)) {
		return { minted: false, error: 'ens_invalid_label' }
	}
	if (!isAddress(ownerAddress)) {
		return { minted: false, error: 'ens_invalid_owner_address' }
	}
	if (!config.minterPrivateKey) {
		return { minted: false, error: 'ens_minter_key_not_configured' }
	}
	if (!config.subregistryAddress || !isAddress(config.subregistryAddress)) {
		// See module docstring: the subregistry for suwappu-agents.eth must be
		// deployed + wired via setSubregistry() before minting can work at all.
		return { minted: false, error: 'ens_subregistry_not_configured' }
	}
	if (!isAddress(config.resolverAddress)) {
		return { minted: false, error: 'ens_invalid_resolver_address' }
	}

	let privateKey = config.minterPrivateKey.trim()
	if (!privateKey.startsWith('0x')) privateKey = `0x${privateKey}`

	try {
		const account = privateKeyToAccount(privateKey as Hex)
		const transport = http(config.rpcUrl)
		const publicClient = createPublicClient({ chain: sepolia, transport })
		const walletClient = createWalletClient({ account, chain: sepolia, transport })

		const expiry = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_EXPIRY_SECONDS)

		const { request } = await publicClient.simulateContract({
			address: config.subregistryAddress as Hex,
			abi: registryAbi,
			functionName: 'register',
			args: [
				label,
				ownerAddress as Hex,
				// No further nesting under the agent's own subname (no grandchildren) —
				// zero address means "no subregistry", matching ENSv2 leaf-name convention.
				'0x0000000000000000000000000000000000000000' as Hex,
				config.resolverAddress as Hex,
				DEFAULT_ROLE_BITMAP,
				expiry,
			],
			account,
		})

		const txHash = await walletClient.writeContract(request)
		await publicClient.waitForTransactionReceipt({ hash: txHash })

		const parentName = config.parentName || 'suwappu-agents.eth'
		return { minted: true, ensName: `${label}.${parentName}`, txHash }
	} catch (e) {
		return {
			minted: false,
			error: e instanceof Error ? `ens_mint_error: ${e.message}` : 'ens_mint_error',
		}
	}
}
