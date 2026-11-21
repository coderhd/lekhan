# Lekhan

A browser workspace for writing and linking pages. This branch rebuilds the personal writing workflow from the original [product roadmap](docs/roadmap.md).

## Run locally

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Pages are saved in IndexedDB for that browser and origin. Use the workspace export to make a portable Markdown copy.

```sh
npm run typecheck && npm run lint && npm test && npm run build
npx playwright install chromium
npm run test:e2e
```

The [writing workflow specification](docs/superpowers/specs/writing-workflow-rebuild-spec.md) describes the milestone and its verification.
