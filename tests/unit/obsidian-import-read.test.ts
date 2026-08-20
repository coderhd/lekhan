import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { readVaultZip, readVaultFiles } from '@/services/obsidian-import'

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