import React from 'react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { AlertTriangle, CheckCircle2, HelpCircle, Info, Lightbulb, MessageSquare, XCircle, type LucideIcon } from 'lucide-react'

const TYPE_ICONS: Record<string, LucideIcon> = {
	note: MessageSquare,
	warning: AlertTriangle,
	info: Info,
	tip: Lightbulb,
	success: CheckCircle2,
	danger: XCircle,
	question: HelpCircle,
}

const DEFAULT_TITLES: Record<string, string> = {
	note: 'Note',
	warning: 'Warning',
	info: 'Info',
	tip: 'Tip',
	success: 'Success',
	danger: 'Danger',
	question: 'Question',
}

function CalloutIcon({ type }: { type: string }) {
	const Icon = TYPE_ICONS[type] ?? MessageSquare
	return <Icon aria-hidden />
}

export const CalloutNodeView = ({ node, updateAttributes, selected }: any) => {
	const { type, title, collapsed } = node.attrs
	const toggle = () => updateAttributes({ collapsed: !collapsed })
	return (
		<NodeViewWrapper
			className={`callout callout-${type} ${selected ? 'ProseMirror-selectednode' : ''}`}
			data-callout="true"
			data-callout-type={type}
			data-callout-collapsed={String(collapsed)}
		>
			<button className="callout-title" onClick={toggle} aria-expanded={!collapsed}>
				<CalloutIcon type={type} />
				<span>{title || DEFAULT_TITLES[type] || type}</span>
			</button>
			<NodeViewContent className="callout-content" />
		</NodeViewWrapper>
	)
}
