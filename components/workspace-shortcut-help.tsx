'use client'

import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Kbd } from '@astryxdesign/core/Kbd'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { useTranslations } from '@/lib/i18n/client'
import { workspaceShortcuts } from '@/lib/workspace-shortcuts'

const shortcutKeyMap: Record<string, string> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Backspace: 'backspace',
}

export default function WorkspaceShortcutHelp({ onClose }: { onClose: () => void }) {
  const t = useTranslations('app-shell')
  return (
    <Dialog isOpen onOpenChange={open => { if (!open) onClose() }} width={480} padding={0}>
      <Layout
        header={<DialogHeader title={t('keyboardShortcuts')} onOpenChange={open => { if (!open) onClose() }} />}
        content={
          <LayoutContent>
            <dl className="shortcut-list">
              {workspaceShortcuts.map(shortcut => {
                const keys = [
                  'mod',
                  ...('alt' in shortcut && shortcut.alt ? ['alt'] : []),
                  ...('shift' in shortcut && shortcut.shift ? ['shift'] : []),
                  shortcutKeyMap[shortcut.key] ?? shortcut.key.toLowerCase(),
                ].join('+')
                return (
                  <div key={shortcut.action}>
                    <dt>{t(shortcut.action)}</dt>
                    <dd><Kbd keys={keys} /></dd>
                  </div>
                )
              })}
            </dl>
          </LayoutContent>
        }
      />
    </Dialog>
  )
}
