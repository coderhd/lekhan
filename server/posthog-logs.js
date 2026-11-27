const { SeverityNumber } = require('@opentelemetry/api-logs')
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http')
const { resourceFromAttributes } = require('@opentelemetry/resources')
const { BatchLogRecordProcessor, LoggerProvider } = require('@opentelemetry/sdk-logs')

function createPostHogLogger () {
	const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
	const host = process.env.NEXT_PUBLIC_POSTHOG_HOST
	if (!token || !host) {
		if (process.env.NODE_ENV !== 'production') {
			const missingVariable = token
				? 'NEXT_PUBLIC_POSTHOG_HOST'
				: 'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN'
			console.warn(`${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`)
		}
		return {
			info: () => {},
			warn: () => {},
			shutdown: async () => {},
		}
	}

	const loggerProvider = new LoggerProvider({
		resource: resourceFromAttributes({ 'service.name': 'lekhan-collaboration-server' }),
		processors: [
			new BatchLogRecordProcessor({
				exporter: new OTLPLogExporter({
					url: `${host.replace(/\/$/, '')}/i/v1/logs`,
					timeoutMillis: 2000,
					headers: {
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json',
					},
				}),
			}),
		],
	})
	const logger = loggerProvider.getLogger('posthog-collaboration-lifecycle')

	return {
		info: (body, attributes = {}) => logger.emit({ body, severityNumber: SeverityNumber.INFO, attributes }),
		warn: (body, attributes = {}) => logger.emit({ body, severityNumber: SeverityNumber.WARN, attributes }),
		shutdown: async () => {
			await loggerProvider.forceFlush().catch(() => {})
		},
	}
}

module.exports = { createPostHogLogger }
