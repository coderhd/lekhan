import type { Text } from 'yjs'

export function replaceSourceText(text: Text, current: string, next: string) {
  if (current === next) return
  let start = 0
  let suffix = 0
  while (start < current.length && start < next.length && current[start] === next[start]) start++
  while (suffix < current.length - start && suffix < next.length - start &&
    current[current.length - suffix - 1] === next[next.length - suffix - 1]) suffix++
  if (start > 0 && /[\uD800-\uDBFF]/.test(current[start - 1] ?? '')) start--
  if (suffix > 0 && /[\uDC00-\uDFFF]/.test(current[current.length - suffix] ?? '')) suffix--
  const removed = current.length - start - suffix
  if (removed > 0) text.delete(start, removed)
  const inserted = next.slice(start, next.length - suffix)
  if (inserted) text.insert(start, inserted)
}
