# AI Panel v2 Implementation Plan (Revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework Lekhan's AI assistant from a side-panel tabbed UI to a Lekhan Bot prompt bar with a unified `/` slash menu, inline diff preview, new Sarvam features, and expanded language/voice coverage.

**Architecture:** Two distinct systems: (1) **`/` slash menu** — a TipTap suggestion extension for block commands (headings, lists, code) with an "Ask Lekhan Bot" entry that opens the prompt bar. (2) **Lekhan Bot prompt bar** — a hidden-by-default input bar at the bottom of the editor canvas, triggered by `/ai` (via slash menu), `Cmd+L` (L = Lekhan), or the `✨` bubble menu button. Features quick-action presets (Summarize, Fix Grammar, Translate, etc.) and a freeform prompt input. Results appear inline via a diff preview card. The side panel becomes a lightweight Settings surface.

**Tech Stack:** Next.js 16, React 19, TipTap 2.x, Tailwind CSS, Sarvam AI APIs, Vitest, TypeScript

## Global Constraints

- All code uses tabs for indentation, single quotes, no semicolons
- Component files use kebab-case naming
- Event handlers use `handle` prefix, booleans use verb prefix (`isLoading`)
- Use Material Symbols Outlined for icons (existing pattern)
- All new popup/floating UIs must include mobile touch scroll CSS
- Tests run via `npx vitest run` (jsdom environment, setup at `tests/unit/setup.ts`)
- Design spec: `docs/superpowers/specs/2026-07-21-ai-panel-v2-design.md`

---

### Task 1: API Route — Add Transliterate and Detect-Language Actions

**Files:**
- Modify: `app/api/ai/route.ts`
- Test: `tests/unit/api-ai.test.ts`

**Interfaces:**
- Consumes: Existing Sarvam API patterns (`SARVAM_API_URL`, `SARVAM_API_KEY`, `readJsonWithLimit`)
- Produces:
  - `POST /api/ai { action: 'transliterate', text, sourceLanguage, targetLanguage }` → `{ transliteratedText: string }`
  - `POST /api/ai { action: 'detect-language', text }` → `{ languageCode: string, languageName: string, script: string }`

- [ ] **Step 1: Write failing tests for transliterate action**

Add to `tests/unit/api-ai.test.ts`:

```typescript
it('should return transliterated text if action is transliterate', async () => {
	const mockTransliterateResponse = { transliterated_text: 'namaste' }
	;(global.fetch as any).mockResolvedValueOnce({
		ok: true,
		json: async () => mockTransliterateResponse,
	})

	const req = new NextRequest('http://localhost:3000/api/ai', {
		method: 'POST',
		headers: {
			'Authorization': 'Bearer fake-token',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			action: 'transliterate',
			text: 'नमस्ते',
			sourceLanguage: 'hi-IN',
			targetLanguage: 'en-IN',
		}),
	})

	const response = await POST(req)
	expect(response.status).toBe(200)

	const data = await response.json()
	expect(data.transliteratedText).toBe('namaste')
})

it('should return error if transliterate params are missing', async () => {
	const req = new NextRequest('http://localhost:3000/api/ai', {
		method: 'POST',
		headers: {
			'Authorization': 'Bearer fake-token',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ action: 'transliterate', text: 'नमस्ते' }),
	})

	const response = await POST(req)
	expect(response.status).toBe(400)
	const data = await response.json()
	expect(data.error).toContain('Missing')
})
```

- [ ] **Step 2: Write failing tests for detect-language action**

Add to `tests/unit/api-ai.test.ts`:

```typescript
it('should return detected language if action is detect-language', async () => {
	const mockDetectResponse = {
		language_code: 'hi-IN',
		language_name: 'Hindi',
		script: 'Devanagari',
	}
	;(global.fetch as any).mockResolvedValueOnce({
		ok: true,
		json: async () => mockDetectResponse,
	})

	const req = new NextRequest('http://localhost:3000/api/ai', {
		method: 'POST',
		headers: {
			'Authorization': 'Bearer fake-token',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ action: 'detect-language', text: 'नमस्ते दुनिया' }),
	})

	const response = await POST(req)
	expect(response.status).toBe(200)
	const data = await response.json()
	expect(data.languageCode).toBe('hi-IN')
	expect(data.languageName).toBe('Hindi')
	expect(data.script).toBe('Devanagari')
})

it('should return error if detect-language text is missing', async () => {
	const req = new NextRequest('http://localhost:3000/api/ai', {
		method: 'POST',
		headers: {
			'Authorization': 'Bearer fake-token',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ action: 'detect-language' }),
	})

	const response = await POST(req)
	expect(response.status).toBe(400)
	const data = await response.json()
	expect(data.error).toContain('Missing text')
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/api-ai.test.ts`
Expected: 4 new tests FAIL

- [ ] **Step 4: Implement new actions in `app/api/ai/route.ts`**

**a) Add `sourceLanguage` to body parsing (after line 48):**

Add `sourceLanguage: string | undefined` to the destructured vars and the generic type, then add to assignment: `sourceLanguage = body.sourceLanguage`

**b) Add `sourceLanguage` validation (after the existing `speaker` validation, line ~84):**
```typescript
if (typeof sourceLanguage === 'string' && sourceLanguage.length > MAX_SHORT_FIELD_LENGTH) {
	return NextResponse.json({ error: 'Invalid sourceLanguage' }, { status: 400 })
}
```

**c) Add handlers before `Invalid action` fallback (before line 181):**
```typescript
if (action === 'transliterate') {
	if (!text || !sourceLanguage || !targetLanguage) {
		return NextResponse.json({ error: 'Missing text, sourceLanguage, or targetLanguage for transliteration' }, { status: 400 })
	}

	const response = await fetch(`${SARVAM_API_URL}/transliterate`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'api-subscription-key': SARVAM_API_KEY,
		},
		body: JSON.stringify({
			input: text,
			source_language_code: sourceLanguage,
			target_language_code: targetLanguage,
		}),
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(`Sarvam Transliteration error: ${errorText}`)
	}

	const data = await response.json()
	return NextResponse.json({ transliteratedText: data.transliterated_text })
}

if (action === 'detect-language') {
	if (!text) {
		return NextResponse.json({ error: 'Missing text for language detection' }, { status: 400 })
	}

	const response = await fetch(`${SARVAM_API_URL}/language-identification`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'api-subscription-key': SARVAM_API_KEY,
		},
		body: JSON.stringify({ input: text }),
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(`Sarvam Language Detection error: ${errorText}`)
	}

	const data = await response.json()
	return NextResponse.json({
		languageCode: data.language_code,
		languageName: data.language_name,
		script: data.script,
	})
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/api-ai.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/ai/route.ts tests/unit/api-ai.test.ts
git commit -m "feat(api): add transliterate and detect-language actions to AI route"
```

