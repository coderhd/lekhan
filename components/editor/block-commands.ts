import type { ChainedCommands } from '@tiptap/react'
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  Quote,
  type LucideIcon,
} from 'lucide-react'

export interface BlockCommand {
  label: string
  aliases: string
  icon: LucideIcon
  apply: (chain: ChainedCommands) => ChainedCommands
}

export const blockCommands: BlockCommand[] = [
  { label: 'Text', aliases: 'paragraph normal', icon: Pilcrow, apply: (chain) => chain.setParagraph() },
  { label: 'Heading 1', aliases: 'h1 title', icon: Heading1, apply: (chain) => chain.setHeading({ level: 1 }) },
  { label: 'Heading 2', aliases: 'h2 subtitle', icon: Heading2, apply: (chain) => chain.setHeading({ level: 2 }) },
  { label: 'Heading 3', aliases: 'h3', icon: Heading3, apply: (chain) => chain.setHeading({ level: 3 }) },
  { label: 'Bulleted list', aliases: 'bullet unordered ul', icon: List, apply: (chain) => chain.toggleBulletList() },
  { label: 'Numbered list', aliases: 'ordered ol', icon: ListOrdered, apply: (chain) => chain.toggleOrderedList() },
  { label: 'Task list', aliases: 'todo checklist checkbox', icon: ListTodo, apply: (chain) => chain.toggleTaskList() },
  { label: 'Quote', aliases: 'blockquote', icon: Quote, apply: (chain) => chain.setBlockquote() },
  { label: 'Code block', aliases: 'pre fenced', icon: Code2, apply: (chain) => chain.setCodeBlock() },
  { label: 'Divider', aliases: 'horizontal rule line hr', icon: Minus, apply: (chain) => chain.setHorizontalRule() },
]
