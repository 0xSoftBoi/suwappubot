/**
 * Intercepta screening client (Web3 Antivirus / W3A API).
 *
 * Docs: https://docs.web3antivirus.io
 * Key: sandbox key issued at the Intercepta booth / W3A dashboard.
 * Set INTERCEPTA_API_KEY.
 *
 * Verified against the public W3A API reference on 2026-09-25:
 *  - Base URL: https://api.web3antivirus.io
 *  - Auth: `X-API-KEY: <key>` header on every request
 *  - Address : GET /api/public/v2/extension/account/{address}/quick-scan
 *              → { toxicScore, traits: [{ risk, name, txsCount, description }] }
 *  - Token   : GET /api/public/v2/extension/token-intelligence/token/{address}/risks?chainId=N
 *              → { riskScore, riskLevel, category, trust, action, detectors: [{code, description}] }
 *  - Tx      : POST /api/public/v1/extension/simulation/transaction?chainId=N
 *              body { from, to, value, data, gas, gasPrice, mode }
 *              → { detectors: [{code, description}], assetsMovement, transactionType }
 *
 * The normalizers below are defensive on purpose: if the API shape differs
 * from what the reference documents, the screen fails CLOSED (treated as
 * suspicious → require_approval) rather than silently passing. Unknown
 * shapes must never mean "safe".
 */

export interface InterceptaConfig {
	apiKey: string
	baseUrl: string
	timeoutMs: number
}

export function loadInterceptaConfig(env: NodeJS.ProcessEnv = process.env): InterceptaConfig {
	const apiKey = env['INTERCEPTA_API_KEY']
	if (!apiKey) {
		throw new Error('Intercepta not configured — set INTERCEPTA_API_KEY (sandbox key from the Intercepta booth / W3A dashboard)')
	}
	return {
		apiKey,
		baseUrl: (env['INTERCEPTA_BASE_URL'] ?? 'https://api.web3antivirus.io').replace(/\/$/, ''),
		timeoutMs: Number(env['INTERCEPTA_TIMEOUT_MS'] ?? 8000),
	}
}

export function isInterceptaConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
	return Boolean(env['INTERCEPTA_API_KEY'])
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface RiskFinding {
	/** Machine-readable, e.g. "known_scammer", "HONEYPOT", "WALLET_DRAINER". */
	code: string
	risk: RiskLevel
	/** Human-readable, shown to the user in the blocked/held message. */
	description: string
}

export interface ScanResult {
	target: string
	verdict: 'safe' | 'suspicious' | 'malicious'
	riskScore: number // 0-100
	findings: RiskFinding[]
	/** Raw upstream payload for debugging — never shown to end users. */
	raw?: unknown
}

async function request<T>(cfg: InterceptaConfig, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
	const ctrl = new AbortController()
	const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
	try {
		const res = await fetch(`${cfg.baseUrl}${path}`, {
			method,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'X-API-KEY': cfg.apiKey,
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: ctrl.signal,
		})
		if (!res.ok) {
			throw new Error(`intercepta ${method} ${path} → http ${res.status}`)
		}
		return (await res.json()) as T
	} finally {
		clearTimeout(t)
	}
}

/** Map a friendly chain alias (or numeric id) to the W3A chainId query value. */
const CHAIN_ALIASES: Record<string, string> = {
	'1': '1',
	ethereum: '1',
	mainnet: '1',
	'56': '56',
	bsc: '56',
	bnb: '56',
	'8453': '8453',
	base: '8453',
	'42161': '42161',
	arbitrum: '42161',
	'10': '10',
	optimism: '10',
	'137': '137',
	polygon: '137',
	solana: 'solana',
}

export function resolveChainId(chain: string | undefined): string {
	const c = (chain ?? '1').trim().toLowerCase()
	if (CHAIN_ALIASES[c]) return CHAIN_ALIASES[c]!
	if (/^\d+$/.test(c)) return c // numeric ids the reference lists (e.g. 130, 146, 480…) pass through
	throw new Error(`intercepta: unsupported chain "${chain}" — no W3A chainId mapping`)
}

