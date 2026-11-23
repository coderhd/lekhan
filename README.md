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

Choose **Open folder** to write directly into an existing or empty vault. The writer opens Markdown files in nested folders and picks up edits made in another app. On a conflict, export the draft before opening the newer disk copy. Lekhan keeps deleted Markdown in the vault’s `.lekhan/trash` directory. The app remembers the last opened vault. Notes from the earlier desktop preview can be exported from the desktop sidebar.

In **Page context → Attachments**, preview linked images or download a linked file. **Attach file** copies a file up to 50 MiB into the vault’s `Attachments` folder and inserts a relative Markdown link. When you move a note or parent folder in Lekhan, the app updates the affected attachment links and leaves the attachment files in their original locations.

The vault keeps Yjs updates and compacted snapshots under `.lekhan/yjs`. Lekhan replays an interrupted save on open. If a file changed outside Lekhan during the interruption, it keeps the external version and saves the interrupted draft as Markdown under `.lekhan/recovery`. Keep the hidden `.lekhan` folder with the vault when you back it up.

The current desktop vault reads up to 128 MiB of Markdown with a 16 MiB limit per file. [The Markdown vault and Yjs storage decision](docs/adr/0003-desktop-markdown-plus-yjs-sidecar.md) and [desktop release scope](https://github.com/coderhd/lekhan/issues/88) describe the storage format and remaining release work.

### Local models

Build the desktop bundle with the pinned llama.cpp sidecar using CMake and Git.

```sh
npm run desktop:package
```

The package script defaults to Metal on macOS and CPU on Windows and Linux. Set `LEKHAN_LLAMA_BACKEND` to `cuda` or `vulkan` on a machine with the corresponding build SDK and driver. Build on the target platform. A debug build can also use an installed server via the absolute `LEKHAN_LLAMA_SERVER` path. [Pinned llama.cpp source](https://github.com/ggml-org/llama.cpp/tree/61881b1f7f0b13d9e46d561fc25afcd6bbaec479)

Open **Model Library → Discover** to find a curated model. Each listing shows its download size, estimated memory and intended use. Lekhan keeps paused transfers on disk across app restarts and checks each model against its pinned SHA-256 digest before installation.

Open **Installed** to select a model for the writing assistant, see storage usage, or remove the library copy. **Add GGUF model** copies a model you already have. Discard a partial download from its listing to reclaim the space. Prompts sent through **On this device** go to the local runtime. Windows and Linux runtime verification remains open.

## Account access

Configure the public Supabase project URL, publishable key, and canonical application origin using the variables in `.env.example`. Enable email/password authentication and allow the configured application's `/auth/confirm` redirect in Supabase. This route accepts verified token-hash confirmation and the PKCE exchange code. Configure the recovery template with `type=recovery` for token-hash links. Use the default Supabase recovery redirect flow for PKCE.

Guest pages and signed-in account pages have separate browser replicas. Account access does not move existing guest pages or send them to Supabase. Use Markdown export and import to move local material explicitly.
