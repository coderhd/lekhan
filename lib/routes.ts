/**
 * Route classification shared by global chrome (header/footer) and analytics.
 *
 * The editor renders edge-to-edge with its own navbar and bottom bar — no
 * global header/footer (decision from the editor-enhancement work), and no
 * GA4 pageviews (document IDs must not leak into analytics URLs).
 *
 * The editor lived at /doc/* before the p2 client cutover and lives at
 * /page/[id] now. Legacy /doc links still resolve, so both count.
 */

const EDITOR_ROUTE_RE = /^\/page(\/|$)/
const LEGACY_EDITOR_ROUTE_RE = /^\/doc(\/|$)/

export function isEditorPathname (pathname: string | null | undefined): boolean {
	if (!pathname) return false
	return EDITOR_ROUTE_RE.test(pathname) || LEGACY_EDITOR_ROUTE_RE.test(pathname)
}
