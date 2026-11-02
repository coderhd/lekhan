import { describe, it, expect } from 'vitest'
import { computeGraphLayout, defaultIterations } from '@/lib/graph-view/layout'
import { serializeWorkspaceGraph } from '@/lib/graph-view/serialize'
import { seededCorpus } from '../fixtures/graph-corpus'

/**
 * First-paint budget proof for GV-T1, isolated from the parallel unit suite so
 * the wall-clock measurement is not distorted by other test files.
 *
 * Run with `npm run test:perf`. Scope: serialization + the full pure d3-force
 * layout at the deterministic default tick count. It intentionally excludes
 * React mount and canvas paint (those need a real browser); at 500/2,020 the
 * layout is the only non-trivial synchronous work before the first frame.
 */
describe('graph view first-paint budget', () => {
	it('serializes and fully lays out 500 pages / 2,020 links in under 1 s', () => {
		const { pages, links } = seededCorpus()

		const started = performance.now()
		const data = serializeWorkspaceGraph({ pages, links })
		const layout = computeGraphLayout(data.nodes, data.edges)
		const elapsed = performance.now() - started

		expect(data.nodes).toHaveLength(520) // 500 pages + 20 ghosts
		expect(data.totalLinks).toBe(2020)
		expect(layout.nodes).toHaveLength(520)
		expect(layout.edges.length).toBeGreaterThan(1900)
		// No silent truncation: the full deterministic tick budget ran.
		expect(layout.iterations).toBe(defaultIterations(data.nodes.length))
		expect(layout.iterations).toBe(140)
		expect(elapsed).toBeLessThan(1000)
	})
})
