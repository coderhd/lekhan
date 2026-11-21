# H0 rebuild verification

The goal covers everything specced in H0. GitHub issue status records work across the repository. This document tracks evidence for the rebuild branch separately.

## Release scope

| Spec or issue | Current rebuild evidence | Remaining verification |
|---|---|---|
| [#8 Pages graph](https://github.com/coderhd/lekhan/issues/8), [#9 client cutover](https://github.com/coderhd/lekhan/issues/9) | Local pages have stable identities and hierarchy. Supabase account routes compile and authenticated browser sessions select isolated replicas. | Workspace membership, legacy/sync cutover, durable graph index, page-scoped authorization, invites and versions. |
| [#25 Global search](https://github.com/coderhd/lekhan/issues/25), [#79 UX parity](https://github.com/coderhd/lekhan/issues/79) | Local trigram search ranks titles, tags, wikilink targets, and page text. The palette and tag-to-search path are exercised in Chromium. | Incremental durable indexing and scale measurements, the server-side permission matrix, sync states, shortcut help, and full parity matrix. |
| [#26 Markdown](https://github.com/coderhd/lekhan/issues/26), [#27 Obsidian](https://github.com/coderhd/lekhan/issues/27), [#87 import retries](https://github.com/coderhd/lekhan/issues/87) | Markdown source preserves unsupported blocks. Vault ingestion builds nested pages in one local write, resolves original filenames, retains YAML and supported images, and records a retry fingerprint. | Full format and attachment fidelity, sync-side vault IR authorization and idempotency, and export compatibility. |
| [#28 Provider Registry](https://github.com/coderhd/lekhan/issues/28) | Registry, browser-direct streaming, local discovery, and the encrypted provider setup and writing assistant are implemented. | Local runner and Model Library, remaining editor actions, and live provider connections on the launch matrix. |
| [#29 Billing](https://github.com/coderhd/lekhan/issues/29), [#82 tier enforcement](https://github.com/coderhd/lekhan/issues/82) | Prior integration and specs exist on repository history. | Rebuild integration, workspace subscription entitlements, USD/INR pricing, Stripe/Razorpay checkout, webhook and lifecycle verification. |
| [#30 Publish polish](https://github.com/coderhd/lekhan/issues/30), [#85 early access](https://github.com/coderhd/lekhan/issues/85), [#93 public pages](https://github.com/coderhd/lekhan/issues/93) | Earlier implementation has issue history and published requirements. | Public reader, share controls, marketing surfaces, and waitlist verification. |
| [#31 i18n](https://github.com/coderhd/lekhan/issues/31) | Cookie-backed locale and five message catalogs cover account routes, the workspace, and top-level editor chrome. | Remaining route, chrome, SEO, and translation reviews from the approved spec. |
| [#32 Docs](https://github.com/coderhd/lekhan/issues/32) | Existing docs-site implementation in repository history, with H0 topic inventory. | Bring it onto the rebuild, verify instructions against shipped functionality, and verify the docs host. |
| [#77 sync durability](https://github.com/coderhd/lekhan/issues/77), [#81 encryption at rest](https://github.com/coderhd/lekhan/issues/81) | IndexedDB checks each write against the latest persisted revision. | Collaborative sync engine, server durability, encrypted snapshots, rotation/backfill, and deploy checks. |
| [#83 analytics](https://github.com/coderhd/lekhan/issues/83), [#84 private beta](https://github.com/coderhd/lekhan/issues/84), [#90 observability](https://github.com/coderhd/lekhan/issues/90) | Release and monitoring issues are present in GitHub. | Privacy-filtered analytics, uptime and error monitoring, launch checklist with live evidence. |
| [#88 desktop shell](https://github.com/coderhd/lekhan/issues/88) | Promoted to H0 in the later roadmap. | Tauri, vault on disk, llama.cpp sidecar, and Model Library verification. |

The H0 strategy and the latest approved issue specs determine acceptance. Current source and live verification determine completion.

## Reference observations

Reverse Engineer Anything captured the published Obsidian callout examples in `ev_0a57c6b29c287d6cb5b0d9dc85f59aee0bdd3a52158e022e431d319fed32d9d5`. The example separates the callout title from its editable content and retains ordinary Markdown and links inside it. The implementation uses Lekhan’s own editor and styling. [Obsidian callouts](https://obsidian.md/help/callouts)

## Verified on the rebuild

- `npm run typecheck`, `npm run lint`, and `npm run build` succeeded.
- 85 unit tests cover the writer, graph model, IndexedDB, bounded vault ingestion, locale catalogs, and provider adapters.
- Twelve Chromium tests passed. The new flows cover vault ZIP import, language persistence across reload, encrypted provider configuration with explicit per-request page sharing, and account routing without a backend.
- The provider browser test used an intercepted OpenAI response. Provider credentials, production billing, the hosted docs site, and the cloud sync stack still need live verification.

A separate Chromium smoke test exercised the login and logout flows against a local Supabase Auth fixture. The guest workspace and two authenticated browser replicas remained isolated. Read-only inspection confirmed that the staging project already has the page graph, import ledger, and billing tables with row-level security enabled. Staging sign-in, email delivery, and the rebuild's cloud writer still need verification.
