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
  id: string
  aliases: string
  icon: LucideIcon
  apply: (chain: ChainedCommands) => ChainedCommands
}

export const blockCommands = [
  { id: 'blockText', aliases: 'text paragraph normal', icon: Pilcrow, apply: (chain) => chain.setParagraph() },
  { id: 'blockHeading1', aliases: 'heading 1 h1 title', icon: Heading1, apply: (chain) => chain.setHeading({ level: 1 }) },
  { id: 'blockHeading2', aliases: 'heading 2 h2 subtitle', icon: Heading2, apply: (chain) => chain.setHeading({ level: 2 }) },
  { id: 'blockHeading3', aliases: 'heading 3 h3', icon: Heading3, apply: (chain) => chain.setHeading({ level: 3 }) },
  { id: 'blockBulletList', aliases: 'bulleted list bullet unordered ul', icon: List, apply: (chain) => chain.toggleBulletList() },
  { id: 'blockNumberedList', aliases: 'numbered list ordered ol', icon: ListOrdered, apply: (chain) => chain.toggleOrderedList() },
  { id: 'blockTaskList', aliases: 'task list todo checklist checkbox', icon: ListTodo, apply: (chain) => chain.toggleTaskList() },
  { id: 'blockQuote', aliases: 'quote blockquote', icon: Quote, apply: (chain) => chain.setBlockquote() },
  { id: 'blockCode', aliases: 'code block pre fenced', icon: Code2, apply: (chain) => chain.setCodeBlock() },
  { id: 'blockDivider', aliases: 'divider horizontal rule line hr', icon: Minus, apply: (chain) => chain.setHorizontalRule() },
] as const satisfies readonly BlockCommand[]
