/**
 * AEGIS signature loader — TS port of aegis/scanner/signatures/__init__.py.
 *
 * Loads two YAML sources and merges them, first-loaded-wins on id collision
 * (mirrors the Python `load_signatures()` dedup order: bundled first, then
 * additional_files):
 *   1. data/default.yaml — ported copy of the upstream aegis-shield bundled
 *      signatures (PI-/RH-/IO-/DE-/CE-/MP-/SE-/EV-/EI-/CP- prefixes).
 *   2. data/crypto.yaml   — COPY of bot/config/aegis_signatures/crypto.yaml
 *      (SW- prefix). See that file's header comment for the sync caveat:
 *      the Python file is canonical; this is a manually-synced copy because
 *      the api-ts Docker build context does not include `bot/`.
 *
 * A malformed signature (missing field, bad regex) is skipped with a
 * console.warn rather than throwing — the loader must fail open so a single
 * bad YAML entry can never take the scanner (and therefore the request path
 * that calls it) down.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import type { RawSignature, Signature } from './types'

const DEFAULT_SIGNATURES_PATH = fileURLToPath(new URL('./data/default.yaml', import.meta.url))
const CRYPTO_SIGNATURES_PATH = fileURLToPath(new URL('./data/crypto.yaml', import.meta.url))

function isRawSignature(value: unknown): value is RawSignature {
	if (!value || typeof value !== 'object') return false
	const v = value as Record<string, unknown>
	return (
		typeof v.id === 'string' &&
		typeof v.category === 'string' &&
		typeof v.pattern === 'string' &&
		typeof v.severity === 'number' &&
		typeof v.description === 'string'
	)
}

function loadRawSignaturesFromFile(path: string): RawSignature[] {
	let text: string
	try {
		text = readFileSync(path, 'utf-8')
	} catch (err) {
		console.warn(`[aegis] signature file unreadable, skipping: ${path}`, err)
		return []
	}

	let data: unknown
	try {
		data = parseYaml(text)
	} catch (err) {
		console.warn(`[aegis] signature file failed to parse as YAML, skipping: ${path}`, err)
		return []
	}

	const list = (data as { signatures?: unknown } | null)?.signatures
	if (!Array.isArray(list)) return []

	const raw: RawSignature[] = []
	for (const entry of list) {
		if (isRawSignature(entry)) {
			raw.push(entry)
		} else {
			console.warn(`[aegis] malformed signature entry skipped in ${path}:`, entry)
		}
	}
	return raw
}

/** Compile a single raw signature; returns null (and warns) on a bad regex instead of throwing. */
function compileSignature(raw: RawSignature): Signature | null {
	try {
		const pattern = new RegExp(raw.pattern, 'i')
		return {
			id: raw.id,
			category: raw.category,
			pattern,
			severity: Math.max(0, Math.min(1, raw.severity)),
			description: raw.description,
		}
	} catch (err) {
		console.warn(`[aegis] signature ${raw.id} has an invalid regex pattern, skipping`, err)
		return null
	}
}

export interface LoadSignaturesOptions {
	/** Load the bundled default.yaml. Defaults to true. */
	useBundled?: boolean
	/** Additional raw-signature file paths beyond the in-repo crypto pack. */
	additionalFiles?: string[]
	/** Skip the in-repo crypto.yaml pack. Defaults to false (i.e. loaded by default). */
	skipCryptoPack?: boolean
}

/**
 * Load and compile signatures from the bundled default pack + the Suwappu
 * crypto pack (+ any extra files). Dedupes by id, first-loaded wins — the
 * bundled pack is loaded before the crypto pack, matching the Python
 * ordering and its "custom domain signature ids should not collide with
 * bundled ones" assumption (crypto.yaml uses the SW- prefix specifically to
 * avoid this).
 *
 * Never throws: unreadable/malformed files and bad regexes are skipped with
 * a warning so the scanner degrades gracefully instead of failing to boot.
 */
export function loadSignatures(options: LoadSignaturesOptions = {}): Signature[] {
	const { useBundled = true, additionalFiles = [], skipCryptoPack = false } = options

	const rawSignatures: RawSignature[] = []

	if (useBundled) {
		rawSignatures.push(...loadRawSignaturesFromFile(DEFAULT_SIGNATURES_PATH))
	}
	if (!skipCryptoPack) {
		rawSignatures.push(...loadRawSignaturesFromFile(CRYPTO_SIGNATURES_PATH))
	}
	for (const file of additionalFiles) {
		rawSignatures.push(...loadRawSignaturesFromFile(file))
	}

	const seenIds = new Set<string>()
	const signatures: Signature[] = []

	for (const raw of rawSignatures) {
		if (seenIds.has(raw.id)) continue
		seenIds.add(raw.id)

		const compiled = compileSignature(raw)
		if (compiled) signatures.push(compiled)
	}

	return signatures
}
