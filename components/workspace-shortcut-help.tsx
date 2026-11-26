import { X } from 'lucide-react'
import { workspaceShortcuts } from '@/lib/workspace-shortcuts'
import { useTranslations } from '@/lib/i18n/client'
import { Dialog } from './workspace-dialogs'

const keyLabels: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', Backspace: '⌫' }

export default function WorkspaceShortcutHelp({ onClose }: { onClose: () => void }) {
  const t = useTranslations('app-shell')
  const mac = /Mac|iPhone|iPad/.test(navigator.platform)
  return <Dialog title={t('keyboardShortcuts')} onClose={onClose} className="shortcut-dialog">
    <div className="form-dialog">
      <header className="shortcut-dialog-header">
        <h2>{t('keyboardShortcuts')}</h2>
        <button className="icon-button" type="button" aria-label={t('close')} onClick={onClose} autoFocus>
          <X size={17} aria-hidden="true" />
        </button>
      </header>
      <dl className="shortcut-list">
        {workspaceShortcuts.map(shortcut => <div key={shortcut.action}>
          <dt>{t(shortcut.action)}</dt>
          <dd>
            <kbd>{mac ? '⌘' : 'Ctrl'}</kbd>
            {'alt' in shortcut && <kbd>{mac ? '⌥' : 'Alt'}</kbd>}
            {'shift' in shortcut && <kbd>{mac ? '⇧' : 'Shift'}</kbd>}
            <kbd>{keyLabels[shortcut.key] ?? shortcut.key.toUpperCase()}</kbd>
          </dd>
        </div>)}
      </dl>
    </div>
  </Dialog>
}