---

### Task 2: Shared AI Constants and Types

**Files:**
- Create: `lib/ai-constants.ts`

**Interfaces:**
- Consumes: Nothing (foundational)
- Produces:
  - `LANGUAGES: Language[]` (23 entries), `TTS_LANGUAGES: Language[]` (11 entries)
  - `SPEAKERS: Speaker[]` (38 entries with tone metadata)
  - `LEKHAN_BOT_ACTIONS: LekhanBotAction[]` — quick-action presets for the prompt bar
  - `AIPreferences` type + `loadAIPreferences()` / `saveAIPreferences()`

- [ ] **Step 1: Create `lib/ai-constants.ts`**

```typescript
export interface Language {
	code: string
	name: string
	script: string
}

export interface Speaker {
	id: string
	name: string
	tone: string
}

export interface LekhanBotAction {
	id: string
	label: string
	icon: string
	requiresSelection: boolean
	defaultInsert: 'accept' | 'below' | 'both'
	buildPrompt: (text: string) => string
}

export interface AIPreferences {
	targetLanguage: string
	ttsLanguage: string
	ttsVoice: string
}

export const LANGUAGES: Language[] = [
	{ code: 'en-IN', name: 'English (India)', script: 'Latin' },
	{ code: 'hi-IN', name: 'Hindi', script: 'Devanagari' },
	{ code: 'bn-IN', name: 'Bengali', script: 'Bengali' },
	{ code: 'ta-IN', name: 'Tamil', script: 'Tamil' },
	{ code: 'te-IN', name: 'Telugu', script: 'Telugu' },
	{ code: 'gu-IN', name: 'Gujarati', script: 'Gujarati' },
	{ code: 'kn-IN', name: 'Kannada', script: 'Kannada' },
	{ code: 'ml-IN', name: 'Malayalam', script: 'Malayalam' },
	{ code: 'mr-IN', name: 'Marathi', script: 'Devanagari' },
	{ code: 'pa-IN', name: 'Punjabi', script: 'Gurmukhi' },
	{ code: 'od-IN', name: 'Odia', script: 'Odia' },
	{ code: 'as-IN', name: 'Assamese', script: 'Bengali' },
	{ code: 'ur-IN', name: 'Urdu', script: 'Perso-Arabic' },
	{ code: 'ne-IN', name: 'Nepali', script: 'Devanagari' },
	{ code: 'kok-IN', name: 'Konkani', script: 'Devanagari' },
	{ code: 'ks-IN', name: 'Kashmiri', script: 'Perso-Arabic' },
	{ code: 'sd-IN', name: 'Sindhi', script: 'Perso-Arabic' },
	{ code: 'sa-IN', name: 'Sanskrit', script: 'Devanagari' },
	{ code: 'sat-IN', name: 'Santali', script: 'Ol Chiki' },
	{ code: 'mni-IN', name: 'Manipuri', script: 'Meitei' },
	{ code: 'brx-IN', name: 'Bodo', script: 'Devanagari' },
	{ code: 'mai-IN', name: 'Maithili', script: 'Devanagari' },
	{ code: 'doi-IN', name: 'Dogri', script: 'Devanagari' },
]

export const TTS_LANGUAGES: Language[] = LANGUAGES.filter(l =>
	['en-IN', 'hi-IN', 'bn-IN', 'ta-IN', 'te-IN', 'gu-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'pa-IN', 'od-IN'].includes(l.code)
)

export const SPEAKERS: Speaker[] = [
	{ id: 'priya', name: 'Priya', tone: 'Warm, friendly (default)' },
	{ id: 'aditya', name: 'Aditya', tone: 'Professional, news-anchor' },
	{ id: 'ritu', name: 'Ritu', tone: 'Calm, professional' },
	{ id: 'neha', name: 'Neha', tone: 'Warm, conversational' },
	{ id: 'rahul', name: 'Rahul', tone: 'Professional, conversational' },
	{ id: 'pooja', name: 'Pooja', tone: 'Warm, friendly' },
	{ id: 'kavya', name: 'Kavya', tone: 'Calm, professional' },
	{ id: 'kabir', name: 'Kabir', tone: 'Professional, warm' },
	{ id: 'anand', name: 'Anand', tone: 'Mature, professional' },
	{ id: 'vijay', name: 'Vijay', tone: 'Mature, authoritative' },
	{ id: 'shreya', name: 'Shreya', tone: 'Calm, narration' },
	{ id: 'gokul', name: 'Gokul', tone: 'Mature, narration' },
	{ id: 'tanya', name: 'Tanya', tone: 'Young, energetic' },
	{ id: 'suhani', name: 'Suhani', tone: 'Young, energetic' },
	{ id: 'niharika', name: 'Niharika', tone: 'Young, energetic' },
	{ id: 'ashutosh', name: 'Ashutosh', tone: '' },
	{ id: 'rohan', name: 'Rohan', tone: '' },
	{ id: 'simran', name: 'Simran', tone: '' },
	{ id: 'amit', name: 'Amit', tone: '' },
	{ id: 'dev', name: 'Dev', tone: '' },
	{ id: 'ishita', name: 'Ishita', tone: '' },
	{ id: 'ratan', name: 'Ratan', tone: '' },
	{ id: 'varun', name: 'Varun', tone: '' },
	{ id: 'manan', name: 'Manan', tone: '' },
	{ id: 'sumit', name: 'Sumit', tone: '' },
	{ id: 'roopa', name: 'Roopa', tone: '' },
	{ id: 'aayan', name: 'Aayan', tone: '' },
	{ id: 'shubh', name: 'Shubh', tone: '' },
	{ id: 'advait', name: 'Advait', tone: '' },
	{ id: 'tarun', name: 'Tarun', tone: '' },
	{ id: 'sunny', name: 'Sunny', tone: '' },
	{ id: 'mani', name: 'Mani', tone: '' },
	{ id: 'mohit', name: 'Mohit', tone: '' },
	{ id: 'kavitha', name: 'Kavitha', tone: '' },
	{ id: 'rehan', name: 'Rehan', tone: '' },
	{ id: 'soham', name: 'Soham', tone: '' },
	{ id: 'rupali', name: 'Rupali', tone: '' },
]

/** Quick-action presets shown above the prompt bar */
export const LEKHAN_BOT_ACTIONS: LekhanBotAction[] = [
	{
		id: 'fix-grammar',
		label: 'Fix Grammar',
		icon: 'spellcheck',
		requiresSelection: true,
		defaultInsert: 'accept',
		buildPrompt: (text) => `Fix spelling and grammar in this text. Return only the corrected text:\n\n"${text}"`,
	},
	{
		id: 'improve-flow',
		label: 'Rewrite',
		icon: 'edit_note',
		requiresSelection: true,
		defaultInsert: 'accept',
		buildPrompt: (text) => `Improve the writing style and flow of this text. Return only the improved text:\n\n"${text}"`,
	},
	{
		id: 'summarize',
		label: 'Summarize',
		icon: 'summarize',
		requiresSelection: true,
		defaultInsert: 'below',
		buildPrompt: (text) => `Summarize the following text concisely:\n\n"${text}"`,
	},
	{
		id: 'expand',
		label: 'Expand',
		icon: 'expand',
		requiresSelection: true,
		defaultInsert: 'below',
		buildPrompt: (text) => `Expand this text with more details and depth:\n\n"${text}"`,
	},
	{
		id: 'make-shorter',
		label: 'Make Shorter',
		icon: 'compress',
		requiresSelection: true,
		defaultInsert: 'accept',
		buildPrompt: (text) => `Make this text shorter and more concise while preserving the meaning:\n\n"${text}"`,
	},
]

export const LEKHAN_BOT_SYSTEM_PROMPT =
	'You are Lekhan Bot, a helpful Indian writing assistant built into Lekhan, a document editor for Indian languages. ' +
	'You support 23 Indian languages and scripts. Respond concisely. ' +
	'When asked to fix, rewrite, or transform text, return only the result — no explanations unless asked.'

const AI_PREFS_KEY = 'lekhan-ai-preferences'

const DEFAULT_PREFS: AIPreferences = {
	targetLanguage: 'hi-IN',
	ttsLanguage: 'hi-IN',
	ttsVoice: 'priya',
}

export function loadAIPreferences(): AIPreferences {
	if (typeof window === 'undefined') return DEFAULT_PREFS
	try {
		const stored = localStorage.getItem(AI_PREFS_KEY)
		if (stored) return { ...DEFAULT_PREFS, ...JSON.parse(stored) }
	} catch { /* ignore */ }
	return DEFAULT_PREFS
}

export function saveAIPreferences(prefs: Partial<AIPreferences>): void {
	if (typeof window === 'undefined') return
	const current = loadAIPreferences()
	localStorage.setItem(AI_PREFS_KEY, JSON.stringify({ ...current, ...prefs }))
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ai-constants.ts
git commit -m "feat: add shared AI constants, types, Lekhan Bot actions, and preference helpers"
```

