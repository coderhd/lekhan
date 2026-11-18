# Clean-room review — PR #201 (SIL-224)

Adversarial review of `docs/sil-224-brevo-templates` vs
`docs/sil-201-brevo-welcome-sequence` (the stacked base: SIL-223 copy).
Reviewer: independent clean-room subagent, no authorship context. Scope: the
whole change, not just the diff.

Verdict: **no blocker**. Six should-fix findings and eight nits; all should-fix
items and the accuracy-relevant nits were fixed in the same commit.

## What the reviewer verified

- `node scripts/render-brevo-previews.mjs` — 8 previews, no overflow, no size
  mismatch. `npx eslint scripts/render-brevo-previews.mjs` — clean.
- Copy fidelity: every subject, preview text, HTML body and `.txt` body matches
  `brevo-welcome-sequence.md` §3–§6, byte-for-byte for the text parts except the
  documented `[INVITE LINK]` → `{{contact.INVITE_URL}}` substitution.
- No secrets, credentials, real personal data, tracking pixels, `<script>`,
  `<style>`, web fonts or non-wordmark assets. All four tables parse with no
  unclosed tags; all `href`s are `&amp;`-encoded correctly.
- Previews differ from the templates only by the documented sample-value
  substitutions.

## Findings and resolutions

| # | Severity | Finding | Resolution |
|---|---|---|---|
| S1 | should-fix | `README` source-copy link resolved to `docs/marketing/brevo/brevo-welcome-sequence.md`, which does not exist | Fixed to `../../brevo-welcome-sequence.md`; all 22 relative links now resolve |
| S2 | should-fix | `{{senderAddress}}` is not in Brevo's public tag reference (help-centre search returns 0 results), yet the README described its behaviour as settled | Documented as unverified; test-send gate added; hard-coded postal-address fallback documented; in-template comment added at the footer |
| S3 | should-fix | Brevo's UI path in the import checklist ("Import HTML / Paste your code", plain-text tab) does not exist in the current product | Rewritten to the HTML custom-code editor and the campaign's "View the plain text version → Edit" flow |
| S4 | should-fix | `max-width:600px` is ignored by Outlook desktop; the card would stretch to the window | Added `width="600"` alongside `width:100%;max-width:600px` |
| S5 | should-fix | A cold run produced a clipped/tiled full-page screenshot while the overflow guard still passed | Script now uses a fresh page per capture and asserts PNG dimensions against `scrollHeight × DPR`; README wording corrected |
| S6 | should-fix | Outlook collapses the button padding, leaving a ~20px target | Added `mso-padding-alt:14px 22px` to the CTA anchors |
| N1 | nit | Email-4 inline invite link carried a UTM in HTML but not in text; the doc's body link is bare | HTML inline link is now `{{contact.INVITE_URL}}` with no UTM; button keeps the tracked URL; registry lists both |
| N2 | nit | "renders blank or 'there'" is a Mailchimp behaviour, not Brevo's | Reworded to "blank unless a value-if-empty is configured" |
| N3 | nit | Provenance mixed SIL-223/SIL-201 and cited PR #199 as if merged | Reworded: SIL-223 copy, PR #199 stacked (open at time of writing) |
| N4 | nit | Hidden preheader plus Brevo's preview-text field would duplicate the inbox snippet | Hidden preheaders removed; the Brevo field is the single source |
| N5 | nit | README overstated preview reproducibility | Preview section now states 2× DPR and that pixels can shift across machines |
| N6 | nit | 1.7 MB of PNGs | Accepted: 2× is needed for legibility; images are the preview evidence the AC asks for |
| N7 | nit | Preheader comment described a figure space as zero-width | Removed with N4 |
| N8 | nit | Brevo's docs write `{{ unsubscribe }}` with spaces | Noted in the merge-tag table; test send is the proof |

## External review — pullfrog

pullfrog reviewed the full diff against the copy doc, Brevo's docs and a live
render: **no critical issues**, two minor inline notes, both about doc
references rather than the templates.

| Finding | Resolution |
|---|---|
| "Brevo → Campaigns → Templates → New template" is the wrong top-level path; current docs use Marketing → Templates → Create template | Step 2 of the checklist now uses `Marketing → Templates → Create template → Start from scratch`, keeping the "labels move between releases" hedge |
| "If a tag does not turn orange/chip it will not resolve" asserts an editor invariant Brevo does not document | Reworded: a valid tag may render as a chip or plain text, and the test send is the authoritative check |

CodeRabbit: auto-review skipped on a non-default base branch, then the manual
trigger hit the free OSS review limit. Explicit waiver posted on the PR with the
reason and the internal-review coverage.

## Re-check after fixes

- `node scripts/render-brevo-previews.mjs` — 8 previews, guards passed.
- `npx eslint scripts/render-brevo-previews.mjs` — clean.
- `git status` after re-render — previews byte-identical.
- Copy verification (HTML body ≡ `.txt`, `.txt` ≡ copy-doc block) — all pass.
- Relative-link check — 22/22 resolve.
