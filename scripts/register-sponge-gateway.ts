#!/usr/bin/env bun
/**
 * Register Suwappu in the Sponge Catalog so AI agents can discover us.
 *
 * Usage:
 *   bun scripts/register-sponge-gateway.ts
 *
 * Required env:
 *   SPONGE_API_KEY — API key for the Sponge Gateway
 *
 * Reads api-ts/openapi-agent.json for the spec and x-sponge-gateway metadata.
 * Stores the returned gateway_id in .sponge-config.json (gitignored).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const SPONGE_GATEWAY_URL = 'https://gateway.sponge.dev/v1/register'
const CONFIG_PATH = resolve(import.meta.dir, '..', '.sponge-config.json')
const OPENAPI_PATH = resolve(import.meta.dir, '..', 'api-ts', 'openapi-agent.json')

async function main() {
	const apiKey = process.env.SPONGE_API_KEY
	if (!apiKey) {
		console.error('Error: SPONGE_API_KEY environment variable is required')
		process.exit(1)
	}

	// Load OpenAPI spec
	if (!existsSync(OPENAPI_PATH)) {
		console.error(`Error: OpenAPI spec not found at ${OPENAPI_PATH}`)
		process.exit(1)
	}

	const spec = JSON.parse(readFileSync(OPENAPI_PATH, 'utf-8'))
	const spongeMetadata = spec.info?.['x-sponge-gateway']

	if (!spongeMetadata) {
		console.error('Error: x-sponge-gateway metadata not found in OpenAPI spec')
		process.exit(1)
	}

	console.log('Registering Suwappu with Sponge Gateway...')
	console.log(`  Category: ${spongeMetadata.category}`)
	console.log(`  Tags: ${spongeMetadata.tags.join(', ')}`)
	console.log(`  Chains: ${spongeMetadata.supported_chains.join(', ')}`)

	const payload = {
		name: 'suwappu-dex',
		description: spec.info.description,
		version: spec.info.version,
		openapi_spec: spec,
		category: spongeMetadata.category,
		tags: spongeMetadata.tags,
		endpoints: {
			rest: 'https://api.suwappu.bot/v1/agent',
			mcp: 'https://api.suwappu.bot/mcp',
			a2a: 'https://api.suwappu.bot/a2a',
			openapi: 'https://api.suwappu.bot/v1/agent/openapi',
		},
		callback_url: 'https://api.suwappu.bot/v1/agent/sponge/callback',
		pricing: spongeMetadata.pricing,
		supported_chains: spongeMetadata.supported_chains,
	}

	const res = await fetch(SPONGE_GATEWAY_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(payload),
	})

	if (!res.ok) {
		const errText = await res.text().catch(() => res.statusText)
		console.error(`Registration failed (${res.status}): ${errText}`)
		process.exit(1)
	}

	const result = (await res.json()) as { gateway_id?: string; id?: string; [key: string]: unknown }
	const gatewayId = result.gateway_id || result.id

	console.log(`\nRegistered successfully!`)
	console.log(`  Gateway ID: ${gatewayId}`)

	// Store config
	const config = {
		gateway_id: gatewayId,
		registered_at: new Date().toISOString(),
		version: spec.info.version,
	}
	writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
	console.log(`  Config saved to ${CONFIG_PATH}`)
}

main().catch((err) => {
	console.error('Fatal error:', err)
	process.exit(1)
})
