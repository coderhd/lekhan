import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// GV-T3 fixture proof for `fetchPageBacklinks` (SIL-208).
//
// Two layers:
//
// 1. Always-on *contract fixture*: the real `fetchPageBacklinks` and the real
//    `@supabase/supabase-js` client talk HTTP to an in-process PostgREST-shaped
//    server. It serves a `page_links` fixture, honours the `to_page_id` filter
//    and applies the `select_page_links` policy's member-visibility decision
//    (a member sees rows, a stranger gets an RLS-shaped empty set).
//
// 2. Opt-in *real Supabase* proof: when a disposable project is configured via
//    TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY /
//    TEST_SUPABASE_SERVICE_ROLE_KEY, it provisions two throwaway auth users,
//    pages and a link through the service role, then proves a member reads the
//    backlink while a non-member does not. It skips (with a clear reason) when
//    those variables are absent so the default suite never touches a real DB.
// ---------------------------------------------------------------------------

const holder = vi.hoisted(() => ({ client: null as unknown as SupabaseClient }))

vi.mock('@/lib/supabase', () => ({
	supabase: { from: (table: string) => holder.client.from(table) },
}))

// Imported after the mock declaration so the service resolves `@/lib/supabase`
// to the swappable fixture client.
import { fetchPageBacklinks } from '@/services/graph'

interface FixtureLink {
	from_page_id: string
	from_title: string
	to_page_id: string
}

const LINK: FixtureLink = { from_page_id: 'a-1', from_title: 'Alpha', to_page_id: 'b-1' }

let server: Server
let memberClient: SupabaseClient
let strangerClient: SupabaseClient
const seenQueries: string[] = []

function createFixtureServer (): Server {
	return createServer((req, res) => {
		const url = new URL(req.url || '/', 'http://127.0.0.1')
		if (url.pathname !== '/rest/v1/page_links') {
			res.writeHead(404, { 'content-type': 'application/json' })
			res.end('{"message":"not found"}')
			return
		}

		seenQueries.push(url.search)
		const apiKey = String(req.headers.apikey ?? '')
		const toPageId = (url.searchParams.get('to_page_id') || '').replace(/^eq\./, '')

		// Fixture stand-in for the `select_page_links` RLS policy: a member sees
		// links whose endpoints they can access; a stranger sees none.
		const visible = apiKey === 'member-key' && toPageId === LINK.to_page_id

		res.writeHead(200, { 'content-type': 'application/json' })
		res.end(JSON.stringify(visible
			? [{ from_page_id: LINK.from_page_id, pages: { title: LINK.from_title } }]
			: []))
	})
}

describe('fetchPageBacklinks — PostgREST contract fixture', () => {
	beforeAll(async () => {
		server = createFixtureServer()
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		const { port } = server.address() as AddressInfo
		const url = `http://127.0.0.1:${port}`

		memberClient = createClient(url, 'member-key', {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		})
		strangerClient = createClient(url, 'stranger-key', {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		})
	})

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
	})

	beforeEach(() => {
		seenQueries.length = 0
		holder.client = memberClient
	})

	it('maps real PostgREST rows into Backlink records for a member', async () => {
		const result = await fetchPageBacklinks('b-1')

		expect(result).toEqual([{ from_page_id: 'a-1', from_title: 'Alpha' }])
		expect(seenQueries[0]).toContain('to_page_id=eq.b-1')
	})

	it('returns an empty list for a non-member (RLS-shaped response)', async () => {
		holder.client = strangerClient
		expect(await fetchPageBacklinks('b-1')).toEqual([])
	})

	it('does not surface links to an unrelated target page', async () => {
		expect(await fetchPageBacklinks('some-other-page')).toEqual([])
	})
})

// ---------------------------------------------------------------------------
// Opt-in real project proof. Configure this only with a disposable project.
// ---------------------------------------------------------------------------

const realConfig = {
	url: process.env.TEST_SUPABASE_URL,
	anonKey: process.env.TEST_SUPABASE_ANON_KEY,
	serviceKey: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY,
}

const hasRealProject = Boolean(realConfig.url && realConfig.anonKey && realConfig.serviceKey)

describe.skipIf(!hasRealProject)('fetchPageBacklinks — real Supabase fixture', () => {
	let admin: SupabaseClient
	const createdUserIds: string[] = []
	const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
	const memberEmail = `backlink-fixture-member-${suffix}@example.test`
	const strangerEmail = `backlink-fixture-stranger-${suffix}@example.test`
	const password = `fixture-${suffix}-Pw1!`

	let targetPageId: string

	beforeAll(async () => {
		admin = createClient(realConfig.url!, realConfig.serviceKey!, {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		})

		const member = await admin.auth.admin.createUser({ email: memberEmail, password, email_confirm: true })
		if (member.error) throw member.error
		const stranger = await admin.auth.admin.createUser({ email: strangerEmail, password, email_confirm: true })
		if (stranger.error) throw stranger.error
		createdUserIds.push(member.data.user.id, stranger.data.user.id)

		const workspace = await admin
			.from('workspaces')
			.insert({ name: `backlink fixture ${suffix}`, owner_id: member.data.user.id })
			.select('id')
			.single()
		if (workspace.error) throw workspace.error

		const source = await admin
			.from('pages')
			.insert({ workspace_id: workspace.data.id, owner_id: member.data.user.id, title: 'Alpha source' })
			.select('id')
			.single()
		if (source.error) throw source.error

		const target = await admin
			.from('pages')
			.insert({ workspace_id: workspace.data.id, owner_id: member.data.user.id, title: 'Beta target' })
			.select('id')
			.single()
		if (target.error) throw target.error
		targetPageId = target.data.id

		const link = await admin.from('page_links').insert({
			workspace_id: workspace.data.id,
			from_page_id: source.data.id,
			to_page_id: targetPageId,
			to_title: 'Beta target',
		})
		if (link.error) throw link.error
	})

	afterAll(async () => {
		await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)))
	})

	afterEach(async () => {
		await holder.client?.auth.signOut()
	})

	it('resolves the inbound link for a member and hides it from a non-member', async () => {
		const member = createClient(realConfig.url!, realConfig.anonKey!, {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		})
		const signIn = await member.auth.signInWithPassword({ email: memberEmail, password })
		if (signIn.error) throw signIn.error

		holder.client = member
		const asMember = await fetchPageBacklinks(targetPageId)
		expect(asMember.map((row) => row.from_title)).toEqual(['Alpha source'])

		const stranger = createClient(realConfig.url!, realConfig.anonKey!, {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		})
		const strangerSignIn = await stranger.auth.signInWithPassword({ email: strangerEmail, password })
		if (strangerSignIn.error) throw strangerSignIn.error

		holder.client = stranger
		expect(await fetchPageBacklinks(targetPageId)).toEqual([])
	})
})
