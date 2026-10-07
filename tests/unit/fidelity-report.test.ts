import { describe, it, expect } from 'vitest'
import { fromImportReport, DATABASE_VIEWS_OMISSION } from '@/lib/fidelity-report'
import { unescapeObsidianWikilinks } from '@/lib/markdown/engine'

describe('fromImportReport', () => {
	it('maps import counters onto the shared shape with direction "import"', () => {
		const report = fromImportReport({
			pages: 5,
			folderPages: 2,
			linksResolved: 3,
			linksUnresolved: 1,
			degradedBlocks: 4,
		})
		expect(report.direction).toBe('import')
		expect(report.pages).toBe(5)
		expect(report.folderPages).toBe(2)
		expect(report.linksResolved).toBe(3)
		expect(report.linksUnresolved).toBe(1)
		expect(report.degradedBlocks).toBe(4)
		expect(report.omissions).toEqual([])
		expect(report.warnings).toEqual([])
	})

	it('carries warnings through without mutating the input', () => {
		const warnings = [{ title: 'A', stage: 'snapshot', error: 'boom' }]
		const report = fromImportReport(
			{ pages: 1, folderPages: 0, linksResolved: 0, linksUnresolved: 0, degradedBlocks: 0 },
			warnings,
		)
		expect(report.warnings).toEqual(warnings)
		warnings.length = 0
		expect(report.warnings).toHaveLength(1)
	})

	it('exposes the database-views omission copy for both directions', () => {
		expect(DATABASE_VIEWS_OMISSION.kind).toBe('database-views')
		expect(DATABASE_VIEWS_OMISSION.detail).toContain('H2 #47')
	})
})

describe('unescapeObsidianWikilinks', () => {
	it('restores escaped wikilinks to raw Obsidian syntax', () => {
		expect(unescapeObsidianWikilinks('See \\[\\[Home\\]\\] now')).toBe('See [[Home]] now')
	})

	it('restores the alias pipe form', () => {
		expect(unescapeObsidianWikilinks('\\[\\[Page\\|Alias\\]\\]')).toBe('[[Page|Alias]]')
	})

	it('leaves ordinary markdown escaping untouched', () => {
		expect(unescapeObsidianWikilinks('a \\* b \\_ c')).toBe('a \\* b \\_ c')
	})
})