function numericRisk(risk: unknown): RiskLevel {
	const r = typeof risk === 'number' ? risk : 50
	if (r >= 75) return 'CRITICAL'
	if (r >= 50) return 'HIGH'
	if (r >= 25) return 'MEDIUM'
	return 'LOW'
}

function unrecognized(target: string, payload: unknown, endpoint: string): ScanResult {
	return {
		target,
		verdict: 'suspicious',
		riskScore: 50,
		findings: [
			{
				code: 'unrecognized_payload',
				risk: 'MEDIUM',
				description: `Intercepta ${endpoint} returned an unrecognized payload shape — treated as suspicious`,
			},
		],
		raw: payload,
	}
}

/** Screen a counterparty / payTo address (pre-sign). Accepts a raw address or ENS name. */
export async function scanAddress(cfg: InterceptaConfig, address: string, _chain?: string): Promise<ScanResult> {
	const payload = (await request(cfg, 'GET', `/api/public/v2/extension/account/${address}/quick-scan`)) as any
	if (typeof payload?.toxicScore !== 'number' && !Array.isArray(payload?.traits)) {
		return unrecognized(address, payload, 'quick-scan')
	}
	const toxicScore: number = typeof payload.toxicScore === 'number' ? payload.toxicScore : 50
	const traits: Array<{ risk?: unknown; name?: unknown; txsCount?: unknown; description?: unknown }> =
		Array.isArray(payload.traits) ? payload.traits : []
	const MALICIOUS_TRAITS = new Set([
		'known_scammer',
		'sanction_address_communication',
		'blacklist',
		'rug_pull',
		'attack_money_target',
	])
	const traitNames = traits.map((t) => String(t?.name ?? '').toLowerCase())
	const hasMaliciousTrait = traitNames.some((n) => MALICIOUS_TRAITS.has(n))
	const verdict: ScanResult['verdict'] =
		toxicScore >= 70 || hasMaliciousTrait ? 'malicious' : toxicScore >= 35 || traits.length > 0 ? 'suspicious' : 'safe'
	const findings: RiskFinding[] = traits.map((t) => ({
		code: String(t?.name ?? 'unknown_trait'),
		risk: numericRisk(t?.risk),
		description: `${String(t?.description ?? t?.name ?? 'flagged trait')} (${Number(t?.txsCount ?? 0)} related txs)`,
	}))
	return { target: address, verdict, riskScore: toxicScore, findings, raw: payload }
}

function tokenDetectorRisk(code: string): RiskLevel {
	const c = code.toUpperCase()
	if (/KNOWN_MALICIOUS|RUG_PULL|HONEYPOT|SANCTIONED|BLOCKLIST|FAKE_TOKEN|UNSELLABLE/.test(c)) return 'CRITICAL'
	if (/HIGH_|SCAM_|CONCENTRATED|INSUFFICIENT_LOCKED|SUSPICIOUS_DEPLOYER/.test(c)) return 'HIGH'
	if (/HIGH_REPUTATION/.test(c)) return 'LOW'
	return 'MEDIUM'
}

/** Screen a token contract before quoting/swapping it. */
export async function scanToken(cfg: InterceptaConfig, tokenAddress: string, chain?: string): Promise<ScanResult> {
	const chainId = resolveChainId(chain)
	const payload = (await request(
		cfg,
		'GET',
		`/api/public/v2/extension/token-intelligence/token/${tokenAddress}/risks?chainId=${chainId}`,
	)) as any
	if (typeof payload?.riskScore !== 'number' && !Array.isArray(payload?.detectors)) {
		return unrecognized(tokenAddress, payload, 'token risks')
	}
	const riskScore: number = typeof payload.riskScore === 'number' ? payload.riskScore : 50
	const category = String(payload?.category ?? '').toLowerCase()
	const action = String(payload?.action ?? '').toLowerCase()
	const riskLevel = String(payload?.riskLevel ?? '').toLowerCase()
	let verdict: ScanResult['verdict']
	if (category === 'malicious' || category === 'sanctioned' || action === 'block') {
		verdict = 'malicious'
	} else if (
		category === 'suspicious' ||
		category === 'restricted' ||
		action === 'warn' ||
		riskLevel === 'high' ||
		riskScore >= 70
	) {
		verdict = 'suspicious'
	} else {
		verdict = 'safe'
	}
	if (verdict !== 'malicious' && riskScore >= 90) verdict = 'malicious'
	const detectors: Array<{ code?: unknown; description?: unknown }> = Array.isArray(payload.detectors)
		? payload.detectors
		: []
	const findings: RiskFinding[] = detectors.map((d) => {
		const code = String(d?.code ?? 'unknown_detector')
		return {
			code,
			risk: tokenDetectorRisk(code),
			description: String(d?.description ?? code),
		}
	})
	return { target: tokenAddress, verdict, riskScore, findings, raw: payload }
}

