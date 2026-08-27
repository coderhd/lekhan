import { describe, it, expect, vi } from 'vitest'

// Mock the environment variables needed for server scripts
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'mock-anon-key'

const auth = require('../../server/auth')

const { getServerMetrics } = require('../../server/index.js')

describe('Server Metrics & Health System', () => {
	it('provides valid server metrics format from production getServerMetrics', () => {
		const metrics = getServerMetrics()
		expect(metrics).toHaveProperty('status')
		expect(metrics.limits.maxConnections).toBe(1500)
		expect(typeof metrics.limits.heapUtilizationPct).toBe('number')
	})
})

describe('Server Authentication & Role Verification System', () => {
	it('should initialize supabase client with correct headers', () => {
		const client = auth.getSupabaseClient('mock-user-jwt')
		expect(client).toBeDefined()
	})

	it('should return null when no user session is present', async () => {
		const mockSupabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
			},
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'doc-id')
		expect(role.role).toBeNull()
	})

	it('should return "owner" when user matches document owner_id', async () => {
		const mockUser = { id: 'user-123' }
		const mockSupabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
			},
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({ data: { owner_id: 'user-123', is_public: false }, error: null }),
					}),
				}),
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'doc-id')
		expect(role.role).toBe('owner')
	})

	it('should return member role when user is collaborator but not owner', async () => {
		const mockUser = { id: 'user-123' }
		const mockSupabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
			},
			from: vi.fn().mockImplementation((table) => {
				if (table === 'pages') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
							}),
						}),
					}
				}
				if (table === 'documents') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({ data: { owner_id: 'different-owner', is_public: false }, error: null }),
							}),
						}),
					}
				}
				if (table === 'document_members') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								eq: vi.fn().mockReturnValue({
									single: vi.fn().mockResolvedValue({ data: { role: 'editor' }, error: null }),
								}),
							}),
						}),
					}
				}
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'doc-id')
		expect(role.role).toBe('editor')
	})
})

