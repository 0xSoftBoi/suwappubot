/**
 * Intercepta screening client.
 *
 * Docs: https://intercepta.io/ethglobal (hackathon) / https://docs.web3antivirus.io (API).
 * Key: sandbox key issued by email after requesting at the hackathon page
 * (1,000 requests). Set INTERCEPTA_API_KEY.
 *
 * ⚠️ TODO(BOOTH): confirm the exact REST paths below against the quickstart /
 * booth before the demo. The module structure (typed findings → verdicts) is
 * stable regardless; only `PATHS` may need adjusting.
 */

export interface InterceptaConfig {
	apiKey: string
	baseUrl: string
	timeoutMs: number
}

export function loadInterceptaConfig(env: NodeJS.ProcessEnv = process.env): InterceptaConfig {
	const apiKey = env['INTERCEPTA_API_KEY']
	if (!apiKey) {
		throw new Error('Intercepta not configured — set INTERCEPTA_API_KEY (sandbox key from intercepta.io/ethglobal)')
	}
	return {
		apiKey,
		baseUrl: (env['INTERCEPTA_BASE_URL'] ?? 'https://api.intercepta.io').replace(/\/$/, ''),
		timeoutMs: Number(env['INTERCEPTA_TIMEOUT_MS'] ?? 8000),
	}
}

export function isInterceptaConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
	return Boolean(env['INTERCEPTA_API_KEY'])
}

/** TODO(BOOTH): confirm against quickstart. Names follow the docs' module names. */
const PATHS = {
	address: '/v1/scan/address',
	token: '/v1/scan/token',
	transaction: '/v1/scan/transaction',
} as const

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface RiskFinding {
	/** Machine-readable, e.g. "sanctioned_address", "honeypot", "mixer_interaction". */
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

async function post<T>(cfg: InterceptaConfig, path: string, body: unknown): Promise<T> {
	const ctrl = new AbortController()
	const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
	try {
		const res = await fetch(`${cfg.baseUrl}${path}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${cfg.apiKey}`,
				'X-API-Key': cfg.apiKey,
			},
			body: JSON.stringify(body),
			signal: ctrl.signal,
		})
		if (!res.ok) {
			throw new Error(`intercepta ${path} → http ${res.status}`)
		}
		return (await res.json()) as T
	} finally {
		clearTimeout(t)
	}
}

/**
 * Normalize the upstream payload into our ScanResult. The normalizer is
 * defensive on purpose: if the API shape differs from PATHS assumptions, the
 * screen fails CLOSED (treated as suspicious → require_approval) rather than
 * silently passing. Unknown shapes must never mean "safe".
 */
function normalize(target: string, payload: any): ScanResult {
	const riskScore = typeof payload?.risk_score === 'number' ? payload.risk_score : 50
	const verdictRaw = String(payload?.verdict ?? '').toLowerCase()
	const verdict: ScanResult['verdict'] =
		verdictRaw === 'safe' ? 'safe' : verdictRaw === 'malicious' ? 'malicious' : 'suspicious'
	const findings: RiskFinding[] = Array.isArray(payload?.findings)
		? payload.findings.map((f: any) => ({
				code: String(f?.code ?? 'unknown'),
				risk: (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).includes(f?.risk)
					? f.risk
					: 'MEDIUM',
				description: String(f?.description ?? f?.message ?? f?.code ?? 'flagged by Intercepta'),
			}))
		: verdict === 'safe'
			? []
			: [{ code: 'unrecognized_payload', risk: 'MEDIUM', description: 'Intercepta returned an unrecognized payload shape — treated as suspicious' }]
	return { target, verdict, riskScore, findings, raw: payload }
}

/** Screen a counterparty / payTo address (pre-sign). */
export async function scanAddress(cfg: InterceptaConfig, address: string, chain?: string): Promise<ScanResult> {
	const payload = await post(cfg, PATHS.address, { address, chain })
	return normalize(address, payload)
}

/** Screen a token contract before quoting/swapping it. */
export async function scanToken(cfg: InterceptaConfig, tokenAddress: string, chain?: string): Promise<ScanResult> {
	const payload = await post(cfg, PATHS.token, { token: tokenAddress, chain })
	return normalize(tokenAddress, payload)
}

/** Screen the exact unsigned transaction before POST /execute. */
export async function scanTransaction(
	cfg: InterceptaConfig,
	tx: { to: string; data?: string; value?: string; chain: string },
): Promise<ScanResult> {
	const payload = await post(cfg, PATHS.transaction, tx)
	return normalize(tx.to, payload)
}
