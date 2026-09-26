/**
 * AgentKit (World ID for Agents) — x402 integration.
 *
 * Two sides:
 * 1. Agent side: the agent's outbound x402 payments carry proof that a unique
 *    verified human delegated to this agent (via createAgentkitClient hooks).
 * 2. Seller side: Suwappu's x402 endpoints verify the `agentkit` extension
 *    header on incoming payments:
 *      parseAgentkitHeader → verifyAgentkitSignature → validateAgentkitMessage
 *      → createAgentBookVerifier().lookupHuman(address)
 *    Human-backed agents pass; others get 403 + registration instructions.
 *
 * Setup (venue, needs Orb):
 *   npx @worldcoin/agentkit-cli@0.2.0 register <AGENT_EOA>
 *   npx @worldcoin/agentkit-cli@0.2.0 status <AGENT_EOA>   # registered: true
 *
 * ⚠️ The CLI requests a v3-legacy proof; World IDs minted after ~2026-06-01
 * are v4-only. Register with a teammate's older World ID if needed.
 */
import {
	createAgentBookVerifier,
	createAgentkitClient,
	createAgentkitHooks,
	InMemoryAgentKitStorage,
	parseAgentkitHeader,
	validateAgentkitMessage,
	verifyAgentkitSignature,
	type AgentkitClient,
	type AgentkitSigner,
} from '@worldcoin/agentkit'

export interface AgentKitConfig {
	/** The agent EOA registered in AgentBook. Must equal the signing address. */
	agentAddress: `0x${string}`
	/** Our own endpoint base, e.g. https://api.suwappu.bot — the `uri` we expect. */
	expectedResourceUri: string
	rpcUrl?: string
	/** Nonce replay guard. Production: DB-backed; demo: in-memory. */
	storage?: { hasUsedNonce(nonce: string): Promise<boolean>; recordNonce(nonce: string): Promise<void> }
}

export function loadAgentKitConfig(env: NodeJS.ProcessEnv = process.env): AgentKitConfig | null {
	const agentAddress = env['AGENTKIT_AGENT_ADDRESS']
	const expectedResourceUri = env['AGENTKIT_RESOURCE_URI']
	if (!agentAddress || !agentAddress.startsWith('0x') || !expectedResourceUri) return null
	return { agentAddress: agentAddress as `0x${string}`, expectedResourceUri }
}

/**
 * Seller-side lookup: is this agent address registered in AgentBook, and to
 * which anonymous human? Always resolves against World Chain (480).
 */
export async function lookupAgentHuman(
	agentAddress: string,
	rpcUrl?: string,
): Promise<{ registered: boolean; humanId?: string }> {
	const verifier = createAgentBookVerifier(rpcUrl ? { rpcUrl } : undefined)
	const humanId = await verifier.lookupHuman(agentAddress)
	if (!humanId) return { registered: false }
	return { registered: true, humanId }
}

/** What the seller enforces on the `agentkit` extension header. */
export type AgentKitSellerDecision =
	| { allow: true; tier: 'human-backed'; agentAddress: string }
	| { allow: false; status: 403; instructions: string }

const REGISTRATION_INSTRUCTIONS =
	'This endpoint requires proof of unique-human backing. Register your agent ' +
	'with World ID for Agents: npx @worldcoin/agentkit-cli@0.2.0 register <agent-address>, ' +
	'then retry with the agentkit extension header.'

/**
 * Seller side: verify the agentkit header on an incoming x402 payment.
 * Intended insertion: X402Service.verify_payment (bot) — after sender binding,
 * before accepting the payment.
 */
export async function verifyAgentKitHeader(
	headerValue: string | null | undefined,
	cfg: AgentKitConfig,
): Promise<AgentKitSellerDecision> {
	if (!headerValue) {
		return { allow: false, status: 403, instructions: REGISTRATION_INSTRUCTIONS }
	}

	let payload: ReturnType<typeof parseAgentkitHeader>
	try {
		payload = parseAgentkitHeader(headerValue)
	} catch {
		return { allow: false, status: 403, instructions: 'Malformed agentkit header. ' + REGISTRATION_INSTRUCTIONS }
	}

	const sig = await verifyAgentkitSignature(payload)
	if (!sig.valid || !sig.address) {
		return { allow: false, status: 403, instructions: `Invalid agentkit signature: ${sig.error ?? 'unknown'}` }
	}

	const storage = cfg.storage ?? new InMemoryAgentKitStorage()
	const msg = await validateAgentkitMessage(payload, cfg.expectedResourceUri, {
		checkNonce: async (nonce) => !(await storage.hasUsedNonce(nonce)),
	})
	if (!msg.valid) {
		return { allow: false, status: 403, instructions: `Agentkit message invalid: ${msg.error ?? 'unknown'}` }
	}
	if (storage.recordNonce) {
		await storage.recordNonce(payload.nonce)
	}

	const reg = await lookupAgentHuman(sig.address, cfg.rpcUrl)
	if (!reg.registered) {
		return {
			allow: false,
			status: 403,
			instructions: `Agent ${sig.address} is not registered in AgentBook. ` + REGISTRATION_INSTRUCTIONS,
		}
	}
	return { allow: true, tier: 'human-backed', agentAddress: sig.address }
}

/**
 * Agent side: build the client whose fetch attaches the human-delegation
 * proof to outbound x402 payments. `client.fetch` is a drop-in replacement
 * for the fetch passed to the x402 client; `client.createHeader()` mints the
 * extension header for manual flows.
 *
 * The signer is the venue agent's key (EOA). Build it with viem:
 *   const account = privateKeyToAccount(pk)
 *   signer = { address: account.address, chainId: 'eip155:480',
 *              type: 'eip191', signMessage: (m) => account.signMessage({ message: m }) }
 */
export function createAgentClient(
	cfg: AgentKitConfig,
	signer: AgentkitSigner,
): AgentkitClient {
	return createAgentkitClient({
		signer,
		onEvent: (event) => {
			// Venue logging: which outbound calls carried the delegation proof.
			console.log(`[agentkit] ${event.type} → ${event.url}`)
		},
	})
}

/**
 * Seller side (alternative to manual verifyAgentKitHeader): framework hooks
 * for incoming requests. Mount `requestHook` in front of the x402 paywall —
 * it grants access to AgentBook-registered agents and surfaces
 * `agent_not_verified` / `validation_failed` events for logging.
 */
export function createSellerHooks(cfg: AgentKitConfig) {
	const agentBook = createAgentBookVerifier(cfg.rpcUrl ? { rpcUrl: cfg.rpcUrl } : undefined)
	const storage = new InMemoryAgentKitStorage()
	return createAgentkitHooks({
		agentBook,
		storage,
		onEvent: (event) => {
			console.log(`[agentkit-seller] ${event.type} resource=${event.resource}`)
		},
	})
}