---

### Task 3: Unified `/` Slash Menu Extension

The `/` slash menu shows **block commands only** (Heading, List, Code, Divider, etc.) plus an **"Ask Lekhan Bot"** entry. Typing `/ai` filters to the Lekhan Bot entry and selecting it opens the prompt bar.

**Files:**
- Create: `lib/slash-menu-extension.ts`
- Create: `components/slash-menu.tsx`
- Dependency: `npm install @tiptap/suggestion tippy.js` (if not present)

**Interfaces:**
- Consumes: Nothing directly — standalone TipTap extension
- Produces:
  - `SlashMenuExtension` — TipTap extension triggered by `/`
  - `SlashMenuComponent` — React component for the dropdown
  - `buildSlashMenuItems(onOpenLekhanBot: () => void): SlashMenuItem[]`

- [ ] **Step 1: Check and install dependencies**

```bash
cd /Users/harshdave/Desktop/projects/Lekhan && npm ls @tiptap/suggestion tippy.js 2>/dev/null || npm install @tiptap/suggestion tippy.js
```

- [ ] **Step 2: Create `lib/slash-menu-extension.ts`**

```typescript
import { Extension } from '@tiptap/core'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'

export interface SlashMenuItem {
	id: string
	label: string
	icon: string
	description?: string
	action: (editor: any) => void
}

export const SlashMenuExtension = Extension.create({
	name: 'slashMenu',

	addOptions() {
		return {
			suggestion: {
				char: '/',
				command: ({
					editor,
					range,
					props,
				}: {
					editor: any
					range: any
					props: SlashMenuItem
				}) => {
					editor.chain().focus().deleteRange(range).run()
					props.action(editor)
				},
			} as Partial<SuggestionOptions>,
		}
	},

	addProseMirrorPlugins() {
		return [
			Suggestion({
				editor: this.editor,
				...this.options.suggestion,
			}),
		]
	},
})

export function buildSlashMenuItems(
	onOpenLekhanBot: () => void,
): SlashMenuItem[] {
	return [
		{
			id: 'heading-1',
			label: 'Heading 1',
			icon: 'format_h1',
			description: 'Large section heading',
			action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
		},
		{
			id: 'heading-2',
			label: 'Heading 2',
			icon: 'format_h2',
			description: 'Medium section heading',
			action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
		},
		{
			id: 'heading-3',
			label: 'Heading 3',
			icon: 'format_h3',
			description: 'Small section heading',
			action: (editor) => editor.chain().focus().toggleHeading({ level: 4 }).run(),
		},
		{
			id: 'bullet-list',
			label: 'Bullet List',
			icon: 'format_list_bulleted',
			description: 'Unordered list',
			action: (editor) => editor.chain().focus().toggleBulletList().run(),
		},
		{
			id: 'numbered-list',
			label: 'Numbered List',
			icon: 'format_list_numbered',
			description: 'Ordered list',
			action: (editor) => editor.chain().focus().toggleOrderedList().run(),
		},
		{
			id: 'task-list',
			label: 'Task List',
			icon: 'checklist',
			description: 'Checklist with toggles',
			action: (editor) => editor.chain().focus().toggleTaskList().run(),
		},
		{
			id: 'code-block',
			label: 'Code Block',
			icon: 'code_blocks',
			description: 'Fenced code block',
			action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
		},
		{
			id: 'divider',
			label: 'Divider',
			icon: 'horizontal_rule',
			description: 'Horizontal separator',
			action: (editor) => editor.chain().focus().setHorizontalRule().run(),
		},
		{
			id: 'ai',
			label: 'Ask Lekhan Bot',
			icon: 'auto_awesome',
			description: 'AI writing assistant (⌘L)',
			action: () => onOpenLekhanBot(),
		},
	]
}
```

