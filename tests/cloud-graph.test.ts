import { describe, expect, it } from 'vitest'
import { pageTitle, resolvePageRole } from '../lib/cloud/graph'

describe('cloud page rules', () => {
  it('uses only page ownership and direct membership for private access', () => {
    const page = { owner_id: 'owner', is_public: false }
    expect(resolvePageRole(page, 'owner', null)).toBe('owner')
    expect(resolvePageRole(page, 'other', 'editor')).toBe('editor')
    expect(resolvePageRole(page, 'other', 'viewer')).toBe('viewer')
    expect(resolvePageRole(page, 'other', 'owner')).toBeNull()
    expect(resolvePageRole(page, null, 'editor')).toBeNull()
    expect(resolvePageRole({ ...page, is_public: true }, 'other', null)).toBe('viewer')
  })

  it('normalizes titles and rejects inconsistent values', () => {
    expect(pageTitle('  Project notes  ')).toBe('Project notes')
    expect(pageTitle('x\ny')).toBeNull()
    expect(pageTitle(' '.repeat(10))).toBeNull()
    expect(pageTitle('a'.repeat(161))).toBeNull()
  })
})
