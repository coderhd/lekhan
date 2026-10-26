import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import type { JSONContent } from '@tiptap/core'
import { MarkdownEngine, base64ToUint8Array } from '@/lib/markdown/engine'
import { importObsidianVault, type ObsidianImportIR, type VaultContent } from '@/services/obsidian-import'
import { buildVaultFiles, buildVaultZip, type VaultPage } from '@/lib/markdown/vault-export'

/**
 * SIL-9 S4 acceptance proof: a real, committed Obsidian vault fixture is
 * imported, then exported as a vault zip, unzipped, and asserted as an Obsidian
 * vault — the same test a user performs by dropping the zip into Obsidian.
 *
 * Seam: importer (`importObsidianVault`) → Page graph + docs → export builder
 * (`buildVaultFiles`) → zip writer (`buildZipBytes`). Nothing here mocks the
 * markdown dialect; it is the real S3 Obsidian profile end to end.
 */

const VAULT_ROOT = join(process.cwd(), 'tests/fixtures/vaults/research-vault')
const SKIP_DIRS = new Set(['.obsidian', '.trash'])
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i
const WIKILINK_RE = /\[\[([^[\]|]+?)(?:\|[^[\]]+?)?\]\]/g
const MD_LINK_RE = /!\[[^\]]*\]\(([^)]+)\)/g

/** Read the committed vault exactly as the browser readers would present it. */
function readFixtureVault(root: string): VaultContent {
	const files: VaultContent['files'] = []
	const directories: string[] = []
	const walk = (absolute: string, prefix: string): void => {
		for (const name of readdirSync(absolute).sort()) {
			const relative = prefix ? `${prefix}/${name}` : name
			const full = join(absolute, name)
			if (statSync(full).isDirectory()) {
				if (SKIP_DIRS.has(name)) continue
				directories.push(relative)
				walk(full, relative)
				continue
			}
			if (!name.endsWith('.md') && !IMAGE_RE.test(name)) continue
			files.push({ path: relative, data: new Uint8Array(readFileSync(full)) })
		}
	}
	walk(root, '')
	return { files, directories }
}

function folderPathOf(page: { folderPath: string | null; title: string }): string {
	return page.folderPath ? `${page.folderPath}/${page.title}` : page.title
}

/** Map the importer IR onto the export builder's Page graph (parent_id chain). */
function toVaultPages(ir: ObsidianImportIR, engine: MarkdownEngine): VaultPage[] {
	const folders = ir.pages.filter((page) => page.isFolder)
	const folderIdByPath = new Map(folders.map((page) => [folderPathOf(page).toLowerCase(), `folder:${folderPathOf(page)}`]))
	const pages: VaultPage[] = folders.map((page) => ({
		id: `folder:${folderPathOf(page)}`,
		parentId: page.folderPath ? folderIdByPath.get(page.folderPath.toLowerCase()) ?? null : null,
		title: page.title,
		properties: {},
		isFolder: true,
	}))
	for (const page of ir.pages.filter((entry) => !entry.isFolder)) {
		const doc: JSONContent = engine.yjsStateToJson(base64ToUint8Array(page.contentYjsBase64))
		pages.push({
			id: `note:${page.folderPath ?? ''}/${page.title}`,
			parentId: page.folderPath ? folderIdByPath.get(page.folderPath.toLowerCase()) ?? null : null,
			title: page.title,
			tags: page.tags,
			properties: page.properties,
			doc,
		})
	}
	return pages
}

function notePaths(files: Record<string, Uint8Array>): string[] {
	return Object.keys(files).filter((path) => path.endsWith('.md'))
}

/**
 * Obsidian's link resolution, reduced to what a vault zip can prove: a target
 * resolves when its (case-insensitive) text names a note's basename or its
 * vault-relative path without `.md`. Heading/block anchors are ignored.
 */
