import { describe, it, expect } from 'vitest'
import { splitIntoBatches, BATCH_BYTE_BUDGET } from '@/services/vault-import'

function makePage (title: string, base64Length: number) {
	return {
		title,
		folderPath: null,
		properties: {},
		tags: [],
		contentYjsBase64: 'A'.repeat(base64Length),
		plainText: '',
		isFolder: false,
	}
}

function makeIR (pages: ReturnType<typeof makePage>[]) {
	return { workspaceId: 'ws-1', pages }
}

describe('splitIntoBatches', () => {
	it('keeps a small vault in one batch', () => {
		const { batches, oversized } = splitIntoBatches(makeIR([makePage('a', 100), makePage('b', 100)]))
		expect(batches).toHaveLength(1)
		expect(oversized).toHaveLength(0)
	})

	it('splits when the exact serialized size crosses the budget', () => {
		// Budget small enough to force a split with modest fixtures.
		const budget = 600
		const pages = [makePage('a', 300), makePage('b', 300), makePage('c', 300)]
		const { batches, oversized } = splitIntoBatches(makeIR(pages), budget)

		expect(oversized).toHaveLength(0)
		expect(batches.length).toBeGreaterThanOrEqual(2)

		// Every batch must serialize under budget — the exact invariant the
		// server enforces.
		for (const batch of batches) {
			const bytes = new TextEncoder().encode(JSON.stringify(batch)).length
			expect(bytes).toBeLessThanOrEqual(budget)
		}
		// Coverage: all pages present across batches.
		expect(batches.flatMap(b => b.pages.map(p => p.title))).toEqual(['a', 'b', 'c'])
	})

	it('rejects a single page that cannot fit any batch as oversized', () => {
		const { batches, oversized } = splitIntoBatches(makeIR([
			makePage('small', 50),
			makePage('huge', BATCH_BYTE_BUDGET),
		]))
		expect(batches).toHaveLength(1)
		expect(batches[0].pages.map(p => p.title)).toEqual(['small'])
		expect(oversized.map(p => p.title)).toEqual(['huge'])
	})
})