describe('Server Pages Cutover & Graph Index Integration', () => {
	const auth = require('../../server/auth')
	const graphIndex = require('../../server/graph-index')

	it('verifyUserRole returns "owner" when the page owner matches the user', async () => {
		const mockSupabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null }),
			},
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({ data: { type: 'page', owner_id: 'user-123', is_public: false }, error: null }),
					}),
				}),
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'page-1', 'token-1')
		expect(role.role).toBe('owner')
	})

	it('verifyUserRole falls back to documents when no page exists', async () => {
		let calls = 0
		const mockSupabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null }),
			},
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockImplementation(async () => {
							calls += 1
							if (calls === 1) return { data: null, error: null }
							return { data: { type: 'document', owner_id: 'user-123', is_public: false }, error: null }
						}),
					}),
				}),
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'doc-legacy', 'token-1')
		expect(role.role).toBe('owner')
	})

	it('verifyUserRole returns member role from page_members', async () => {
		const mockSupabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-456' } }, error: null }),
			},
			from: vi.fn().mockImplementation((table: string) => {
				if (table === 'pages') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({
									data: { type: 'page', owner_id: 'user-123', is_public: false },
									error: null,
								}),
							}),
						}),
					}
				}
				if (table === 'page_members') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								eq: vi.fn().mockReturnValue({
									single: vi.fn().mockResolvedValue({ data: { role: 'editor' }, error: null }),
								}),
							}),
						}),
					}
				}
				return {}
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'page-1', 'token-1')
		expect(role.role).toBe('editor')
	})

	it('verifyUserRole ignores document_members grants on mapped pages (page-only authority)', async () => {
		const mockSupabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-456' } }, error: null }),
			},
			from: vi.fn().mockImplementation((table: string) => {
				if (table === 'pages') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({
									data: { type: 'page', owner_id: 'user-123', is_public: false, source_document_id: 'doc-legacy' },
									error: null,
								}),
							}),
						}),
					}
				}
				if (table === 'page_members') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								eq: vi.fn().mockReturnValue({
									single: vi.fn().mockResolvedValue({ data: null, error: null }),
								}),
							}),
						}),
					}
				}
				if (table === 'document_members') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								eq: vi.fn().mockReturnValue({
									single: vi.fn().mockResolvedValue({ data: { role: 'editor' }, error: null }),
								}),
							}),
						}),
					}
				}
				return {}
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'page-1', 'token-1')
		expect(role.role).toBeNull()
	})

	it('verifyUserRole grants "viewer" to an authenticated non-member on a public page', async () => {
		const mockSupabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-456' } }, error: null }),
			},
			from: vi.fn().mockImplementation((table: string) => {
				if (table === 'pages') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({
									data: { type: 'page', owner_id: 'user-123', is_public: true },
									error: null,
								}),
							}),
						}),
					}
				}
				if (table === 'page_members') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								eq: vi.fn().mockReturnValue({
									single: vi.fn().mockResolvedValue({ data: null, error: null }),
								}),
							}),
						}),
					}
				}
				return {}
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'page-1', 'token-1')
		expect(role.role).toBe('viewer')
	})

	it('getDocumentOwnerPlan reads the owner plan via pages', async () => {
		const mockAdmin = {
			from: vi.fn().mockImplementation((table: string) => {
				if (table === 'pages') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({
									data: { owner_id: 'user-123' },
									error: null,
								}),
							}),
						}),
					}
				}
				if (table === 'profiles') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								single: vi.fn().mockResolvedValue({ data: { plan: 'pro' }, error: null }),
							}),
						}),
					}
				}
				return {}
			}),
		} as any

		const limit = await auth.getDocumentOwnerPlan(mockAdmin, 'page-1')
		expect(limit).toBe('pro')
	})

	it('indexPage writes links, tags and searchable_text via the admin client', async () => {
		let pageSelectCalls = 0
		const workspacePagesData = [{ id: 'priya-page', title: 'Priya' }]

		// Builder node that is both directly awaitable (indexPage awaits .eq() for the
		// workspace-pages fetch) and chainable (.maybeSingle() for getWorkspaceForPage).
		const makePageEq = () => ({
			maybeSingle: vi.fn(async () => {
				pageSelectCalls += 1
				if (pageSelectCalls === 1) return { data: { workspace_id: 'ws-1', properties: {} }, error: null }
				return { data: workspacePagesData, error: null }
			}),
			then: (onfulfilled: any) =>
				Promise.resolve({ data: workspacePagesData, error: null }).then(onfulfilled),
		})

		const admin = {
			from: vi.fn().mockImplementation((table: string) => {
				if (table === 'pages') {
					return {
						select: vi.fn().mockReturnValue({ eq: makePageEq }),
					}
				}
				return {}
			}),
			rpc: vi.fn().mockResolvedValue({ data: { links: 1, tags: 1 }, error: null }),
		} as any

		const result = await graphIndex.indexPage(admin, 'page-1', 'Meeting [[Priya]] #work')
		expect(result).toEqual({ links: 1, tags: 1 })
		expect(admin.rpc).toHaveBeenCalledTimes(1)
		expect(admin.rpc).toHaveBeenCalledWith('sync_page_graph', {
			p_page_id: 'page-1',
			p_workspace_id: 'ws-1',
			p_searchable_text: 'Meeting [[Priya]] #work',
			p_links: [
				{ workspace_id: 'ws-1', from_page_id: 'page-1', to_page_id: 'priya-page', to_title: 'Priya' },
			],
			p_tags: [{ page_id: 'page-1', tag: 'work' }],
		})
		expect(admin.from).toHaveBeenCalledWith('pages')
		expect(admin.from).not.toHaveBeenCalledWith('page_links')
		expect(admin.from).not.toHaveBeenCalledWith('page_tags')
	})

	it('verifyUserRole returns viewer for anonymous access to a public page', async () => {
		const mockSupabase = {
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: { owner_id: 'user-123', is_public: true },
							error: null,
						}),
					}),
				}),
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'page-1', 'anonymous')
		expect(role.role).toBe('viewer')
	})
})
