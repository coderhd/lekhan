/**
 * #30 T2 — public reading surface footer. Rendered under the editor scroll
 * region only for anonymous visitors (`anonVisitor`): closes the viral loop
 * by inviting the reader to create their own workspace, and adds the
 * "Powered by Lekhan" brand signal the publish story depends on.
 */
export default function PublicPageFooter() {
	return (
		<footer className="mt-10 pb-2 flex flex-col items-center gap-3 text-center">
			<a
				href="/signup"
				className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-container text-on-primary-container text-sm font-bold hover:brightness-110 active:scale-95 premium-transition shadow-sm"
			>
				Create your own workspace
				<span aria-hidden="true">→</span>
			</a>
			<p className="text-xs text-on-surface-variant/70 font-label-sm">
				Powered by <span className="font-bold text-on-surface-variant">Lekhan</span>
			</p>
		</footer>
	)
}