- [ ] **Step 3: Create `components/slash-menu.tsx`**

```typescript
'use client'

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import type { SlashMenuItem } from '@/lib/slash-menu-extension'

interface SlashMenuComponentProps {
	items: SlashMenuItem[]
	command: (item: SlashMenuItem) => void
}

export const SlashMenuComponent = forwardRef(
	({ items, command }: SlashMenuComponentProps, ref) => {
		const [selectedIndex, setSelectedIndex] = useState(0)
		const containerRef = useRef<HTMLDivElement>(null)

		useEffect(() => {
			setSelectedIndex(0)
		}, [items])

		// Scroll selected item into view
		useEffect(() => {
			const container = containerRef.current
			if (!container) return
			const selected = container.querySelector(`[data-index="${selectedIndex}"]`)
			if (selected) {
				selected.scrollIntoView({ block: 'nearest' })
			}
		}, [selectedIndex])

		useImperativeHandle(ref, () => ({
			onKeyDown: ({ event }: { event: KeyboardEvent }) => {
				if (event.key === 'ArrowUp') {
					setSelectedIndex((selectedIndex + items.length - 1) % items.length)
					return true
				}
				if (event.key === 'ArrowDown') {
					setSelectedIndex((selectedIndex + 1) % items.length)
					return true
				}
				if (event.key === 'Enter') {
					const item = items[selectedIndex]
					if (item) command(item)
					return true
				}
				return false
			},
		}))

		if (items.length === 0) return null

		return (
			<div
				ref={containerRef}
				className="z-[9999] w-64 bg-surface-container border border-black/10 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto touch-scroll-container p-1"
			>
				{items.map((item, index) => (
					<button
						key={item.id}
						data-index={index}
						onClick={() => command(item)}
						className={`w-full flex items-center gap-3 px-3 py-2 text-xs rounded-lg transition ${
							index === selectedIndex
								? 'bg-primary-container/20 text-on-surface'
								: 'text-on-surface hover:bg-black/5 dark:hover:bg-white/5'
						}`}
					>
						<span className={`material-symbols-outlined text-base ${
							item.id === 'ai' ? 'text-primary' : 'text-on-surface-variant/60'
						}`}>
							{item.icon}
						</span>
						<div className="text-left">
							<div className={item.id === 'ai' ? 'font-semibold text-primary' : ''}>
								{item.label}
							</div>
							{item.description && (
								<div className="text-[10px] text-on-surface-variant/50">
									{item.description}
								</div>
							)}
						</div>
					</button>
				))}
			</div>
		)
	},
)
SlashMenuComponent.displayName = 'SlashMenuComponent'
```

- [ ] **Step 4: Commit**

```bash
git add lib/slash-menu-extension.ts components/slash-menu.tsx
git commit -m "feat: add unified / slash menu with block commands and Lekhan Bot entry"
```

---

### Task 4: Lekhan Bot Prompt Bar

The main AI interaction surface — a hidden-by-default prompt bar at the bottom of the editor with quick-action presets.

**Files:**
- Create: `components/lekhan-bot-bar.tsx`

**Interfaces:**
- Consumes:
  - `LEKHAN_BOT_ACTIONS`, `LANGUAGES`, `LEKHAN_BOT_SYSTEM_PROMPT`, `loadAIPreferences` from `lib/ai-constants.ts` (Task 2)
- Produces:
  - `<LekhanBotBar editor={editor} token={token} isVisible={boolean} onClose={() => void} onResult={(actionId, result, originalText) => void} />`
  - `onResult` triggers the diff preview in the parent

- [ ] **Step 1: Create `components/lekhan-bot-bar.tsx`**

