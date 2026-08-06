#!/usr/bin/env node
/**
 * Suwappu MCP Server — a stdio bridge to the hosted Suwappu MCP endpoint.
 *
 * This package deliberately contains NO tool definitions. It forwards
 * `tools/list` and `tools/call` to `${SUWAPPU_API_URL}/mcp` and returns what
 * that endpoint says.
 *
 * Why: this package used to carry its own hand-written catalogue of 11 tools
 * while the hosted endpoint served 22 — different names, different arguments,
 * and none of the perps/predictions/lending surface. Two hand-maintained
 * catalogues diverge; that is not a discipline problem, it is a structural one.
 * With zero local definitions the divergence cannot happen, and new tools reach
 * `npx @suwappu/mcp-server` users without republishing this package.
 *
 * This is the same pattern as mcp-remote / mcp-proxy / fastmcp-remote: stdio-only
 * clients (Claude Desktop, Cursor, Windsurf) need a bridge to reach HTTP servers.
 *
 * Configuration:
 *   SUWAPPU_API_KEY  - Suwappu agent API key. Needed to CALL tools; listing
 *                      them works without it, so we do not demand it at startup.
 *   SUWAPPU_API_URL  - API base URL (default: https://api.suwappu.bot)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { getAuthConfig } from './auth.js'

const VERSION = '0.6.0'

const auth = getAuthConfig()
const endpoint = `${auth.apiUrl.replace(/\/+$/, '')}/mcp`

const server = new Server(
	{ name: 'suwappu', version: VERSION },
	{ capabilities: { tools: {} } },
)

interface JsonRpcResponse {
	result?: unknown
	error?: { code: number; message: string; data?: unknown }
}

let nextId = 1

/**
 * Forward a JSON-RPC call to the hosted endpoint.
 *
 * The Authorization header is only attached when a key is configured, so
 * `tools/list` still works for an unconfigured user (the hosted endpoint
 * deliberately leaves listing open for registry validators).
 */
async function forward(method: string, params?: unknown): Promise<unknown> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Accept: 'application/json, text/event-stream',
		'User-Agent': `suwappu-mcp-server/${VERSION}`,
	}
	if (auth.apiKey) headers.Authorization = `Bearer ${auth.apiKey}`

	let res: Response
	try {
		res = await fetch(endpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
		})
	} catch (cause) {
		// Network-level failure: the endpoint is unreachable, not erroring.
		throw new Error(
			`Cannot reach the Suwappu API at ${endpoint}: ${(cause as Error).message}`,
		)
	}

	const text = await res.text()
	let body: JsonRpcResponse
	try {
		body = JSON.parse(text) as JsonRpcResponse
	} catch {
		throw new Error(
			`Suwappu API returned a non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`,
		)
	}

	if (body.error) {
		// Surface the server's message verbatim — it is written for agents and
		// already explains how to fix auth/validation problems.
		throw new Error(body.error.message)
	}
	return body.result
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
	const result = (await forward('tools/list')) as { tools?: unknown[] }
	return { tools: result?.tools ?? [] }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	if (!auth.apiKey) {
		return {
			content: [
				{
					type: 'text' as const,
					text:
						'SUWAPPU_API_KEY is not set. Calling tools requires an agent API key.\n' +
						'Get one at: curl -X POST https://api.suwappu.bot/v1/agent/register ' +
						'-H "Content-Type: application/json" -d \'{"name": "my-agent"}\'',
				},
			],
			isError: true as const,
		}
	}

	try {
		const result = await forward('tools/call', {
			name: request.params.name,
			arguments: request.params.arguments ?? {},
		})
		return result as { content: Array<{ type: 'text'; text: string }> }
	} catch (cause) {
		return {
			content: [{ type: 'text' as const, text: (cause as Error).message }],
			isError: true as const,
		}
	}
})

async function main(): Promise<void> {
	const transport = new StdioServerTransport()
	await server.connect(transport)
	// stdout is the protocol channel — every diagnostic must go to stderr.
	console.error(`Suwappu MCP server ${VERSION} (stdio) -> ${endpoint}`)
}

main().catch((cause) => {
	console.error(`Fatal: ${(cause as Error).message}`)
	process.exit(1)
})
