# Obsidian Vault Ingestion → IR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the client-side Obsidian importer (OI-T2 #61) that reads a whole vault from a ZIP (`jszip`) or a folder picker (`showDirectoryPicker` / `webkitdirectory` fallback) and normalizes it into the pipeline's intermediate representation (IR): pages with title, frontmatter→`properties`/tags, callout-aware editor content, a folder path for the nested parent chain, images → base64 embeds, plus honest fidelity counts for the import report.

**Architecture:** Three thin browser adapters (`readVaultZip`, `readVaultFiles`, `readVaultDirectory`) each produce a normalized `VaultContent` (file bytes + discovered directories). A single pure normalization function `importObsidianVault(files, directories, options)` then: enumerates `.md`/`.markdown` (skipping `.obsidian/`, `.trash/`, `.canvas`, and non-markdown binaries), parses frontmatter via the #26 engine, rewrites `![[embeds]]` (images → base64 data-URL image nodes; non-images → degraded `[[wikilinks]]`), parses the body with the round-trip engine, fits it to the live `heading block*` schema, and seeds a fresh Y.Doc's `default` fragment → base64 `contentYjsBase64`. A new shared `lib/yjs-seed.ts` holds the headless seeding helper (single cached schema, `prosemirrorJSONToYXmlFragment`). The report resolves `[[wikilinks]]` by normalized-title lookup against imported ∪ existing workspace pages.

**Tech Stack:** jszip 3.10.1 (new dependency, added), Tiptap v3 (`@tiptap/core`), y-prosemirror 1.3.7, yjs 13.6, vitest (jsdom), Next.js.

## Global Constraints

- `contentYjsBase64` must be a `Y.encodeStateAsUpdate` of a Y.Doc whose `getXmlFragment('default')` holds the parsed page content fitted to the **live editor schema** (`heading block*`, i.e. `getSharedExtensions()` default `CustomDocument`). The live editor's `Collaboration.configure({ document })` binds that fragment, so seeded state must be schema-valid for it or opening throws.
- The parser keeps `[[wikilinks]]`, `[[Target|alias]]`, `#tags`, and non-image embeds as **literal text** (verified: `parseMarkdown` round-trips them unchanged) — do NOT convert them to nodes. Only `![[image.ext]]` becomes a real image node, via the `data:image/...;base64,...` markdown syntax that the shared `Image` extension (`allowBase64: true`) parses.
- `fitLiveSchema` (currently private in `lib/import-hydration.ts`) must be exported and reused — it prepends an empty title heading when the body doesn't start with a heading, and trims trailing empty paragraphs.
- Reuse `parseFrontmatter` and `parseMarkdown` from `lib/markdown-io.ts` and `titleFromFilename` from `services/import.ts`. Title precedence: frontmatter `title` wins over filename-derived. `tags` fold into both `properties.tags` (the #26 mirror) and the IR `tags` field.
- `folderPath` in the IR is the vault-relative directory of a note (`"guides"` for `guides/foo.md`, `null` for root). Folder pages (including folders with no notes) are IR pages with `isFolder: true`, empty content, and their own `folderPath` (their parent). Write stage #62 consumes `isFolder` to build the parent chain.
- Report link counts are **distinct normalized targets** across all note `plainText`s; resolution set = imported note titles ∪ `existingPageTitles` (passed in). Normalization mirrors `server/graph-index.js` `normalizeTitle` (lowercase, collapse whitespace) — a small local mirror, NOT an import of server CJS into the client bundle.
- Skip rules: any path whose first segment is `.obsidian` or `.trash`, any file whose name ends `.canvas`, and any non-markdown non-image file. Images (`png jpg jpeg gif webp svg bmp avif ico`) are kept as attachment data for embed resolution, never as pages.
- Clear errors (throw): vault with no markdown files; import exceeding `MAX_IMPORT_PAGES = 2000` note pages.
- `showDirectoryPicker` is feature-detected and structurally typed (TS lib.dom here lacks `FileSystemDirectoryHandle`); tests cover `readVaultZip` + `readVaultFiles` (webkitdirectory) and the pure core — the picker walker is a thin, untested-by-jsdom browser adapter.
- Test/lint/build: `export PATH="/Users/harshdave/.hermes/node/bin:$PATH"` then `npm test`, `npm run lint`, `npm run build`. Existing suites (esp. `markdown-io`, `import-hydration`, `callout`, `graph-index`) must stay green.

---

### Task 1: Headless Yjs seeding helper

**Files:**
- Create: `lib/yjs-seed.ts`
- Test: `tests/unit/yjs-seed.test.ts`

**Interfaces:**
- Consumes: `getSharedExtensions` (`@/lib/editor-extensions`), `JSONContent` (`@tiptap/core`), `prosemirrorJSONToYXmlFragment` (`y-prosemirror`), `Y` (`yjs`).
- Produces: `contentToYjsBase64(content: JSONContent): string`, `contentToPlainText(content: JSONContent): string`, `uint8ArrayToBase64(bytes: Uint8Array): string`, `base64ToUint8Array(b64: string): Uint8Array`. Task 3 consumes all four; Task 3's image embeds consume `uint8ArrayToBase64`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/yjs-seed.test.ts
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { getSharedExtensions } from '@/lib/editor-extensions'
import { contentToYjsBase64, contentToPlainText, uint8ArrayToBase64, base64ToUint8Array } from '@/lib/yjs-seed'

describe('contentToYjsBase64', () => {
	it('seeds a Y.Doc whose default fragment renders in a bound live editor', () => {
		const content = {
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
			],
		}
		const b64 = contentToYjsBase64(content)
		expect(typeof b64).toBe('string')
		expect(b64.length).toBeGreaterThan(0)

		const fresh = new Y.Doc()
		Y.applyUpdate(fresh, base64ToUint8Array(b64))
		const editor = new Editor({
			extensions: [
				...getSharedExtensions(),
				Collaboration.configure({ document: fresh }),
			],
		})
		expect(editor.getHTML()).toContain('Title')
		expect(editor.getHTML()).toContain('Hello world')
		editor.destroy()
	})

	it('seeds callout content (live schema) so it renders as a callout', () => {
		const content = {
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'T' }] },
				{
					type: 'callout',
					attrs: { type: 'note', title: 'Tip', collapsed: false },
					content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inner' }] }],
				},
			],
		}
		const fresh = new Y.Doc()
		Y.applyUpdate(fresh, base64ToUint8Array(contentToYjsBase64(content)))
		const editor = new Editor({
			extensions: [
				...getSharedExtensions(),
				Collaboration.configure({ document: fresh }),
			],
		})
		expect(editor.getHTML()).toContain('data-callout')
		expect(editor.getHTML()).toContain('Tip')
		editor.destroy()
	})

	it('rejects content invalid for the live heading-block* schema', () => {
		// paragraph-first (no leading heading) is invalid for the live doc schema.
		expect(() =>
			contentToYjsBase64({ type: 'doc', content: [{ type: 'paragraph', content: [] }] })
		).toThrow()
	})
})

