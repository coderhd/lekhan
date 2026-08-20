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