function resolvesInVault(target: string, notes: string[]): boolean {
	const withoutAlias = target.split('|')[0]
	const withoutAnchor = withoutAlias.split('#')[0].split('^')[0].replace(/\.md$/i, '')
	const key = withoutAnchor.replace(/\\/g, '/').replace(/^\.\//, '').trim().toLowerCase()
	if (!key) return true
	const byPath = new Set(notes.map((path) => path.replace(/\.md$/i, '').toLowerCase()))
	const byBasename = new Set(notes.map((path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '').toLowerCase()))
	return byBasename.has(key) || byPath.has(key)
}

function wikilinks(markdown: string): string[] {
	const found: string[] = []
	WIKILINK_RE.lastIndex = 0
	let match: RegExpExecArray | null
	while ((match = WIKILINK_RE.exec(markdown)) !== null) found.push(match[1].trim())
	return found
}

describe('real vault fixture — import → export → unzip (Obsidian drop-in)', () => {
	let unzipped: Record<string, Uint8Array>
	let notes: string[]
	let report: ReturnType<typeof buildVaultZip>['report']

	beforeAll(() => {
		const engine = new MarkdownEngine()
		try {
			const imported = importObsidianVault(readFixtureVault(VAULT_ROOT), {
				workspaceId: 'fixture-workspace',
				existingPageTitles: [],
			})
			const pages = toVaultPages(imported.ir, engine)
			const { zip, report: built } = buildVaultZip(pages)
			unzipped = unzipSync(zip)
			notes = notePaths(unzipped)
			report = built
		} finally {
			engine.destroy()
		}
	})

	afterAll(() => {
		vi.unstubAllGlobals()
	})

	it('mirrors the fixture folder tree, preserving title filenames Obsidian links to', () => {
		expect([...notes].sort()).toEqual([
			'Home.md',
			'Notes/Daily/2026-10-01.md',
			'Projects/Alpha Brief.md',
			'Projects/Alpha/Spec Notes.md',
			'Projects/Index.md',
		].sort())
		// The vault's own config is not part of the user's content.
		expect(notes.some((path) => path.startsWith('.obsidian/'))).toBe(false)
		// Folder pages become real (possibly empty) directories, so the tree
		// mirrors the workspace — including the attachment-only Assets/ folder.
		expect(Object.keys(unzipped).filter((path) => path.endsWith('/')).sort()).toEqual([
			'Assets/',
			'Notes/',
			'Notes/Daily/',
			'Projects/',
			'Projects/Alpha/',
		])
	})

	it('writes frontmatter, tags and callouts exactly as Obsidian reads them', () => {
		const alpha = strFromU8(unzipped['Projects/Alpha Brief.md'])
		expect(alpha).toMatch(/^---\n/)
		expect(alpha).toContain('title: Alpha Brief')
		expect(alpha).toContain('status: active')
		expect(alpha).toContain('Alpha') // aliases survive as a property
		expect(alpha).toContain('- pkm')
		expect(alpha).toContain('> [!warning] Risk')

		const index = strFromU8(unzipped['Projects/Index.md'])
		expect(index).toContain('> [!tip] Start here')
		expect(index).toContain('| Project | Status |')

		const daily = strFromU8(unzipped['Notes/Daily/2026-10-01.md'])
		expect(daily).toContain('- daily')
	})

	it('resolves every real wikilink in-vault (names and paths) and reports only the dead ones', () => {
		const unresolved = new Set<string>()
		for (const note of notes) {
			for (const target of wikilinks(strFromU8(unzipped[note]))) {
				if (!resolvesInVault(target, notes)) unresolved.add(target.toLowerCase())
			}
		}
		// Both links below point at notes that do not exist in the fixture; they
		// must survive verbatim and be named in the report, not silently dropped.
		expect([...unresolved].sort()).toEqual(['missing note', 'reading list'])
		expect(report.linksUnresolved).toBe(2)
		expect(report.linksResolved).toBe(4) // Home, Alpha Brief, Spec Notes, Projects/Index
		expect(strFromU8(unzipped['Home.md'])).toContain('[[Reading List]]')
	})

	it('bundles the attachment once, references it relatively, and keeps its bytes', () => {
		const attachment = Object.keys(unzipped).find((path) => /^attachments\/architecture-[0-9a-f]+\.png$/.test(path))
		expect(attachment).toBeTruthy()
		const fixtureImage = new Uint8Array(readFileSync(join(VAULT_ROOT, 'Assets/architecture.png')))
		expect(unzipped[attachment!]).toEqual(fixtureImage)

		for (const note of notes) {
			const markdown = strFromU8(unzipped[note])
			expect(markdown).not.toContain('data:image')
			MD_LINK_RE.lastIndex = 0
			let match: RegExpExecArray | null
			while ((match = MD_LINK_RE.exec(markdown)) !== null) {
				expect(Object.keys(unzipped)).toContain(match[1])
			}
		}
	})

	it('reports the round trip honestly (pages, folders, no degraded blocks)', () => {
		expect(report.direction).toBe('export')
		expect(report.pages).toBe(5)
		expect(report.folderPages).toBe(5) // Projects, Projects/Alpha, Notes, Notes/Daily, Assets
		expect(report.degradedBlocks).toBe(0)
		expect(report.omissions).toEqual([])
	})

	it('still builds the zip entirely client-side (no fetch / server roundtrip)', () => {
		const fetchSpy = vi.fn()
		vi.stubGlobal('fetch', fetchSpy)
		const engine = new MarkdownEngine()
		try {
			const imported = importObsidianVault(readFixtureVault(VAULT_ROOT), {
				workspaceId: 'fixture-workspace',
				existingPageTitles: [],
			})
			buildVaultFiles(toVaultPages(imported.ir, engine))
			expect(fetchSpy).not.toHaveBeenCalled()
		} finally {
			engine.destroy()
		}
	})
})
