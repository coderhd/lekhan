# Product analytics — event taxonomy

Canonical list lives in GitHub issue #83 (keep this file in sync when the spec
lands). Implementation seam: `lib/analytics.ts` exposing typed `track(event, props)`;
no raw gtag calls outside that module.

## Rules

1. **No note content ever leaves the client** — ids, counts, enum kinds only.
   Titles, plaintext, properties are forbidden payload keys.
2. Server-authoritative events (checkout completed, subscription changes) come
   from webhook → Measurement Protocol, not client JS.
3. Every event must map to a decision someone will make with it. If no decision,
   don't ship the event.

## Funnel map

signup_started → signup_completed → workspace_created → page_created(first)
→ link_created(first) → import_completed(source)
→ paywall_hit(gate) → upgrade_clicked → checkout_started → checkout_completed(plan)

Interop (#78): paste_in_resolved · copy_out_used · export_triggered(format)
· import_report_viewed(degraded counts)

AI (#28): ai_provider_connected(kind) · ai_message_sent

Retention: daily edit heartbeat (id-less day-level ping)
