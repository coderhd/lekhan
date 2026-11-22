# H0 product analytics

The public footer, early-access page, local workspace sidebar, and cloud library share one browser preference. Product events go to GA4 and PostHog EU through the same contract when their respective keys are configured. GA4 also receives page views for an allowlist of public marketing routes. PostHog uses anonymous browser and session identifiers. Turning the preference off stops subsequent collection across tabs.

| Event | Trigger | Properties |
| --- | --- | --- |
| `early_access_signup` | Early-access signup receipt, once per browser session | — |
| `signup_started` | Valid email signup form submitted | `method=email` |
| `signup_completed` | Successful signup session or email confirmation | `method=email` |
| `workspace_created` | First local workspace persisted or cloud workspace inserted | `kind=local\|cloud` |
| `page_created` | A new page saves locally or is created in the cloud | `is_first` |
| `link_created` | A writer adds a wikilink outside a code block | `is_first` |
| `import_completed` | Markdown files save locally or a vault import finishes with new pages | `source`, `pages_bucket` |
| `import_report_viewed` | An import report is displayed | `source`, `degraded_blocks_bucket` |
| `export_triggered` | A Markdown page or workspace ZIP starts downloading | `format` |
| `paywall_hit` | A history window hides older checkpoints, an invite reaches the collaborator cap, or billing limits cloud editing to read-only | `gate=history\|collaborators\|sync` |
| `ai_provider_connected` | A new AI connection is saved | `kind=byok\|byol\|free_preset` |
| `ai_message_sent` | An AI request returns a complete response | — |
| `daily_active_edit` | First content edit on this browser each UTC day | — |

First-event markers record the first opted-in action observed on that browser. Signup completion is measured when the browser opening the confirmation link has opted in. Import sizes are bucketed as 0, 1, 2–10, 11–50, 51–100, or 101+. Product events use fixed URL paths and a blank referrer. Account and page identifiers, titles, content, filenames, prompts, and provider secrets stay out of event payloads.

## Launch verification

1. Set `NEXT_PUBLIC_GA4_ID` and the EU project’s `NEXT_PUBLIC_POSTHOG_KEY` on staging. Turn off GA4 Enhanced Measurement and page-history collection because Lekhan emits explicit public page views. Keep Google signals and advertising personalization disabled. PostHog starts with autocapture, session replay, and external script loading disabled. [Google pageview configuration](https://developers.google.com/analytics/devguides/collection/ga4/views) · [PostHog SDK configuration](https://posthog.com/docs/libraries/js)
2. Run `NEXT_PUBLIC_GA4_ID=G-LEKHANFIXTURE NEXT_PUBLIC_POSTHOG_KEY=phc_LekhanFixture npm run test:e2e -- e2e/analytics.spec.ts`. It intercepts both destinations, checks payload parity, and exercises cross-tab revocation.
3. In staging, use GA4 DebugView, PostHog live events, and the network inspector to verify collection after consent. Confirm that both destinations receive the intended event properties and fixed paths. Configure the custom dimensions and conversion reports for the activation funnel.

The editor’s dialect-specific paste and copy events depend on the remaining interop work. Upgrade and checkout events depend on billing. Successful payment is a webhook event and should use Measurement Protocol after the verified payment changes the workspace plan. PostHog tier-gate rollout and its offline bootstrap remain part of billing, and the Sean Ellis survey belongs to private beta. [H0 analytics issue](https://github.com/coderhd/lekhan/issues/83)
