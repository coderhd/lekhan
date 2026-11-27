import { SeverityNumber } from '@opentelemetry/api-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST

export let loggerProvider: LoggerProvider | null = null
let posthogLogger: ReturnType<LoggerProvider['getLogger']> | null = null

if (token && host) {
	loggerProvider = new LoggerProvider({
		resource: resourceFromAttributes({ 'service.name': 'lekhan-nextjs' }),
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
	posthogLogger = loggerProvider.getLogger('posthog-version-workflow')
} else if (process.env.NODE_ENV !== 'production') {
	const missingVariable = token
		? 'NEXT_PUBLIC_POSTHOG_HOST'
		: 'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN'
	console.warn(`${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`)
}

export function logPostHogInfo(body: string, attributes: Record<string, string | number | boolean> = {}) {
	posthogLogger?.emit({ body, severityNumber: SeverityNumber.INFO, attributes })
}

export function logPostHogError(body: string, attributes: Record<string, string | number | boolean> = {}) {
	posthogLogger?.emit({ body, severityNumber: SeverityNumber.ERROR, attributes })
}

export async function flushPostHogLogs() {
	if (loggerProvider) {
		await loggerProvider.forceFlush().catch(() => {})
	}
}

export function register() {
	// The provider is intentionally dedicated to logs emitted by this integration.
}
