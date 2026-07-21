# AI Panel v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework Lekhan's AI assistant from a side-panel tabbed UI to an inline command palette with diff preview, new Sarvam features (transliterate, language detection), expanded language/voice coverage, and mobile scroll fixes.

**Architecture:** The AI interaction moves to a floating command palette triggered by `/ai`, `Cmd+J`, or a bubble menu button. Results appear inline via a diff preview card with Accept/Insert Below/Copy/Discard actions. The side panel becomes a lightweight Settings surface for language/voice preferences. The API route adds two new Sarvam actions (transliterate, detect-language).

**Tech Stack:** Next.js 16, React 19, TipTap 2.x, Tailwind CSS, Sarvam AI APIs, Vitest, TypeScript

## Global Constraints

- All code uses tabs for indentation, single quotes, no semicolons
- Component files use kebab-case naming (`ai-command-palette.tsx`)
- Event handlers use `handle` prefix (`handleTranslate`)
- Boolean state uses verb prefix (`isLoading`, `hasSelection`)
- Use `@tiptap/react` v2.4.0+ (already installed)
- Use Material Symbols Outlined for icons (existing pattern)
- All new popup/floating UIs must include mobile touch scroll CSS
- Tests run via `npx vitest run` (jsdom environment, setup at `tests/unit/setup.ts`)
- Design spec: `docs/superpowers/specs/2026-07-21-ai-panel-v2-design.md`
- **Note:** The `/ai` slash command trigger (TipTap suggestion extension) is deferred to a follow-up task. This plan implements `Cmd+J` and bubble menu triggers first — adding the suggestion extension later is additive and won't require rework.

---

### Task 1: API Route — Add Transliterate and Detect-Language Actions

**Files:**
- Modify: `app/api/ai/route.ts:47-84` (body parsing — add `sourceLanguage` field)
- Modify: `app/api/ai/route.ts:179-181` (add new action handlers before the `Invalid action` fallback)
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
		body: JSON.stringify({
			action: 'transliterate',
			text: 'नमस्ते',
			// missing sourceLanguage and targetLanguage
		}),
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
		body: JSON.stringify({
			action: 'detect-language',
			text: 'नमस्ते दुनिया',
		}),
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
		body: JSON.stringify({
			action: 'detect-language',
			// missing text
		}),
	})

	const response = await POST(req)
	expect(response.status).toBe(400)

	const data = await response.json()
	expect(data.error).toContain('Missing text')
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/api-ai.test.ts`
Expected: 4 new tests FAIL (action handlers don't exist yet)

- [ ] **Step 4: Implement transliterate and detect-language actions**

In `app/api/ai/route.ts`:

**a) Add `sourceLanguage` to body parsing (line ~47-61):**

Replace the body destructuring block:
```typescript
let action: string, text: string | undefined, targetLanguage: string | undefined,
	speaker: string | undefined, prompt: string | undefined,
	sourceLanguage: string | undefined
