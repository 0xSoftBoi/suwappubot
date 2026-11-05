/**
 * Suwappu Arbiter (NEAR HACKATHON 2026) — demo routes for the attested
 * milestone escrow. Mounted at /hackathon/arbiter ONLY when HACKATHON_ARBITER=true.
 *
 *  GET  /status               — what this deployment can do (never throws)
 *  GET  /fixtures             — list recorded arbiter-wasm replays (public evidence)
 *  GET  /fixtures/:key        — one recorded replay (input + verdict)
 *  POST /verify-preview       — dry-run: echo the recorded verdict for a known evidence_hash,
 *                               or return "unknown_evidence" — never fabricates a verdict
 *
 * Deliberately NOT here: anything that spends, deploys, or calls near.ai. The demo's
 * settlement happens on the NEAR contract directly (near view / near call) so the
 * backend remains a passive evidence server, not a path to funds.
 */
import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { arbiterStatus } from '../hackathon/near2026'
import { ARBITER_FIXTURES, type ArbiterScenarioKey } from '../hackathon/near2026/fixtures'

export const arbiterRoutes = new Hono()

arbiterRoutes.get('/status', (c) => c.json(arbiterStatus()))

arbiterRoutes.get('/fixtures', (c) =>
	c.json({
		fixtures: Object.entries(ARBITER_FIXTURES).map(([key, f]) => ({
			key,
			context: f.input.context,
			repo: f.input.repo,
			pr_number: f.input.pr_number,
			verdict: f.output.verdict,
		})),
	}),
)

arbiterRoutes.get('/fixtures/:key', (c) => {
	const key = c.req.param('key') as ArbiterScenarioKey
	const f = ARBITER_FIXTURES[key]
	if (!f) return c.json({ error: 'unknown_fixture' }, 404)
	return c.json({ key, ...f })
})

arbiterRoutes.post('/verify-preview', async (c) => {
	let body: { evidence_hash?: string }
	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: 'bad_json' }, 400)
	}
	const evidence = (body.evidence_hash ?? '').toLowerCase()
	if (!/^[0-9a-f]{64}$/.test(evidence)) {
		return c.json({ error: 'evidence_hash must be 64 lowercase hex chars' }, 400)
	}
	for (const [key, f] of Object.entries(ARBITER_FIXTURES)) {
		if (f.output.evidence_hash === evidence) {
			return c.json({
				verdict: f.output.verdict,
				reason: f.output.reason,
				matchedFixture: key,
				source: 'recorded_replay',
			})
		}
	}
	return c.json({ verdict: 'unknown_evidence', source: 'recorded_replay' }, 404)
})

export const arbiterEvidenceHash = (payloadUtf8: string): string =>
	createHash('sha256').update(payloadUtf8).digest('hex')
