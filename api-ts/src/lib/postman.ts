/**
 * Converts an OpenAPI 3.x document into a Postman Collection v2.1 JSON object.
 *
 * Pure/synchronous and dependency-free so it can be unit tested without
 * booting the Effect runtime or a real Hono app (see __tests__/postman.test.ts).
 */

export const POSTMAN_SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const
type HttpMethod = (typeof HTTP_METHODS)[number]

interface OpenApiParameter {
	name: string
	in: 'path' | 'query' | 'header' | 'cookie'
	required?: boolean
	description?: string
	schema?: { type?: string; default?: unknown; enum?: unknown[] }
}

interface OpenApiOperation {
	operationId?: string
	summary?: string
	description?: string
	tags?: string[]
	parameters?: OpenApiParameter[]
	requestBody?: {
		content?: Record<string, { schema?: Record<string, unknown>; example?: unknown }>
	}
}

interface OpenApiDocument {
	openapi?: string
	info?: { title?: string; version?: string; description?: string }
	servers?: Array<{ url: string; description?: string }>
	paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>
	security?: unknown[]
}

interface PostmanUrl {
	raw: string
	protocol?: string
	host?: string[]
	path?: string[]
	query?: Array<{ key: string; value: string; description?: string; disabled?: boolean }>
	variable?: Array<{ key: string; value: string; description?: string }>
}

interface PostmanRequest {
	method: string
	header: Array<{ key: string; value: string; type?: string }>
	url: PostmanUrl
	description?: string
	body?: { mode: string; raw: string; options?: { raw: { language: string } } }
}

interface PostmanItem {
	name: string
	request: PostmanRequest
	response: unknown[]
}

export interface PostmanCollection {
	info: {
		name: string
		description?: string
		schema: string
		_postman_id?: string
	}
	item: PostmanItem[]
	variable?: Array<{ key: string; value: string }>
}

/** Splits an OpenAPI path template like "/agents/{id}/quote" into Postman path segments + variables. */
function splitPath(path: string): { segments: string[]; variables: Array<{ key: string; value: string }> } {
	const segments = path.split('/').filter(Boolean)
	const variables: Array<{ key: string; value: string }> = []
	for (const seg of segments) {
		const match = seg.match(/^\{(.+)\}$/)
		if (match) variables.push({ key: match[1], value: '' })
	}
	// Postman uses :param syntax for path variables in the `path` array.
	const postmanSegments = segments.map((seg) => {
		const match = seg.match(/^\{(.+)\}$/)
		return match ? `:${match[1]}` : seg
	})
	return { segments: postmanSegments, variables }
}

function buildUrl(baseUrl: string, path: string, parameters: OpenApiParameter[]): PostmanUrl {
	const { segments, variables } = splitPath(path)
	const queryParams = parameters.filter((p) => p.in === 'query')
	const query = queryParams.map((p) => ({
		key: p.name,
		value: p.schema?.default != null ? String(p.schema.default) : '',
		description: p.description,
		disabled: !p.required,
	}))

	let host: string[] = []
	let protocol: string | undefined
	try {
		const u = new URL(baseUrl)
		protocol = u.protocol.replace(':', '')
		host = u.host.split('.')
		const basePath = u.pathname.split('/').filter(Boolean)
		segments.unshift(...basePath)
	} catch {
		// baseUrl not a valid absolute URL — fall back to a raw-only URL.
	}

	const rawQuery = query.length > 0 ? `?${query.map((q) => `${q.key}=${q.value}`).join('&')}` : ''
	const raw = `${baseUrl.replace(/\/+$/, '')}${path}${rawQuery}`

	return {
		raw,
		...(protocol ? { protocol } : {}),
		...(host.length ? { host } : {}),
		path: segments,
		...(query.length ? { query } : {}),
		...(variables.length ? { variable: variables } : {}),
	}
}

function operationName(path: string, method: HttpMethod, op: OpenApiOperation): string {
	return op.operationId ?? op.summary ?? `${method.toUpperCase()} ${path}`
}

function buildRequestBody(op: OpenApiOperation): PostmanRequest['body'] | undefined {
	const jsonContent = op.requestBody?.content?.['application/json']
	if (!jsonContent) return undefined
	const example = jsonContent.example ?? {}
	return {
		mode: 'raw',
		raw: JSON.stringify(example, null, 2),
		options: { raw: { language: 'json' } },
	}
}

/**
 * Converts an OpenAPI 3.x document into a Postman Collection v2.1 object.
 * Produces exactly one Postman item per OpenAPI operation (method+path pair).
 */
export function openApiToPostmanCollection(spec: OpenApiDocument): PostmanCollection {
	const baseUrl = spec.servers?.[0]?.url ?? ''
	const items: PostmanItem[] = []

	for (const [path, methods] of Object.entries(spec.paths)) {
		for (const method of HTTP_METHODS) {
			const op = methods[method]
			if (!op) continue

			const parameters = op.parameters ?? []
			const headers: PostmanRequest['header'] = []
			const bodyContentType = op.requestBody?.content?.['application/json']
			if (bodyContentType) {
				headers.push({ key: 'Content-Type', value: 'application/json', type: 'text' })
			}

			const request: PostmanRequest = {
				method: method.toUpperCase(),
				header: headers,
				url: buildUrl(baseUrl, path, parameters),
				...(op.description ? { description: op.description } : {}),
			}

			const body = buildRequestBody(op)
			if (body) request.body = body

			items.push({
				name: operationName(path, method, op),
				request,
				response: [],
			})
		}
	}

	return {
		info: {
			name: spec.info?.title ?? 'API',
			description: spec.info?.description,
			schema: POSTMAN_SCHEMA_V21,
		},
		item: items,
	}
}

/** Counts the total number of OpenAPI operations (method+path pairs) in a spec — used to cross-check collection size. */
export function countOpenApiOperations(spec: OpenApiDocument): number {
	let count = 0
	for (const methods of Object.values(spec.paths)) {
		for (const method of HTTP_METHODS) {
			if (methods[method]) count++
		}
	}
	return count
}
