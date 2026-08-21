#!/usr/bin/env node
/**
 * Smoke test for the stdio proxy.
 *
 * Runs the built binary against a LOCAL mock of the hosted /mcp endpoint
 * rather than the real API. A publish must not fail because of a network
 * blip, and mocking lets us assert the things that actually break:
 *
 *   1. The binary starts at all (a duplicated shebang once made dist/index.js
 *      a SyntaxError — see PR #735).
 *   2. tools/list is forwarded and returned verbatim, so this package can
 *      never drift back into carrying its own catalogue.
 *   3. tools/call forwards the tool name, the arguments, AND the Bearer token.
 *   4. A missing SUWAPPU_API_KEY stays unauthenticated instead of being blocked
 *      locally, so hosted public tools remain usable and hosted MCP owns auth.
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js')

const MOCK_TOOLS = [
	{ name: 'get_quote', description: 'q', inputSchema: { type: 'object', properties: {} } },
	{ name: 'list_chains', description: 'c', inputSchema: { type: 'object', properties: {} } },
]

let lastCall = null

const mock = http.createServer((req, res) => {
	let body = ''
	req.on('data', (d) => (body += d))
	req.on('end', () => {
		const rpc = JSON.parse(body)
		if (rpc.method === 'tools/call') {
			lastCall = { params: rpc.params, auth: req.headers.authorization }
		}
		const result =
			rpc.method === 'tools/list'
				? { tools: MOCK_TOOLS }
				: { content: [{ type: 'text', text: 'mock-ok' }] }
		res.setHeader('content-type', 'application/json')
		res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
	})
})

await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const apiUrl = `http://127.0.0.1:${mock.address().port}`

/** Drive the binary over stdio with the given requests; resolve parsed responses. */
function run(requests, env = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [BIN], {
			env: { ...process.env, SUWAPPU_API_URL: apiUrl, ...env },
			stdio: ['pipe', 'pipe', 'pipe'],
		})
		let out = ''
		let err = ''
		child.stdout.on('data', (d) => (out += d))
		child.stderr.on('data', (d) => (err += d))
		child.on('error', reject)
		child.on('close', () => {
			const msgs = out
				.split('\n')
				.filter(Boolean)
				.map((l) => {
					try {
						return JSON.parse(l)
					} catch {
						return null
					}
				})
				.filter(Boolean)
			resolve({ msgs, err })
		})
		for (const r of requests) child.stdin.write(JSON.stringify(r) + '\n')
		child.stdin.end()
		setTimeout(() => child.kill(), 20000).unref?.()
	})
}

const INIT = {
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: {
		protocolVersion: '2024-11-05',
		capabilities: {},
		clientInfo: { name: 'smoke', version: '1' },
	},
}

function assert(cond, msg) {
	if (!cond) {
		console.error(`✗ ${msg}`)
		process.exitCode = 1
		mock.close()
		process.exit(1)
	}
	console.log(`✓ ${msg}`)
}

// 1 + 2: starts, initializes, forwards tools/list verbatim.
{
	const { msgs } = await run(
		[INIT, { jsonrpc: '2.0', id: 2, method: 'tools/list' }],
		{ SUWAPPU_API_KEY: 'test_key' },
	)
	const init = msgs.find((m) => m.result?.serverInfo)
	assert(init, 'binary starts and answers initialize')
	const list = msgs.find((m) => m.result?.tools)
	assert(list, 'tools/list returns a result')
	assert(
		JSON.stringify(list.result.tools) === JSON.stringify(MOCK_TOOLS),
		'tools/list is forwarded verbatim (no local catalogue)',
	)
}

// 3: tool name, arguments and Bearer token all reach the upstream endpoint.
{
	lastCall = null
	const { msgs } = await run(
		[
			INIT,
			{
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'get_quote', arguments: { from_token: 'ETH' } },
			},
		],
		{ SUWAPPU_API_KEY: 'test_key' },
	)
	assert(lastCall?.params?.name === 'get_quote', 'tools/call forwards the tool name')
	assert(
		lastCall?.params?.arguments?.from_token === 'ETH',
		'tools/call forwards the arguments',
	)
	assert(lastCall?.auth === 'Bearer test_key', 'tools/call forwards the Bearer token')
	assert(
		msgs.some((m) => JSON.stringify(m.result ?? '').includes('mock-ok')),
		'tools/call returns the upstream result',
	)
}

// 4: no key -> public calls still reach hosted MCP without an Authorization header.
{
	lastCall = null
	const { msgs } = await run(
		[INIT, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_chains', arguments: {} } }],
		{ SUWAPPU_API_KEY: '' },
	)
	assert(
		lastCall?.params?.name === 'list_chains' && lastCall?.auth === undefined,
		'missing API key forwards public tools without Authorization',
	)
	assert(
		msgs.some((m) => JSON.stringify(m.result ?? '').includes('mock-ok')),
		'public tool result is returned without a local auth gate',
	)
}

mock.close()
console.log('\nAll proxy smoke checks passed.')
