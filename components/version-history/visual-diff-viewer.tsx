import React from 'react'
import { diffWordsWithSpace } from 'diff'

export interface VisualDiffViewerProps {
	previousText: string
	currentText: string
}

export function VisualDiffViewer({ previousText, currentText }: VisualDiffViewerProps) {
	if (previousText === currentText) {
		return <div className="whitespace-pre-wrap">{currentText || <span className="text-muted-foreground italic">Empty document</span>}</div>
	}

	const diffs = diffWordsWithSpace(previousText, currentText)

	return (
		<div className="whitespace-pre-wrap">
			{diffs.map((part, index) => {
				if (part.added) {
					return (
						<span key={index} className="text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 px-0.5 rounded">
							{part.value}
						</span>
					)
				}
				if (part.removed) {
					return (
						<span key={index} className="text-red-700 dark:text-red-300 bg-red-500/10 line-through px-0.5 rounded">
							{part.value}
						</span>
					)
				}
				return <span key={index}>{part.value}</span>
			})}
		</div>
	)
}