try {
	const body = await readJsonWithLimit<{
		action?: string
		text?: string
		targetLanguage?: string
		sourceLanguage?: string
		speaker?: string
		prompt?: string
	}>(request, MAX_BODY_BYTES)
	action = body.action ?? ''
	text = body.text
	targetLanguage = body.targetLanguage
	sourceLanguage = body.sourceLanguage
	speaker = body.speaker
	prompt = body.prompt
```

**b) Add `sourceLanguage` validation (after the existing `speaker` validation ~line 82-84):**
```typescript
if (typeof sourceLanguage === 'string' && sourceLanguage.length > MAX_SHORT_FIELD_LENGTH) {
	return NextResponse.json({ error: 'Invalid sourceLanguage' }, { status: 400 })
}
```

**c) Add `transliterate` and `detect-language` handlers (before the `Invalid action` fallback ~line 179):**
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
Expected: All 7 tests PASS (3 existing + 4 new)

- [ ] **Step 6: Commit**

```bash
git add app/api/ai/route.ts tests/unit/api-ai.test.ts
git commit -m "feat(api): add transliterate and detect-language actions to AI route"
```

---

### Task 2: Shared AI Constants and Types

**Files:**
- Create: `lib/ai-constants.ts`
- Test: Not separately tested — consumed by Tasks 3-6

**Interfaces:**
- Consumes: Nothing (foundational)
- Produces:
  - `LANGUAGES: Array<{ code: string, name: string, script: string }>` (23 entries)
  - `TTS_LANGUAGES: Array<{ code: string, name: string, script: string }>` (11 entries, subset of LANGUAGES)
  - `SPEAKERS: Array<{ id: string, name: string, tone: string }>` (38 entries)
  - `AI_ACTIONS: Array<AIActionDef>` — action definitions for the command palette
  - `type AIActionDef = { id: string, label: string, icon: string, category: 'write' | 'translate' | 'script' | 'voice', requiresSelection: boolean, defaultInsert: 'accept' | 'below' | 'both', prompt?: string }`
  - `type AIPreferences = { targetLanguage: string, ttsLanguage: string, ttsVoice: string }`
  - `function loadAIPreferences(): AIPreferences`
  - `function saveAIPreferences(prefs: Partial<AIPreferences>): void`

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

export interface AIActionDef {
	id: string
	label: string
	icon: string
	category: 'write' | 'translate' | 'script' | 'voice'
	requiresSelection: boolean
	defaultInsert: 'accept' | 'below' | 'both'
	prompt?: string
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

export const AI_ACTIONS: AIActionDef[] = [
	// Write
	{ id: 'summarize', label: 'Summarize', icon: 'summarize', category: 'write', requiresSelection: true, defaultInsert: 'below', prompt: 'Summarize the following text' },
	{ id: 'fix-grammar', label: 'Fix Grammar', icon: 'spellcheck', category: 'write', requiresSelection: true, defaultInsert: 'accept', prompt: 'Fix spelling and grammar in this text' },
	{ id: 'improve-flow', label: 'Improve Flow', icon: 'edit_note', category: 'write', requiresSelection: true, defaultInsert: 'accept', prompt: 'Improve the writing style of this text' },
	{ id: 'expand', label: 'Expand', icon: 'expand', category: 'write', requiresSelection: true, defaultInsert: 'below', prompt: 'Extend this text with more details' },
	{ id: 'custom-prompt', label: 'Custom Prompt...', icon: 'chat', category: 'write', requiresSelection: false, defaultInsert: 'both' },
	// Translate
	{ id: 'translate', label: 'Translate to...', icon: 'translate', category: 'translate', requiresSelection: true, defaultInsert: 'below' },
	// Script
	{ id: 'transliterate', label: 'Transliterate to...', icon: 'language', category: 'script', requiresSelection: true, defaultInsert: 'accept' },
	// Voice
	{ id: 'read-aloud', label: 'Read Aloud', icon: 'volume_up', category: 'voice', requiresSelection: false, defaultInsert: 'both' },
]

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
		if (stored) {
			return { ...DEFAULT_PREFS, ...JSON.parse(stored) }
		}
	} catch {
		// ignore parse errors
	}
	return DEFAULT_PREFS
}

export function saveAIPreferences(prefs: Partial<AIPreferences>): void {
	if (typeof window === 'undefined') return
	const current = loadAIPreferences()
	const updated = { ...current, ...prefs }
	localStorage.setItem(AI_PREFS_KEY, JSON.stringify(updated))
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ai-constants.ts
git commit -m "feat: add shared AI constants, types, and preference helpers"
```

---

### Task 3: AI Command Palette Component

**Files:**
- Create: `components/ai-command-palette.tsx`
- Test: Manual testing (visual component — tested via integration in Task 6)

**Interfaces:**
- Consumes:
  - `AI_ACTIONS`, `LANGUAGES`, `AIActionDef`, `loadAIPreferences` from `lib/ai-constants.ts` (Task 2)
- Produces:
  - `<AICommandPalette editor={editor} token={token} isOpen={boolean} position={{ x, y }} selectedText={string} onClose={() => void} onAction={(actionId, result, originalText) => void} />`
  - The `onAction` callback passes the action result to the parent for diff preview rendering

- [ ] **Step 1: Create `components/ai-command-palette.tsx`**

```typescript
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
	AI_ACTIONS,
	LANGUAGES,
	loadAIPreferences,
	type AIActionDef,
} from '@/lib/ai-constants'

interface AICommandPaletteProps {
	editor: any
	token: string
	isOpen: boolean
	position: { x: number, y: number }
	selectedText: string
	onClose: () => void
	onAction: (actionId: string, result: string, originalText: string) => void
}

export default function AICommandPalette({
	editor,
	token,
	isOpen,
	position,
	selectedText,
	onClose,
	onAction,
}: AICommandPaletteProps) {
	const [searchQuery, setSearchQuery] = useState('')
	const [subMenu, setSubMenu] = useState<'translate' | 'transliterate' | null>(null)
	const [customPrompt, setCustomPrompt] = useState('')
	const [isLoading, setIsLoading] = useState(false)
	const paletteRef = useRef<HTMLDivElement>(null)
	const searchRef = useRef<HTMLInputElement>(null)

	// Focus search input when palette opens
	useEffect(() => {
		if (isOpen && searchRef.current) {
			searchRef.current.focus()
		}
		if (isOpen) {
			setSearchQuery('')
			setSubMenu(null)
			setCustomPrompt('')
		}
	}, [isOpen])

	// Close on Escape
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				if (subMenu) {
					setSubMenu(null)
				} else {
					onClose()
				}
			}
		}
		if (isOpen) {
			document.addEventListener('keydown', handleKeyDown)
		}
		return () => document.removeEventListener('keydown', handleKeyDown)
	}, [isOpen, subMenu, onClose])

	// Close on click outside
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
				onClose()
			}
		}
		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside)
		}
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [isOpen, onClose])

	const filteredActions = AI_ACTIONS.filter(action =>
		action.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
		action.category.toLowerCase().includes(searchQuery.toLowerCase())
	)

	const executeAction = useCallback(async (
		action: AIActionDef,
		extraParams?: Record<string, string>,
	) => {
		const prefs = loadAIPreferences()
		const text = selectedText

		// Handle read-aloud separately (TTS doesn't produce text result)
		if (action.id === 'read-aloud') {
			setIsLoading(true)
			try {
				const ttsText = text || editor.getText().trim()
				if (!ttsText) {
					toast.error('Document is empty. Type something to read aloud!')
					return
				}
				const res = await fetch('/api/ai', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						action: 'tts',
						text: ttsText,
						targetLanguage: prefs.ttsLanguage,
						speaker: prefs.ttsVoice,
					}),
				})
				if (!res.ok) {
					const err = await res.json()
					throw new Error(err.error || 'TTS failed')
				}
				const data = await res.json()
				const url = `data:audio/wav;base64,${data.base64Audio}`
				const audio = new Audio(url)
				audio.play()
				onClose()
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err)
				toast.error(`TTS failed: ${message}`)
			} finally {
				setIsLoading(false)
			}
			return
		}

		// Require selection for actions that need it
		if (action.requiresSelection && !text) {
			toast.error('Please select some text first')
			return
		}

		setIsLoading(true)
		try {
			let apiAction: string
			let body: Record<string, string>

			if (action.id === 'translate') {
				apiAction = 'translate'
				body = {
					action: apiAction,
					text,
					targetLanguage: extraParams?.targetLanguage || prefs.targetLanguage,
				}
			} else if (action.id === 'transliterate') {
				apiAction = 'transliterate'
				body = {
					action: apiAction,
					text,
					sourceLanguage: extraParams?.sourceLanguage || 'auto',
					targetLanguage: extraParams?.targetLanguage || prefs.targetLanguage,
				}
			} else if (action.id === 'custom-prompt') {
				apiAction = 'chat'
				const fullPrompt = text
					? `Context: "${text}"\n\nPrompt: ${customPrompt}`
					: customPrompt
				body = { action: apiAction, prompt: fullPrompt }
			} else {
				// Write actions (summarize, fix-grammar, improve-flow, expand)
				apiAction = 'chat'
				const fullPrompt = `${action.prompt}:\n\n"${text}"`
				body = { action: apiAction, prompt: fullPrompt }
			}

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
				throw new Error(err.error || 'AI request failed')
			}

			const data = await res.json()
			const result = data.translatedText
				|| data.transliteratedText
				|| data.text
				|| ''
			onAction(action.id, result, text)
			onClose()
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`AI error: ${message}`)
		} finally {
			setIsLoading(false)
		}
	}, [selectedText, token, customPrompt, editor, onAction, onClose])

	const handleActionClick = (action: AIActionDef) => {
		if (action.id === 'translate') {
			setSubMenu('translate')
			return
		}
		if (action.id === 'transliterate') {
			setSubMenu('transliterate')
			return
		}
		if (action.id === 'custom-prompt') {
			// Custom prompt input is always visible — don't execute on click
			return
		}
		executeAction(action)
	}

	if (!isOpen) return null

	const categories = ['write', 'translate', 'script', 'voice'] as const
	const categoryLabels: Record<string, string> = {
		write: 'Write',
		translate: 'Translate',
		script: 'Script',
		voice: 'Voice',
	}

	// Compute position with viewport bounds
	const paletteWidth = 320
	const clampedX = Math.min(
		position.x,
		window.innerWidth - paletteWidth - 16,
	)
	const clampedY = Math.min(position.y, window.innerHeight - 400)

	return createPortal(
		<div
			ref={paletteRef}
			className="fixed z-[9999] w-80 bg-surface-container border border-black/10 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 touch-scroll-container"
			style={{ left: clampedX, top: clampedY }}
		>
			{/* Search Input */}
			<div className="p-3 border-b border-black/5 dark:border-white/5">
				{selectedText && (
					<div className="text-[10px] text-on-surface-variant/60 mb-2 truncate">
						Working with:{' '}
						<span className="italic">
							&quot;{selectedText.slice(0, 30)}
							{selectedText.length > 30 ? '...' : ''}&quot;
						</span>
					</div>
				)}
				<div className="flex items-center gap-2 bg-black/5 dark:bg-white/5 rounded-xl px-3 py-2">
					<span className="material-symbols-outlined text-on-surface-variant/50 text-sm">
						search
					</span>
					<input
						ref={searchRef}
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search AI actions..."
						className="flex-1 bg-transparent text-xs text-on-surface placeholder:text-on-surface-variant/40 outline-none"
					/>
				</div>
			</div>

			{/* Loading overlay */}
			{isLoading && (
				<div className="px-4 py-3 flex items-center gap-2 text-xs text-on-surface-variant/70 border-b border-black/5 dark:border-white/5">
					<span className="animate-spin h-3.5 w-3.5 border-2 border-primary-container border-t-transparent rounded-full" />
					<span>✨ Generating...</span>
				</div>
			)}

			{/* Sub-menu: Language/Script picker */}
			{subMenu && !isLoading && (
				<div className="max-h-64 overflow-y-auto touch-scroll-container p-2">
					<button
						onClick={() => setSubMenu(null)}
						className="flex items-center gap-1 text-xs text-on-surface-variant/60 hover:text-on-surface px-2 py-1 mb-1 transition"
					>
						<span className="material-symbols-outlined text-sm">
							arrow_back
						</span>
						Back
					</button>
					<div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50 px-2 py-1">
						{subMenu === 'translate'
							? 'Translate to'
							: 'Transliterate to'}
					</div>
					{LANGUAGES.map(lang => (
						<button
							key={lang.code}
							onClick={() => {
								const action = AI_ACTIONS.find(
									a => a.id === subMenu,
								)!
								executeAction(action, {
									targetLanguage: lang.code,
									sourceLanguage: 'auto',
								})
							}}
							className="w-full flex items-center gap-2 px-3 py-2 text-xs text-on-surface hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition"
						>
							<span className="text-on-surface-variant/50 text-[10px] w-12">
								{lang.code}
							</span>
							<span>{lang.name}</span>
							<span className="text-on-surface-variant/40 text-[10px] ml-auto">
								{lang.script}
							</span>
						</button>
					))}
				</div>
			)}

			{/* Main action list */}
			{!subMenu && !isLoading && (
				<div className="max-h-72 overflow-y-auto touch-scroll-container p-2">
					{categories.map(cat => {
						const actions = filteredActions.filter(
							a => a.category === cat,
						)
						if (actions.length === 0) return null
						return (
							<div key={cat} className="mb-2">
								<div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50 px-2 py-1">
									{categoryLabels[cat]}
								</div>
								{actions.map(action => {
									const isDisabled =
										action.requiresSelection && !selectedText
									return (
										<button
											key={action.id}
											onClick={() =>
												!isDisabled &&
												handleActionClick(action)
											}
											disabled={isDisabled}
											className={`w-full flex items-center gap-3 px-3 py-2.5 text-xs rounded-xl transition ${
												isDisabled
													? 'text-on-surface-variant/30 cursor-not-allowed'
													: 'text-on-surface hover:bg-black/5 dark:hover:bg-white/5'
											}`}
										>
											<span
												className={`material-symbols-outlined text-sm ${
													isDisabled
														? 'text-on-surface-variant/30'
														: 'text-primary-container'
												}`}
											>
												{action.icon}
											</span>
											<span>{action.label}</span>
											{isDisabled && (
												<span className="text-[10px] text-on-surface-variant/30 ml-auto">
													Select text
												</span>
											)}
										</button>
									)
								})}
							</div>
						)
					})}

					{/* Custom prompt input */}
					{filteredActions.some(a => a.id === 'custom-prompt') && (
						<form
							onSubmit={(e) => {
								e.preventDefault()
								if (!customPrompt.trim()) return
								const action = AI_ACTIONS.find(
									a => a.id === 'custom-prompt',
								)!
								executeAction(action)
							}}
							className="mt-2 px-2"
						>
							<div className="flex gap-2">
								<input
									type="text"
									value={customPrompt}
									onChange={(e) =>
										setCustomPrompt(e.target.value)
									}
									placeholder="Type a custom instruction..."
									className="flex-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:ring-2 focus:ring-primary-container/50"
								/>
								<button
									type="submit"
									disabled={!customPrompt.trim()}
									className="rounded-xl bg-primary-container text-on-primary-container px-3 py-2 text-xs font-semibold hover:brightness-110 transition disabled:opacity-50"
								>
									Go
								</button>
							</div>
						</form>
					)}
				</div>
			)}
		</div>,
		document.body,
	)
}
```

- [ ] **Step 2: Commit**

```bash
git add components/ai-command-palette.tsx
git commit -m "feat: add inline AI command palette component"
```

---

### Task 4: AI Diff Preview Component

**Files:**
- Create: `components/ai-diff-preview.tsx`
- Test: Manual testing (visual component — tested via integration in Task 6)

**Interfaces:**
- Consumes:
  - `AI_ACTIONS` from `lib/ai-constants.ts` (Task 2) — to look up `defaultInsert`
- Produces:
  - `<AIDiffPreview editor={editor} actionId={string} originalText={string} resultText={string} position={{ x, y }} onClose={() => void} />`
  - Handles Accept, Insert Below, Copy, Discard internally via `editor` reference

- [ ] **Step 1: Create `components/ai-diff-preview.tsx`**

```typescript
'use client'

import { useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { AI_ACTIONS } from '@/lib/ai-constants'

interface AIDiffPreviewProps {
	editor: any
	actionId: string
	originalText: string
	resultText: string
	position: { x: number, y: number }
	onClose: () => void
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
	const actionDef = AI_ACTIONS.find(a => a.id === actionId)
	const actionLabel = actionDef?.label || 'AI Result'
	const defaultInsert = actionDef?.defaultInsert || 'both'

	// Close on click outside
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (
				cardRef.current &&
				!cardRef.current.contains(e.target as Node)
			) {
				onClose()
			}
		}
		document.addEventListener('mousedown', handleClickOutside)
		return () =>
			document.removeEventListener('mousedown', handleClickOutside)
	}, [onClose])

	// Close on Escape
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => document.removeEventListener('keydown', handleKeyDown)
	}, [onClose])

	const handleAccept = () => {
		// Replace the original text in the document
		const { state } = editor
		const { doc } = state
		const fullText = doc.textContent
		const idx = fullText.indexOf(originalText)
		if (idx !== -1) {
			editor
				.chain()
				.focus()
				.setTextSelection({
					from: idx + 1,
					to: idx + 1 + originalText.length,
				})
				.insertContent(resultText)
				.run()
		} else {
			// Fallback: insert at current cursor
			editor.chain().focus().insertContent(resultText).run()
		}
		onClose()
	}

	const handleInsertBelow = () => {
		// Move cursor to end of selection and insert as new paragraph
		const { state } = editor
		const { to } = state.selection
		editor
			.chain()
			.focus()
			.setTextSelection(to)
			.insertContent(`\n\n${resultText}`)
			.run()
		onClose()
	}

	const handleCopy = () => {
		navigator.clipboard.writeText(resultText)
		toast.success('Copied to clipboard')
		onClose()
	}

	// Clamp position within viewport
	const cardWidth = 360
	const clampedX = Math.min(
		position.x,
		window.innerWidth - cardWidth - 16,
	)
	const clampedY = Math.min(position.y, window.innerHeight - 300)

	return createPortal(
		<div
			ref={cardRef}
			className="fixed z-[9998] w-[360px] bg-surface-container border border-black/10 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
			style={{ left: clampedX, top: clampedY }}
		>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b border-black/5 dark:border-white/5">
				<div className="flex items-center gap-2 text-xs font-semibold text-on-surface">
					<span className="material-symbols-outlined text-primary-container text-sm">
						auto_awesome
					</span>
					{actionLabel}
				</div>
				<button
					onClick={onClose}
					className="rounded-lg p-1 hover:bg-black/10 dark:hover:bg-white/10 text-on-surface-variant transition"
				>
					<span className="material-symbols-outlined text-sm">
						close
					</span>
				</button>
			</div>

			{/* Content */}
			<div className="px-4 py-3 space-y-3 max-h-48 overflow-y-auto touch-scroll-container">
				{originalText && (
					<div>
						<div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50 mb-1">
							Original
						</div>
						<div className="text-xs text-on-surface-variant bg-black/5 dark:bg-white/5 rounded-lg p-2.5 whitespace-pre-wrap leading-relaxed max-h-20 overflow-y-auto">
							{originalText}
						</div>
					</div>
				)}
				<div>
					<div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/50 mb-1">
						Result
					</div>
					<div className="text-xs text-on-surface bg-primary-container/10 border border-primary-container/20 rounded-lg p-2.5 whitespace-pre-wrap leading-relaxed max-h-20 overflow-y-auto">
						{resultText}
					</div>
				</div>
			</div>

			{/* Actions */}
			<div className="flex items-center gap-2 px-4 py-3 border-t border-black/5 dark:border-white/5">
				<button
					onClick={handleAccept}
					className={`flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 ${
						defaultInsert === 'accept' || defaultInsert === 'both'
							? 'bg-primary-container text-on-primary-container hover:brightness-110'
							: 'bg-black/5 dark:bg-white/5 text-on-surface hover:bg-black/10 dark:hover:bg-white/10'
					}`}
				>
					<span className="material-symbols-outlined text-sm">
						check
					</span>
					Accept
				</button>
				<button
					onClick={handleInsertBelow}
					className={`flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 ${
						defaultInsert === 'below'
							? 'bg-primary-container text-on-primary-container hover:brightness-110'
							: 'bg-black/5 dark:bg-white/5 text-on-surface hover:bg-black/10 dark:hover:bg-white/10'
					}`}
				>
					<span className="material-symbols-outlined text-sm">
						subdirectory_arrow_right
					</span>
					Insert Below
				</button>
				<button
					onClick={handleCopy}
					className="flex items-center gap-1 rounded-xl px-3 py-2 text-xs text-on-surface-variant bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-all active:scale-95"
				>
					<span className="material-symbols-outlined text-sm">
						content_copy
					</span>
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
git commit -m "feat: add inline AI diff preview card component"
```

---

### Task 5: AI Settings Panel (Replaces AI Assistant Panel)

**Files:**
- Create: `components/ai-settings-panel.tsx`
- Delete: `components/ai-assistant-panel.tsx` (handled in Task 6 when we swap imports)
- Test: Manual testing

**Interfaces:**
- Consumes:
  - `LANGUAGES`, `TTS_LANGUAGES`, `SPEAKERS`, `loadAIPreferences`, `saveAIPreferences` from `lib/ai-constants.ts` (Task 2)
  - `CustomSelect` from `components/ui/custom-select.tsx` (existing component)
- Produces:
  - `<AISettingsPanel isOpen={boolean} onClose={() => void} editor={any} token={string} />`
  - Same prop interface as old `AIAssistantPanel` for drop-in replacement

- [ ] **Step 1: Create `components/ai-settings-panel.tsx`**

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { CustomSelect } from './ui/custom-select'
import {
	LANGUAGES,
	TTS_LANGUAGES,
	SPEAKERS,
	loadAIPreferences,
	saveAIPreferences,
} from '@/lib/ai-constants'

interface AISettingsPanelProps {
	isOpen: boolean
	onClose: () => void
	editor: any
	token: string
}

export default function AISettingsPanel({
	isOpen,
	onClose,
	editor,
	token,
}: AISettingsPanelProps) {
	const [prefs, setPrefs] = useState(loadAIPreferences)
	const [detectedLang, setDetectedLang] = useState<{
		languageCode: string
		languageName: string
		script: string
	} | null>(null)
	const [isDetecting, setIsDetecting] = useState(false)

	// Reload prefs when panel opens
	useEffect(() => {
		if (isOpen) {
			setPrefs(loadAIPreferences())
		}
	}, [isOpen])

	// Auto-detect document language (debounced)
	const detectLanguage = useCallback(async () => {
		if (!editor || !token) return
		const text = editor.getText().trim()
		if (!text || text.length < 10) {
			setDetectedLang(null)
			return
		}

		setIsDetecting(true)
		try {
			const sample = text.slice(0, 500)
			const res = await fetch('/api/ai', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					action: 'detect-language',
					text: sample,
				}),
			})
			if (res.ok) {
				const data = await res.json()
				setDetectedLang(data)
			}
		} catch {
			// Silent fail — detection is best-effort
		} finally {
			setIsDetecting(false)
		}
	}, [editor, token])

	// Run detection when panel opens
	useEffect(() => {
		if (isOpen) {
			detectLanguage()
		}
	}, [isOpen, detectLanguage])

	const handlePrefChange = (
		key: keyof typeof prefs,
		value: string,
	) => {
		const updated = { ...prefs, [key]: value }
		setPrefs(updated)
		saveAIPreferences({ [key]: value })
		toast.success('Preference saved')
	}

	if (!isOpen) return null

	// Group speakers: those with tone hints first
	const speakersWithTone = SPEAKERS.filter(s => s.tone)
	const speakersWithoutTone = SPEAKERS.filter(s => !s.tone)
	const sortedSpeakers = [...speakersWithTone, ...speakersWithoutTone]

	return (
		<aside className="absolute right-0 top-0 bottom-0 w-80 bg-background border-l border-black/10 dark:border-white/10 p-6 flex flex-col z-[60] shadow-md backdrop-blur-xl animate-in slide-in-from-right duration-200">
			{/* Header */}
			<div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-4 mb-6">
				<div className="flex items-center gap-sm">
					<div className="w-8 h-8 rounded-lg bg-primary-container/20 flex items-center justify-center">
						<span className="material-symbols-outlined text-primary-container">
							settings
						</span>
					</div>
					<div>
						<h3 className="font-title-lg text-title-lg text-on-surface">
							Settings
						</h3>
						<p className="text-[10px] text-primary-container/80 uppercase tracking-widest font-bold">
							AI Preferences
						</p>
					</div>
				</div>
				<button
					onClick={onClose}
					className="rounded-lg p-1 hover:bg-black/10 dark:hover:bg-white/10 text-on-surface-variant hover:text-on-surface transition"
				>
					<span className="material-symbols-outlined text-lg">
						close
					</span>
				</button>
			</div>

			<div className="flex-1 overflow-y-auto touch-scroll-container px-1.5 -mx-1.5 py-1 -my-1 space-y-6 text-left no-scrollbar">
				{/* Document Intelligence */}
				<div className="space-y-2">
					<p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
						Document Intelligence
					</p>
					<div className="rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-3">
						{isDetecting ? (
							<div className="flex items-center gap-2 text-xs text-on-surface-variant/70">
								<span className="animate-spin h-3 w-3 border-2 border-primary-container border-t-transparent rounded-full" />
								Detecting language...
							</div>
						) : detectedLang ? (
							<div className="flex items-center gap-2">
								<span className="material-symbols-outlined text-primary-container text-sm">
									translate
								</span>
								<div>
									<span className="text-xs font-semibold text-on-surface">
										{detectedLang.languageName}
									</span>
									<span className="text-[10px] text-on-surface-variant/60 ml-1">
										({detectedLang.script})
									</span>
								</div>
							</div>
						) : (
							<span className="text-xs text-on-surface-variant/50">
								Type at least 10 characters to detect language
							</span>
						)}
					</div>
				</div>

				{/* AI Preferences */}
				<div className="space-y-4">
					<p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
						AI Preferences
					</p>

					<div>
						<label className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-1.5">
							Default Translate Target
						</label>
						<CustomSelect
							value={prefs.targetLanguage}
							onValueChange={(val) =>
								handlePrefChange('targetLanguage', val)
							}
							options={LANGUAGES.map(lang => ({
								label: `${lang.name} (${lang.script})`,
								value: lang.code,
							}))}
							triggerClassName="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-2.5 h-[38px] text-xs text-on-surface focus:ring-2 focus:ring-primary-container/50 outline-none premium-transition"
						/>
					</div>

					<div>
						<label className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-1.5">
							Default TTS Language
						</label>
						<CustomSelect
							value={prefs.ttsLanguage}
							onValueChange={(val) =>
								handlePrefChange('ttsLanguage', val)
							}
							options={TTS_LANGUAGES.map(lang => ({
								label: lang.name,
								value: lang.code,
							}))}
							triggerClassName="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-2.5 h-[38px] text-xs text-on-surface focus:ring-2 focus:ring-primary-container/50 outline-none premium-transition"
						/>
					</div>

					<div>
						<label className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-1.5">
							Default Voice
						</label>
						<CustomSelect
							value={prefs.ttsVoice}
							onValueChange={(val) =>
								handlePrefChange('ttsVoice', val)
							}
							options={sortedSpeakers.map(sp => ({
								label: sp.tone
									? `${sp.name} — ${sp.tone}`
									: sp.name,
								value: sp.id,
							}))}
							triggerClassName="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-2.5 h-[38px] text-xs text-on-surface focus:ring-2 focus:ring-primary-container/50 outline-none premium-transition"
						/>
					</div>
				</div>

				{/* Quick Reference */}
				<div className="space-y-2">
					<p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
						Keyboard Shortcuts
					</p>
					<div className="rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-3 space-y-2">
						<div className="flex justify-between text-xs">
							<span className="text-on-surface-variant">
								Open AI palette
							</span>
							<kbd className="bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded text-[10px] font-mono">
								⌘ J
							</kbd>
						</div>
						<div className="flex justify-between text-xs">
							<span className="text-on-surface-variant">
								Slash command
							</span>
							<kbd className="bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded text-[10px] font-mono">
								/ai
							</kbd>
						</div>
						<div className="flex justify-between text-xs">
							<span className="text-on-surface-variant">
								Dismiss
							</span>
							<kbd className="bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded text-[10px] font-mono">
								Esc
							</kbd>
						</div>
					</div>
				</div>
			</div>

			{/* Footer */}
			<div className="mt-auto pt-6 text-left border-t border-black/5 dark:border-white/5">
				<p className="text-[10px] text-on-surface-variant/50 leading-relaxed">
					AI-generated content may be inaccurate or misleading.
					Always review and verify important information.
				</p>
			</div>
		</aside>
	)
}
```

- [ ] **Step 2: Commit**

```bash
git add components/ai-settings-panel.tsx
git commit -m "feat: add AI settings panel component (replaces old tabbed panel)"
```

---

### Task 6: Wire Everything into Editor Workspace + Update Bubble Menu

This is the integration task — connect all new components, remove old ones, fix the header button label, add keyboard shortcut handling.

**Files:**
- Modify: `components/editor-workspace.tsx:27-28` (swap imports)
- Modify: `components/editor-workspace.tsx:122` (add new state vars)
- Modify: `components/editor-workspace.tsx:338-345` (rename header button)
- Modify: `components/editor-workspace.tsx:497-499` (swap bubble menu, add palette + diff preview)
- Modify: `components/editor-workspace.tsx:511` (swap AIAssistantPanel → AISettingsPanel)
- Modify: `components/ai-bubble-menu.tsx` (full rewrite — remove Translate/Listen, add AI button)
- Modify: `components/mobile-header-menu.tsx:119` (rename "AI Companion" to "Settings")

**Interfaces:**
- Consumes:
  - `AICommandPalette` from Task 3
  - `AIDiffPreview` from Task 4
  - `AISettingsPanel` from Task 5
  - Updated `AIBubbleMenu` (this task)
- Produces: Fully wired editor with inline AI experience

- [ ] **Step 1: Rewrite `components/ai-bubble-menu.tsx`**

Replace the entire file content with:

```typescript
'use client'

