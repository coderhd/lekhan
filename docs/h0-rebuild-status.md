# H0 rebuild verification

The goal covers everything specced in H0. GitHub issue status records work across the repository. This document tracks evidence for the rebuild branch separately.

## Release scope

| Spec or issue | Current rebuild evidence | Remaining verification |
|---|---|---|
| [#8 Pages graph](https://github.com/coderhd/lekhan/issues/8), [#9 client cutover](https://github.com/coderhd/lekhan/issues/9) | Local pages have stable identities and hierarchy. Signed-in writers can open owned and shared Pages graph rows through a private cloud library. Cloud pages check membership, redirect legacy document URLs, and persist search and graph projections alongside their snapshots. | Live role and row-level security matrix, invites and versions, resolved nested links, cloud search, and progressive legacy migration. |
| [#25 Global search](https://github.com/coderhd/lekhan/issues/25), [#79 UX parity](https://github.com/coderhd/lekhan/issues/79) | Local and cloud pages share a keyboard palette. Cloud search uses the caller-scoped `search_pages` RPC, supports recent pages and exposes match context. Chromium covered local search and authenticated cloud search with fixtures. Staging's existing owner could find a private page and an unrelated account received no match. The four trigram indexes are present. | Live shared/private/public permission matrix, incremental indexing and performance at 10k pages, shortcut help, and full parity review. |
| [#26 Markdown](https://github.com/coderhd/lekhan/issues/26), [#27 Obsidian](https://github.com/coderhd/lekhan/issues/27), [#87 import retries](https://github.com/coderhd/lekhan/issues/87) | Markdown source preserves unsupported blocks. Vault ingestion builds nested pages in one local write, resolves original filenames, retains YAML and supported images, and records a retry fingerprint. | Full format and attachment fidelity, sync-side vault IR authorization and idempotency, and export compatibility. |
| [#28 Provider Registry](https://github.com/coderhd/lekhan/issues/28) | Registry, browser-direct streaming, local discovery, and the encrypted provider setup and writing assistant are implemented. | Local runner and Model Library, remaining editor actions, and live provider connections on the launch matrix. |
| [#29 Billing](https://github.com/coderhd/lekhan/issues/29), [#82 tier enforcement](https://github.com/coderhd/lekhan/issues/82) | Cloud sync reads workspace entitlements and applies collaborator limits and the payment grace period. | Remaining tier gates, USD/INR pricing, Stripe/Razorpay checkout, webhook and lifecycle verification. |
| [#30 Publish polish](https://github.com/coderhd/lekhan/issues/30), [#85 early access](https://github.com/coderhd/lekhan/issues/85), [#93 public pages](https://github.com/coderhd/lekhan/issues/93) | Earlier implementation has issue history and published requirements. | Public reader, share controls, marketing surfaces, and waitlist verification. |
| [#31 i18n](https://github.com/coderhd/lekhan/issues/31) | Cookie-backed locale and five message catalogs cover account routes, the workspace, and top-level editor chrome. | Remaining route, chrome, SEO, and translation reviews from the approved spec. |
| [#32 Docs](https://github.com/coderhd/lekhan/issues/32) | Existing docs-site implementation in repository history, with H0 topic inventory. | Bring it onto the rebuild, verify instructions against shipped functionality, and verify the docs host. |
| [#77 sync durability](https://github.com/coderhd/lekhan/issues/77), [#81 encryption at rest](https://github.com/coderhd/lekhan/issues/81) | Local IndexedDB checks revisions. The cloud writer uses Yjs with account-scoped offline copies, encrypted relay WAL records and compatible encrypted snapshots. Local WebSocket tests exercise reconnects, read-only access, crash recovery and snapshot upload retries. | Staging relay deployment, live Supabase Storage and graph persistence, failover and volume recovery drills, and key rotation/backfill. |
| [#83 analytics](https://github.com/coderhd/lekhan/issues/83), [#84 private beta](https://github.com/coderhd/lekhan/issues/84), [#90 observability](https://github.com/coderhd/lekhan/issues/90) | Release and monitoring issues are present in GitHub. | Privacy-filtered analytics, uptime and error monitoring, launch checklist with live evidence. |
| [#88 desktop shell](https://github.com/coderhd/lekhan/issues/88) | Promoted to H0 in the later roadmap. | Tauri, vault on disk, llama.cpp sidecar, and Model Library verification. |

The H0 strategy and the latest approved issue specs determine acceptance. Current source and live verification determine completion.

## Reference observations

Reverse Engineer Anything captured the published Obsidian callout examples in `ev_0a57c6b29c287d6cb5b0d9dc85f59aee0bdd3a52158e022e431d319fed32d9d5`. The example separates the callout title from its editable content and retains ordinary Markdown and links inside it. The implementation uses Lekhan’s own editor and styling. [Obsidian callouts](https://obsidian.md/help/callouts)

## Verified on the rebuild

- `npm run typecheck`, `npm run lint`, and `npm run build` succeeded.
- 92 unit tests cover the writer, graph and relay, IndexedDB, bounded vault ingestion, locale catalogs, and provider adapters.
- Thirteen Chromium tests passed. The covered flows include vault ZIP import, language persistence across reload, encrypted provider configuration with explicit per-request page sharing, and the sign-in guard for private cloud routes.
- The provider browser test used an intercepted OpenAI response. Provider credentials, production billing, the hosted docs site, and the cloud sync stack still need live verification.

A separate Chromium smoke test exercised the login and logout flows against a local Supabase Auth fixture. The guest workspace and two authenticated browser replicas remained isolated. A cloud Chromium smoke test used fixture Auth and page data, the real ticket endpoint and a local WebSocket relay. Owner and editor sessions exchanged edits, a viewer could read the updates, and the mobile editor's offline change reached both peers after reconnection. The local relay completed a snapshot flush. Read-only inspection confirmed the staging page graph, import ledger, and billing tables have row-level security enabled. Staging sign-in, email delivery and the deployed cloud writer still need live verification.

## Run the cloud writer

Set the app's Supabase URL and publishable key, `LEKHAN_PUBLIC_URL`, `LEKHAN_SYNC_URL` and `LEKHAN_SYNC_TICKET_SECRET`. The ticket endpoint also needs `SUPABASE_SECRET_KEY` on the server to check workspace entitlements. Use `ws://localhost:8080` for a local relay and a `wss://` origin for a hosted relay.

Start the relay with `npm run sync` on Node 24. Use the same app origin, Supabase configuration and ticket secret. Set `LEKHAN_ENCRYPTION_KEY` and mount a persistent directory at `LEKHAN_WAL_DIR`. Run a single writer per environment and keep the volume through relay restarts. During migration, keep the existing snapshot key available in `LEKHAN_ENCRYPTION_PREVIOUS_KEYS` as a comma-separated decrypt-only list. The relay exposes `/health` for readiness checks.