describe('contentToPlainText', () => {
	it('concatenates text, preserving wikilinks and tags literally', () => {
		const content = {
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'See [[Alpha]] and #work' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] },
			],
		}
		const text = contentToPlainText(content)
		expect(text).toContain('[[Alpha]]')
		expect(text).toContain('#work')
		expect(text).toContain('second')
	})

	it('excludes image node src from plain text', () => {
		const content = {
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
				{ type: 'image', attrs: { src: 'data:image/png;base64,AAAA' } },
			],
		}
		expect(contentToPlainText(content)).toBe('before')
	})
})

describe('base64 helpers', () => {
	it('round-trips arbitrary bytes', () => {
		const bytes = new Uint8Array([0, 1, 2, 250, 255])
		expect(base64ToUint8Array(uint8ArrayToBase64(bytes))).toEqual(bytes)
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/yjs-seed.test.ts`
Expected: FAIL — `lib/yjs-seed.ts` does not exist (module not found).

- [ ] **Step 3: Write the implementation**

```ts
// lib/yjs-seed.ts
import * as Y from 'yjs'
import type { JSONContent, Schema } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror'
import { getSharedExtensions } from '@/lib/editor-extensions'

let liveSchema: Schema | null = null

/**
 * The live editor schema (`heading block*`, from `getSharedExtensions()`'s
 * default `CustomDocument`). Built once and reused so a large vault does not
 * pay Editor-construction cost per page. Seeded content MUST be schema-valid
 * for this schema (callers fit via `fitLiveSchema` first).
 */
function getLiveSchema(): Schema {
	if (!liveSchema) {
		const editor = new Editor({ extensions: getSharedExtensions() })
		liveSchema = editor.schema
		editor.destroy()
	}
	return liveSchema
}

/**
 * Base64-encode bytes without a `Buffer` dependency (works in browser and
 * Node 22). Chunked so large image data URLs do not blow the call stack.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = ''
	const chunkSize = 0x8000
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
	}
	return btoa(binary)
}

/** Decode a base64 string back to bytes. */
export function base64ToUint8Array(b64: string): Uint8Array {
	const binary = atob(b64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i)
	}
	return bytes
}

/**
 * Seed a Y.Doc's `default` XmlFragment with the given editor content and
 * return the base64-encoded `Y.encodeStateAsUpdate`. `content` must be valid
 * for the live `heading block*` schema (fit it first). This is the shared
 * headless seeding helper the import pipeline uses to build `contentYjsBase64`.
 */
export function contentToYjsBase64(content: JSONContent): string {
	const ydoc = new Y.Doc()
	try {
		prosemirrorJSONToYXmlFragment(getLiveSchema(), content, ydoc.getXmlFragment('default'))
		return uint8ArrayToBase64(Y.encodeStateAsUpdate(ydoc))
	} finally {
		ydoc.destroy()
	}
}

/**
 * Plain text of a doc for `searchable_text` + link/tag extraction: all text
 * nodes joined with newlines. Wikilinks and `#tags` are literal text nodes, so
 * they survive verbatim (the graph index regexes need them); image `src`
 * attributes are not text and are excluded.
 */
export function contentToPlainText(content: JSONContent): string {
	const parts: string[] = []
	const walk = (node: JSONContent): void => {
		if (node.type === 'text') {
			if (node.text) parts.push(node.text)
			return
		}
		if (node.content) {
			for (const child of node.content) walk(child)
		}
	}
	walk(content)
	return parts.join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/yjs-seed.test.ts`
Expected: PASS (3 groups, 5 tests).

- [ ] **Step 5: Run lint and build**

Run: `npm run lint && npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/yjs-seed.ts tests/unit/yjs-seed.test.ts package.json package-lock.json
git commit -m "feat: headless Yjs seeding helper for the import pipeline (OI-T2 #61)"
```

---

### Task 2: Vault readers (ZIP + webkitdirectory + directory picker)

**Files:**
- Create: `services/obsidian-import.ts`
- Test: `tests/unit/obsidian-import-read.test.ts`

**Interfaces:**
- Consumes: `uint8ArrayToBase64` (Task 1), jszip `JSZip`.
- Produces: `interface VaultEntry { path: string; data: Uint8Array }`, `interface VaultContent { files: VaultEntry[]; directories: string[] }`, `interface VaultDirectoryHandle` (minimal structural type for the browser File System Access API), `pickVaultDirectory(): Promise<VaultDirectoryHandle | null>`, `readVaultZip(zipFile: File): Promise<VaultContent>`, `readVaultFiles(files: File[]): Promise<VaultContent>`, `readVaultDirectory(handle: VaultDirectoryHandle): Promise<VaultContent>`. Task 3 consumes `VaultContent`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/obsidian-import-read.test.ts
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { readVaultZip, readVaultFiles, type VaultContent } from '@/services/obsidian-import'

async function fixtureZip(): Promise<File> {
	const zip = new JSZip()
	zip.file('guides/intro.md', '# Intro\n')
	zip.file('guides/alpha.md', '# Alpha\n')
	zip.file('root.md', '# Root\n![[pic.png]]\n')
	zip.file('pic.png', new Uint8Array([137, 80, 78, 71])) // PNG magic
	zip.file('notes/bin.dat', new Uint8Array([0, 1, 2]))
	zip.file('.obsidian/app.json', '{}')
	zip.file('.trash/deleted.md', '# gone\n')
	zip.file('stuff.canvas', '{}')
	zip.folder('emptyfolder')
	const blob = await zip.generateAsync({ type: 'blob' })
	return new File([blob], 'vault.zip', { type: 'application/zip' })
}

describe('readVaultZip', () => {
	it('enumerates markdown and image files with vault-relative paths', async () => {
		const vault = await readVaultZip(await fixtureZip())
		const paths = vault.files.map((f) => f.path).sort()
		expect(paths).toEqual(['guides/alpha.md', 'guides/intro.md', 'pic.png', 'root.md'])
	})

	it('reports the image data as raw bytes', async () => {
		const vault = await readVaultZip(await fixtureZip())
		const pic = vault.files.find((f) => f.path === 'pic.png')
		expect(pic).toBeDefined()
		expect(Array.from(pic!.data)).toEqual([137, 80, 78, 71])
	})

	it('discovers directories including folders with no notes', async () => {
		const vault = await readVaultZip(await fixtureZip())
		expect(vault.directories.sort()).toEqual(['emptyfolder', 'guides'])
	})
})

describe('readVaultFiles (webkitdirectory)', () => {
	it('uses webkitRelativePath, stripping the picked root folder segment', async () => {
		const makeFile = (rel: string, name: string) =>
			Object.assign(new File([name], name), { webkitRelativePath: rel })
		const files = [
			makeFile('vault/guides/a.md', 'a.md'),
			makeFile('vault/root.md', 'root.md'),
			makeFile('vault/.obsidian/app.json', 'app.json'),
		]
		const vault = await readVaultFiles(files)
		expect(vault.files.map((f) => f.path).sort()).toEqual(['guides/a.md', 'root.md'])
		expect(vault.directories).toEqual(['guides'])
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/obsidian-import-read.test.ts`
Expected: FAIL — `@/services/obsidian-import` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// services/obsidian-import.ts
import JSZip from 'jszip'

export interface VaultEntry {
	/** Vault-relative path with forward slashes, e.g. `guides/foo.md`. */
	path: string
	/** Raw file bytes (utf-8 for markdown, binary for images). */
	data: Uint8Array
}

export interface VaultContent {
	/** Non-skipped files (markdown + images). Images are kept as attachment data for embeds. */
	files: VaultEntry[]
	/** Every directory discovered (including folders with no notes), vault-relative. */
	directories: string[]
}

/** Minimal structural type for the browser File System Access API (TS lib.dom lacks it). */
export interface VaultDirectoryHandle {
	values(): AsyncIterableIterator<VaultEntryHandle>
}
export interface VaultEntryHandle {
	kind: 'file' | 'directory'
	name: string
	getFile(): Promise<File>
	getDirectoryHandle?(): Promise<VaultDirectoryHandle>
}

const SKIP_DIRS = new Set(['.obsidian', '.trash'])
const MARKDOWN_EXT = new Set(['.md', '.markdown'])

/**
 * Feature-detect the File System Access API. Returns `null` where unavailable
 * (Firefox, Safari) so callers can fall back to `<input type="file" webkitdirectory>`.
 */
export function pickVaultDirectory (): Promise<VaultDirectoryHandle | null> {
	const picker = (window as unknown as { showDirectoryPicker?: () => Promise<VaultDirectoryHandle> }).showDirectoryPicker
	if (typeof picker !== 'function') {
		return Promise.resolve(null)
	}
	return Promise.resolve(picker.call(window))
}

function dirname(path: string): string {
	const idx = path.lastIndexOf('/')
	return idx === -1 ? '' : path.slice(0, idx)
}

function basename(path: string): string {
	return path.split('/').pop() ?? path
}

function isSkipped(path: string): boolean {
	const segments = path.split('/')
	if (SKIP_DIRS.has(segments[0])) return true
	const name = basename(path)
	return name.endsWith('.canvas') || name.startsWith('.' )
}

function isMarkdown(path: string): boolean {
	return MARKDOWN_EXT.has(basename(path).toLowerCase())
}

function isImage(path: string): boolean {
	return /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(basename(path))
}

/** Normalize a raw path (strip leading `/`, collapse `./`, drop trailing `/` for dirs). */
function normalizePath(path: string): string {
	return path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/\.\//g, '/')
}

export async function readVaultZip (zipFile: File): Promise<VaultContent> {
	const zip = await JSZip.loadAsync(zipFile)
	const files: VaultEntry[] = []
	const directories = new Set<string>()

	for (const rawPath of Object.keys(zip.files)) {
		const path = normalizePath(rawPath)
		if (!path) continue
		const entry = zip.files[rawPath]
		if (entry.dir) {
			const dir = dirname(path)
			if (dir) directories.add(dir)
			continue
		}
		if (isSkipped(path)) continue
		if (!isMarkdown(path) && !isImage(path)) continue
		const data = await entry.async('uint8array')
		files.push({ path, data })
		const dir = dirname(path)
		if (dir) directories.add(dir)
	}

	return { files, directories: [...directories] }
}

/**
 * `webkitdirectory` fallback. Each `File` carries `webkitRelativePath`
 * (`<pickedRoot>/<relative>`); the first segment is the folder the user
 * selected, so it is stripped to make paths vault-relative.
 */
export async function readVaultFiles (files: File[]): Promise<VaultContent> {
	const entries: VaultEntry[] = []
	const directories = new Set<string>()

	for (const file of files) {
		const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name
		const path = normalizePath(rel.replace(/^[^/]+\//, ''))
		if (!path) continue
		if (isSkipped(path)) continue
		if (!isMarkdown(path) && !isImage(path)) continue
		const data = new Uint8Array(await file.arrayBuffer())
		entries.push({ path, data })
		const dir = dirname(path)
		if (dir) directories.add(dir)
	}

	return { files: entries, directories: [...directories] }
}

/**
 * `showDirectoryPicker` walker. Recursively reads files and records every
 * directory (including empty ones), producing vault-relative paths.
 */
export async function readVaultDirectory (handle: VaultDirectoryHandle): Promise<VaultContent> {
	const files: VaultEntry[] = []
	const directories = new Set<string>()

	async function walk (dir: VaultDirectoryHandle, prefix: string): Promise<void> {
		for await (const entry of dir.values()) {
			const path = prefix ? `${prefix}/${entry.name}` : entry.name
			if (entry.kind === 'directory') {
				directories.add(path)
				await walk(entry.getDirectoryHandle!(), path)
			} else {
				if (isSkipped(path)) continue
				if (!isMarkdown(path) && !isImage(path)) continue
				const file = await entry.getFile()
				files.push({ path, data: new Uint8Array(await file.arrayBuffer()) })
			}
		}
	}

	await walk(handle, '')
	return { files, directories: [...directories] }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/obsidian-import-read.test.ts`
Expected: PASS (3 groups, 5 tests).

- [ ] **Step 5: Run lint and build**

Run: `npm run lint && npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add services/obsidian-import.ts tests/unit/obsidian-import-read.test.ts
git commit -m "feat: vault readers for ZIP, webkitdirectory and directory picker (OI-T2 #61)"
```

---

### Task 3: Core normalization → IR + report

**Files:**
- Modify: `lib/import-hydration.ts` (export `fitLiveSchema`)
- Modify: `services/obsidian-import.ts` (append IR builder)
- Test: `tests/unit/obsidian-import.test.ts`

**Interfaces:**
- Consumes: `VaultContent` (Task 2), `contentToYjsBase64`/`contentToPlainText`/`uint8ArrayToBase64` (Task 1), `parseFrontmatter`/`parseMarkdown` (`@/lib/markdown-io`), `titleFromFilename` (`@/services/import`), `fitLiveSchema` (this task), `Image` extensions.
- Produces: `interface ObsidianImportPage`, `interface ObsidianImportIR`, `interface ObsidianImportReport`, `interface ObsidianImportOptions`, `interface ObsidianImportResult`, `function importObsidianVault(content: VaultContent, options: ObsidianImportOptions): ObsidianImportResult`. The write stage (#62) and UX (#63) consume `ObsidianImportResult`.

- [ ] **Step 1: Export `fitLiveSchema` from import-hydration**

Change `function fitLiveSchema(` → `export function fitLiveSchema(` in `lib/import-hydration.ts`.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/unit/obsidian-import.test.ts
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { getSharedExtensions } from '@/lib/editor-extensions'
import { readVaultZip } from '@/services/obsidian-import'
import { importObsidianVault } from '@/services/obsidian-import'
import { base64ToUint8Array } from '@/lib/yjs-seed'

async function fixtureVault(): Promise<Parameters<typeof importObsidianVault>[0]> {
	const zip = new JSZip()
	zip.file('guides/intro.md', [
		'---',
		'title: Introduction',
		'tags: [guide, import]',
		'author: Harsh',
		'---',
		'# Intro',
		'',
		'See [[alpha]] and [[Missing Note]]',
		'',
		'> [!note] Tip',
		'> Callout body',
		'',
		'```ts',
		'const x = 1',
		'```',
		'',
	].join('\n'))
	zip.file('guides/alpha.md', '# Alpha\n\nRead [[Introduction|the intro]] #work\n')
	zip.file('guides/plain.md', 'Just body text, no heading\n')
	zip.file('root.md', '# Root\n\n![[pic.png]]\n\n![[unknown.png]]\n\nSee [[alpha]] again\n')
	zip.file('pic.png', new Uint8Array([137, 80, 78, 71, 1, 2]))
	zip.file('.obsidian/app.json', '{}')
	zip.file('.trash/deleted.md', '# gone\n')
	zip.file('stuff.canvas', '{}')
	zip.file('notes/bin.dat', new Uint8Array([0, 1]))
	zip.folder('emptyfolder')
	const blob = await zip.generateAsync({ type: 'blob' })
	return readVaultZip(new File([blob], 'vault.zip', { type: 'application/zip' }))
}

describe('importObsidianVault — IR shape', () => {
	it('produces folder pages first (including empty folders) then note pages', async () => {
		const vault = await fixtureVault()
		const { ir } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: ['Old Page'] })

		const folders = ir.pages.filter((p) => p.isFolder)
		expect(folders.map((f) => f.title).sort()).toEqual(['emptyfolder', 'guides'])
		expect(folders.every((f) => f.contentYjsBase64 && f.plainText === '')).toBe(true)

		const notes = ir.pages.filter((p) => !p.isFolder)
		expect(notes.map((n) => n.title).sort()).toEqual(['Introduction', 'alpha', 'plain', 'root'])
	})

	it('maps frontmatter to title (winning over filename), properties and tags', async () => {
		const vault = await fixtureVault()
		const { ir } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: [] })
		const intro = ir.pages.find((p) => p.title === 'Introduction')!
		expect(intro.properties).toMatchObject({ author: 'Harsh', tags: ['guide', 'import'] })
		expect(intro.tags).toEqual(['guide', 'import'])
		expect(intro.folderPath).toBe('guides')

		const alpha = ir.pages.find((p) => p.title === 'alpha')!
		expect(alpha.properties).toEqual({})
		expect(alpha.folderPath).toBe('guides')
	})

	it('sets folderPath null for root-level notes and seeds valid live-schema Yjs content', async () => {
		const vault = await fixtureVault()
		const { ir } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: [] })
		const root = ir.pages.find((p) => p.title === 'root')!
		expect(root.folderPath).toBeNull()
		expect(root.contentYjsBase64.length).toBeGreaterThan(0)
		expect(root.plainText).toContain('[[alpha]]')
	})

	it('seeded content renders in a bound live editor (callout + heading preserved)', async () => {
		const vault = await fixtureVault()
		const { ir } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: [] })
		const intro = ir.pages.find((p) => p.title === 'Introduction')!

		const fresh = new Y.Doc()
		Y.applyUpdate(fresh, base64ToUint8Array(intro.contentYjsBase64))
		const editor = new Editor({
			extensions: [
				...getSharedExtensions(),
				Collaboration.configure({ document: fresh }),
			],
		})
		const html = editor.getHTML()
		expect(html).toContain('Intro')
		expect(html).toContain('data-callout')
		expect(html).toContain('Callout body')
		expect(html).toContain('<pre')
		expect(editor.getText()).toContain('[[alpha]]')
		editor.destroy()
	})

	it('prepends an empty title heading for bodies that do not start with a heading', async () => {
		const vault = await fixtureVault()
		const { ir } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: [] })
		const plain = ir.pages.find((p) => p.title === 'plain')!
		const fresh = new Y.Doc()
		Y.applyUpdate(fresh, base64ToUint8Array(plain.contentYjsBase64))
		const editor = new Editor({
			extensions: [
				...getSharedExtensions(),
				Collaboration.configure({ document: fresh }),
			],
		})
		expect(editor.getJSON().content?.[0]?.type).toBe('heading')
		expect(editor.getText()).toContain('Just body text')
		editor.destroy()
	})

	it('embeds images as base64 data-URL image nodes and degrades non-image embeds', async () => {
		const vault = await fixtureVault()
		const { ir } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: [] })
		const root = ir.pages.find((p) => p.title === 'root')!

		const fresh = new Y.Doc()
		Y.applyUpdate(fresh, base64ToUint8Array(root.contentYjsBase64))
		const editor = new Editor({
			extensions: [
				...getSharedExtensions(),
				Collaboration.configure({ document: fresh }),
			],
		})
		const html = editor.getHTML()
		expect(html).toContain('data:image/png;base64,')
		// degraded embed survives as a literal wikilink
		expect(editor.getText()).toContain('[[unknown.png]]')
		// base64 src does not leak into plain text
		expect(root.plainText).not.toContain('data:image')
		editor.destroy()
	})
})

