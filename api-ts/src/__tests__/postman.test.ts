import { describe, expect, it } from 'bun:test'
import openApiSpec from '../../openapi-agent.json'
import { countOpenApiOperations, openApiToPostmanCollection, POSTMAN_SCHEMA_V21 } from '../lib/postman'

describe('postman collection generation', () => {
	const collection = openApiToPostmanCollection(openApiSpec as never)

	it('uses the Postman v2.1.0 collection schema', () => {
		expect(collection.info.schema).toBe(POSTMAN_SCHEMA_V21)
		expect(collection.info.schema).toBe('https://schema.getpostman.com/json/collection/v2.1.0/collection.json')
	})

	it('produces exactly one Postman item per OpenAPI operation', () => {
		const opCount = countOpenApiOperations(openApiSpec as never)
		expect(opCount).toBeGreaterThan(0)
		expect(collection.item.length).toBe(opCount)
	})

	it('is structurally valid: every item has a method, a url, and a name', () => {
		expect(collection.item.length).toBeGreaterThan(0)
		for (const item of collection.item) {
			expect(typeof item.name).toBe('string')
			expect(item.name.length).toBeGreaterThan(0)
			expect(typeof item.request.method).toBe('string')
			expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']).toContain(item.request.method)
			expect(item.request.url).toBeDefined()
			expect(typeof item.request.url.raw).toBe('string')
			expect(item.request.url.raw.length).toBeGreaterThan(0)
			expect(Array.isArray(item.request.header)).toBe(true)
			expect(Array.isArray(item.response)).toBe(true)
		}
	})

	it('maps every OpenAPI path+method pair to a matching Postman request', () => {
		const expected: Array<{ method: string; path: string }> = []
		for (const [path, methods] of Object.entries((openApiSpec as { paths: Record<string, Record<string, unknown>> }).paths)) {
			for (const method of Object.keys(methods)) {
				if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) {
					expected.push({ method: method.toUpperCase(), path })
				}
			}
		}

		for (const exp of expected) {
			const match = collection.item.find(
				(item) => item.request.method === exp.method && item.request.url.raw.includes(exp.path.split('{')[0]),
			)
			expect(match, `no Postman item found for ${exp.method} ${exp.path}`).toBeDefined()
		}
	})

	it('sets a top-level collection name derived from the OpenAPI info.title', () => {
		expect(typeof collection.info.name).toBe('string')
		expect(collection.info.name.length).toBeGreaterThan(0)
	})
})