import { BubbleMenu } from '@tiptap/react'
import { Bold, Italic, Underline } from 'lucide-react'

interface AIBubbleMenuProps {
	editor: any
	onOpenAIPalette: () => void
}

export default function AIBubbleMenu({
	editor,
	onOpenAIPalette,
}: AIBubbleMenuProps) {
	if (!editor) return null

	return (
		<BubbleMenu
			editor={editor}
			tippyOptions={{ duration: 100 }}
			className="flex overflow-hidden rounded-lg border border-border bg-card/80 backdrop-blur-md shadow-xl p-1 z-50"
		>
			<button
				onClick={() => editor.chain().focus().toggleBold().run()}
				className={`p-2 transition rounded-md ${
					editor.isActive('bold')
						? 'bg-primary/20 text-primary'
						: 'hover:bg-muted text-muted-foreground'
				}`}
			>
				<Bold className="h-4 w-4" />
			</button>
			<button
				onClick={() => editor.chain().focus().toggleItalic().run()}
				className={`p-2 transition rounded-md ${
					editor.isActive('italic')
						? 'bg-primary/20 text-primary'
						: 'hover:bg-muted text-muted-foreground'
				}`}
			>
				<Italic className="h-4 w-4" />
			</button>
			<button
				onClick={() =>
					editor.chain().focus().toggleUnderline().run()
				}
				className={`p-2 transition rounded-md ${
					editor.isActive('underline')
						? 'bg-primary/20 text-primary'
						: 'hover:bg-muted text-muted-foreground'
				}`}
			>
				<Underline className="h-4 w-4" />
			</button>

			<div className="w-px bg-border mx-1 my-1" />

			<button
				onClick={onOpenAIPalette}
				className="flex items-center gap-1.5 p-2 px-3 text-xs font-semibold hover:bg-primary/10 text-primary transition rounded-md"
			>
				<span className="material-symbols-outlined text-sm">
					auto_awesome
				</span>
				<span>AI</span>
			</button>
		</BubbleMenu>
	)
}
```

- [ ] **Step 2: Update `components/editor-workspace.tsx` imports**

Replace lines 27-28:
```typescript
import AIAssistantPanel from './ai-assistant-panel'
import AIBubbleMenu from './ai-bubble-menu'
```
With:
```typescript
import AISettingsPanel from './ai-settings-panel'
import AIBubbleMenu from './ai-bubble-menu'
import AICommandPalette from './ai-command-palette'
import AIDiffPreview from './ai-diff-preview'
```

Also add `useCallback` to the React import on line 3 (it already imports `useEffect, useState`):
```typescript
import { useEffect, useState, useCallback } from 'react'
```

- [ ] **Step 3: Add new state and helper functions to `components/editor-workspace.tsx`**

After line 127 (`const [isLinkPromptOpen, setIsLinkPromptOpen] = useState(false)`), add:

```typescript
const [isPaletteOpen, setIsPaletteOpen] = useState(false)
const [palettePosition, setPalettePosition] = useState({ x: 0, y: 0 })
const [diffPreview, setDiffPreview] = useState<{
	actionId: string
	originalText: string
	resultText: string
	position: { x: number, y: number }
} | null>(null)

