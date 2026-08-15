import pino from 'pino'

const isProduction = process.env.NODE_ENV === 'production'

const transport = !isProduction
	? (() => {
			try {
				return pino.transport({ target: 'pino-pretty' })
			} catch {
				return undefined
			}
		})()
	: undefined

const logger = pino(
	{
		level: process.env.LOG_LEVEL || 'info',
		base: { service: 'suwappu-api-ts' },
	},
	transport,
)

export { logger }
