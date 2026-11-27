'use client'

import { type ComponentProps, useState } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { AlignLeft, Languages, PenLine, Sparkles, SpellCheck } from 'lucide-react'
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/Stack'
import { useTranslations } from '@/lib/i18n/client'
import { type EditorAction, maxEditorActionChars, replaceSourceRange, selectedSourceRange } from '@/lib/ai/editor-actions'
import AssistantDialog, { type LocalAssistantModel } from '../assistant-dialog'
import type { ProviderTransport } from '@/lib/ai/client'
import { suggestionTransaction } from './selection-edits'

type Selection = { text: string; apply: (result: string, append: boolean) => boolean }
export type EditorAssistant = {
  storageScope: string; localModel?: LocalAssistantModel; localModels?: readonly LocalAssistantModel[]; transport?: ProviderTransport
}

const actions = [
  ['polish', Sparkles], ['summarize', AlignLeft], ['translate', Languages], ['grammar', SpellCheck], ['continue', PenLine],
] as const

function SelectionActions({ start }: { start: (action: EditorAction) => void }) {
  const t = useTranslations('editor-ai')
  return (
    <HStack gap={1} wrap="wrap" className="selection-ai-actions" role="group" aria-label={t('actions')}>
      {actions.map(([action, Icon]) => (
        <Button
          key={action}
          type="button"
          variant="ghost"
          size="sm"
          icon={<Icon size={15} aria-hidden="true" />}
          label={t(action)}
          tooltip={t(action)}
          onMouseDown={event => event.preventDefault()}
          onClick={() => start(action)}
        />
      ))}
    </HStack>
  )
}

function supportsSelection(editor: Editor) {
  const { selection } = editor.state
  return selection instanceof TextSelection && !selection.empty && selection.to - selection.from <= maxEditorActionChars
    && selection.$from.parent.isTextblock && selection.$to.parent.isTextblock
    && !selection.$from.parent.type.spec.code && !selection.$to.parent.type.spec.code
    && !!editor.state.doc.textBetween(selection.from, selection.to, '\n').trim()
}

export function RichSelectionAI({ editor, assistant, formattingMenuOpen }: {
  editor: Editor; assistant: EditorAssistant; formattingMenuOpen: boolean
}) {
  const [request, setRequest] = useState<{ action: EditorAction; selection: Selection }>()

  function start(action: EditorAction) {
    if (!editor.isEditable || !supportsSelection(editor)) return
    const { doc, selection: { from, to } } = editor.state
    setRequest({ action, selection: {
      text: doc.textBetween(from, to, '\n'),
      apply(result, append) {
        if (editor.isDestroyed || !editor.isEditable) return false
        const tr = suggestionTransaction(editor.state, { doc, from, to }, result, append)
        if (!tr) return false
        editor.view.dispatch(tr.scrollIntoView())
        return true
      },
    } })
  }

  return <>
    {!request && !formattingMenuOpen && <BubbleMenu editor={editor} className="selection-ai-popover"
      options={{ strategy: 'fixed', placement: 'bottom-start', offset: 8, flip: true, shift: { padding: 10 } }}
      updateDelay={100} shouldShow={({ view, element }) => editor.isEditable && supportsSelection(editor)
        && (view.hasFocus() || element.contains(document.activeElement))}>
      <SelectionActions start={start} />
    </BubbleMenu>}
    {request && <AssistantDialog {...assistant} onClose={() => setRequest(undefined)} editorRequest={request} />}
  </>
}

export function AssistedMarkdownSource({ markdown, onChange, onApply, assistant, ...textarea }: Omit<ComponentProps<'textarea'>, 'value' | 'onChange' | 'onSelect'> & {
  markdown: string; onChange: (value: string) => void; assistant?: EditorAssistant
  onApply?: (value: string, expected: string) => boolean
}) {
  const [range, setRange] = useState<{ from: number; to: number }>()
  const [request, setRequest] = useState<{ action: EditorAction; source: string; selection: NonNullable<ReturnType<typeof selectedSourceRange>> }>()
  const selection = range && assistant && !textarea.readOnly ? selectedSourceRange(markdown, range.from, range.to) : null

  return <>
    {selection && !request && <SelectionActions start={action => setRequest({ action, source: markdown, selection })} />}
    <textarea {...textarea} value={markdown} onChange={event => onChange(event.target.value)}
      onSelect={event => setRange({ from: event.currentTarget.selectionStart, to: event.currentTarget.selectionEnd })} />
    {request && assistant && !textarea.readOnly && <AssistantDialog {...assistant} onClose={() => setRequest(undefined)}
      editorRequest={{ action: request.action, selection: {
        text: request.selection.text,
        apply(result, append) {
          if (markdown !== request.source) return false
          const next = replaceSourceRange(markdown, request.selection, result, append)
          if (onApply) {
            if (!onApply(next, request.source)) return false
          } else onChange(next)
          setRange(undefined)
          return true
        },
      } }} />}
  </>
}
