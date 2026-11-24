export const workspaceShortcuts = [
  { action: 'searchPages', key: 'k' },
  { action: 'quickSwitch', key: 'k', shift: true },
  { action: 'newPage', key: 'n', shift: true },
  { action: 'toggleNavigation', key: '\\' },
  { action: 'previousPage', key: 'ArrowLeft', alt: true },
  { action: 'nextPage', key: 'ArrowRight', alt: true },
  { action: 'exportMarkdown', key: 'e', shift: true },
  { action: 'deletePage', key: 'Backspace', shift: true },
  { action: 'keyboardShortcuts', key: '/' },
] as const satisfies readonly { action: string; key: string; shift?: true; alt?: true }[]

export function workspaceShortcut(event: KeyboardEvent) {
  if (event.isComposing || event.defaultPrevented || event.repeat || event.metaKey === event.ctrlKey) return
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  return workspaceShortcuts.find(shortcut => shortcut.key === key
    && ('shift' in shortcut) === event.shiftKey && ('alt' in shortcut) === event.altKey)?.action
}