```typescript
'use client'

import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import {
	LEKHAN_BOT_ACTIONS,
	LANGUAGES,
	LEKHAN_BOT_SYSTEM_PROMPT,
	loadAIPreferences,
	type LekhanBotAction,
} from '@/lib/ai-constants'

interface LekhanBotBarProps {
	editor: any
	token: string
	isVisible: boolean
	onClose: () => void
	onResult: (actionId: string, result: string, originalText: string) => void
}

export default function LekhanBotBar({
	editor,
	token,
	isVisible,
	onClose,
	onResult,
}: LekhanBotBarProps) {
	const [prompt, setPrompt] = useState('')
	const [isLoading, setIsLoading] = useState(false)
	const [showPresets, setShowPresets] = useState(true)
	const [showTranslatePicker, setShowTranslatePicker] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)

	const getSelectedText = (): string => {
		if (!editor) return ''
		const { from, to } = editor.state.selection
		return editor.state.doc.textBetween(from, to, ' ').trim()
	}

	// Focus and show presets when bar opens
	useEffect(() => {
		if (isVisible) {
			setShowPresets(true)
			setShowTranslatePicker(false)
			setTimeout(() => inputRef.current?.focus(), 100)
		}
	}, [isVisible])

	// Close on Escape
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && isVisible) {
				onClose()
			}
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => document.removeEventListener('keydown', handleKeyDown)
	}, [isVisible, onClose])

	const callAI = async (
		apiAction: string,
		body: Record<string, string>,
		actionId: string,
		originalText: string,
	) => {
		setIsLoading(true)
		try {
			const res = await fetch('/api/ai', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(body),
			})

			if (!res.ok) {
				const err = await res.json()
				throw new Error(err.error || 'Request failed')
			}

			const data = await res.json()
			const result = data.translatedText
				|| data.transliteratedText
				|| data.text
				|| ''
			onResult(actionId, result, originalText)
			setPrompt('')
			setShowPresets(true)
			setShowTranslatePicker(false)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Lekhan Bot: ${message}`)
		} finally {
			setIsLoading(false)
		}
	}

	const handlePresetAction = (action: LekhanBotAction) => {
		const selectedText = getSelectedText()
		if (action.requiresSelection && !selectedText) {
			toast.error('Select some text first, then try again')
			return
		}
		callAI(
			'chat',
			{
				action: 'chat',
				prompt: action.buildPrompt(selectedText),
			},
			action.id,
			selectedText,
		)
	}

	const handleTranslate = (targetLanguage: string) => {
		const selectedText = getSelectedText()
		if (!selectedText) {
			toast.error('Select some text to translate')
			return
		}
		setShowTranslatePicker(false)
		callAI(
			'translate',
			{ action: 'translate', text: selectedText, targetLanguage },
			'translate',
			selectedText,
		)
	}

	const handleReadAloud = () => {
		const prefs = loadAIPreferences()
		const text = getSelectedText() || editor?.getText().trim()
		if (!text) {
			toast.error('Document is empty')
			return
		}
		setIsLoading(true)
		fetch('/api/ai', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				action: 'tts',
				text: text.slice(0, 10000),
				targetLanguage: prefs.ttsLanguage,
				speaker: prefs.ttsVoice,
			}),
		})
			.then(res => {
				if (!res.ok) throw new Error('TTS failed')
				return res.json()
			})
			.then(data => {
				const audio = new Audio(`data:audio/wav;base64,${data.base64Audio}`)
				audio.play()
			})
			.catch(err => {
				const message = err instanceof Error ? err.message : String(err)
				toast.error(`Read aloud failed: ${message}`)
			})
			.finally(() => setIsLoading(false))
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!prompt.trim() || isLoading) return

		const selectedText = getSelectedText()
		const fullPrompt = selectedText
			? `Context: "${selectedText}"\n\nInstruction: ${prompt}`
			: prompt

		callAI(
			'chat',
			{ action: 'chat', prompt: fullPrompt },
			'custom-prompt',
			selectedText,
		)
	}

	if (!isVisible) return null

	const selectedText = getSelectedText()

	return (
		<div className="w-full max-w-5xl mx-auto px-[40px] md:px-[60px] pb-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
			{/* Presets row — visible when focused and not loading */}
			{showPresets && !isLoading && !showTranslatePicker && (
				<div className="flex flex-wrap items-center gap-1.5 mb-2">
					{LEKHAN_BOT_ACTIONS.map(action => (
						<button
							key={action.id}
							onClick={() => handlePresetAction(action)}
							disabled={action.requiresSelection && !selectedText}
							className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl border transition-all active:scale-95 ${
								action.requiresSelection && !selectedText
									? 'border-black/5 dark:border-white/5 text-on-surface-variant/30 cursor-not-allowed'
									: 'border-black/10 dark:border-white/10 text-on-surface hover:bg-black/5 dark:hover:bg-white/5 hover:border-primary-container/30'
							}`}
						>
							<span className="material-symbols-outlined text-sm">{action.icon}</span>
							{action.label}
						</button>
					))}

					{/* Translate button — opens language picker */}
					<button
						onClick={() => setShowTranslatePicker(true)}
						disabled={!selectedText}
						className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl border transition-all active:scale-95 ${
							!selectedText
								? 'border-black/5 dark:border-white/5 text-on-surface-variant/30 cursor-not-allowed'
								: 'border-black/10 dark:border-white/10 text-on-surface hover:bg-black/5 dark:hover:bg-white/5 hover:border-primary-container/30'
						}`}
					>
						<span className="material-symbols-outlined text-sm">translate</span>
						Translate
					</button>

					{/* Read Aloud */}
					<button
						onClick={handleReadAloud}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl border border-black/10 dark:border-white/10 text-on-surface hover:bg-black/5 dark:hover:bg-white/5 hover:border-primary-container/30 transition-all active:scale-95"
					>
						<span className="material-symbols-outlined text-sm">volume_up</span>
						Read Aloud
					</button>
				</div>
			)}

			{/* Language picker for Translate */}
			{showTranslatePicker && !isLoading && (
				<div className="flex flex-wrap items-center gap-1 mb-2 max-h-28 overflow-y-auto touch-scroll-container">
					<button
						onClick={() => setShowTranslatePicker(false)}
						className="flex items-center gap-1 text-xs text-on-surface-variant/60 hover:text-on-surface px-2 py-1 mr-1 transition"
					>
						<span className="material-symbols-outlined text-sm">arrow_back</span>
						Back
					</button>
					{LANGUAGES.map(lang => (
						<button
							key={lang.code}
							onClick={() => handleTranslate(lang.code)}
							className="px-2.5 py-1 text-[11px] rounded-lg border border-black/10 dark:border-white/10 text-on-surface hover:bg-primary-container/10 hover:border-primary-container/30 transition"
						>
							{lang.name}
						</button>
					))}
				</div>
			)}

			{/* Selection context hint */}
			{selectedText && !isLoading && (
				<div className="text-[10px] text-on-surface-variant/50 mb-1.5 truncate px-1">
					Selected: &quot;{selectedText.slice(0, 60)}{selectedText.length > 60 ? '...' : ''}&quot;
				</div>
			)}

			{/* Prompt input */}
			<form
				onSubmit={handleSubmit}
				className="flex items-center gap-3 rounded-2xl border-2 border-primary-container/30 focus-within:border-primary-container/60 bg-surface-container/50 backdrop-blur-sm px-4 py-3 transition-all"
			>
				<span className="material-symbols-outlined text-primary-container/60 text-lg">
					auto_awesome
				</span>
				<input
					ref={inputRef}
					type="text"
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					onFocus={() => { setShowPresets(true); setShowTranslatePicker(false) }}
					placeholder="Ask Lekhan Bot anything..."
					disabled={isLoading}
					className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/40 outline-none disabled:opacity-50"
				/>
				{isLoading ? (
					<span className="animate-spin h-5 w-5 border-2 border-primary-container border-t-transparent rounded-full" />
				) : (
					<>
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg p-1.5 hover:bg-black/5 dark:hover:bg-white/5 text-on-surface-variant/50 transition"
							title="Close (Esc)"
						>
							<span className="material-symbols-outlined text-base">close</span>
						</button>
						<button
							type="submit"
							disabled={!prompt.trim()}
							className="rounded-xl bg-primary-container/20 hover:bg-primary-container/40 text-primary-container p-2 transition disabled:opacity-30 active:scale-95"
						>
							<span className="material-symbols-outlined text-lg">arrow_upward</span>
						</button>
					</>
				)}
			</form>
		</div>
	)
}
```

- [ ] **Step 2: Commit**

```bash
git add components/lekhan-bot-bar.tsx
git commit -m "feat: add Lekhan Bot prompt bar with quick-action presets"
```

---

### Task 5: AI Diff Preview Component

**Files:**
- Create: `components/ai-diff-preview.tsx`

**Interfaces:**
- Consumes: `LEKHAN_BOT_ACTIONS` from `lib/ai-constants.ts` (Task 2)
- Produces: `<AIDiffPreview editor={editor} actionId={string} originalText={string} resultText={string} position={{ x, y }} onClose={() => void} />`

- [ ] **Step 1: Create `components/ai-diff-preview.tsx`**

```typescript
'use client'

import { useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { LEKHAN_BOT_ACTIONS } from '@/lib/ai-constants'

interface AIDiffPreviewProps {
	editor: any
	actionId: string
	originalText: string
	resultText: string
	position: { x: number, y: number }
	onClose: () => void
}

const ACTION_LABELS: Record<string, string> = {
	'fix-grammar': 'Grammar Fix',
	'improve-flow': 'Rewrite',
	'summarize': 'Summary',
	'expand': 'Expanded',
	'make-shorter': 'Shortened',
	'translate': 'Translation',
	'transliterate': 'Transliteration',
	'custom-prompt': 'Lekhan Bot',
}

export default function AIDiffPreview({
	editor,
	actionId,
	originalText,
	resultText,
	position,
	onClose,
}: AIDiffPreviewProps) {
	const cardRef = useRef<HTMLDivElement>(null)
	const actionLabel = ACTION_LABELS[actionId] || 'Lekhan Bot'
	const actionDef = LEKHAN_BOT_ACTIONS.find(a => a.id === actionId)
	const defaultInsert = actionDef?.defaultInsert || 'both'

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
				onClose()
			}
		}
		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [onClose])

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => document.removeEventListener('keydown', handleKeyDown)
	}, [onClose])

	const handleAccept = () => {
		const { doc } = editor.state
		const fullText = doc.textContent
		const idx = fullText.indexOf(originalText)
		if (idx !== -1) {
			editor.chain().focus()
				.setTextSelection({ from: idx + 1, to: idx + 1 + originalText.length })
				.insertContent(resultText).run()
		} else {
			editor.chain().focus().insertContent(resultText).run()
		}
		onClose()
	}

	const handleInsertBelow = () => {
		const { to } = editor.state.selection
		editor.chain().focus().setTextSelection(to)
			.insertContent(`\n\n${resultText}`).run()
		onClose()
	}

	const handleCopy = () => {
		navigator.clipboard.writeText(resultText)
		toast.success('Copied to clipboard')
		onClose()
	}

	const cardWidth = 360
	const clampedX = Math.min(position.x, window.innerWidth - cardWidth - 16)
	const clampedY = Math.min(position.y, window.innerHeight - 300)

	return createPortal(
		<div
			ref={cardRef}
			className="fixed z-[9998] w-[360px] bg-surface-container border border-black/10 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
			style={{ left: clampedX, top: clampedY }}
		>
			<div className="flex items-center justify-between px-4 py-3 border-b border-black/5 dark:border-white/5">
				<div className="flex items-center gap-2 text-xs font-semibold text-on-surface">
					<span className="material-symbols-outlined text-primary text-sm">auto_awesome</span>
					{actionLabel}
				</div>
				<button onClick={onClose} className="rounded-lg p-1 hover:bg-black/10 dark:hover:bg-white/10 text-on-surface-variant transition">
					<span className="material-symbols-outlined text-sm">close</span>
				</button>
			</div>

			<div className="px-4 py-3 space-y-3 max-h-48 overflow-y-auto touch-scroll-container">
				{originalText && (
					<div>
						<div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50 mb-1">Original</div>
						<div className="text-xs text-on-surface-variant bg-black/5 dark:bg-white/5 rounded-lg p-2.5 whitespace-pre-wrap leading-relaxed max-h-20 overflow-y-auto">
							{originalText}
						</div>
					</div>
				)}
				<div>
					<div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50 mb-1">Result</div>
					<div className="text-xs text-on-surface bg-primary-container/10 border border-primary-container/20 rounded-lg p-2.5 whitespace-pre-wrap leading-relaxed max-h-20 overflow-y-auto">
						{resultText}
					</div>
				</div>
			</div>

			<div className="flex items-center gap-2 px-4 py-3 border-t border-black/5 dark:border-white/5">
				<button onClick={handleAccept} className={`flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 ${
					defaultInsert === 'accept' || defaultInsert === 'both'
						? 'bg-primary-container text-on-primary-container hover:brightness-110'
						: 'bg-black/5 dark:bg-white/5 text-on-surface hover:bg-black/10 dark:hover:bg-white/10'
				}`}>
					<span className="material-symbols-outlined text-sm">check</span>
					Accept
				</button>
				<button onClick={handleInsertBelow} className={`flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 ${
					defaultInsert === 'below'
						? 'bg-primary-container text-on-primary-container hover:brightness-110'
						: 'bg-black/5 dark:bg-white/5 text-on-surface hover:bg-black/10 dark:hover:bg-white/10'
				}`}>
					<span className="material-symbols-outlined text-sm">subdirectory_arrow_right</span>
					Insert Below
				</button>
				<button onClick={handleCopy} className="flex items-center gap-1 rounded-xl px-3 py-2 text-xs text-on-surface-variant bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-all active:scale-95">
					<span className="material-symbols-outlined text-sm">content_copy</span>
				</button>
			</div>
		</div>,
		document.body,
	)
}
```

- [ ] **Step 2: Commit**

```bash
git add components/ai-diff-preview.tsx
git commit -m "feat: add inline AI diff preview card"
```

---

### Task 6: AI Settings Panel (Replaces AI Assistant Panel)

**Files:**
- Create: `components/ai-settings-panel.tsx`

**Interfaces:**
- Consumes: `LANGUAGES`, `TTS_LANGUAGES`, `SPEAKERS`, `loadAIPreferences`, `saveAIPreferences` from Task 2
- Produces: `<AISettingsPanel isOpen={boolean} onClose={() => void} editor={any} token={string} />`

- [ ] **Step 1: Create `components/ai-settings-panel.tsx`**

Same implementation as the previous plan's Task 5 — a lightweight side panel with Document Intelligence (language detection), AI Preferences (translate target, TTS language, TTS voice dropdowns), and Keyboard Shortcuts reference card. Uses `CustomSelect` from `components/ui/custom-select.tsx`.

Key details:
- Header icon: `settings`, title: "Settings", subtitle: "AI PREFERENCES"
- Document Intelligence: calls `detect-language` API on panel open
- Preferences: three `CustomSelect` dropdowns persisted via `saveAIPreferences()`
- Shortcuts card: `⌘L` — Open Lekhan Bot, `/` — Block commands, `Esc` — Dismiss

Full code is identical to the component defined in the previous plan's Task 5 section, with one change — the shortcuts card shows `⌘L` instead of `⌘J`:

```typescript
<kbd className="bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded text-[10px] font-mono">⌘ L</kbd>
```

- [ ] **Step 2: Commit**

```bash
git add components/ai-settings-panel.tsx
git commit -m "feat: add AI settings panel (replaces old tabbed panel)"
```

---

### Task 7: Wire Everything — Editor Workspace + Bubble Menu

Integration task — connect all new components, add keyboard shortcuts, configure the slash menu, update the bubble menu.

**Files:**
- Modify: `components/editor-workspace.tsx` (imports, state, extensions, rendering)
- Modify: `components/ai-bubble-menu.tsx` (full rewrite)
- Modify: `components/mobile-header-menu.tsx:118-119` (rename button)
- Delete: `components/ai-assistant-panel.tsx`

**Interfaces:**
- Consumes: All components from Tasks 3–6
- Produces: Fully wired editor with Lekhan Bot

- [ ] **Step 1: Rewrite `components/ai-bubble-menu.tsx`**

```typescript
'use client'