const getSelectionInfo = useCallback(() => {
	if (!editor) return { text: '', position: { x: 0, y: 0 } }
	const { from, to } = editor.state.selection
	const selectedText = editor.state.doc.textBetween(from, to, ' ').trim()
	const coords = editor.view.coordsAtPos(to)
	return {
		text: selectedText,
		position: { x: coords.left, y: coords.bottom + 8 },
	}
}, [editor])

const handleOpenPalette = useCallback(() => {
	setDiffPreview(null)
	const { position } = getSelectionInfo()
	setPalettePosition(
		position.x === 0 && position.y === 0
			? { x: window.innerWidth / 2 - 160, y: window.innerHeight / 3 }
			: position,
	)
	setIsPaletteOpen(true)
}, [getSelectionInfo])

const handleAIAction = useCallback((
	actionId: string,
	result: string,
	originalText: string,
) => {
	const { position } = getSelectionInfo()
	setDiffPreview({
		actionId,
		originalText,
		resultText: result,
		position:
			position.x === 0 && position.y === 0
				? { x: window.innerWidth / 2 - 180, y: window.innerHeight / 3 }
				: position,
	})
}, [getSelectionInfo])
```

- [ ] **Step 4: Add Cmd+J keyboard shortcut**

Add this `useEffect` after the existing `handleBeforeUnload` effect (after line ~222):

```typescript
useEffect(() => {
	const handleKeyDown = (e: KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
			e.preventDefault()
			handleOpenPalette()
		}
	}
	document.addEventListener('keydown', handleKeyDown)
	return () => document.removeEventListener('keydown', handleKeyDown)
}, [handleOpenPalette])
```

- [ ] **Step 5: Rename header button (lines ~338-345)**

Change the AI header button from `auto_awesome` / `AI Companion` to `settings` / `Settings`:

Replace:
```typescript
<span className="material-symbols-outlined text-primary-container text-lg">auto_awesome</span>
<span className="hidden lg:inline">AI Companion</span>
```
With:
```typescript
<span className="material-symbols-outlined text-primary-container text-lg">settings</span>
<span className="hidden lg:inline">Settings</span>
```

Also update the `title` prop on that button from `"AI Assistant"` to `"Settings"`.

- [ ] **Step 6: Update bubble menu and add new components (lines ~497-511)**

Replace line ~498:
```typescript
{!isViewer && <AIBubbleMenu editor={editor} token={token} />}
```
With:
```typescript
{!isViewer && <AIBubbleMenu editor={editor} onOpenAIPalette={handleOpenPalette} />}
{!isViewer && (
	<AICommandPalette
		editor={editor}
		token={token}
		isOpen={isPaletteOpen}
		position={palettePosition}
		selectedText={getSelectionInfo().text}
		onClose={() => setIsPaletteOpen(false)}
		onAction={handleAIAction}
	/>
)}
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

