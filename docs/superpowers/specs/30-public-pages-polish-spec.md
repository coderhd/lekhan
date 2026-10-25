# Spec — #30 H0 Public Pages polish (SIL-31)

Epic: H0 — Public Pages / Publish polish. Full publish/public-sites is H1 (strategy spec scenario);
this spec holds the H0-scoped polish of the existing surface: `pages.is_public` +
`app/page/[id]` + share modal. H1 will build the dedicated publish surface on top.

## Current state (audited 2026-10-26)

Anonymous visitors to a public page get a synthetic session (`token: 'anonymous'`, server maps it to
viewer role — `server/auth.js`) and the **full `EditorWorkspace`** in viewer mode. Content and
correctness are fine (RLS `select_pages_public`, `isViewer` gating), but the **presentation is
collaborator chrome, not a reading surface**:

1. Visitor sees sync clock, live collaborator avatars, global-search, version-history, AI-settings,
   profile menu ("Anonymous Viewer") — all meaningless to a reader.
2. Brand touch missing entirely: no "public / powered by Lekhan" signal, no signup CTA — the viral
   loop the publish story (\#30) depends on. Signed-out readers bounce invisibly.
3. Non-public or missing page → silent `router.push('/login')` with zero explanation.
4. Copy violates domain language: share modal and viewer banner say "Document" (CONTEXT.md: avoid;
   page is the node). Export button title too.
5. Editor workspace has no way to know it is serving an *anonymous* visitor (only codes "viewer"):
   the reading surface can't be differentiated from a member viewer today.

## Requirements (Given/When/Then)

### P1 — Public reading surface for anonymous visitors

- **Given** a signed-out visitor opens `/page/<id>` of a `is_public` page
  - the workspace knows the session is anonymous (`anonVisitor` prop from the route),
  - header shows: Lekhan logo, page title (read-only), a **Public — view-only** badge, theme toggle
    (visible on mobile too),
  - hidden: sync indicator, collaborator avatars, global search, history, AI settings, mobile menu,
    profile menu,
  - a slim footer reads "Anyone with the link can view this page. **Create your own workspace →**"
    linking to `/signup` (viral loop),
  - editing remains impossible (unchanged `isViewer` pipeline — RLS + anonymous token + `editable: false`).

### P2 — Access-denied screen instead of silent redirect

- **Given** a signed-out visitor opens a non-public or missing `/page/<id>`
  - they see an inline denied screen (lock glyph, "This page isn't available", hint text,
    primary "Log in" → `/login`, secondary "Create your workspace" → `/signup`)
  - no toast-and-bounce, no blank `/login` hop.
- **Given** a signed-in user opens a page they can't access: same denied screen with a
  "Back home" primary action (replaces `toast.error` + `router.push('/')`).

### P3 — Domain-language copy pass on the public/share surface

- Share modal: "Document is visible to anyone without sign in" → "Anyone with the link can view
  this page"; "Only invited collaborators can access" → "Only invited collaborators can view or edit";
  public-link input aria/label clarity.
- Viewer banner: "You only have viewing access to this document." → "You have viewing access to
  this page." (anon variant per P1); export title "Export Document" → "Export page".

## Out of scope (H1 publish epic)

OG/meta tags + server rendering of public pages, custom slugs, published-site hosting, per-page
analytics, visitor export/download, password-protected pages. No schema changes, no new API
surface, no changes to `server/auth.js` or RLS.

## Consistency invariants

- Domain language per CONTEXT.md (Page/Workspace; no "Document" in user-facing copy).
- No regression for member viewers or editors: every new visibility gate keys off `anonVisitor`,
  never off `isViewer` alone.
- Follow existing UI system (Material-3-ish tokens `bg-surface-container*`, `text-on-surface*`,
  `premium-transition`) and Material Symbols icons.

## Verification plan

- Unit (vitest + RTL): denied-screen component; EditorWorkspace anon render (no collaborator chrome,
  badge + footer present, read-only banner copy); share-modal copy assertions via existing patterns
  if cheap.
- `npm run typecheck && npm run lint && npm test && npm run build` before review.
- Clean-room adversarial subagent review of `git diff origin/main...HEAD` (4 axes) before PR.