describe('importObsidianVault — report', () => {
	it('counts pages, folder pages, resolved/unresolved links and degraded blocks', async () => {
		const vault = await fixtureVault()
		const { ir, report } = importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: ['Old Page'] })

		expect(report.pages).toBe(4)          // Introduction, alpha, plain, root
		expect(report.folderPages).toBe(2)    // guides, emptyfolder

		// Distinct link targets across all notes: alpha, Missing Note, Introduction, unknown.png
		// Resolved against imported titles {Introduction, alpha, plain, root} ∪ {Old Page}.
		expect(report.linksResolved).toBe(2)  // alpha, Introduction
		expect(report.linksUnresolved).toBe(2) // Missing Note, unknown.png

		expect(report.degradedBlocks).toBe(1) // ![[unknown.png]] → [[unknown.png]]
		expect(ir.pages.filter((p) => !p.isFolder)).toHaveLength(report.pages)
		expect(ir.pages.filter((p) => p.isFolder)).toHaveLength(report.folderPages)
	})
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/obsidian-import.test.ts`
Expected: FAIL — `importObsidianVault` is not exported; `fitLiveSchema` not exported.

- [ ] **Step 4: Write the implementation**

Append to `services/obsidian-import.ts`:

```ts
import { parseFrontmatter, parseMarkdown } from '@/lib/markdown-io'
import { fitLiveSchema } from '@/lib/import-hydration'
import { contentToYjsBase64, contentToPlainText, uint8ArrayToBase64 } from '@/lib/yjs-seed'
import { titleFromFilename } from '@/services/import'

