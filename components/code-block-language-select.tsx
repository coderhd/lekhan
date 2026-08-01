'use client'

import { Editor } from '@tiptap/react'
import { Code2 } from 'lucide-react'

const LANGUAGES = [
	{ label: 'Auto / Plain Text', value: '' },
	{ label: 'JavaScript', value: 'javascript' },
	{ label: 'TypeScript', value: 'typescript' },
	{ label: 'Python', value: 'python' },
	{ label: 'HTML', value: 'html' },
	{ label: 'CSS', value: 'css' },
	{ label: 'JSON', value: 'json' },
	{ label: 'Bash / Shell', value: 'bash' },
	{ label: 'SQL', value: 'sql' },
	{ label: 'Markdown', value: 'markdown' },
	{ label: 'C++', value: 'cpp' },
	{ label: 'Java', value: 'java' },
	{ label: 'Rust', value: 'rust' },
	{ label: 'Go', value: 'go' },
	{ label: 'PHP', value: 'php' },
	{ label: 'Ruby', value: 'ruby' },
]

interface CodeBlockLanguageSelectProps {
	editor: Editor | null
}

export function CodeBlockLanguageSelect({ editor }: CodeBlockLanguageSelectProps) {
	if (!editor || !editor.isActive('codeBlock')) {
		return null
	}

	const currentLanguage = editor.getAttributes('codeBlock').language || ''

	return (
		<div className="flex items-center gap-1.5 p-1 bg-surface-container border border-black/10 dark:border-white/10 rounded-xl shadow-lg z-30 text-xs">
			<Code2 className="w-4 h-4 text-primary ml-1" />
			<span className="font-semibold text-on-surface-variant">Language:</span>
			<select
				value={currentLanguage}
				onChange={(e) => {
					editor.chain().focus().updateAttributes('codeBlock', { language: e.target.value }).run()
				}}
				className="bg-background text-on-surface border border-black/10 dark:border-white/10 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer text-xs"
			>
				{LANGUAGES.map((lang) => (
					<option key={lang.value} value={lang.value}>
						{lang.label}
					</option>
				))}
			</select>
		</div>
	)
}
