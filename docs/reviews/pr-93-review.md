# Clean-Room Review — SIL-3 · GitHub #93 · Public marketing pages

- **Diff:** `git diff origin/main...feat/sil-3-public-pages-redesign` (branch pushed to origin)
- **Reviewer:** fresh-context adversarial subagent (Stage-5 gate per AGENTS.md); findings independently re-verified against shipped code before implementation
- **Verdict:** REQUEST-CHANGES → findings 1–5, 6–7, 9–11, 13 implemented; fixes below re-verified

## Hallmark audit punch list — resolve/waive record (AC#1)

**Resolved:** structural fingerprint (asymmetric 7/5 hero, typographic workbench, hairline proof strip, no equal-card quartet), banned voice words, fabricated social proof, slogan-numbers stats, third-pillar positioning gap, card duplication, `<button router.push>` → `<Link>`, "zero latency" overclaims, unDraw stock → real product screenshots, emoji-as-icons → lucide, token drift (`text-muted-foreground` → `text-on-surface-variant`, legal pages visual-only), footer channel consistency, allegiance stamps + `.hallmark/log.json`, hero-glow blobs removed from `/`.

**Consciously waived / deferred (owner noted):**
- Header glyph `☰`/`✕` → lucide and `alt="Lekhan Logo ekhan"` SR fix — pre-existing app-shell chrome outside this diff's spirit; one-line follow-ups for a shell pass.
- Loader flash on `/` (session round-trip gates first paint) — fixing risks signed-out flash for authed users; needs a router-level decision, deferred to tech lead.
- `public/hero-illustration.svg`, `step-1/2/3.svg` now referenced nowhere — kept on disk deliberately (campaign kit); delete whenever assets are audited.

## Review findings → disposition

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | critical | "browser-direct / never on our servers / never meters credits" falsified: only ollama/lmstudio are direct (`lib/ai/provider-registry.ts` — cloud → `/api/ai/stream` relay); `app/api/ai/route.ts` falls back to `SARVAM_API_KEY`; credits metered (50/500/2500/3500, HTTP 402) | **FIXED.** Truth established first: a valid BYOK key fully bypasses gating and deduction (`remainingCredits < requiredCredits && !hasValidByokKey`). All 5 surfaces rewritten to "AI on your own keys — or a local model; on your key, AI never consumes plan credits." Root-cause fixed too: `.agents/product-marketing.md` (the voice source) corrected — its stale "we never host inference or meter credits" line is where the claim was born. |
| 2 | major | "Every version is kept / never paywalled" vs 100 MB auto-checkpoint prune (`editor-workspace.tsx:350`, `indexeddb.ts:69-97`) and plan-tied in-app labels | **FIXED.** FAQ now: "Pin any version and it stays forever; auto-snapshots roll inside a generous local budget (100 MB per document) … never gated by plan." Tension between app label (`version-history.tsx:216-221`) and tier limits → follow-up ticket for product copy. |
| 3 | major | FAQ "only you and the people you share with" ignores shipped public-link mode (`share-modal.tsx:185`) | **FIXED.** Public-link caveat added. |
| 4 | minor | Footer lacks GitHub while contact page claims open-source | **FIXED.** GitHub → `coderhd/lekhan` added to `socialLinks`. |
| 5 | minor | "our GitHub repository" → personal profile URL | **FIXED.** Contact card + prose link → `github.com/coderhd/lekhan`. |
| 6 | minor | Proof strip section has no accessible heading | **FIXED.** `<h2 class="sr-only">Proof, not adjectives</h2>`. |
| 7 | minor | Figures lack intrinsic dimensions → CLS | **FIXED.** width/height 1280×661 (editor), 1280×657 (import). |
| 8 | minor | FAQ claims at-rest encryption; frozen privacy policy says transit only | **NOTED, legal untouched** (AC: copy untouched). At-rest claim verified against ADR 0001 (explicitly authorizes this default claim; forbids only E2E) + `lib/server-crypto.ts` in persister/version routes. Legal-copy update needs a human legal pass. |
| 9 | minor | "Founding edition now open" static badge goes stale when 500 fill | **FIXED.** Badge → "Founding edition · 500 numbered spots · closes when full" (statically true; /early renders live state). |
| 10 | minor | "They join instantly" vs invite → login redirect (`app/invite/[token]/page.tsx:28-32`) | **FIXED** on landing step 2 **and** the analogous FAQ invite answer. |
| 11 | nit | "the AI bill stays yours and yours alone" rhymey | **FIXED** in card-4 rewrite ("The AI bill stays yours."). |
| 13 | nit | About values-card icon block mis-indented | **FIXED.** |
| 14 | minor | No punch-list resolve/waive artifact | **FIXED** by this file. |

