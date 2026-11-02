import type { Metadata } from 'next'
import GraphPage from '@/components/graph-page'

export const metadata: Metadata = {
	title: 'Graph — Lekhan',
	description: 'Explore the pages and page links in your workspace as a graph.',
}

/**
 * `/graph` route entry point.
 *
 * This is a server component shell (metadata + static chrome) because the rest
 * of the app keeps the Supabase session in the browser (there is no cookie-based
 * SSR client), so the authed fetch has to run in the client boundary. The
 * boundary is `GraphPage`, which redirects signed-out visitors to `/login` and
 * serializes `fetchWorkspaceGraph` into the canvas props. The route is still
 * read-only: it only calls the existing read queries.
 */
export default function GraphRoute () {
	return <GraphPage />
}
