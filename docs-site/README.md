# Lekhan Docs

Fumadocs and Next.js serve the MDX guides in `content/docs`. Keep instructions in step with the workspace UI and link readers to the relevant guide rather than repeating setup steps.

## Run locally

Use Node 24, the same major used by the documentation build check.

```sh
cd docs-site
npm ci
npm run dev -- --port 3190
```

Open [local docs](http://localhost:3190). The root redirects to `/docs/getting-started`. Folder `meta.json` files set the sidebar order. Use absolute `/docs/…` links between guides.

## Verify

```sh
npm run check:links
npm run lint
npm run build
npm run start -- --port 3190
```

Check the quickstart, a guide from each section, and the search dialog on desktop and mobile. The production build needs a Next.js runtime to serve the search API. Fonts are installed with the app and do not require a build-time font service.

## Deployment

The existing `lekhan-docs` Vercel project serves [docs.lekhan.online](https://docs.lekhan.online). Set its root directory to `docs-site`. The docs use that domain for canonical URLs and link to [the workspace](https://lekhan.online/workspace).

- `NEXT_PUBLIC_DOCS_URL` overrides the canonical docs origin.
- `NEXT_PUBLIC_LEKHAN_APP_URL` overrides the app origin used by **Open workspace**.
- Set `NEXT_PUBLIC_DOCS_URL` in the main app to show a **Docs** link in its public footer.

The August strategy names `docs.lekhan.app`. Verify domain access and DNS before switching the public hostname or changing canonical URLs.
