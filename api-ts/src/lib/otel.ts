import { logger } from './logger'

let started = false
let providerShutdown: (() => Promise<void>) | undefined

export interface OtelConfig {
	/** String 'true'/'false' to match the *_ENABLED convention used across EnvService. */
	enabled: string
	serviceName: string
	endpoint?: string | undefined
}

/**
 * Initialize OpenTelemetry tracing. Fully optional — a no-op when OTEL_ENABLED
 * is not 'true' (default off). Never throws: any init or exporter failure is
 * caught/logged and never crashes the process or blocks startup.
 *
 * Deliberately NOT wired into the Effect Layer graph (MainLayer/ManagedRuntime).
 * All @opentelemetry/* packages are dynamically imported here, so when
 * OTEL_ENABLED is unset/false, none of that code is even loaded — zero init
 * cost, zero exporter, zero added latency on any request.
 *
 * Bun.serve() bypasses Node's `http` module, so Node http auto-instrumentation
 * (which patches http.Server/http.request) would not see requests served by
 * Bun. Instead, request spans are created manually by the Hono middleware in
 * app.ts using the tracer registered here (see withOtelSpan / requestTracingMiddleware).
 */
export async function initOtel(config: OtelConfig): Promise<void> {
	if (config.enabled !== 'true') return
	if (started) return

	try {
		const [{ NodeTracerProvider }, { BatchSpanProcessor }, { OTLPTraceExporter }, { resourceFromAttributes }] =
			await Promise.all([
				import('@opentelemetry/sdk-trace-node'),
				import('@opentelemetry/sdk-trace-base'),
				import('@opentelemetry/exporter-trace-otlp-http'),
				import('@opentelemetry/resources'),
			])

		// Exporter failures (no collector reachable, DNS errors, etc.) are
		// swallowed by BatchSpanProcessor internally and logged via the OTel
		// diag channel — they never throw into the request path or crash the
		// process. We don't need to wrap export calls ourselves.
		const exporter = new OTLPTraceExporter(config.endpoint ? { url: `${config.endpoint.replace(/\/+$/, '')}/v1/traces` } : {})

		const provider = new NodeTracerProvider({
			resource: resourceFromAttributes({ 'service.name': config.serviceName }),
			spanProcessors: [new BatchSpanProcessor(exporter)],
		})

		provider.register()
		started = true
		providerShutdown = () => provider.shutdown().catch(() => undefined)

		logger.info(
			`[otel] tracing initialized (service=${config.serviceName}, endpoint=${
				config.endpoint ?? 'http://localhost:4318 (default OTLP/HTTP collector)'
			})`,
		)
	} catch (err) {
		logger.error({ err }, '[otel] init failed, continuing without tracing')
	}
}

export function isOtelInitialized(): boolean {
	return started
}

/** Flush + shut down the exporter on graceful shutdown. No-op if never started. */
export async function shutdownOtel(): Promise<void> {
	if (!providerShutdown) return
	await providerShutdown()
}
