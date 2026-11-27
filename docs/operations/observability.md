# Production observability

Use the `lekhan` Sentry project for the Next.js app and `lekhan-sync-relay` for the sync relay. Set the private server environment variables in the corresponding deployment. The browser DSN uses the app project and is public by design. Build the app with the browser variables set. Omit the DSNs to run without remote error reporting.

| Scope | Configuration |
|---|---|
| Next.js app | `SENTRY_APP_DSN`, optional `SENTRY_RETENTION_MONITOR_SLUG` |
| Browser | `NEXT_PUBLIC_SENTRY_APP_DSN`. Reporting requires the user's usage analytics preference to be granted |
| Sync relay | `SENTRY_RELAY_DSN`, optional Better Stack ingest origin and token |
| Deployment metadata | Set `SENTRY_ENVIRONMENT` and `NEXT_PUBLIC_SENTRY_ENVIRONMENT` to `production` for production. Set `SENTRY_RELEASE` and `NEXT_PUBLIC_SENTRY_RELEASE` to the deployed Git SHA |

Set `SENTRY_ERROR_SAMPLE_RATE` or `NEXT_PUBLIC_SENTRY_ERROR_SAMPLE_RATE` to a value between 0 and 1 to adjust error sampling. Both default to 1. The relay emits repeated errors of each operation at most once every 30 seconds.

Sentry error events carry a service, an error class, and allowlisted application stack locations. Relay events can also carry a fixed operation name. The event builder drops the original error message, request, account data, breadcrumbs, and arbitrary properties. Both app request tracking and browser tracking skip document routes. The relay ships fixed operation names and numeric maintenance counts to Better Stack. Keep exception text and document identifiers out of new logging call sites.

## Scheduled job

The `lekhan-retention-prune` monitor is configured in the app project for `30 5 * * *` UTC, matching the retention route in `vercel.json`. It allows 15 minutes for a late check-in and 10 minutes for execution. Set its slug in `SENTRY_RETENTION_MONITOR_SLUG`. Enable the monitor when the hosted cron has deployed and can deliver check-ins. Cron authentication still uses the existing `CRON_SECRET`. A retention response that needs retry is recorded as an error check-in.

The protected staging preview has its own cron secret. Manual retention and billing reconciliation requests rejected an invalid token with HTTP 401. Both returned HTTP 200 with no failures for the configured token against the empty staging queues. The production schedule and provider-event reconciliation still need live verification.

## External availability and logs

Create a Better Stack Logs source for the relay and set `BETTER_STACK_INGEST_URL` to its HTTPS ingest origin (`in.logs.betterstack.com` or `*.betterstackdata.com`) and `BETTER_STACK_SOURCE_TOKEN` to its token. The relay validates both at startup (`betterStackDestination`), ships fixed JSON operation counts asynchronously, flushes pending batches on `SIGTERM`/`SIGINT`, and writes the same JSON records to stdout when Better Stack credentials are absent. Server-only telemetry variables stay restricted to Node/server modules.

Create external monitors for the hosted app’s `GET /api/health` route (returning HTTP 200 `{ ok: true, service: 'app' }` with `Cache-Control: private, no-store`) and the sync relay’s HTTPS `/health` route. The relay route reports overload or shutdown as HTTP 503. Monitor the public relay port as well if the deployment terminates WebSocket traffic on a separate host or port. Keep a separate authenticated staging check that opens two WebSocket clients in one fixture page and verifies that an edit traverses the relay.

Create the public status page in Better Stack and attach the app and relay monitors. Confirm that the status page and its incident history can be opened without signing in.

## Staging verification

- Use the staging Sentry projects and a synthetic error to verify a redacted browser event after opting in. Confirm that opting out and visiting a document route suppress reporting.
- Confirm that the relay's `listening` record reaches the staging Better Stack Logs source and a staging relay fault reaches its Sentry project.
- Confirm the retention cron reports a successful run and that a failing staging test job raises a monitor alert.
- Confirm the uptime checks change status when the staging relay is stopped and recover after it restarts.

[Next.js instrumentation](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation) · [Sentry Crons](https://docs.sentry.io/platforms/javascript/guides/node/crons/) · [Better Stack log ingestion](https://betterstack.com/docs/logs/ingesting-data/http/logs/) · [Better Stack monitors](https://betterstack.com/docs/uptime/api/create-a-new-monitor/)