import { BubbleMenu } from '@tiptap/react'
import { Bold, Italic, Underline } from 'lucide-react'

interface AIBubbleMenuProps {
	editor: any
	onOpenLekhanBot: () => void
}

export default function AIBubbleMenu({ editor, onOpenLekhanBot }: AIBubbleMenuProps) {
	if (!editor) return null

	return (
		<BubbleMenu editor={editor} tippyOptions={{ duration: 100 }} className="flex overflow-hidden rounded-lg border border-border bg-card/80 backdrop-blur-md shadow-xl p-1 z-50">
			<button
				onClick={() => editor.chain().focus().toggleBold().run()}
				className={`p-2 transition rounded-md ${editor.isActive('bold') ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground'}`}
			>
				<Bold className="h-4 w-4" />
			</button>
			<button
				onClick={() => editor.chain().focus().toggleItalic().run()}
				className={`p-2 transition rounded-md ${editor.isActive('italic') ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground'}`}
			>
				<Italic className="h-4 w-4" />
			</button>
			<button
				onClick={() => editor.chain().focus().toggleUnderline().run()}
				className={`p-2 transition rounded-md ${editor.isActive('underline') ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground'}`}
			>
				<Underline className="h-4 w-4" />
			</button>

			<div className="w-px bg-border mx-1 my-1" />

			<button
				onClick={onOpenLekhanBot}
				className="flex items-center gap-1.5 p-2 px-3 text-xs font-semibold hover:bg-primary/10 text-primary transition rounded-md"
				title="Lekhan Bot (⌘L)"
			>
				<span className="material-symbols-outlined text-sm">auto_awesome</span>
				<span>AI</span>
			</button>
		</BubbleMenu>
	)
}
```

- [ ] **Step 2: Update `components/editor-workspace.tsx` — imports**

Replace:
```typescript
import AIAssistantPanel from './ai-assistant-panel'
import AIBubbleMenu from './ai-bubble-menu'
```
With:
```typescript
import AISettingsPanel from './ai-settings-panel'
import AIBubbleMenu from './ai-bubble-menu'
import LekhanBotBar from './lekhan-bot-bar'
import AIDiffPreview from './ai-diff-preview'
import { SlashMenuExtension, buildSlashMenuItems } from '@/lib/slash-menu-extension'
import { SlashMenuComponent } from './slash-menu'
```

Add `useCallback` to the React import if not already present.

- [ ] **Step 3: Add slash menu to TipTap extensions**

In the `getSharedExtensions()` function, this can't be done statically because we need the `onOpenLekhanBot` callback. Instead, move the slash menu extension into the `useEditor` call inside the component.

In the `useEditor` extensions array (line ~225-241), add after `...getSharedExtensions()`:

```typescript
SlashMenuExtension.configure({
	suggestion: {
		char: '/',
		items: ({ query }: { query: string }) => {
			const allItems = buildSlashMenuItems(handleOpenLekhanBot)
			if (!query) return allItems
			return allItems.filter(item =>
				item.label.toLowerCase().includes(query.toLowerCase())
			)
		},
		render: () => {
			let component: any
			let popup: any

			return {
				onStart: (props: any) => {
					const { default: tippy } = require('tippy.js')
					const container = document.createElement('div')
					const root = require('react-dom/client').createRoot(container)
					component = { root, container, ref: { current: null } }

					const renderMenu = (items: any[], command: any) => {
						root.render(
							<SlashMenuComponent
								ref={(r: any) => { component.ref.current = r }}
								items={items}
								command={command}
							/>
						)
					}

					renderMenu(props.items, props.command)

					popup = tippy('body', {
						getReferenceClientRect: props.clientRect,
						appendTo: () => document.body,
						content: container,
						showOnCreate: true,
						interactive: true,
						trigger: 'manual',
						placement: 'bottom-start',
					})
				},
				onUpdate: (props: any) => {
					if (!component) return
					const renderMenu = (items: any[], command: any) => {
						component.root.render(
							<SlashMenuComponent
								ref={(r: any) => { component.ref.current = r }}
								items={items}
								command={command}
							/>
						)
					}
					renderMenu(props.items, props.command)
					popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect })
				},
				onKeyDown: (props: any) => {
					if (props.event.key === 'Escape') {
						popup?.[0]?.hide()
						return true
					}
					return component?.ref?.current?.onKeyDown(props) || false
				},
				onExit: () => {
					popup?.[0]?.destroy()
					component?.root?.unmount()
				},
			}
		},
	},
}),
```

> [!IMPORTANT]
> The `require()` calls for `tippy.js` and `react-dom/client` are used here because the render lifecycle runs outside React's component tree. This is the standard TipTap suggestion extension pattern. An alternative is to use a React portal approach — the implementer should choose whichever integrates more cleanly with the existing codebase.

- [ ] **Step 4: Add state variables and handlers**

After `const [isLinkPromptOpen, setIsLinkPromptOpen] = useState(false)` (line ~127), add:

```typescript
const [isLekhanBotOpen, setIsLekhanBotOpen] = useState(false)
const [diffPreview, setDiffPreview] = useState<{
	actionId: string
	originalText: string
	resultText: string
	position: { x: number, y: number }
} | null>(null)

