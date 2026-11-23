import * as Y from 'yjs'
import { maxPageUpdateBytes } from '../sync/wire.ts'
import { replaceSourceText } from '../sync/replace-source.ts'

export const checkpointMaxBytes = 20 * 1024 * 1024
export const checkpointTransferBytes = maxPageUpdateBytes
export const checkpointInlineBytes = 4 * 1024 * 1024

export interface Checkpoint {
  id: string
  version_name: string
  created_at: string
}

export function checkpointName(value: string | null) {
  const name = value?.trim() ?? ''
  return name.length > 0 && name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null
}

export function replaceCheckpointContent(target: Y.Doc, snapshot: Y.Doc, origin: unknown) {
  const metadata = snapshot.getMap('lekhan')
  const source = metadata.get('mode') === 'source'
  const frontmatter = metadata.get('frontmatter')
  const rich = snapshot.getXmlFragment('default').toArray().map(node => {
    if (node instanceof Y.XmlElement || node instanceof Y.XmlText) return node.clone()
    throw new Error('This checkpoint contains unsupported blocks.')
  })
  const text = snapshot.getText('source').toString()
  target.transact(() => {
    const mode = target.getMap('lekhan')
    if (source) mode.set('mode', 'source')
    else mode.delete('mode')
    if (typeof frontmatter === 'string') mode.set('frontmatter', frontmatter)
    else mode.delete('frontmatter')

    const fragment = target.getXmlFragment('default')
    if (fragment.length) fragment.delete(0, fragment.length)
    if (rich.length) fragment.insert(0, rich)

    const markdown = target.getText('source')
    replaceSourceText(markdown, markdown.toString(), text)
  }, origin)
}
