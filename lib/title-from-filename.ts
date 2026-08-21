/**
 * Derive a page title from a filename: the extension is stripped and
 * separators collapse to spaces. The design's fallback when the frontmatter
 * has no `title`. Lives in `lib/` (dependency-free) so client-side importers
 * can use it without pulling the Supabase client in through `services/import`.
 */
export function titleFromFilename(filename: string): string {
	const base = filename.replace(/\.(md|markdown|mdown|txt)$/i, '').trim()
	if (!base) return 'Untitled'
	return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}