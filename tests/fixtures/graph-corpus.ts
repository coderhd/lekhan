import type { Page, PageLink } from '@/types'

/** Deterministic PRNG so the seeded corpus is identical on every run. */
export function mulberry32 (seed: number): () => number {
	let a = seed
	return () => {
		a |= 0
		a = (a + 0x6D2B79F5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/**
 * 500 pages / 2,000 resolved links + 20 unresolved targets — the spec's W45
 * dogfood corpus. `page_links` is UNIQUE(from_page_id, to_title), so generated
 * pairs are deduped like the database would.
 */
export function seededCorpus (): { pages: Page[]; links: PageLink[] } {
	const pages: Page[] = Array.from({ length: 500 }, (_, i) => ({
		id: `p-${i}`,
		workspace_id: 'ws-1',
		parent_id: null,
		title: `Page ${i}`,
		owner_id: 'user-1',
		icon: null,
		cover: null,
		properties: {},
		is_public: false,
		searchable_text: null,
		created_at: '2026-11-01T00:00:00.000Z',
		updated_at: '2026-11-02T00:00:00.000Z',
	}))
	const rand = mulberry32(206)
	const seen = new Set<string>()
	const links: PageLink[] = []
	for (let i = 0; i < 2000; i++) {
		const from = Math.floor(rand() * pages.length)
		let to = Math.floor(rand() * pages.length)
		if (to === from) to = (to + 1) % pages.length
		const key = `${from}:${to}`
		if (seen.has(key)) {
			i -= 1
			continue
		}
		seen.add(key)
		links.push({
			id: `l-${i}-${from}-${to}`,
			workspace_id: 'ws-1',
			from_page_id: `p-${from}`,
			to_page_id: `p-${to}`,
			to_title: pages[to].title,
			block_id: null,
			created_at: '2026-11-02T00:00:00.000Z',
		})
	}
	// Unresolved targets keep ghost-node layout inside the same budget.
	for (let i = 0; i < 20; i++) {
		links.push({
			id: `ghost-${i}`,
			workspace_id: 'ws-1',
			from_page_id: `p-${i}`,
			to_page_id: null,
			to_title: `Unwritten ${i}`,
			block_id: null,
			created_at: '2026-11-02T00:00:00.000Z',
		})
	}
	return { pages, links }
}
