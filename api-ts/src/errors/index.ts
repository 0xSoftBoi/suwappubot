import { Data, Match } from 'effect'

export class ValidationError extends Data.TaggedError('ValidationError')<{
	readonly message: string
	readonly fields?: Record<string, string>
}> {
	readonly status = 400 as const
}

export class UnauthorizedError extends Data.TaggedError('UnauthorizedError')<{
	readonly message?: string
}> {
	readonly status = 401 as const
}

export class ForbiddenError extends Data.TaggedError('ForbiddenError')<{
	readonly message?: string
}> {
	readonly status = 403 as const
}

export class NotFoundError extends Data.TaggedError('NotFoundError')<{
	readonly message?: string
	readonly resource?: string
}> {
	readonly status = 404 as const
}

export class DatabaseError extends Data.TaggedError('DatabaseError')<{
	readonly message: string
	readonly cause?: unknown
}> {
	readonly status = 500 as const
}

export type AppError =
	| ValidationError
	| UnauthorizedError
	| ForbiddenError
	| NotFoundError
	| DatabaseError

interface ErrorResponse {
	status: number
	body: { error: string; message?: string; fields?: Record<string, string> }
}

export const mapErrorToResponse = (error: AppError | Error | unknown): ErrorResponse => {
	// Handle plain Error or unknown errors
	if (!(error && typeof error === 'object' && '_tag' in error)) {
		const message = error instanceof Error ? error.message : 'Unknown error'
		return {
			status: 500,
			body: { error: 'Internal Error', message },
		}
	}

	// Handle tagged AppError types
	return Match.value(error as AppError).pipe(
		Match.tag('ValidationError', (e) => ({
			status: e.status,
			body: {
				error: 'Validation Error',
				message: e.message,
				...(e.fields && { fields: e.fields }),
			},
		})),
		Match.tag('UnauthorizedError', (e) => ({
			status: e.status,
			body: { error: 'Unauthorized', ...(e.message && { message: e.message }) },
		})),
		Match.tag('ForbiddenError', (e) => ({
			status: e.status,
			body: { error: 'Forbidden', ...(e.message && { message: e.message }) },
		})),
		Match.tag('NotFoundError', (e) => ({
			status: e.status,
			body: {
				error: 'Not Found',
				...(e.message && { message: e.message }),
				...(e.resource && { resource: e.resource }),
			},
		})),
		Match.tag('DatabaseError', (e) => ({
			status: e.status,
			body: { error: 'Database Error', message: e.message },
		})),
		Match.exhaustive
	)
}
