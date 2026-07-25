import { describe, expect, it } from 'bun:test'
import path from 'path'

/**
 * Regression coverage for resolveTrustedClientIp's cf-connecting-ip anti-spoofing
 * gate (not covered by ipRateLimit.test.ts, which only exercises resolveClientIp).
 *
 * cf-connecting-ip is trivially forgeable by any direct-to-origin caller. It must
 * only be trusted when CF_PROVENANCE_SECRET is configured AND the request also
 * presents a matching cf-provenance header (proof it actually transited the
 * configured Cloudflare edge). This property is what protects the starter-credit
 * anti-farm cap (AgentService.registerAgent) and the IP rate limiter from an
 * attacker simply setting cf-connecting-ip to a fresh value on every request.
 *
 * IMPORTANT: resolveTrustedClientIp reads CF_PROVENANCE_SECRET from process.env
 * into a MODULE-SCOPE constant computed once at first import. Whichever test file
 * in the suite imports ipRateLimit.ts FIRST freezes that constant for the rest of
 * the bun test process — verified empirically: an in-process version of this test
 * (mutating process.env.CF_PROVENANCE_SECRET around a dynamic `await import()`)
 * passed in isolation but failed when the full suite ran, because another test
 * file had already imported the module with the secret unset. Every scenario here
 * therefore runs resolveTrustedClientIp in a brand-new `bun -e` child process with
 * an explicit env, so the module is loaded fresh every time and results cannot
 * depend on suite ordering.
 */

const IP_RATE_LIMIT_PATH = path.join(__dirname, '..', 'middleware', 'ipRateLimit.ts')

/** Runs resolveTrustedClientIp in a brand-new bun process with the given env. */
function resolveInChildProcess(args: {
	cfIp?: string
	forwarded?: string
	provenanceHeader?: string
	cfProvenanceSecret?: string
}): string {
	const script = `
		import { resolveTrustedClientIp } from ${JSON.stringify(IP_RATE_LIMIT_PATH)};
		const result = resolveTrustedClientIp(
			${JSON.stringify(args.cfIp)},
			${JSON.stringify(args.forwarded)},
			undefined,
			1,
			${JSON.stringify(args.provenanceHeader)},
		);
		console.log(result);
	`
	const env: Record<string, string> = {}
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined) env[k] = v
	}
	if (args.cfProvenanceSecret === undefined) {
		delete env.CF_PROVENANCE_SECRET
	} else {
		env.CF_PROVENANCE_SECRET = args.cfProvenanceSecret
	}

	const result = Bun.spawnSync(['bun', '-e', script], { env })
	if (result.exitCode !== 0) {
		throw new Error(`child process failed: ${result.stderr.toString()}`)
	}
	return result.stdout.toString().trim()
}

describe('resolveTrustedClientIp (cf-connecting-ip anti-spoofing gate)', () => {
	const SECRET = 'test-cf-provenance-secret'

	it('ignores cf-connecting-ip with no provenance header, even though a secret is configured', () => {
		const result = resolveInChildProcess({
			cfIp: '203.0.113.99', // attacker-forged cf-connecting-ip
			forwarded: '198.51.100.9', // proxy-appended real client via XFF
			provenanceHeader: undefined, // no cf-provenance header presented
			cfProvenanceSecret: SECRET,
		})

		expect(result).not.toBe('203.0.113.99')
		expect(result).toBe('198.51.100.9')
	})

	it('ignores cf-connecting-ip when the provenance header is present but wrong', () => {
		const result = resolveInChildProcess({
			cfIp: '203.0.113.99',
			forwarded: '198.51.100.9',
			provenanceHeader: 'not-the-real-secret',
			cfProvenanceSecret: SECRET,
		})

		expect(result).not.toBe('203.0.113.99')
		expect(result).toBe('198.51.100.9')
	})

	it('honors cf-connecting-ip only when the provenance header matches the configured secret', () => {
		const result = resolveInChildProcess({
			cfIp: '203.0.113.99', // now legitimately from the trusted Cloudflare edge
			forwarded: '198.51.100.9', // an XFF value that must be ignored in favor of the cf ip
			provenanceHeader: SECRET,
			cfProvenanceSecret: SECRET,
		})

		expect(result).toBe('203.0.113.99')
	})

	it('falls back to XFF/socket when cf-connecting-ip is absent even with valid provenance', () => {
		const result = resolveInChildProcess({
			cfIp: undefined,
			forwarded: '198.51.100.9',
			provenanceHeader: SECRET,
			cfProvenanceSecret: SECRET,
		})

		expect(result).toBe('198.51.100.9')
	})
})

describe('resolveTrustedClientIp with CF_PROVENANCE_SECRET unset (deployment default)', () => {
	it('ignores cf-connecting-ip entirely, even with a matching-looking provenance header, when no secret is configured', () => {
		const result = resolveInChildProcess({
			cfIp: '203.0.113.99',
			forwarded: '198.51.100.9',
			provenanceHeader: 'anything',
			cfProvenanceSecret: undefined,
		})

		expect(result).toBe('198.51.100.9')
	})

	it('still ignores cf-connecting-ip when the provenance header happens to equal a value that WOULD be a valid secret elsewhere', () => {
		// Proves the gate checks "is a secret configured at all", not just
		// "does the header look secret-shaped" — if the falsy-secret check were
		// buggy (e.g. comparing against '' instead of requiring CF_PROVENANCE_SECRET
		// to be truthy), this specific header value could slip through.
		const result = resolveInChildProcess({
			cfIp: '203.0.113.99',
			forwarded: '198.51.100.9',
			provenanceHeader: 'test-cf-provenance-secret',
			cfProvenanceSecret: undefined,
		})

		expect(result).not.toBe('203.0.113.99')
		expect(result).toBe('198.51.100.9')
	})
})