Replace line ~511:
```typescript
<AIAssistantPanel isOpen={isAIPanelOpen} onClose={() => setIsAIPanelOpen(false)} editor={editor} token={token} />
```
With:
```typescript
<AISettingsPanel isOpen={isAIPanelOpen} onClose={() => setIsAIPanelOpen(false)} editor={editor} token={token} />
```

- [ ] **Step 7: Update `components/mobile-header-menu.tsx`**

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

- [ ] **Step 8: Delete old AI assistant panel**

```bash
rm components/ai-assistant-panel.tsx
```

- [ ] **Step 9: Verify the app compiles**

Run: `npx next build`
Expected: Build succeeds without errors

If the build fails due to missing imports or type errors, fix them before proceeding.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: integrate AI command palette, diff preview, and settings panel

- Replace old tabbed AI panel with inline command palette (Cmd+J, bubble menu)
- Add diff preview for AI results with Accept/Insert Below/Copy/Discard
- Replace AI side panel with lightweight Settings panel
- Simplify bubble menu to formatting + AI button
- Rename header button from AI Companion to Settings
- Delete old ai-assistant-panel.tsx"
```

---

### Task 7: Mobile Touch Scroll Fix

**Files:**
- Modify: `app/globals.css` (add touch scroll utility class)
- Modify: `components/color-highlight-popover.tsx:49` (add scroll class to popover content)

**Interfaces:**
- Consumes: Nothing
- Produces: `.touch-scroll-container` CSS class used by all floating/popup UIs

- [ ] **Step 1: Add touch scroll CSS to `app/globals.css`**

Add after the existing scrollbar styles (after the `::-webkit-scrollbar-thumb:hover` block near line ~260):

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

- [ ] **Step 2: Add touch scroll class to `components/color-highlight-popover.tsx`**

On line 49, add `max-h-[70vh] touch-scroll-container` to the `DropdownMenu.Content` className:

Replace:
```typescript
className="z-[9999] min-w-[12rem] bg-surface-container rounded-xl border border-black/10 dark:border-white/10 p-2 shadow-xl"
```
With:
```typescript
className="z-[9999] min-w-[12rem] max-h-[70vh] bg-surface-container rounded-xl border border-black/10 dark:border-white/10 p-2 shadow-xl touch-scroll-container"
```

- [ ] **Step 3: Verify no build errors**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add app/globals.css components/color-highlight-popover.tsx
git commit -m "fix: add mobile touch scroll support to popup menus and floating UIs"
```