const handleOpenLekhanBot = useCallback(() => {
	setDiffPreview(null)
	setIsLekhanBotOpen(true)
}, [])

const handleLekhanBotResult = useCallback((
	actionId: string,
	result: string,
	originalText: string,
) => {
	if (!editor) return
	const { to } = editor.state.selection
	const coords = editor.view.coordsAtPos(to)
	setDiffPreview({
		actionId,
		originalText,
		resultText: result,
		position: {
			x: coords.left,
			y: coords.bottom + 8,
		},
	})
}, [editor])
```

- [ ] **Step 5: Add `Cmd+L` keyboard shortcut**

After the `handleBeforeUnload` useEffect (line ~222), add:

```typescript
useEffect(() => {
	const handleKeyDown = (e: KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
			e.preventDefault()
			handleOpenLekhanBot()
		}
	}
	document.addEventListener('keydown', handleKeyDown)
	return () => document.removeEventListener('keydown', handleKeyDown)
}, [handleOpenLekhanBot])
```

- [ ] **Step 6: Rename header button**

Change lines 338-345 — update icon from `auto_awesome` to `settings`, text from `AI Companion` to `Settings`, title from `AI Assistant` to `Settings`.

- [ ] **Step 7: Update rendering — bubble menu, Lekhan Bot bar, diff preview**

Replace line ~498:
```typescript
{!isViewer && <AIBubbleMenu editor={editor} token={token} />}
```
With:
```typescript
{!isViewer && <AIBubbleMenu editor={editor} onOpenLekhanBot={handleOpenLekhanBot} />}
```

After `</div>` closing the `editor-canvas` div (line ~507), add the Lekhan Bot bar:
```typescript
{!isViewer && (
	<LekhanBotBar
		editor={editor}
		token={token}
		isVisible={isLekhanBotOpen}
		onClose={() => setIsLekhanBotOpen(false)}
		onResult={handleLekhanBotResult}
	/>
)}
```

After the `</main>` tag (line ~508), add the diff preview:
```typescript
{diffPreview && (
	<AIDiffPreview
		editor={editor}
		actionId={diffPreview.actionId}
		originalText={diffPreview.originalText}
		resultText={diffPreview.resultText}
		position={diffPreview.position}
		onClose={() => setDiffPreview(null)}
	/>
)}
```

Replace line ~511 (`<AIAssistantPanel ...>`) with:
```typescript
<AISettingsPanel isOpen={isAIPanelOpen} onClose={() => setIsAIPanelOpen(false)} editor={editor} token={token} />
```

- [ ] **Step 8: Update `components/mobile-header-menu.tsx`**

Replace lines 118-119:
```typescript
<span className="material-symbols-outlined text-[20px]">auto_awesome</span>
				AI Companion
