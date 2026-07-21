# AI Panel v2 — Inline Command Palette & India-First AI Tools

## Overview

Rework Lekhan's AI assistant experience from a side-panel-centric tabbed UI to a modern **inline command palette** model, with new India-specific Sarvam AI features. The side panel becomes a lightweight **Settings** surface for preferences. This is Sub-project 1 of the broader Lekhan workspace rework — pricing/plans and Sheets/Slides are separate future specs.

## Background & Problems

### Current State
- AI panel is a right-side panel with 3 tabs: Assistant, Translate, Speech
- The bubble menu offers hardcoded Hindi translate and TTS buttons
- Only 10 of 23 supported languages and 3 of 38 available voices are exposed
- No transliteration or language detection capabilities

### Problems Being Solved
1. **Quick panel Translate button** opens the AI panel without text selection context — user sees "Please select some text" error
2. **`insertContent()` replaces selected text** when inserting AI results — for translations or summaries this destroys the original
3. **AI tools are generic** — no differentiation for Indian consumers despite Sarvam offering India-specific capabilities
4. **UX friction** — users bounce between editor and side panel for every AI action
5. **Mobile popup scroll bug** — color picker, text selection menus, and other popup menus are not scrollable on mobile touch screens

---

## Proposed Changes

### 1. Inline Command Palette

The primary AI interaction moves to a floating command palette triggered inline.

#### Trigger Mechanisms

| Trigger | Behavior |
|---------|----------|
| Type `/ai` in editor | Opens palette at cursor position (TipTap suggestion extension) |
| `Cmd+J` / `Ctrl+J` | Opens palette at cursor (or selection if text is selected) |
| Bubble menu `✨ AI` button | Opens palette with selection pre-loaded |

#### Palette UI

- **Floating dropdown** anchored to cursor position, ~320px wide, max-height with scroll
- **Search/filter input** at top — fuzzy-filters available actions as user types
- **Categorized action list** with icons and optional keyboard shortcut hints
- **Selection context header** — when text is selected, shows "Working with: *[first 30 chars...]*"
- Dismisses on `Escape` or click-outside

#### Action Categories

**Write**
| Action | Icon | Requires Selection | Description |
|--------|------|-------------------|-------------|
| Summarize | `summarize` | Yes | Condense selected text |
| Fix Grammar | `spellcheck` | Yes | Correct spelling and grammar |
| Improve Flow | `edit_note` | Yes | Rewrite for better readability |
| Expand | `expand` | Yes | Add more detail to selected text |
| Custom Prompt | `chat` | No (optional) | Freeform instruction with optional selection context |

**Translate**
| Action | Icon | Requires Selection | Description |
|--------|------|-------------------|-------------|
| Translate to... | `translate` | Yes | Opens nested language picker (all 23 languages) |

**Script**
| Action | Icon | Requires Selection | Description |
|--------|------|-------------------|-------------|
| Transliterate to... | `language` | Yes | Opens nested script picker (convert between Indian scripts) |

**Voice**
| Action | Icon | Requires Selection | Description |
|--------|------|-------------------|-------------|
| Read Aloud | `volume_up` | No (reads full doc if no selection) | TTS with preferred voice and language |

#### No-Selection Behavior

When no text is selected:
- Actions requiring selection show dimmed with "Select text first" hint
- Custom Prompt and Read Aloud remain fully functional
- **This fixes the current bug** where the Translate button opens the panel to an error state

#### Multiple Invocations

- If a diff preview is already showing and the user triggers the command palette again, the existing diff preview is dismissed first
- Only one command palette instance can be open at a time
- Only one diff preview can be visible at a time


#### Implementation: TipTap Suggestion Extension