function txDetectorRisk(code: string): RiskLevel {
	const c = code.toUpperCase()
	if (
		[
			'WALLET_DRAINER',
			'WALLET_DRAINER_APPROVE',
			'MALICIOUS_ADDRESS',
			'SCAM_ADDRESS',
			'RUG_PULL',
			'PHISH_HACK',
			'MALICIOUS_TRANSFER',
			'SUBSEQUENT_DRAINING_RISK',
			'FAKE_MEV_BOT_DEPLOYMENT_CONTRACT',
			'FAKE_ENS',
			'SCAM_TOKEN',
			'POISONING_ATTACK',
			'TRANSFER_TO_POISONING_ADDRESS',
			'BLOCKLIST_SITE',
		].includes(c)
	) {
		return 'CRITICAL'
	}
	if (
		c.startsWith('HONEYPOT') ||
		[
			'SUSPICIOUS_APPROVE',
			'SUSPICIOUS_DEPLOYER',
			'SUSPICIOUS_DOMAIN',
			'APPROVE_RESTRICTION',
			'IMPOSSIBLE_APPROVE',
			'OWNER_APPROVE',
			'SCAM_ENS_NAME',
			'SCAM_AIRDROP',
			'SCAM_NAME',
			'NEWLY_CREATED_WEBSITE',
			'SUSPICIOUS_LISTING',
			'TRANSFER_RESTRICTION',
			'OWNER_PERMISSIONS',
			'METAMORPHIC_CONTRACT',
			'BIG_ETH_TRANSFER',
		].includes(c)
	) {
		return 'HIGH'
	}
	return 'MEDIUM'
}

export interface UnsignedTx {
	/** Transaction initiator — required by the W3A simulation endpoint. */
	from: string
	to: string
	data?: string
	value?: string
	gas?: string
	gasPrice?: string
	chain: string
}

/** Screen the exact unsigned transaction (pre-sign). Uses short simulation mode. */
export async function scanTransaction(cfg: InterceptaConfig, tx: UnsignedTx): Promise<ScanResult> {
	if (!tx.from) {
		// Fail closed: a simulation without the initiator is meaningless —
		// balance/allowance checks would run against the wrong account.
		throw new Error('scanTransaction: tx.from (transaction initiator) is required')
	}
	const chainId = resolveChainId(tx.chain)
	const payload = (await request(cfg, 'POST', `/api/public/v1/extension/simulation/transaction?chainId=${chainId}`, {
		from: tx.from,
		to: tx.to,
		value: tx.value,
		data: tx.data,
		gas: tx.gas,
		gasPrice: tx.gasPrice,
		mode: 'short',
	})) as any
	if (!Array.isArray(payload?.detectors)) {
		return unrecognized(tx.to, payload, 'transaction simulation')
	}
	const detectors: Array<{ code?: unknown; description?: unknown }> = payload.detectors
	const findings: RiskFinding[] = detectors.map((d) => {
		const code = String(d?.code ?? 'unknown_detector')
		return {
			code,
			risk: txDetectorRisk(code),
			description: String(d?.description ?? code),
		}
	})
	const hasCritical = findings.some((f) => f.risk === 'CRITICAL')
	const hasHigh = findings.some((f) => f.risk === 'HIGH')
	const hasMedium = findings.some((f) => f.risk === 'MEDIUM')
	const riskScore = hasCritical ? 85 : hasHigh ? 60 : hasMedium ? 40 : findings.length > 0 ? 25 : 5
	const verdict: ScanResult['verdict'] = hasCritical ? 'malicious' : findings.length > 0 ? 'suspicious' : 'safe'
	return { target: tx.to, verdict, riskScore, findings, raw: payload }
}
