import React from 'react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { AlertTriangle, CheckCircle2, HelpCircle, Info, Lightbulb, MessageSquare, XCircle, type LucideIcon } from 'lucide-react'
import { calloutDisplayTitle } from '@/lib/callout'

const TYPE_ICONS: Record<string, LucideIcon> = {
	note: MessageSquare,
	warning: AlertTriangle,
	info: Info,
	tip: Lightbulb,
	success: CheckCircle2,
	danger: XCircle,
	question: HelpCircle,
}

/**
 * Resolve the icon for a callout type. `type` is user-controlled, so an
 * accepted custom type such as `constructor` or `toString` must fall back to
 * the default icon instead of resolving an inherited `Object.prototype` member
 * (rendering that as a React component throws).
 */
function CalloutIcon({ type }: { type: string }) {
	const Icon = Object.prototype.hasOwnProperty.call(TYPE_ICONS, type) ? TYPE_ICONS[type] : MessageSquare
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
				<span>{calloutDisplayTitle(type, title)}</span>
			</button>
			<NodeViewContent className="callout-content" />
		</NodeViewWrapper>
	)
}
