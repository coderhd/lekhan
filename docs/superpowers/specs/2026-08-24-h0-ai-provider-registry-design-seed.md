# H0: AI Provider Registry & Assistant Capability Map — Spec Seed

Status: DRAFT for #28 spec pass. Strategy base: §6 of the global strategy doc.
Decisions locked there still stand: no Lekhan-hosted inference anywhere, no
credits ledger, client-direct calls.

## Part 1 — Friction: getting a non-technical user to a working model

The docs subdomain is necessary but not sufficient: docs help people who
already decided. The friction kill-chain has four links, each with a free fix:

| Friction link | Fix | Cost to us |
|---|---|---|
| "I don't have an API key" | **On-ramp wizard** (in-product, not docs): 3 curated free-tier presets (OpenRouter free models first), deep-linked provider signup, paste field, live test button. Target: under 3 minutes from click to first AI output | zero |
| "Which model do I pick?" | Presets ship preselected defaults; dropdown groups by provider with plain-language labels ("free · slower", "fast · your quota") | zero |
| "I run Ollama/LM Studio" | **BYOL detector**: probes standard localhost ports; when CORS blocks (Ollama needs `OLLAMA_ORIGINS`), shows the exact one-line env fix in context | zero |
| "How do I do any of this?" | Docs subdomain guides linked FROM wizard steps (contextual, not a separate destination) | docs site #32 |

Evaluated and rejected/deferred:
- **Managed Lekhan keys** — dropped in §6.2; cost + abuse surface.
- **Browser-local inference (WebLLM/WebGPU)** — genuinely zero-friction and
  offline, quality ceiling too low today for assistant-grade work. Re-evaluate
  as H1 experiment ("try AI instantly, no key"); keep out of H0 scope.

## Part 2 — AI capability map (what the assistant can be)

Four layers. Layer 1 is table stakes; Layers 3–4 are where a knowledge-graph
product wins because AI operates ON structure (links, properties, tags), not
just text.

### L1 — Text actions (in-editor)
Rewrite / summarize / translate / continue writing / fix grammar on selection.
Ship with registry as the visible proof that AI works at all.

### L2 — Page-aware actions
- Page Q&A ("explain this page"), title/summary generation
- **Tag & property suggestions written back through the typed index**
- Wikilink completion while typing (suggest existing pages as `[[...]]`)

### L3 — Graph-aware intelligence (the differentiators)
- **Ask your vault**: RAG over pages + link structure; answers cite pages,
  click-through navigates the graph
- **Auto-linker**: scan unlinked mentions across workspace → suggest
  connections in bulk (graph-native; turns import into instant value)
- **Structure generation**: bullets → project page with task list +
  properties; meeting notes → structured page template
- **Import report companion**: natural language over what degraded (#78 synergy)
- Daily digest: what changed since last visit, across pages you follow

### L4 — Agentic maintenance (H2, epic #50)
Auto-organize inbox, orphan/broken-link janitor, research agent that drafts
pages with citations into the graph.

## Part 3 — Differentiation

| Dimension | Notion AI | Obsidian plugins (Copilot, Smart Connections…) | Lekhan |
|---|---|---|---|
| Where content goes | Notion cloud, their models, per-seat fee | Direct to whatever key each plugin configured | Direct to user-chosen provider/local model — never our servers |
| Cost | $8–10/seat add-on, opaque | Free plugins, user pays providers (fragmented config per plugin) | Same provider payment, ONE registry configures every feature |
| Model choice | Their roadmap | Per-plugin | Any OpenAI-compatible endpoint, incl. local = offline-capable AI |
| Collaboration awareness | Yes (their stack) | None — plugins are single-player, unaware of CRDT/permissions | Registry + features sit inside the collab stack (presence, permissions respected) |
| Write-back | Their block model | Plain text inserts | Typed write-backs: tags, properties, links, page structure |
| Trust story | "Trust Notion" | "Trust each plugin author" (unsandboxed) | "Your key, your provider, auditable calls" |

Honest note: Smart Connections/Copilot cover real ground on vault-Q&A. Our win
is not a single feature — it is *one registry powering every capability*,
*collab-awareness*, and *typed write-back into the graph*. Say this plainly in
marketing instead of claiming novelty on RAG.

## Part 4 — The bridge-vs-product fear

Named, and managed structurally rather than by reassurance:

1. **Capacity rule**: interop work ≤ ~25% of any horizon's tickets. H1's
   headline remains graph view + daily notes; the importer rides along.
2. **Nobody switches FOR an importer.** Importers remove reasons to stay away;
   they never create reasons to stay. Retention comes from L1–L3 above plus
   graph view/daily notes — all native product.
3. **The AI layer is inherently full-product territory**: its value is a
   function of graph depth. Every capability we add makes the bridge LESS
   central, because the graph itself becomes the point.
4. Watch metric: % of weekly active users who use any interop feature vs any
   native feature (#83 events). If interop dominates usage, we have become the
   bridge — and will know it early.

## Part 5 — #28 implementation scope (this epic)

1. Provider registry data model: encrypted per-user provider configs
   (generalize `lib/crypto.ts` to N entries), default presets table
2. Client-direct router: thin `app/api/ai` keeps auth + config fetch only;
   inference calls go browser → provider
3. Model picker in bot bar + settings; per-request override; streaming passthrough
4. BYOL detector + connection test UX
5. On-ramp wizard (presets → deep link → paste → test)
6. L1 text actions on the new plumbing as the acceptance demo
7. Usage honesty: show user their own token counts per response

Out of scope: L2+ features beyond one L1 demonstrator (separate tickets),
WebGPU experiment, team-shared keys (Enterprise, later).
