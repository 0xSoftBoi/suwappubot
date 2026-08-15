/**
 * Build fingerprint for api-ts.
 *
 * A green Railway deploy is not proof the new code is running. python-api
 * already reports a fingerprint (see api/main.py), and the absence of the
 * equivalent here has been actively costly: an api-ts deploy could report
 * SUCCESS while the old build kept serving, and there was no way to tell that
 * apart from a code bug. Debugging cookie auth meant repeatedly guessing
 * whether a 401 meant "my change is wrong" or "my change isn't deployed".
 *
 * Computed the same way as the python side — SHA-256 over the service's own
 * sources, truncated — so one script can verify either service. The container
 * ships raw `src/` (see Dockerfile), so this works without a build step.
 *
 * Cached after first computation; never throws.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

let cached: string | null = null

function walk(dir: string, out: string[]): void {
	for (const entry of readdirSync(dir).sort()) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue
		const full = join(dir, entry)
		let s
		try {
			s = statSync(full)
		} catch {
			continue
		}
		if (s.isDirectory()) walk(full, out)
		else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
	}
}

export function sourceFingerprint(): string {
	if (cached !== null) return cached
	try {
		const here = dirname(fileURLToPath(import.meta.url))
		// lib/ -> src/
		const root = join(here, '..')
		const files: string[] = []
		walk(root, files)
		files.sort()

		const digest = createHash('sha256')
		for (const file of files) {
			digest.update(relative(root, file).split('\\').join('/'))
			digest.update(readFileSync(file))
		}
		cached = digest.digest('hex').slice(0, 12)
	} catch {
		// Never block a health check on this.
		cached = 'unavailable'
	}
	return cached
}
