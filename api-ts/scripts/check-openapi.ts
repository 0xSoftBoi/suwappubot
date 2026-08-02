#!/usr/bin/env bun
/**
 * check-openapi.ts — OpenAPI drift gate.
 *
 * Regenerates the spec in-memory (same deterministic `buildSpec` used by
 * `gen-openapi.ts`) and diffs it against the checked-in `openapi-agent.json`.
 * Exits 0 when clean, exits 1 with a concise summary of the changed
 * paths/keys (NOT a full JSON dump) when the checked-in artifact has drifted
 * from the Zod validators.
 *
 * This is the script CI / `scripts/verify.sh` should call — it never writes
 * to disk, so it's safe to run in read-only CI environments.
 */

import { readFileSync } from 'node:fs'
import { buildSpec, serialize, SPEC_PATH } from './gen-openapi'

// deno-lint-ignore no-explicit-any
type Json = any

type Change =
	| { kind: 'added'; path: string; value: Json }
	| { kind: 'removed'; path: string; value: Json }
	| { kind: 'changed'; path: string; from: Json; to: Json }

const MAX_LEAF_DIFFS = 25
const MAX_VALUE_LEN = 80

function isPlainObject(v: Json): v is Record<string, Json> {
	return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function short(v: Json): string {
	const s = typeof v === 'string' ? v : JSON.stringify(v)
	if (s === undefined) return 'undefined'
	return s.length > MAX_VALUE_LEN ? `${s.slice(0, MAX_VALUE_LEN)}…` : s
}

/** Recursive structural diff. Stops descending once it finds a leaf-level
 * difference and records it as a single change entry (keeps output concise
 * instead of exploding every nested key under a changed subtree). */
function diff(a: Json, b: Json, path: string, out: Change[]): void {
	if (out.length >= MAX_LEAF_DIFFS) return

	if (isPlainObject(a) && isPlainObject(b)) {
		const keys = new Set([...Object.keys(a), ...Object.keys(b)])
		for (const key of [...keys].sort()) {
			if (out.length >= MAX_LEAF_DIFFS) return
			const childPath = path ? `${path}.${key}` : key
			const inA = key in a
			const inB = key in b
			if (inA && !inB) {
				out.push({ kind: 'removed', path: childPath, value: a[key] })
			} else if (!inA && inB) {
				out.push({ kind: 'added', path: childPath, value: b[key] })
			} else {
				diff(a[key], b[key], childPath, out)
			}
		}
		return
	}

	if (Array.isArray(a) && Array.isArray(b)) {
		if (JSON.stringify(a) !== JSON.stringify(b)) {
			out.push({ kind: 'changed', path, from: a, to: b })
		}
		return
	}

	if (a !== b) {
		out.push({ kind: 'changed', path, from: a, to: b })
	}
}

function formatChange(c: Change): string {
	switch (c.kind) {
		case 'added':
			return `  + ${c.path} = ${short(c.value)}`
		case 'removed':
			return `  - ${c.path} (was ${short(c.value)})`
		case 'changed':
			return `  ~ ${c.path}: ${short(c.from)} -> ${short(c.to)}`
	}
}

function main(): void {
	const onDisk = readFileSync(SPEC_PATH, 'utf8')
	const existing = JSON.parse(onDisk)
	const next = serialize(buildSpec(existing))

	if (next === onDisk) {
		console.log('✓ openapi-agent.json is in sync with the Zod validators.')
		return
	}

	const nextParsed = JSON.parse(next)
	const changes: Change[] = []
	diff(existing, nextParsed, '', changes)

	console.error(
		'❌ openapi-agent.json is out of date with the Zod validators.\n' +
			`   ${changes.length >= MAX_LEAF_DIFFS ? `${MAX_LEAF_DIFFS}+` : changes.length} changed key(s):`,
	)
	for (const c of changes) console.error(formatChange(c))
	console.error('\n   Run `bun run generate:openapi` and commit the result.')
	process.exit(1)
}

main()
