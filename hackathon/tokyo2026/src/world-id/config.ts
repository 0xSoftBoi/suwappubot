/**
 * World ID configuration, loaded from the environment.
 * Secrets are read here and never leave the server boundary.
 */

export interface WorldIdConfig {
	/** World app id, always `app_<hex>`. */
	appId: `app_${string}`
	rpId: string
	action: string
	/**
	 * World action for step-up re-verifications (Gate 5). MUST differ from
	 * `action`: World ID nullifiers are action-scoped (same human + same
	 * action = same nullifier), so a step-up verified against `action`
	 * would be rejected as a replay of the Gate 1 proof. The step-up is a
	 * distinct authorization and gets its own nullifier namespace.
	 */
	stepUpAction: string
	environment: 'production' | 'staging'
	/** RP signing key — server-only. Never expose, log, or send to a client. */
	signingKeyHex: string
	/** How long a verified approval satisfies step-up (ms). Default 15 min. */
	approvalTtlMs: number
}

export function loadWorldIdConfig(env: NodeJS.ProcessEnv = process.env): WorldIdConfig {
	const appId = env['WORLD_APP_ID']
	const rpId = env['WORLD_RP_ID']
	const signingKeyHex = env['RP_SIGNING_KEY']
	const missing = [
		['WORLD_APP_ID', appId],
		['WORLD_RP_ID', rpId],
		['RP_SIGNING_KEY', signingKeyHex],
	].filter(([, v]) => !v)
	if (missing.length > 0) {
		throw new Error(
			`World ID not configured — missing: ${missing.map(([k]) => k).join(', ')}. ` +
				`See hackathon/tokyo2026/.env.example`,
		)
	}
	const environment = env['WORLD_ENV'] === 'staging' ? 'staging' : 'production'
	const action = env['WORLD_ACTION'] ?? 'suwappu-trade-approval'
	return {
		appId: appId as `app_${string}`,
		rpId: rpId as string,
		action,
		stepUpAction: env['WORLD_STEP_UP_ACTION'] ?? `${action}-stepup`,
		environment,
		signingKeyHex: signingKeyHex as string,
		approvalTtlMs: Number(env['WORLD_APPROVAL_TTL_MS'] ?? 15 * 60 * 1000),
	}
}

/** True when the module is operable (all secrets present). Demo should check this first. */
export function isWorldIdConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
	return Boolean(env['WORLD_APP_ID'] && env['WORLD_RP_ID'] && env['RP_SIGNING_KEY'])
}