---

### Task 8: Run All Tests and Final Verification

**Files:**
- No new files — verification only

- [ ] **Step 1: Run unit tests**

Run: `npx vitest run`
Expected: All tests pass (including the 4 new tests from Task 1)

- [ ] **Step 2: Run build**

Run: `npx next build`
Expected: Build succeeds without errors or warnings

- [ ] **Step 3: Manual smoke test checklist**

Run `npm run dev` and test in the browser:

1. Press `Cmd+J` → command palette appears ✓
2. Select text → bubble menu shows `✨ AI` button → click → palette opens with selection context ✓
3. Click "Summarize" with text selected → loading state → diff preview appears ✓
4. Click "Accept" in diff preview → selected text is replaced ✓
5. Click "Insert Below" in diff preview → text inserted as new paragraph ✓
6. Click "Copy" in diff preview → clipboard updated ✓
7. Click "Translate to..." → language picker appears with 23 languages → select Hindi → diff preview shows translation ✓
8. Click "Transliterate to..." → script picker → select English → diff preview shows result ✓
9. Click "Read Aloud" with no selection → full document is read ✓
10. Header "Settings" button opens settings side panel with preferences ✓
11. Changing preferences persists across page reload ✓
12. Version History still works alongside Settings panel ✓
13. Mobile: color picker popover scrolls on touch ✓
14. Mobile: AI command palette scrolls on touch ✓

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address smoke test findings"
```
