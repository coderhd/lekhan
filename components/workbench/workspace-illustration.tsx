import { FileText, RefreshCw } from 'lucide-react'

export function WorkspaceIllustration({ variant }: { variant: 'empty' | 'retry' }) {
	return (
		<div className="wb-state-art" aria-hidden="true">
			<span className="wb-state-sheet wb-state-sheet-back" />
			<span className="wb-state-sheet wb-state-sheet-front">
				{variant === 'retry' ? <RefreshCw size={24} /> : <FileText size={24} />}
			</span>
		</div>
	)
}