export const MAX_IMPORT_PAGES = 2000

export interface ObsidianImportPage {
	title: string
	folderPath: string | null
	properties: Record<string, unknown>
	tags: string[]
	contentYjsBase64: string
	plainText: string
	isFolder: boolean
}

export interface ObsidianImportIR {
	workspaceId: string
	pages: ObsidianImportPage[]
}

export interface ObsidianImportReport {
	pages: number
	folderPages: number
	linksResolved: number
	linksUnresolved: number
	degradedBlocks: number
}

export interface ObsidianImportResult {
	ir: ObsidianImportIR
	report: ObsidianImportReport
}

export interface ObsidianImportOptions {
	workspaceId: string
	/** Titles of pages already in the workspace, used to resolve wikilinks in the report. */
	existingPageTitles: string[]
}

const IMAGE_MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	avif: 'image/avif',
	ico: 'image/x-icon',
}

// Mirrors server/graph-index.js normalizeTitle (client bundle cannot import server CJS).
function normalizeTitle (title: string): string {
	return String(title || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Mirrors server/graph-index.js MARKDOWN_LINK_RE.
const WIKILINK_RE = /\[\[([^[\]|]+?)(?:\|([^[\]]+?))?\]\]/g

function extractWikilinks (text: string): string[] {
	const targets: string[] = []
	const seen = new Set<string>()
	let match
	WIKILINK_RE.lastIndex = 0
	while ((match = WIKILINK_RE.exec(text)) !== null) {
		const target = match[1].trim()
		if (!target) continue
		const key = normalizeTitle(target)
		if (seen.has(key)) continue
		seen.add(key)
		targets.push(target)
	}
	return targets
}

const EMBED_RE = /!\[\[([^\]]+)\]\]/g

function imageExtOf (name: string): string | null {
	const m = /\.([a-z0-9]+)$/i.exec(name)
	return m ? m[1].toLowerCase() : null
}

/**
 * Rewrite `![[...]]` embeds in a body before markdown parsing:
 * image embeds whose attachment exists in the vault become `![alt](data:image/...;base64,...)`
 * markdown image syntax (parsed into a real image node); everything else degrades to a
 * `[[wikilink]]` and increments `degraded`.
 */
function processEmbeds (body: string, imageIndex: Map<string, VaultEntry>, degraded: { count: number }): string {
	return body.replace(EMBED_RE, (whole, innerRaw: string) => {
		const inner = innerRaw.trim()
		const target = inner.split('|')[0].trim() // drop Obsidian size/alias suffix
		const ext = imageExtOf(target)
		const entry = imageIndex.get(target.toLowerCase())
		if (ext && IMAGE_MIME[ext] && entry) {
			const mime = IMAGE_MIME[ext]
			return `![${target}](${mime};base64,${uint8ArrayToBase64(entry.data)})`
		}
		degraded.count += 1
		return `[[${inner}]]`
	})
}

const EMPTY_PAGE_DOC = {
	type: 'doc',
	content: [{ type: 'heading', attrs: { level: 1 }, content: [] }],
}

/**
 * Normalize a vault into the IR + report. Pure and synchronous (parsing and
 * Yjs seeding are both sync); the async part is reading the vault (Task 2).
 */
export function importObsidianVault (content: VaultContent, options: ObsidianImportOptions): ObsidianImportResult {
	const { workspaceId, existingPageTitles } = options
	const notePages: ObsidianImportPage[] = []
	const folderPages: ObsidianImportPage[] = []
	const degraded = { count: 0 }

	// Index images by lowercase basename for embed resolution.
	const imageIndex = new Map<string, VaultEntry>()
	for (const file of content.files) {
		const name = file.path.split('/').pop() ?? file.path
		imageIndex.set(name.toLowerCase(), file)
	}

	// Folder pages: every discovered directory, including empty ones, ordered
	// shallow-first so the write stage can build the parent chain.
	const sortedDirs = [...content.directories].sort((a, b) => a.split('/').length - b.split('/').length)
	for (const dir of sortedDirs) {
		const segments = dir.split('/')
		folderPages.push({
			title: segments[segments.length - 1],
			folderPath: segments.length > 1 ? segments.slice(0, -1).join('/') : null,
			properties: {},
			tags: [],
			contentYjsBase64: contentToYjsBase64(EMPTY_PAGE_DOC),
			plainText: '',
			isFolder: true,
		})
	}

	for (const file of content.files) {
		if (!file.path.toLowerCase().endsWith('.md') && !file.path.toLowerCase().endsWith('.markdown')) continue

		const raw = new TextDecoder().decode(file.data)
		const { data, body } = parseFrontmatter(raw)

		const title = data.title ?? titleFromFilename(file.path.split('/').pop() ?? '')

		const properties: Record<string, unknown> = { ...data.properties }
		if (data.tags && data.tags.length > 0) {
			properties.tags = data.tags
		}

		const processedBody = processEmbeds(body, imageIndex, degraded)
		const fitted = fitLiveSchema(parseMarkdown(processedBody))

		notePages.push({
			title,
			folderPath: file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : null,
			properties,
			tags: data.tags ?? [],
			contentYjsBase64: contentToYjsBase64(fitted),
			plainText: contentToPlainText(fitted),
			isFolder: false,
		})
	}

	if (notePages.length === 0) {
		throw new Error('No markdown files found in the vault. Nothing to import.')
	}
	if (notePages.length > MAX_IMPORT_PAGES) {
		throw new Error(`Vault exceeds the maximum of ${MAX_IMPORT_PAGES} pages. Split the vault and import in parts.`)
	}

	// Resolve wikilinks against imported titles ∪ existing workspace titles.
	const knownTitles = new Set([
		...notePages.map((p) => normalizeTitle(p.title)),
		...existingPageTitles.map(normalizeTitle),
	])
	let linksResolved = 0
	let linksUnresolved = 0
	for (const page of notePages) {
		for (const target of extractWikilinks(page.plainText)) {
			if (knownTitles.has(normalizeTitle(target))) {
				linksResolved += 1
			} else {
				linksUnresolved += 1
			}
		}
	}

	const pages = [...folderPages, ...notePages]
	return {
		ir: { workspaceId, pages },
		report: {
			pages: notePages.length,
			folderPages: folderPages.length,
			linksResolved,
			linksUnresolved,
			degradedBlocks: degraded.count,
		},
	}
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/obsidian-import.test.ts tests/unit/yjs-seed.test.ts tests/unit/obsidian-import-read.test.ts tests/unit/import-hydration.test.ts tests/unit/markdown-io.test.ts`
Expected: PASS (all new tests plus existing round-trip/hydration suites stay green).

- [ ] **Step 6: Run lint and build**

Run: `npm run lint && npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/import-hydration.ts services/obsidian-import.ts tests/unit/obsidian-import.test.ts
git commit -m "feat: normalize an Obsidian vault into the import IR + fidelity report (OI-T2 #61)"
```

---

### Task 4: Error paths and limit guard

**Files:**
- Modify: `services/obsidian-import.ts` (add exported `MAX_IMPORT_PAGES` is already there — no change)
- Test: `tests/unit/obsidian-import-errors.test.ts`

**Interfaces:**
- Consumes: `importObsidianVault`, `MAX_IMPORT_PAGES` (Task 3).
- Produces: no new exports; documents the two thrown error messages.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/obsidian-import-errors.test.ts
import { describe, it, expect } from 'vitest'
import { importObsidianVault, MAX_IMPORT_PAGES, type VaultContent } from '@/services/obsidian-import'

function mdFile(path: string, text: string) {
	return { path, data: new TextEncoder().encode(text) }
}

describe('importObsidianVault — errors', () => {
	it('throws a clear error for a vault with no markdown files', () => {
		const vault: VaultContent = {
			files: [mdFile('pic.png', '')],
			directories: ['assets'],
		}
		expect(() => importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: [] }))
			.toThrow(/no markdown/i)
	})

	it('throws a clear error when the note count exceeds the import limit', () => {
		const files: VaultContent['files'] = []
		for (let i = 0; i < MAX_IMPORT_PAGES + 1; i++) {
			files.push(mdFile(`n${i}.md`, `# ${i}\n`))
		}
		expect(() => importObsidianVault({ files, directories: [] }, { workspaceId: 'ws-1', existingPageTitles: [] }))
			.toThrow(/maximum/i)
	})

	it('does not count image-only vaults as pages', () => {
		const vault: VaultContent = { files: [mdFile('a.png', '')], directories: [] }
		expect(() => importObsidianVault(vault, { workspaceId: 'ws-1', existingPageTitles: [] }))
			.toThrow(/no markdown/i)
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/obsidian-import-errors.test.ts`
Expected: FAIL if run before Task 3 completes; otherwise PASS once Task 3 landed. If Task 3 is already merged, skip to Step 3 and confirm all pass.

- [ ] **Step 3: Confirm the guard logic exists (Task 3 already throws both errors)**

The `notePages.length === 0` and `notePages.length > MAX_IMPORT_PAGES` throws landed in Task 3's `importObsidianVault`. If the errors are not present (Task 3 was not merged), implement them now per Task 3's Step 4 block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/obsidian-import-errors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run lint and build**

Run: `npm run lint && npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/obsidian-import-errors.test.ts services/obsidian-import.ts
git commit -m "test: error paths and page-limit guard for vault import (OI-T2 #61)"
```

---

### Task 5: Full gates + PR

**Files:**
- None new.

**Interfaces:**
- Consumes: all of Tasks 1–4.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — existing 302+ tests plus the new `yjs-seed`, `obsidian-import-read`, `obsidian-import`, `obsidian-import-errors` suites.

- [ ] **Step 2: Run lint and build**

Run: `npm run lint && npm run build`
Expected: clean.

- [ ] **Step 3: Verify no stale dependencies**

Run: `npx vitest run tests/unit/graph-index.test.ts tests/unit/server.test.ts`
Expected: PASS — the server link-extraction regex mirrors were not changed.

- [ ] **Step 4: Verify the repo is on the feature branch and create the PR**

```bash
git status
git log --oneline -5
git push -u origin feat/61-obsidian-import
gh pr create --title "feat: Obsidian vault ingestion → IR (OI-T2 #61)" --body "Closes #61 (in progress)" --base main
```

- [ ] **Step 5: Move the board item to In review**

Run: `docs/agents/project-board.sh 61 "In review"`

- [ ] **Step 6: Commit any follow-ups from review, then close out**

After review + merge: `docs/agents/project-board.sh 61 "Done"`, comment on #61 with the merge ref, and run dependency hygiene (remove #61's outgoing edges — there are none; verify no open issue lists #61 as a closed blocker).