Build a custom TipTap suggestion extension that:
- Triggers on `/ai` typed in the editor
- Renders the command palette as a React component via `tippy.js` (same pattern as TipTap's mention/slash-command examples)
- The same React component is also mounted standalone for `Cmd+J` and bubble menu triggers (these bypass the suggestion extension and mount the palette directly at selection coordinates)

---

### 2. Inline Diff Preview

AI results appear **inline in the editor** via a floating card, not in the side panel.

#### Diff Preview Card

Appears directly below the selection (or cursor position) after AI processing completes:

```
┌──────────────────────────────────────────┐
│ ✨ Grammar Fix                         ✕ │
│──────────────────────────────────────────│
│ ▸ Original                              │
│   "The report were good and complete"   │
│ ──────────────────────────────────────── │
│ ▸ Result                                │
│   "The report was good and complete"    │
│                                          │
│ [✓ Accept]  [↓ Insert Below]  [📋 Copy] │
└──────────────────────────────────────────┘
```

#### Action Buttons

| Button | Behavior |
|--------|----------|
| **Accept** | Replaces selected text with AI result |
| **Insert Below** | Keeps original, inserts result as new paragraph after selection |
| **Copy** | Copies result to clipboard, no editor changes |
| **Discard (✕)** | Dismisses card, no changes |

#### Default Button by Action Type

| Action | Primary (highlighted) | Rationale |
|--------|----------------------|-----------|
| Fix Grammar | Accept | Corrections should replace errors |
| Improve Flow | Accept | Improved version replaces original |
| Summarize | Insert Below | Summary supplements, doesn't replace |
| Expand | Insert Below | Extended text adds content |
| Translate | Insert Below | Both original and translation usually needed |
| Transliterate | Accept | Script conversion replaces source script |
| Custom Prompt | Both equal | User decides based on context |

#### Loading State

- Inline skeleton with pulsing shimmer and "✨ Generating..." text
- Selection highlighted with a subtle animated border during processing
- Dismissible (user can cancel mid-request)

#### Implementation

The diff preview is a React portal rendered at the selection's DOM coordinates using `editor.view.coordsAtPos()`. It's positioned absolutely below the selection and scrolls with the editor content.

---

### 3. Settings Side Panel (Renamed)

> [!IMPORTANT]
> The header button is renamed from "AI Companion" to "Settings"

The side panel becomes a lightweight **preferences and discovery** surface.

#### Panel Content

**Document Intelligence**
- Auto-detected language badge (e.g., "Detected: Hindi") — calls Sarvam language identification on document text
- Updates periodically as user types (debounced)

**AI Preferences**
- **Default translate target** — dropdown with all 23 languages, grouped by script family
- **Default TTS voice** — dropdown with 38 voices, showing name + tone hint (e.g., "Priya — warm, friendly")
- **Default TTS language** — dropdown with 11 TTS-supported languages
- Preferences persisted in `localStorage` and used as defaults in the command palette

**Quick Reference**
- Keyboard shortcuts card:
  - `Cmd+J` — Open AI palette
  - `/ai` — Open AI palette from editor
  - `Esc` — Dismiss palette
- Link to future pricing/usage page (placeholder)

#### Panel Behavior
- Same 320px width and slide-in animation as current
- Shares slot with Version History (mutually exclusive, same as current)
- Icon changes from `auto_awesome` to `settings` on the header button

---

### 4. Bubble Menu Changes

#### Current → New

| Element | Before | After |
|---------|--------|-------|
| Bold | ✅ Keep | ✅ Keep |
| Italic | ✅ Keep | ✅ Keep |
| Underline | ✅ Keep | ✅ Keep |
| Translate (HI) | ❌ Remove | — |
| Listen | ❌ Remove | — |
| AI button | — | ✅ Add `✨ AI` button |

- The `✨ AI` button opens the command palette pre-populated with the current selection
- This consolidates all AI actions into a single entry point
- The bubble menu stays clean and focused on formatting + AI gateway

---

### 5. API Route Updates

#### New Actions in `/api/ai`

**`transliterate`**
```typescript
// Request
{ action: 'transliterate', text: string, sourceLanguage: string, targetLanguage: string }

// Calls: Sarvam /transliterate API
// Response
{ transliteratedText: string }
```

**`detect-language`**
```typescript
// Request
{ action: 'detect-language', text: string }

// Calls: Sarvam language identification API
// Response
{ languageCode: string, languageName: string, script: string }
```

#### Updated Constants

**Languages** — expand from 10 to all 23 Sarvam-supported languages:
`en-IN, hi-IN, bn-IN, ta-IN, te-IN, gu-IN, kn-IN, ml-IN, mr-IN, pa-IN, od-IN, as-IN, ur-IN, ne-IN, kok-IN, ks-IN, sd-IN, sa-IN, sat-IN, mni-IN, brx-IN, mai-IN, doi-IN`

**Speakers** — expand from 3 to all 38 Bulbul v3 voices with tone metadata:
- Professional: aditya (news-anchor), ritu (calm), kavya (calm), kabir (warm), anand (mature), vijay (authoritative)
- Conversational: priya (warm, default), neha (warm), rahul (professional), pooja (friendly)
- Narration: shreya (news-anchor), gokul (mature)
- Energetic: tanya (young), suhani (young), niharika (young)
- Plus 23 additional voices without specific tone hints

#### Validation Updates
- Add `MAX_SHORT_FIELD_LENGTH` check for `sourceLanguage` field (new param for transliterate)
- No new payload size changes needed (transliterate and detect-language use same text limits)

---

### 6. Mobile Touch Scroll Fix

> [!WARNING]
> This is a pre-existing bug affecting multiple popup menus, not just the AI panel.

#### Problem
Popup menus (color picker, highlight color popover, and similar floating UI) are not scrollable on mobile touch screens. Users cannot swipe/scroll within these menus.

#### Fix
- Add `-webkit-overflow-scrolling: touch` and `overflow-y: auto` to popup containers
- Ensure `touch-action: pan-y` is set on scrollable popup content areas
- Add `overscroll-behavior: contain` to prevent scroll chaining to parent
- Apply to: `ColorHighlightPopover`, the new AI command palette, and any other floating menus with scrollable content
- Test on iOS Safari and Android Chrome

---

## File Impact Summary

### Modified Files
| File | Changes |
|------|---------|
| [`ai-assistant-panel.tsx`](file:///Users/harshdave/Desktop/projects/Lekhan/components/ai-assistant-panel.tsx) | **Major rewrite** — side panel becomes Settings panel with preferences UI |
| [`ai-bubble-menu.tsx`](file:///Users/harshdave/Desktop/projects/Lekhan/components/ai-bubble-menu.tsx) | Remove Translate/Listen buttons, add `✨ AI` button |
| [`editor-workspace.tsx`](file:///Users/harshdave/Desktop/projects/Lekhan/components/editor-workspace.tsx) | Integrate command palette, rename header button, wire up new triggers |
| [`mobile-header-menu.tsx`](file:///Users/harshdave/Desktop/projects/Lekhan/components/mobile-header-menu.tsx) | Rename "AI Companion" to "Settings" |
| [`route.ts`](file:///Users/harshdave/Desktop/projects/Lekhan/app/api/ai/route.ts) | Add `transliterate` and `detect-language` actions |
| [`color-highlight-popover.tsx`](file:///Users/harshdave/Desktop/projects/Lekhan/components/color-highlight-popover.tsx) | Mobile scroll fix |
| [`globals.css`](file:///Users/harshdave/Desktop/projects/Lekhan/app/globals.css) | Mobile touch scroll utility classes |

### New Files
| File | Purpose |
|------|---------|
| `components/ai-command-palette.tsx` | The inline command palette component |
| `components/ai-diff-preview.tsx` | The inline diff preview card |
| `components/ai-settings-panel.tsx` | The new lightweight settings side panel (replaces ai-assistant-panel.tsx) |
| `lib/ai-suggestion.ts` | TipTap suggestion extension for `/ai` trigger |

### Deleted Files
| File | Reason |
|------|--------|
| `components/ai-assistant-panel.tsx` | Replaced by `ai-settings-panel.tsx` + `ai-command-palette.tsx` |

---

## Out of Scope

- **Pricing plans** — separate sub-project
- **Real-time transliteration** (type-as-you-go) — future enhancement
- **Voice dictation (STT)** — future sub-project
- **OCR / Vision extract** — future sub-project
- **Text Analytics** — future sub-project
- **Workspace expansion** (Sheets/Slides) — separate major initiative

---

## Verification Plan

### Automated Tests
- Unit tests for the new API route actions (`transliterate`, `detect-language`)
- Update existing `api-ai.test.ts` with new action coverage
- Component tests for command palette rendering and action dispatch

### Manual Verification
- Verify command palette opens via all 3 triggers (`/ai`, `Cmd+J`, bubble menu)
- Verify diff preview appears inline with correct Accept/Insert Below behavior
- Verify all 23 languages appear in translate picker
- Verify transliterate action works end-to-end
- Verify mobile touch scroll works on popup menus (iOS Safari, Android Chrome)
- Verify the Settings side panel shows preferences and persists them
- Verify no regression in Version History panel behavior
