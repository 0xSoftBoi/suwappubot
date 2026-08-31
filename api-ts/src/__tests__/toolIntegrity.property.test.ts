import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { computeToolDefinitionHash, type ToolDefinitionLike } from '../lib/toolIntegrity'

// Property tests extending the ETDI tool-integrity hash's manual proof
// (see toolIntegrity.ts's module docstring) into a permanent test, per
// Phase 2 of docs/plans/oss-parity.md:
//   1. Key-order independence: shuffling object key INSERTION order anywhere
//      in the {name, description, inputSchema} tree must never change the
//      hash -- canonicalize() sorts keys recursively specifically so a
//      cosmetic reordering (e.g. from a Zod version bump changing its
//      internal iteration order) can't be mistaken for a real schema drift.
//   2. Sensitivity: any single-character change to `name` or `description`
//      MUST change the hash -- otherwise the tripwire could miss a genuine
//      drift.

const jsonPrimitive = fc.oneof(fc.string(), fc.double({ noNaN: true }), fc.boolean(), fc.constant(null))

// A JSON-object-shaped arbitrary (never an array/primitive at the top level)
// so it's representative of a real Zod inputSchema (JSON Schema is always an
// object at the root).
const jsonObjectTree: fc.Arbitrary<Record<string, unknown>> = fc.letrec((tie) => ({
	value: fc.oneof(
		{ depthSize: 'small' },
		jsonPrimitive,
		fc.array(tie('value') as fc.Arbitrary<unknown>, { maxLength: 4 }),
		tie('object') as fc.Arbitrary<Record<string, unknown>>,
	),
	object: fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), tie('value') as fc.Arbitrary<unknown>, {
		maxKeys: 5,
	}),
})).object

/**
 * Recursively re-insert every object's keys in a shuffled order, using a
 * fast-check-driven shuffle so the property is reproducible under a seed.
 * Arrays keep their element ORDER (order is semantically meaningful for
 * arrays, unlike object key insertion order) but their elements are
 * themselves recursively shuffled if they're objects/arrays.
 */
function shuffleKeysDeep(value: unknown, shuffledIndices: number[], cursor: { i: number }): unknown {
	if (Array.isArray(value)) {
		return value.map((v) => shuffleKeysDeep(v, shuffledIndices, cursor))
	}
	if (value !== null && typeof value === 'object') {
		const keys = Object.keys(value as Record<string, unknown>)
		// Deterministic-but-different insertion order: rotate by a value drawn
		// from the shuffledIndices pool (cycling if we run out).
		const rotation = keys.length > 0 ? shuffledIndices[cursor.i++ % shuffledIndices.length] % keys.length : 0
		const rotatedKeys = [...keys.slice(rotation), ...keys.slice(0, rotation)]
		const out: Record<string, unknown> = {}
		for (const key of rotatedKeys) {
			out[key] = shuffleKeysDeep((value as Record<string, unknown>)[key], shuffledIndices, cursor)
		}
		return out
	}
	return value
}

describe('computeToolDefinitionHash (property)', () => {
	it('is independent of recursive object key insertion order', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 20 }),
				fc.string({ minLength: 0, maxLength: 100 }),
				jsonObjectTree,
				fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 8, maxLength: 8 }),
				(name, description, inputSchema, rotationSeeds) => {
					const original: ToolDefinitionLike = { name, description, inputSchema }
					const shuffled: ToolDefinitionLike = {
						name,
						description,
						inputSchema: shuffleKeysDeep(inputSchema, rotationSeeds, { i: 0 }),
					}
					expect(computeToolDefinitionHash(shuffled)).toBe(computeToolDefinitionHash(original))
				},
			),
		)
	})

	it('is independent of top-level {name, description, inputSchema} key order (object literal insertion order)', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 20 }),
				fc.string({ minLength: 0, maxLength: 100 }),
				jsonObjectTree,
				(name, description, inputSchema) => {
					const inOrder = computeToolDefinitionHash({ name, description, inputSchema })
					// Same three fields, reconstructed via a differently-ordered
					// object spread -- JS object key order is otherwise
					// insertion-order, so this is a real reordering, not a no-op.
					const reordered = { inputSchema, name, description } as ToolDefinitionLike
					expect(computeToolDefinitionHash(reordered)).toBe(inOrder)
				},
			),
		)
	})

	it('any single-character change to `name` changes the hash', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 30 }),
				fc.string({ minLength: 0, maxLength: 50 }),
				jsonObjectTree,
				fc.nat(),
				fc.integer({ min: 1, max: 0x2fffff }),
				(name, description, inputSchema, indexSeed, codePointDelta) => {
					const index = indexSeed % name.length
					const codePoints = Array.from(name)
					const originalChar = codePoints[index]
					// Perturb the code point at `index` to something different,
					// wrapping into the valid Unicode range and skipping surrogate
					// halves (which would produce an invalid lone surrogate string).
					let newCodePoint = (originalChar!.codePointAt(0)! + codePointDelta) % 0x110000
					if (newCodePoint >= 0xd800 && newCodePoint <= 0xdfff) newCodePoint = 0x41 // 'A'
					if (newCodePoint === originalChar!.codePointAt(0)) newCodePoint = (newCodePoint + 1) % 0x110000
					codePoints[index] = String.fromCodePoint(newCodePoint)
					const mutatedName = codePoints.join('')
					fc.pre(mutatedName !== name)

					const before = computeToolDefinitionHash({ name, description, inputSchema })
					const after = computeToolDefinitionHash({ name: mutatedName, description, inputSchema })
					expect(after).not.toBe(before)
				},
			),
		)
	})

	it('any single-character change to `description` changes the hash', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 30 }),
				fc.string({ minLength: 1, maxLength: 50 }),
				jsonObjectTree,
				fc.nat(),
				fc.integer({ min: 1, max: 0x2fffff }),
				(name, description, inputSchema, indexSeed, codePointDelta) => {
					const index = indexSeed % description.length
					const codePoints = Array.from(description)
					const originalChar = codePoints[index]
					let newCodePoint = (originalChar!.codePointAt(0)! + codePointDelta) % 0x110000
					if (newCodePoint >= 0xd800 && newCodePoint <= 0xdfff) newCodePoint = 0x41
					if (newCodePoint === originalChar!.codePointAt(0)) newCodePoint = (newCodePoint + 1) % 0x110000
					codePoints[index] = String.fromCodePoint(newCodePoint)
					const mutatedDescription = codePoints.join('')
					fc.pre(mutatedDescription !== description)

					const before = computeToolDefinitionHash({ name, description, inputSchema })
					const after = computeToolDefinitionHash({ name, description: mutatedDescription, inputSchema })
					expect(after).not.toBe(before)
				},
			),
		)
	})

	it('appending any single character to `name` or `description` changes the hash', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 0, maxLength: 30 }),
				fc.string({ minLength: 0, maxLength: 30 }),
				jsonObjectTree,
				fc.char(),
				(name, description, inputSchema, extraChar) => {
					const before = computeToolDefinitionHash({ name, description, inputSchema })
					const afterName = computeToolDefinitionHash({
						name: name + extraChar,
						description,
						inputSchema,
					})
					const afterDescription = computeToolDefinitionHash({
						name,
						description: description + extraChar,
						inputSchema,
					})
					expect(afterName).not.toBe(before)
					expect(afterDescription).not.toBe(before)
				},
			),
		)
	})
})
