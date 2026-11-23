# Lekhan

A browser workspace for writing and linking pages. This branch rebuilds the personal writing workflow from the original [product roadmap](docs/roadmap.md).

## Run locally

```sh
npm ci
npm run dev
```

Open [the local workspace](http://localhost:3000/workspace). Pages are saved in IndexedDB for that browser and origin. Use the workspace export to make a portable Markdown copy.

```sh
npm run typecheck && npm run lint && npm test && npm run build
npx playwright install chromium
npm run test:e2e
```

The [writing workflow specification](docs/superpowers/specs/writing-workflow-rebuild-spec.md) describes the milestone and its verification.

## Desktop development

Install the [Tauri desktop prerequisites](https://v2.tauri.app/start/prerequisites/) for the operating system and use Rust 1.90 or later.

```sh
npm ci
npm run desktop -- dev
npm run desktop -- build
```

The desktop shell bundles the shared writer. **Cloud workspace** opens the Next.js app in a separate window. Build with `LEKHAN_DESKTOP_CLOUD_ORIGIN` to test against a deployed preview or a local Next.js server. The app defaults to `https://www.lekhan.online`, where the rebuilt workspace requires deployment. The host must be an HTTPS origin or loopback HTTP.

The development shell currently saves local pages in the desktop webview. [The Markdown vault and Yjs storage requirements](docs/adr/0003-desktop-markdown-plus-yjs-sidecar.md) and the [desktop release scope](https://github.com/coderhd/lekhan/issues/88) describe the remaining release work.

## Account access

Configure the public Supabase project URL, publishable key, and canonical application origin using the variables in `.env.example`. Enable email/password authentication and allow the configured application's `/auth/confirm` redirect in Supabase. This route accepts verified token-hash confirmation and the PKCE exchange code. Configure the recovery template with `type=recovery` for token-hash links. Use the default Supabase recovery redirect flow for PKCE.

Guest pages and signed-in account pages have separate browser replicas. Account access does not move existing guest pages or send them to Supabase. Use Markdown export and import to move local material explicitly.
