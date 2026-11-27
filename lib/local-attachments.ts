import type { LocalAttachment } from './types'

const attachmentAnchor = /^#lekhan-file-([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})(?:-(.*))?$/i

export function attachmentDestination(file: LocalAttachment, fragment = '') {
  return '#lekhan-file-' + file.id + (fragment ? '-' + encodeURIComponent(fragment) : '')
}

export function attachmentReference(destination: string) {
  const found = attachmentAnchor.exec(destination)
  if (!found) return null
  let fragment = ''
  try { fragment = decodeURIComponent(found[2] ?? '') } catch { /* Leave a malformed suffix out. */ }
  return { id: found[1], fragment }
}

export function vaultFileIndex<T>(files: Map<string, T>) {
  const folded = new Map<string, T | null>()
  const byName = new Map<string, T | null>()
  for (const [path, file] of files) {
    const key = path.normalize('NFC').toLowerCase()
    const name = key.split('/').at(-1)!
    folded.set(key, folded.has(key) ? null : file)
    byName.set(name, byName.has(name) ? null : file)
  }
  return (target: string, source: string, wiki: boolean) => {
    if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target) || target.includes('\\')) return
    const relative = target.startsWith('/') ? [] : source.split('/').slice(0, -1)
    for (const step of target.split('/')) {
      if (!step || step === '.') continue
      if (step === '..') {
        if (!relative.length) return
        relative.pop()
      } else relative.push(step)
    }
    const direct = relative.join('/')
    const read = (path: string) => files.get(path) ?? folded.get(path.normalize('NFC').toLowerCase()) ?? undefined
    return read(direct) ?? (wiki && !target.startsWith('.') ? read(target.replace(/^\//, ''))
      ?? (!target.includes('/') ? byName.get(target.normalize('NFC').toLowerCase()) ?? undefined : undefined) : undefined)
  }
}