```
With:
```typescript
<span className="material-symbols-outlined text-[20px]">settings</span>
				Settings
```

- [ ] **Step 9: Delete old panel**

```bash
rm components/ai-assistant-panel.tsx
```

- [ ] **Step 10: Verify build**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: integrate Lekhan Bot, slash menu, diff preview, and settings panel

- Replace old tabbed AI panel with Lekhan Bot prompt bar (Cmd+L, /ai, bubble menu)
- Add / slash menu for block commands (Heading, List, Code, etc.)
- Add inline diff preview with Accept/Insert Below/Copy
- Replace side panel with Settings panel for AI preferences
- Simplify bubble menu to formatting + AI button
- Rename header button from AI Companion to Settings
- Delete old ai-assistant-panel.tsx"
```

---

### Task 8: Mobile Touch Scroll Fix

**Files:**
- Modify: `app/globals.css`
- Modify: `components/color-highlight-popover.tsx:49`

- [ ] **Step 1: Add touch scroll CSS to `app/globals.css`**

After existing scrollbar styles (~line 260):
```css
/* Mobile touch scroll for floating menus and popovers */
.touch-scroll-container {
	-webkit-overflow-scrolling: touch;
	overflow-y: auto;
	overscroll-behavior: contain;
	touch-action: pan-y;
}

@media (pointer: coarse) {
	.touch-scroll-container {
		scroll-behavior: smooth;
	}
}
```

- [ ] **Step 2: Add class to color-highlight-popover.tsx**

Add `max-h-[70vh] touch-scroll-container` to `DropdownMenu.Content` className on line 49.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css components/color-highlight-popover.tsx
git commit -m "fix: add mobile touch scroll support to popup menus"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Run unit tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run build**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 3: Manual smoke test**

Run `npm run dev` and verify:

1. Type `/` → slash menu appears with block commands + "Ask Lekhan Bot" ✓
2. Type `/ai` → filters to "Ask Lekhan Bot" → select it → prompt bar opens ✓
3. Press `Cmd+L` → Lekhan Bot prompt bar slides in at bottom ✓
4. Select text → bubble menu shows `✨ AI` → click → prompt bar opens ✓
5. Click "Fix Grammar" preset with text selected → loading → diff preview ✓
6. Click "Translate" → language picker → select Hindi → diff preview ✓
7. Click "Accept" in diff preview → text replaced ✓
8. Click "Insert Below" → text inserted as new paragraph ✓
9. Press `Esc` → prompt bar closes ✓
10. Header "Settings" button → settings side panel opens ✓
11. Preferences persist across reload ✓
12. Version History still works ✓
13. Mobile: popups scroll on touch ✓

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address smoke test findings"
```
