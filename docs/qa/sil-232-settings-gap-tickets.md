# GAP tickets — settings-surface audit extension (SIL-232)

Status: **filed on GitHub 2026-11-03** — GAP-11 → [#203](https://github.com/coderhd/lekhan/issues/203),
GAP-12 → [#204](https://github.com/coderhd/lekhan/issues/204), GAP-13 → [#205](https://github.com/coderhd/lekhan/issues/205),
GAP-14 → [#206](https://github.com/coderhd/lekhan/issues/206), GAP-15 → [#207](https://github.com/coderhd/lekhan/issues/207),
GAP-16 → [#208](https://github.com/coderhd/lekhan/issues/208). Numbering continues the SIL-8 GAP
format (first pass filed GAP-1…GAP-10 as #137–#146). This file is the verbatim copy of record.

---

## GAP-11 (P2) → [#209] — Orphaned settings surfaces diverge from /settings post-cutover

**Title:** `[Polish] Remove or wire orphaned settings components: UnifiedSettingsModal + ModelLibrary are dead code with stale "Coming Soon" tabs`

`components/settings/unified-settings-modal.tsx` and `components/settings/model-library.tsx`
are imported only by their own tests (`tests/unit/unified-settings.test.tsx`,
`tests/unit/model-library-ui.test.tsx`, referenced from `tests/unit/sarvam-scrub.test.ts`).
The modal still advertises a "Plan & Usage" tab and three "Coming Soon" panels for surfaces
that are **live** on `/settings` today (billing tab: real T12 states; general/profile tab:
Profile & Security tab). Keeping two settings perceptions diverging post-billing-cutover
(SIL-8 #29, PR #158) is a stale-state trap.

Options: (a) delete both components + their tests, or (b) wire the modal as the editor-side
settings entry reusing live tab content. Evidence: `grep -rn "UnifiedSettingsModal|ModelLibrary" app components` → tests only.

---

## GAP-12 (P2) → [#210] — Two divergent BYOK/AI-settings affordances on the settings surface

**Title:** `[Polish] Settings has two contradictory AI/BYOK stories: Sarvam-only card vs 10-provider registry`

- Usage tab: `components/byok-settings.tsx` — a Sarvam-only card (`sk_`-format gate, `/api/ai`
  validate-key, local AES-256-GCM store, "Sarvam AI Key" copy, AI panel shortcut list …).
- AI & Models tab: `components/settings/ai-provider-settings.tsx` — the provider registry with
  10 providers and its own encrypted vault (`lib/ai/vault.ts`) rendered from `registryState`.

Same page, different key stores, different claims. The AI settings panel
(`components/ai-settings-panel.tsx`, used inside the editor) adds a third place where "Settings"
voice exists. Consolidate: either fold the Sarvam card into the registry row or retire it once
the registry covers Sarvam; align naming (see GAP-14). Evidence: the two cards render on the
same `/settings` route (usage + AI tabs).

---

## GAP-13 (P2) → [#211] — CustomSelect is not an accessible select

**Title:** `[A11y] CustomSelect trigger has no accessible name / state relationship to its label`

`components/ui/custom-select.tsx` renders `Radix DropdownMenu.Trigger` as a bare button whose
only content is the current value (plus chevron). Screen-reader users hear "Editor" — not
"Role: Editor". Affected call sites on audited surfaces: collaborator role picker
(`settings-client.tsx`), workspace ownership pickers, AI panel translate/TTS selects. Radix's
Menu basis also announces "menu" rather than a combobox. Fix direction: offer a labelled
`role=combo` trigger (`aria-labelledby` pairing with visible labels, selection announcements)
or migrate role pickers to `native select`. WCAG 4.1.2.

Related settings-tablist deviations sampled by the SIL-232 audit (fix together):
- `aria-orientation` is unset on the `role=tablist` aside — physical rail is horizontal at
  390 px, vertical at `lg:`; AT announces the wrong arrow semantics either way.
- Inactive tab panels are unmounted while every tab carries `aria-controls="settings-panel-*"`.

---

## GAP-16 (P2) → [#214] — Razorpay checkout has no return landing / feedback on /settings

**Title:** `[Billing] After a Razorpay (INR-rail) checkout there is no return state or feedback on /settings`

Stripe returns land on `/settings?billing=<state>` (`lib/billing/stripe.ts:166-207`) and are
consumed as of SIL-232. The Razorpay rail opens `subscription.short_url`
(`lib/billing/razorpay.ts:363-372`) — a hosted payment page with **no return URL handling**
anywhere, so INR-rail users come back to settings with zero acknowledgment and the known
webhook-application lag is undisguised. Inside Razorpay-a11y there is usually no auto
redirect-back; when available, wire `options.callback_url`/`return_url` to
`/settings?billing=razorpay_return` (distinct per portal/checkout) and consume it beside the
Stripe states; otherwise show a "payment pending — we'll confirm when the provider reports
back" state after returning from the Razorpay sheet. Post-cutover parity work; pairs with
GAP-14's copy sweep so the INR copy matches the honest no-claim toast pattern.

---

## GAP-14 (P2) → [#212] — Billing copy uses "plan" workflow-wide while Context vocabulary pins "tier"

**Title:** `[Polish] Billing surface copy says "plan" everywhere; CONTEXT.md Tier row says avoid "plan (code legacy)"`

`billing-settings.tsx` copy: "Subscription & Plan", "Plans", "plan changes and cycle switches",
"Changing plans: upgrades apply immediately…", "You keep the paid plan until then",
active-url param and `PricingMatrix` props (`currentPlan`). Tests pin several strings
(`tests/unit/settings-tabs.test.tsx` asserts "Subscription & Plan"). A sweep must cover the
billing tab, `pricing-plans`, ownership-transfer card ("the current plan stays"), and pinned
tests together. Cheap single-word fixes inside the AI usage tab were already fixed in SIL-232;
the billing surface needs a coordinated copy pass.

---

## GAP-15 (P2) → [#213] — Mobile settings tab rail has no scroll affordance

**Title:** `[Polish] 390px settings: horizontal tab rail overflows with no visual scroll indicator; last tab off-screen`

At 390 px the settings `role=tablist` renders as a horizontally scrollable rail of five
`whitespace-nowrap` tabs (~780-820 px combined width vs 390 px viewport, `aside` of
`settings-client.tsx`, `overflow-x-auto` without any fade/chevron). "Billing & Subscription"
is fully off-screen until the user discovers scrolling. Add an affordance (edge fade +
chevron, or collapsed/shortened labels ≤ 390 px) per the mobile-reflow bar in #79. Touch
targets measure ~36-40 px (`py-2.5` buttons, `py-3` tabs with text-xs line height) — they
pass WCAG 2.5.8 but sit below the 44 px HIG bar; bring them to ≥ 44 px while touching the
rail (affordance + sizing pass).

---

## Scope note (P3, no ticket — recorded for the next settings touch)

- Hardware/local-probe results in `ai-provider-settings.tsx` pop in with no skeleton/loading
  state (they appear 0.1-2 s later); fine at current sizes, becomes a flash at larger probe
  latencies.
- No document title is set on `/settings` (or any app surface) — tab shows the site-default
  metadata title. Cross-surface if/when a title strategy lands.
