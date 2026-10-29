import { describe, it, expect, vi } from 'vitest'
import type { JSONContent } from '@tiptap/core'

// Fail serialization for one specific page so we can assert the report stays
// honest about a note that was never written.
const FAIL_TITLE = 'Broken'

vi.mock('@/lib/markdown/engine', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/markdown/engine')>()
	// Delegate through the prototype: `markdownEngine` is a class instance, so a
	// spread would drop its prototype methods.
	const engine = Object.create(actual.markdownEngine) as typeof actual.markdownEngine
	engine.serializeObsidianBody = (doc: JSONContent) => {
		const text = JSON.stringify(doc)
		if (text.includes('payload')) throw new Error('boom')
		return actual.markdownEngine.serializeObsidianBody(doc)
	}
	return { ...actual, markdownEngine: engine }
})

const { buildVaultFiles } = await import('@/lib/markdown/vault-export')
type VaultPage = import('@/lib/markdown/vault-export').VaultPage

const doc = (textValue: string): JSONContent => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text: textValue }] }],
})

const HOME: VaultPage = {
	id: 'a',
	parentId: null,
	title: 'Home',
	properties: {},
	doc: doc('[[Broken]]'),
}

const BROKEN: VaultPage = {
	id: 'b',
	parentId: null,
	title: FAIL_TITLE,
	properties: {},
	doc: doc('payload [[Broken]]'),
}

describe('buildVaultFiles — serialize-stage honesty', () => {
	it('does not count a link resolved when the target note failed to serialize', () => {
		const { files, report } = buildVaultFiles([HOME, BROKEN])

		expect(files.some((file) => file.path === 'broken.md')).toBe(false)
		expect(report.warnings).toHaveLength(1)
		expect(report.warnings[0]).toMatchObject({ title: FAIL_TITLE, stage: 'serialize' })
		expect(report.linksResolved).toBe(0)
		expect(report.linksUnresolved).toBe(1)
	})

	it('leaves the wikilink untouched instead of pointing at a missing note', () => {
		const { files } = buildVaultFiles([HOME, BROKEN])
		const home = files.find((file) => file.path === 'home.md')
		const body = typeof home?.data === "string" ? home.data : ""
		expect(body).toContain('[[Broken]]')
		expect(body).not.toContain('broken|')
	})

	it('promotes a later duplicate note when the first duplicate fails to serialize', () => {
		const dupFail: VaultPage = {
			id: 'c',
			parentId: null,
			title: 'Dup',
			properties: {},
			doc: doc('payload'),
		}
		const dupOk: VaultPage = {
			id: 'd',
			parentId: null,
			title: 'Dup',
			properties: {},
			doc: doc('safe'),
		}
		const link: VaultPage = {
			id: 'e',
			parentId: null,
			title: 'Links',
			properties: {},
			doc: doc('see [[Dup]]'),
		}

		const { files, report } = buildVaultFiles([link, dupFail, dupOk])

		expect(files.some((file) => file.path === 'dup.md')).toBe(false)
		expect(files.some((file) => file.path === 'dup-2.md')).toBe(true)
		const links = files.find((file) => file.path === 'links.md')
		const body = typeof links?.data === 'string' ? links.data : ''
		expect(body).toContain('[[dup-2|Dup]]')
		expect(report.linksResolved).toBe(1)
		expect(report.linksUnresolved).toBe(0)
	})
})
