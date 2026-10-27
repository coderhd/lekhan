# Lekhan docs site

The public documentation site for [Lekhan](https://lekhan.app), served at
`https://docs.lekhan.app`. Self-contained Next.js + [Fumadocs](https://fumadocs.dev) app so docs
ship from this repo as markdown/MDX, versioned with the product.

## Requirements

- Node.js **20.9+** (Node 22 LTS or 24 recommended)
- npm 10+

## Develop

```bash
cd docs-site
npm ci
npm run dev
```

Open <http://localhost:3000>. The root route redirects to `/docs/getting-started`.

## Build

```bash
cd docs-site
npm ci
npm run build
npm run start
```

The build writes to `.next/` (standard Next.js output; the site uses server rendering for search, so
it is **not** a static export).

- Build command: `npm ci && npm run build`
- Start command: `npm run start`
- Output directory: `.next`
- Env vars: none required. Optional `NEXT_PUBLIC_DOCS_URL` sets the canonical metadata base
  (defaults to `https://docs.lekhan.app`).

## Content

All docs live in `content/docs/` as `.mdx`:

```text
content/docs/
├── meta.json                 # top-level navigation order
├── index.mdx                 # /docs
├── getting-started/
│   ├── index.mdx             # quickstart
│   ├── markdown-import-export.mdx
│   └── obsidian-import.mdx
├── concepts/                 # pages, workspaces, links, graph, tags
├── ai/                       # free-key on-ramp, BYOK, BYOL
├── troubleshooting.mdx
└── faq.mdx
```

Frontmatter supports `title` and `description`. Folder `meta.json` files control sidebar titles and
page order (`"pages": ["index", "..."]`).

Editorial rules:

- Use the product vocabulary in `CONTEXT.md` (page, workspace, page link, backlink, tag, on-ramp).
  "Vault" only refers to an imported Obsidian folder.
- Never promise bundled AI credits. AI always runs on the user's key or machine.
- Free models are labelled "free models may change or be slower".
- Pricing copy follows `docs/prd/h0-real-billing-prd.md` §5.1 (founding vs GA, INR regional, Team
  USD-only at launch). Update the FAQ table when pricing lands.
- Internal links use absolute docs paths (`/docs/...`). Do not link to unpublished H1 pages.

## Isolation from the main app

This app has its own `package.json`, lockfile, and Next config. The repo root `tsconfig.json` and
`eslint.config.mjs` exclude `docs-site/` so the root `typecheck`/`lint`/`build` behavior is unchanged.
Do not add this app to the root workspace or root scripts.

## Deploy hand-off

DevOps deploys this directory as its own Vercel project (root directory `docs-site`) and points
`docs.lekhan.app` at it. Search is served by `/api/search` inside this app.