## Claims trace (post-fix)

| Claim | Trace |
|---|---|
| 4 export formats (markdown/HTML/PDF/DOCX) | `ExportType` union, `editor-workspace.tsx:49`; generators in `lib/export-utils.ts`; PRODUCT.md corrected 5→4 |
| 0 round-trips per keystroke / saved locally first | local-first save path; same statement in FAQ "local-first" answer |
| BYOK: own key or local model — cloud calls relayed through our API to the chosen provider, local models (Ollama/LM Studio) browser-direct; on your own key, no plan credits consumed | `lib/ai/provider-registry.ts` (`isLocalDirect` only for local; cloud → `/api/ai/stream` pass-through relay, no persistence in route); `app/api/ai/route.ts` quota gate (`remainingCredits < requiredCredits && !hasValidByokKey`) |
| "on your own key, AI never consumes plan credits" | `app/api/ai/route.ts` — quota gate + deduction both skip when `hasValidByokKey` |
| 500 founding spots, price locked for life, closes when full | `app/early/page.tsx` `FOUNDING_CAP = 500` + founding-pricing section |
| Obsidian fidelity: wikilinks, callouts, frontmatter, tags + honest report | `services/obsidian-import.ts` + `tests/unit/obsidian-import.test.ts` |
| Version history: git-style local, pinned forever, 100 MB auto budget, visual diffs | `editor-workspace.tsx:347-364`, `version-history/adapters/indexeddb.ts:69-97` |
| Encrypted in transit and at rest by default | ADR 0001 (accepted), `lib/server-crypto.ts` usage in server persister + version route |
| E2E / native apps / databases / user counts | NOT claimed — claims-NOT-allowed list respected |

## Verification log

- eslint + `tsc --noEmit` clean on every touched file (both passes)
- `npm test` 83 files / 631 tests passed; `npm run build` success (BUILD_ID ML3tnzvbZlizyXWATW1nq)
- Browser sweep (live dev server, pre-claim-fix state): 24/24 overflow probes clean at 320/375/414/768 across `/`, `/about`, `/faq`, `/contact`, legal ×2; 88 keyboard Tab stops with focus ring on every element; `prefers-reduced-motion` emulation collapses all 34 animated/transitioned elements to 0.01ms
- Post-claim-fix re-probe: below in PR thread (dev server re-verification)

## Not-applicable axes (confirmed, not assumed)

- Axis 3 CRDT/storage: diff touches zero `lib/`/`services/`/`hooks/`/storage code (9 marketing files + 2 docs)
- Axis 4 backend security: no routes/migrations/server code changed

## External review round 2 — pullfrog on PR #135 (2026-10-08)

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| P1 | major | Public copy (landing :77/:198, about :24, faq :56) contrasts own-keys vs local models but never states cloud BYOK calls are relayed through Lekhan's API — material to the privacy claim | **FIXED.** Relay language added at every AI-claim surface: "cloud calls are relayed through our API to the provider you pick … local models connect straight from your browser." Verified against `app/api/ai/stream/route.ts` — pure pass-through, no persistence in route. Hero positioning lines stay as-is: PRODUCT.md declares the positioning line binding everywhere; the card directly under it carries the architecture detail. |
| P2 | major | PRODUCT.md positioning/constraints still call user-key AI a strategic target / "do not market until shipped" (lines 20/24/32/34), contradicting shipped reality and inviting future copy reverts | **FIXED.** Product Purpose, Positioning, Capabilities and Constraints reconciled to shipped truth (BYOK live: relay on user key, local browser-direct, plan-credit fallback without key). Bright line corrected from false "no hosted AI inference ever" to "the AI bill is the user's — their key, their local model, or an explicit plan credit; no silent hosted inference". |

## Follow-ups surfaced by review (not diff defects)

1. **[security, tech lead]** `app/api/ai/stream/route.ts` appears to relay user-supplied provider keys with no visible session check — open-relay risk; needs independent review.
2. **[product copy, dev]** In-app version-history label says "cloud & local" retention is plan-tied (`version-history.tsx:216-221`) while the local engine has no tier gate — reconcile app copy with reality (ADR 0002).
3. **[legal, human]** Privacy-policy "encryption in transit" sentence lags the shipped at-rest default (ADR 0001) — legal pass, copy otherwise untouched per this issue's AC.
4. **[marketing, after epic #28 lands]** Re-audit AI card + FAQ AI answer when the provider epic redesign ships; PRODUCT.md marks AI ownership a moving target.
