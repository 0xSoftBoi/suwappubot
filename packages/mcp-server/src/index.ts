#!/usr/bin/env node
/**
 * Suwappu MCP Server — stdio bridge to the hosted Suwappu MCP endpoint.
 *
 * The bridge owns no Suwappu tool/resource/prompt definitions. Discovery and
 * calls are forwarded to the hosted endpoint so there is only one catalog and
 * one auth policy to keep current.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
	CallToolRequestSchema,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { getAuthConfig } from './auth.js'

const VERSION = '0.6.0'

const auth = getAuthConfig()
const endpoint = `${auth.apiUrl.replace(/\/+$/, '')}/mcp`

const server = new Server(
	{ name: 'suwappu', version: VERSION },
	{
		capabilities: {
			tools: {},
			resources: {},
			prompts: {},
		},
	},
)

interface JsonRpcResponse {
	result?: unknown
	error?: { code: number; message: string; data?: unknown }
}

let nextId = 1

function decodeJsonRpcResponse(text: string, contentType: string): JsonRpcResponse {
	const candidates: string[] = []

	if (contentType.includes('text/event-stream')) {
		for (const block of text.split(/\r?\n\r?\n/)) {
			const data = block
				.split(/\r?\n/)
				.filter((line) => line.startsWith('data:'))
				.map((line) => line.slice(5).trimStart())
				.join('\n')
			if (data && data !== '[DONE]') candidates.push(data)
		}
	} else if (text) {
		candidates.push(text)
	}

	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate) as unknown
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as JsonRpcResponse
			}
		} catch {
			// Try the next SSE event before failing the response.
		}
	}

	throw new Error('Suwappu MCP returned no decodable JSON-RPC message')
}

/**
 * Forward a JSON-RPC request to the hosted endpoint.
 *
 * Authorization is attached only when configured. The hosted server remains
 * the source of truth for which discovery methods and tool calls are public;
 * the bridge deliberately does not duplicate that allowlist.
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
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: nextId++,
				method,
				...(params !== undefined ? { params } : {}),
			}),
		})
	} catch (cause) {
		throw new Error(
			`Cannot reach the Suwappu API at ${endpoint}: ${(cause as Error).message}`,
		)
	}

	const text = await res.text()
	let body: JsonRpcResponse
	try {
		body = decodeJsonRpcResponse(text, res.headers.get('content-type') ?? '')
	} catch (cause) {
		throw new Error(
			`Suwappu API returned an invalid MCP response (HTTP ${res.status}): ${(cause as Error).message}`,
		)
	}

	if (body.error) throw new Error(body.error.message)
	if (!res.ok) {
		throw new Error(`Suwappu MCP HTTP ${res.status}: ${text.slice(0, 200)}`)
	}
	if (body.result === undefined) {
		throw new Error(`Suwappu MCP method ${method} returned no result`)
	}
	return body.result
}

server.setRequestHandler(ListToolsRequestSchema, async (request) => {
	const result = (await forward('tools/list', request.params)) as {
		tools?: unknown[]
		nextCursor?: string
	}
	return {
		tools: result?.tools ?? [],
		...(result?.nextCursor ? { nextCursor: result.nextCursor } : {}),
	} as any
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	try {
		return (await forward('tools/call', {
			name: request.params.name,
			arguments: request.params.arguments ?? {},
		})) as any
	} catch (cause) {
		return {
			content: [{ type: 'text' as const, text: (cause as Error).message }],
			isError: true as const,
		}
	}
})

server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
	return (await forward('resources/list', request.params)) as any
})

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
	return (await forward('resources/read', request.params)) as any
})

server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
	return (await forward('prompts/list', request.params)) as any
})

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
	return (await forward('prompts/get', request.params)) as any
})

async function main(): Promise<void> {
	const transport = new StdioServerTransport()
	await server.connect(transport)
	// stdout is the MCP protocol channel — diagnostics belong on stderr.
	console.error(`Suwappu MCP server ${VERSION} (stdio) -> ${endpoint}`)
}

main().catch((cause) => {
	console.error(`Fatal: ${(cause as Error).message}`)
	process.exit(1)
})
